-- Fisher's Lightning Blackjack v2. Before each deal DJ Fisher strikes 2-3 card ranks with multipliers (2x-25x).
-- A winning hand that holds a struck rank has its profit multiplied by the highest struck multiplier in it, in the same hand.
-- Fee = 50% of the main bet. Calibration (sim/fisher_bj.py, 600k rounds): E[extra] = 0.477/unit -> total RTP ~98.2%.
-- The old "next round boost" (bj_boost) is retired.

alter table bj_rounds add column if not exists strikes jsonb not null default '{}';
delete from bj_boost;

create table if not exists bj_fw (kind text, val int, w int, primary key (kind, val));
delete from bj_fw;
insert into bj_fw values ('count',2,60),('count',3,40),
  ('mult',2,550),('mult',3,200),('mult',4,100),('mult',5,60),('mult',6,40),('mult',8,25),('mult',10,15),('mult',15,6),('mult',25,4);
revoke all on bj_fw from anon, authenticated;

create or replace function bj_fpick(p_kind text) returns int language plpgsql volatile set search_path = public as $$
declare r int; acc int := 0; x record;
begin
  r := rl_randint((select sum(w)::int from bj_fw where kind = p_kind));
  for x in select val, w from bj_fw where kind = p_kind order by val loop
    acc := acc + x.w; if r < acc then return x.val; end if;
  end loop;
end $$;

-- {"A": 5, "7": 3}
create or replace function bj_strikes() returns jsonb language plpgsql volatile set search_path = public as $$
declare k int := bj_fpick('count'); rs text[] := '{}'; c text; out jsonb := '{}';
begin
  while coalesce(array_length(rs, 1), 0) < k loop
    c := substr('A23456789TJQK', rl_randint(13) + 1, 1);
    if not c = any(rs) then rs := rs || c; out := out || jsonb_build_object(c, bj_fpick('mult')); end if;
  end loop;
  return out;
end $$;

create or replace function bj_hand_mult(p_cards jsonb, p_strikes jsonb) returns int language sql immutable as $$
  select coalesce(max((p_strikes->>left(c, 1))::int), 1) from jsonb_array_elements_text(p_cards) c $$;

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
    v_fee := (p_main + 1) / 2;                                            -- Lightning fee = 50% of the main bet
  end if;
  total := p_main + coalesce(p_pp,0) + coalesce(p_t3,0) + coalesce(p_ll,0) + coalesce(p_bust,0) + v_fee;
  perform apply_tx(u, case p_mode when 'lightning' then 'lightning_blackjack' else 'blackjack' end, 'stake', -total, 'bjstake:' || p_ref);

  if coalesce(p_pp,0) > 0 then v_side := v_side || jsonb_build_object('pp', p_pp); end if;
  if coalesce(p_t3,0) > 0 then v_side := v_side || jsonb_build_object('t3', p_t3); end if;
  if coalesce(p_ll,0) > 0 then v_side := v_side || jsonb_build_object('ll', p_ll); end if;
  if coalesce(p_bust,0) > 0 then v_side := v_side || jsonb_build_object('bust', p_bust); end if;

  p := array[bj_draw(u)]; d := array[bj_draw(u)]; p := p || bj_draw(u); d := d || bj_draw(u);
  insert into bj_rounds (user_id, ref, status, main_bet, side, hands, dealer, total_staked, mode, fee, strikes)
    values (u, p_ref, 'playing', p_main, v_side,
            jsonb_build_array(jsonb_build_object('cards', to_jsonb(p), 'cards0', to_jsonb(p), 'bet', p_main,
              'done', bj_is_bj(p), 'surrendered', false, 'aces', false, 'split', false)),
            d, total, p_mode, v_fee, case when p_mode = 'lightning' then bj_strikes() else '{}'::jsonb end)
    returning id into v_id;

  up := bj_val(d[1]);
  if up = 11 and not bj_is_bj(p) then
    update bj_rounds set status = 'insurance' where id = v_id;
  elsif bj_is_bj(p) or ((up = 10 or up = 11) and bj_is_bj(d)) then
    perform bj_finish(v_id);                                  -- blackjack or dealer peek
  end if;
  return bj_view(v_id);
end $$;

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
    'id', r.id, 'mode', r.mode, 'fee', r.fee, 'strikes', r.strikes, 'status', r.status, 'main_bet', r.main_bet, 'side', r.side, 'insurance', r.insurance,
    'hands', v_hands, 'active', r.active, 'actions', to_jsonb(acts),
    'dealer', case when r.status = 'done' then to_jsonb(r.dealer) else jsonb_build_array(r.dealer[1], '??') end,
    'dealer_total', case when r.status = 'done' then bj_total(r.dealer) else bj_val(r.dealer[1]) end,
    'result', r.result, 'payout', r.payout, 'staked', r.total_staked,
    'balance', (select balance from wallets where user_id = r.user_id));
end $$;

revoke all on function bj_fpick, bj_strikes, bj_hand_mult from public, anon, authenticated;
revoke all on function bj_deal(bigint, bigint, bigint, bigint, bigint, text, text) from public, anon;
grant execute on function bj_deal(bigint, bigint, bigint, bigint, bigint, text, text) to authenticated;
