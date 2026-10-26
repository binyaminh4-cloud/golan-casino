-- Dealer stops after revealing the hole card when every player hand is already bust or surrendered (unless a Buster bet needs her full hand).
create or replace function bj_finish(p_round uuid) returns void language plpgsql security definer set search_path = public as $$
declare r bj_rounds; d text[]; dt int; dbj boolean; pay bigint := 0; h jsonb; pc text[]; pt int; res jsonb := '[]'; m int; v_side jsonb := '{}';
        any_live boolean := false; single boolean; v_extra bigint := 0; v_earn int; v_tier text; fh jsonb;
begin
  select * into r from bj_rounds where id = p_round for update;
  if r.status = 'done' then return; end if;
  if r.ch_run is not null then perform set_config('gc.ch_run', r.ch_run::text, true); end if;
  d := r.dealer; dbj := bj_is_bj(d);
  single := jsonb_array_length(r.hands) = 1;
  -- Dealer always completes the hand unless it already has blackjack (Buster bet needs the full hand).
  if not dbj and (coalesce((r.side->>'bust')::bigint, 0) > 0 or exists (select 1 from jsonb_array_elements(r.hands) x
        where not coalesce((x->>'surrendered')::boolean, false) and bj_total(bj_jcards(x->'cards')) <= 21)) then
    while bj_total(d) < 17 loop d := d || bj_draw(r.user_id); end loop;
  end if;
  dt := bj_total(d);

  for h in select * from jsonb_array_elements(r.hands) loop
    pc := bj_jcards(h->'cards'); pt := bj_total(pc);
    if (h->>'surrendered')::boolean then
      pay := pay + (h->>'bet')::bigint / 2; res := res || jsonb_build_object('outcome','surrender');
    elsif single and bj_is_bj(pc) and not dbj and not (h->>'split')::boolean then
      pay := pay + (h->>'bet')::bigint * 5 / 2; res := res || jsonb_build_object('outcome','blackjack');
    elsif dbj then
      if single and bj_is_bj(pc) then pay := pay + (h->>'bet')::bigint; res := res || jsonb_build_object('outcome','push');
      else res := res || jsonb_build_object('outcome','lose'); end if;
    elsif pt > 21 then res := res || jsonb_build_object('outcome','bust');
    elsif dt > 21 or pt > dt then pay := pay + (h->>'bet')::bigint * 2; res := res || jsonb_build_object('outcome','win');
    elsif pt = dt then pay := pay + (h->>'bet')::bigint; res := res || jsonb_build_object('outcome','push');
    else res := res || jsonb_build_object('outcome','lose'); end if;
  end loop;

  -- Lightning: a winning hand holding a struck rank has its profit multiplied by the highest struck multiplier in it.
  if r.mode = 'lightning' then
    select coalesce(sum(case x.oo->>'outcome' when 'blackjack' then (x.hh->>'bet')::bigint * 3 / 2 when 'win' then (x.hh->>'bet')::bigint else 0 end
                        * (bj_hand_mult(x.hh->'cards', r.strikes) - 1)), 0),
           coalesce(jsonb_agg(bj_hand_mult(x.hh->'cards', r.strikes) order by x.ia), '[]')
      into v_extra, fh
      from (select a.hh, a.ia, b.oo from jsonb_array_elements(r.hands) with ordinality a(hh, ia) join jsonb_array_elements(res) with ordinality b(oo, ib) on a.ia = b.ib) x;
    pay := pay + v_extra;
    v_side := v_side || jsonb_build_object('strike_extra', v_extra, 'hand_mults', fh);
  end if;

  -- Insurance pays 2:1 (returns 3x stake) when dealer has blackjack.
  if r.insurance > 0 and dbj then pay := pay + r.insurance * 3; v_side := v_side || '{"insurance":"win"}'; end if;

  -- Side bets resolved on the initial cards.
  pc := bj_jcards(r.hands->0->'cards0');
  if coalesce((r.side->>'pp')::bigint,0) > 0 then m := bj_pp(pc[1], pc[2]);
     pay := pay + case when m > 0 then (r.side->>'pp')::bigint * (m+1) else 0 end; v_side := v_side || jsonb_build_object('pp', m); end if;
  if coalesce((r.side->>'t3')::bigint,0) > 0 then m := bj_t3(pc[1], pc[2], d[1]);
     pay := pay + case when m > 0 then (r.side->>'t3')::bigint * (m+1) else 0 end; v_side := v_side || jsonb_build_object('t3', m); end if;
  if coalesce((r.side->>'ll')::bigint,0) > 0 then m := bj_ll(pc[1], pc[2], dbj);
     pay := pay + case when m > 0 then (r.side->>'ll')::bigint * (m+1) else 0 end; v_side := v_side || jsonb_build_object('ll', m); end if;
  if coalesce((r.side->>'bust')::bigint,0) > 0 then m := case when dt > 21 then bj_bust_mult(array_length(d,1)) else 0 end;
     pay := pay + case when m > 0 then (r.side->>'bust')::bigint * (m+1) else 0 end; v_side := v_side || jsonb_build_object('bust', m); end if;

  update bj_rounds set status = 'done', dealer = d, payout = pay, finished_at = now(),
         result = jsonb_build_object('hands', res, 'side', v_side, 'dealer_blackjack', dbj, 'net', pay - r.total_staked)
   where id = p_round;
  if pay > 0 then perform bj_tx(r.user_id, case r.mode when 'lightning' then 'lightning_blackjack' else 'blackjack' end, 'payout', pay, 'bjpay:' || p_round); end if;
  if r.ch_run is not null then perform ch_hand_done(r.ch_run); end if;
end $$;

create or replace function bjt_resolve(p_t int, p_n bigint) returns void language plpgsql security definer set search_path = public as $$
declare d text[]; v_id uuid;
begin
  perform set_config('gc.bj_table', p_t::text, true);
  select dealer into d from bjt_rounds where t_no = p_t and round_no = p_n for update;
  -- the dealer plays only if someone still has a live hand (or a Buster bet)
  if d is not null and not bj_is_bj(d) and exists (select 1 from bj_rounds r where r.t_no = p_t and r.t_round = p_n and r.status <> 'done' and
        (coalesce((r.side->>'bust')::bigint, 0) > 0 or exists (select 1 from jsonb_array_elements(r.hands) x
          where not coalesce((x->>'surrendered')::boolean, false) and bj_total(bj_jcards(x->'cards')) <= 21))) then
    while bj_total(d) < 17 loop d := d || bj_draw(null); end loop;
  end if;
  update bj_rounds set dealer = d where t_no = p_t and t_round = p_n and status <> 'done';
  for v_id in select id from bj_rounds where t_no = p_t and t_round = p_n and status <> 'done' loop
    perform bj_finish(v_id);
  end loop;
  update bjt_rounds set phase = 'done', dealer = d, done_at = rl_live_now() where t_no = p_t and round_no = p_n;
end $$;

-- Live roulette 20 seconds shorter: 50-second rounds, 20 s to bet. Pay every bet open on the old clock first.
do $$ declare b record; v_pay bigint; v_game text; begin
  for b in select lb.*, r.result, case lb.mode when 'lightning' then r.lucky_l when 'xxx' then r.lucky_x else '{}'::jsonb end as lucky
           from rl_live_bets lb join rl_live_rounds r using (round_no) where not lb.settled and r.result is not null for update of lb loop
    v_pay := rl_pay2(b.bets, b.result, b.mode, b.lucky);
    v_game := case b.mode when 'classic' then 'roulette' when 'lightning' then 'lightning_roulette' else 'xxx_roulette' end;
    if v_pay > 0 then perform apply_tx(b.user_id, v_game, 'payout', v_pay, 'rllpay:' || b.id); end if;
    update rl_live_bets set payout = v_pay, settled = true where id = b.id;
  end loop;
end $$;
update zeus_duels set status = 'expired', finished_at = now() where status in ('invited', 'active');
create or replace function rl_live_cycle() returns int language sql immutable as $$ select 50 $$;
create or replace function rl_live_window() returns int language sql immutable as $$ select 20 $$;

-- Online indicator: every open page polls the chat, which stamps the member as seen.
alter table profiles add column if not exists last_seen timestamptz;
create or replace function chat_since(p_room text, p_after bigint default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  update profiles set last_seen = now() where id = auth.uid() and (last_seen is null or last_seen < now() - interval '20 seconds');
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'body', m.body, 'at', m.created_at,
           'uid', m.user_id, 'name', p.nickname) order by m.id), '[]') into v
  from (select * from chat_messages where room = p_room and id > coalesce(p_after, 0) order by id desc limit 40) m
  left join profiles p on p.id = m.user_id;
  return v;
end $$;
create or replace function gc_online() returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(id, extract(epoch from now() - last_seen)::int), '{}') from profiles where last_seen is not null and auth.uid() is not null $$;
revoke all on function gc_online() from public, anon; grant execute on function gc_online() to authenticated;

-- Live roulette: everyone's chips (amounts), balances and winnings are visible at the table.
create or replace function rl_live_state(p_mode text default 'classic') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); t numeric; n bigint; c int := rl_live_cycle(); w int := rl_live_window();
        r rl_live_rounds; open boolean; v_mine jsonb; v_pay bigint; v_players jsonb; v_hist jsonb;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_mode not in ('classic', 'lightning', 'xxx') then raise exception 'invalid_mode'; end if;
  perform rl_live_settle();
  insert into rl_presence (user_id, mode, seen_at) values (u, p_mode, now()) on conflict (user_id) do update set mode = excluded.mode, seen_at = now();
  t := rl_live_now(); n := floor(t / c);
  perform rl_live_ensure(n);
  select * into r from rl_live_rounds where round_no = n;
  open := t < n * c + w;
  select coalesce(jsonb_agg(x), '[]'), case when bool_and(settled) then sum(payout) end
    into v_mine, v_pay
    from (select jsonb_array_elements(bets) x, settled, payout from rl_live_bets where round_no = n and user_id = u and mode = p_mode) q;
  select coalesce(sum(payout), null) into v_pay from rl_live_bets where round_no = n and user_id = u and mode = p_mode and settled;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.nickname, 'total', s.tot, 'nums', s.nums, 'bets', s.bets,
           'payout', case when open then null else s.pay end, 'bal', (select balance from wallets w where w.user_id = s.user_id)) order by s.tot desc), '[]')
    into v_players
    from (select user_id, sum(total) tot, sum(payout) filter (where settled) pay,
                 (select jsonb_agg(distinct e->'nums') from rl_live_bets b2, jsonb_array_elements(b2.bets) e
                   where b2.round_no = n and b2.mode = p_mode and b2.user_id = lb.user_id) nums,
                 (select jsonb_agg(e) from rl_live_bets b2, jsonb_array_elements(b2.bets) e
                   where b2.round_no = n and b2.mode = p_mode and b2.user_id = lb.user_id) bets
          from rl_live_bets lb where round_no = n and mode = p_mode group by user_id) s
    join profiles p on p.id = s.user_id;
  select coalesce(jsonb_agg(result order by round_no desc), '[]') into v_hist
    from (select round_no, result from rl_live_rounds where round_no < n or (round_no = n and not open)
          order by round_no desc limit 18) h;
  return jsonb_build_object(
    'now', round(t * 1000), 'round', n,
    'start', n * c * 1000, 'close', (n * c + w) * 1000, 'end', (n + 1) * c * 1000,
    'open', open,
    'result', case when open then null else r.result end,
    'lucky', case when open or p_mode = 'classic' then '{}'::jsonb when p_mode = 'lightning' then r.lucky_l else r.lucky_x end,
    'mine', v_mine, 'payout', v_pay,
    'players', v_players, 'history', v_hist,
    'present', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.nickname, 'bal', (select balance from wallets w where w.user_id = p.id)) order by pr.since), '[]')
                from rl_presence pr join profiles p on p.id = pr.user_id where pr.mode = p_mode and pr.seen_at > now() - interval '15 seconds'),
    'balance', (select balance from wallets where user_id = u));
end $$;
