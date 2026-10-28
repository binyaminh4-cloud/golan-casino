-- Bought pachinko bonuses swing much more (players asked for 40% / 90% / 200% / rare ×10 outcomes instead of ~90% every time):
-- random entry ×1/×2/×5/×10 and a super drop table with far more 100s and 50s. Prices re-set so both stay near 97%.
create or replace function pc_buy(p_kind text, p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); price int; cost bigint; scale bigint := 1; entry int; total bigint := 0; tg jsonb := '[]'; i int; k int; pay bigint; bal bigint; res jsonb; bonus jsonb;
  RV int[] := array[5,100,10,0,20,50,15,25]; SV int[] := array[5,100,10,20,50,15,25];
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_kind not in ('regular', 'super') then raise exception 'invalid_bonus'; end if;
  if exists (select 1 from pc_spins where user_id = u and ref = p_ref) then raise exception 'duplicate'; end if;
  if p_stake is null or p_stake < 10 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  price := gc_buy_price('pachinko', p_kind); cost := p_stake * price;
  perform apply_tx(u, 'pachinko', 'stake', -cost, 'pcbuy:' || u || ':' || p_ref);
  -- a random entry multiplier makes bought bonuses swing: mostly ×1, sometimes ×2, rarely ×5 / ×10
  entry := (array[1,2,5,10])[pc_pick(array[90,8,1.7,0.3]) + 1]; scale := entry;
  if p_kind = 'regular' then
    loop i := pc_pick(array[24,1,18,8,12,3,16,8]); tg := tg || to_jsonb(i);
      if i = 3 then scale := scale * 2; else total := RV[i + 1] * scale; exit; end if; end loop;
  else
    for k in 1..20 loop i := pc_pick(array[84,7,3,1,2,2,1]); tg := tg || to_jsonb(i); total := total + SV[i + 1] * entry; end loop;
  end if;
  bonus := jsonb_build_object('kind', p_kind, 'entry', entry, 'targets', tg, 'total', total);
  pay := p_stake * total;
  res := jsonb_build_object('grid', '[]'::jsonb, 'badges', '{}'::jsonb, 'wins', '[]'::jsonb, 'line_mult', 0, 'bonus', bonus, 'stake', p_stake, 'cost', cost, 'payout', pay, 'bought', true);
  insert into pc_spins (user_id, ref, stake, result, payout) values (u, p_ref, cost, res, pay);
  bal := apply_tx(u, 'pachinko', 'payout', pay, 'pcpay:' || u || ':' || p_ref);
  return res || jsonb_build_object('balance', bal);
end $$;
update buy_prices set price = 20 where game = 'pachinko' and kind = 'regular';
update buy_prices set price = 324 where game = 'pachinko' and kind = 'super';
