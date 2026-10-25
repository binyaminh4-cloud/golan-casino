-- Lightning Blackjack (a mode of the blackjack engine). Each round costs main bet + a Lightning fee (= main bet).
-- After the round the player earns a 2x-25x multiplier, from a table chosen by the first hand's final total.
-- The multiplier boosts the winnings of every winning hand in the player's NEXT Lightning round
-- (on stakes up to the bet of the round that earned it). No side bets in this mode.
-- Calibration (sim/lightning_bj.py, 2M rounds): W = 0.5205 profit on wins per unit; E[m] = 2.903 -> fee RTP ~99.1%.

alter table bj_rounds add column if not exists mode text not null default 'classic' check (mode in ('classic', 'lightning'));
alter table bj_rounds add column if not exists fee bigint not null default 0;
alter table bj_rounds add column if not exists boost int not null default 0;
alter table bj_rounds add column if not exists boost_cap bigint not null default 0;

create table if not exists bj_boost (user_id uuid primary key references profiles(id) on delete cascade, mult int not null, cap bigint not null);
alter table bj_boost enable row level security;
create policy own_boost on bj_boost for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on bj_boost from anon, authenticated;

create table if not exists bj_lw (tier text, val int, w int, primary key (tier, val));
delete from bj_lw;
insert into bj_lw values
  ('bust',2,83),('bust',3,10),('bust',4,5),('bust',5,1),('bust',6,1),
  ('17',2,77),('17',3,13),('17',4,5),('17',5,3),('17',6,1),('17',8,1),
  ('18',2,70),('18',3,15),('18',4,7),('18',5,4),('18',6,2),('18',8,1),('18',10,1),
  ('19',2,60),('19',3,17),('19',4,10),('19',5,6),('19',6,3),('19',8,2),('19',10,1),('19',12,1),
  ('20',2,50),('20',3,18),('20',4,12),('20',5,8),('20',6,5),('20',8,3),('20',10,2),('20',15,1),('20',20,1),
  ('21',2,35),('21',3,15),('21',4,12),('21',5,10),('21',6,8),('21',8,7),('21',10,5),('21',12,3),('21',15,2),('21',20,2),('21',25,1);
revoke all on bj_lw from anon, authenticated;

create or replace function bj_lpick(p_tier text) returns int language plpgsql volatile set search_path = public as $$
declare r int; acc int := 0; x record;
begin
  r := rl_randint((select sum(w)::int from bj_lw where tier = p_tier));
  for x in select val, w from bj_lw where tier = p_tier order by val loop
    acc := acc + x.w; if r < acc then return x.val; end if;
  end loop;
end $$;

create or replace function bj_deal(p_main bigint, p_pp bigint, p_t3 bigint, p_ll bigint, p_bust bigint, p_ref text, p_mode text default 'classic')
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); v_id uuid; p text[]; d text[]; total bigint; up int; v_side jsonb := '{}'; v_fee bigint := 0; v_boost int := 0; v_cap bigint := 0;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select id into v_id from bj_rounds where ref = p_ref and user_id = u;
  if found then return bj_view(v_id); end if;                -- duplicate request
  if exists (select 1 from bj_rounds where user_id = u and status <> 'done') then raise exception 'round_in_progress'; end if;
  if p_main is null or p_main < 10 or p_main > 50000 then raise exception 'invalid_main_bet'; end if;
  if least(coalesce(p_pp,0), coalesce(p_t3,0), coalesce(p_ll,0), coalesce(p_bust,0)) < 0
     or greatest(coalesce(p_pp,0), coalesce(p_t3,0), coalesce(p_ll,0), coalesce(p_bust,0)) > p_main then raise exception 'invalid_side_bet'; end if;
  if p_mode not in ('classic', 'lightning') then raise exception 'invalid_mode'; end if;
  if p_mode = 'lightning' then
    if coalesce(p_pp,0) + coalesce(p_t3,0) + coalesce(p_ll,0) + coalesce(p_bust,0) > 0 then raise exception 'invalid_side_bet'; end if;
    v_fee := p_main;                                                     -- Lightning fee = 100% of the main bet
  end if;
  total := p_main + coalesce(p_pp,0) + coalesce(p_t3,0) + coalesce(p_ll,0) + coalesce(p_bust,0) + v_fee;
  perform apply_tx(u, case p_mode when 'lightning' then 'lightning_blackjack' else 'blackjack' end, 'stake', -total, 'bjstake:' || p_ref);
  if p_mode = 'lightning' then delete from bj_boost where user_id = u returning mult, cap into v_boost, v_cap; end if;   -- multiplier earned last round   -- raises insufficient_funds

  if coalesce(p_pp,0) > 0 then v_side := v_side || jsonb_build_object('pp', p_pp); end if;
  if coalesce(p_t3,0) > 0 then v_side := v_side || jsonb_build_object('t3', p_t3); end if;
  if coalesce(p_ll,0) > 0 then v_side := v_side || jsonb_build_object('ll', p_ll); end if;
  if coalesce(p_bust,0) > 0 then v_side := v_side || jsonb_build_object('bust', p_bust); end if;

  p := array[bj_draw(u)]; d := array[bj_draw(u)]; p := p || bj_draw(u); d := d || bj_draw(u);
  insert into bj_rounds (user_id, ref, status, main_bet, side, hands, dealer, total_staked, mode, fee, boost, boost_cap)
    values (u, p_ref, 'playing', p_main, v_side,
            jsonb_build_array(jsonb_build_object('cards', to_jsonb(p), 'cards0', to_jsonb(p), 'bet', p_main,
              'done', bj_is_bj(p), 'surrendered', false, 'aces', false, 'split', false)),
            d, total, p_mode, v_fee, coalesce(v_boost, 0), coalesce(v_cap, 0))
    returning id into v_id;

  up := bj_val(d[1]);
  if up = 11 and not bj_is_bj(p) then
    update bj_rounds set status = 'insurance' where id = v_id;
  elsif bj_is_bj(p) or ((up = 10 or up = 11) and bj_is_bj(d)) then
    perform bj_finish(v_id);                                  -- blackjack or dealer peek
  end if;
  return bj_view(v_id);
end $$;
drop function if exists bj_deal(bigint, bigint, bigint, bigint, bigint, text);

create or replace function bj_finish(p_round uuid) returns void language plpgsql security definer set search_path = public as $$
declare r bj_rounds; d text[]; dt int; dbj boolean; pay bigint := 0; h jsonb; pc text[]; pt int; res jsonb := '[]'; m int; v_side jsonb := '{}';
        any_live boolean := false; single boolean; v_extra bigint := 0; v_earn int; v_tier text; fh jsonb;
begin
  select * into r from bj_rounds where id = p_round for update;
  if r.status = 'done' then return; end if;
  d := r.dealer; dbj := bj_is_bj(d);
  single := jsonb_array_length(r.hands) = 1;
  -- Dealer always completes the hand unless it already has blackjack (Buster bet needs the full hand).
  if not dbj then
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

  -- Lightning: last round's multiplier boosts the winnings of every winning hand (stake up to the earning round's bet).
  if r.mode = 'lightning' and r.boost > 1 then
    select coalesce(sum(case x.oo->>'outcome' when 'blackjack' then (x.hh->>'bet')::bigint * 3 / 2 when 'win' then (x.hh->>'bet')::bigint else 0 end
                        * least((x.hh->>'bet')::bigint, r.boost_cap) / (x.hh->>'bet')::bigint), 0) * (r.boost - 1)
      into v_extra
      from (select a.hh, b.oo from jsonb_array_elements(r.hands) with ordinality a(hh, ia) join jsonb_array_elements(res) with ordinality b(oo, ib) on a.ia = b.ib) x;
    pay := pay + v_extra;
  end if;
  -- Lightning: earn the next multiplier from the final total of the first hand.
  if r.mode = 'lightning' then
    fh := r.hands->0;
    v_tier := case when (fh->>'surrendered')::boolean or bj_total(bj_jcards(fh->'cards')) > 21 then 'bust'
                   when bj_total(bj_jcards(fh->'cards')) <= 17 then '17' else bj_total(bj_jcards(fh->'cards'))::text end;
    v_earn := bj_lpick(v_tier);
    insert into bj_boost (user_id, mult, cap) values (r.user_id, v_earn, r.main_bet)
      on conflict (user_id) do update set mult = excluded.mult, cap = excluded.cap;
    v_side := v_side || jsonb_build_object('boost_used', r.boost, 'boost_extra', v_extra, 'earned', v_earn, 'tier', v_tier);
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
  if pay > 0 then perform apply_tx(r.user_id, case r.mode when 'lightning' then 'lightning_blackjack' else 'blackjack' end, 'payout', pay, 'bjpay:' || p_round); end if;
end $$;

create or replace function bj_view(p_round uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare r bj_rounds; v_hands jsonb; i int; h jsonb; acts text[];
begin
  select * into r from bj_rounds where id = p_round and user_id = auth.uid();
  if not found then return null; end if;
  if r.status = 'done' then
    acts := '{}';
  elsif r.status = 'insurance' then
    acts := array['insurance','no_insurance'];
  else
    h := r.hands -> r.active;
    acts := array['hit','stand'];
    if jsonb_array_length(h->'cards') = 2 and not (h->>'aces')::boolean then
      acts := acts || 'double'::text;
      if bj_val(h->'cards'->>0) = bj_val(h->'cards'->>1) and jsonb_array_length(r.hands) < 4 then acts := acts || 'split'::text; end if;
      if jsonb_array_length(r.hands) = 1 then acts := acts || 'surrender'::text; end if;
    end if;
  end if;
  select jsonb_agg(x || jsonb_build_object('total', bj_total(bj_jcards(x->'cards')))) into v_hands from jsonb_array_elements(r.hands) x;
  return jsonb_build_object(
    'id', r.id, 'mode', r.mode, 'fee', r.fee, 'boost', r.boost, 'status', r.status, 'main_bet', r.main_bet, 'side', r.side, 'insurance', r.insurance,
    'hands', v_hands, 'active', r.active, 'actions', to_jsonb(acts),
    'dealer', case when r.status = 'done' then to_jsonb(r.dealer) else jsonb_build_array(r.dealer[1], '??') end,
    'dealer_total', case when r.status = 'done' then bj_total(r.dealer) else bj_val(r.dealer[1]) end,
    'result', r.result, 'payout', r.payout, 'staked', r.total_staked,
    'balance', (select balance from wallets where user_id = r.user_id));
end $$;

create or replace function bj_my_boost() returns int language sql security definer set search_path = public as $$
  select coalesce((select mult from bj_boost where user_id = auth.uid()), 0) $$;

revoke all on function bj_lpick from public, anon, authenticated;
revoke all on function bj_deal(bigint, bigint, bigint, bigint, bigint, text, text), bj_my_boost() from public, anon;
grant execute on function bj_deal(bigint, bigint, bigint, bigint, bigint, text, text), bj_my_boost() to authenticated;
