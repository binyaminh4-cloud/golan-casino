-- Bonus buys announce in chat when the win is at least 3× the buy price; admin can clear the chat.
create or replace function seed_buy(p_game text, p_kind text, p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); price int; cost bigint; n int; pick int; k buy_seeds; pay bigint; bal bigint; tag text := case p_game when 'kinneret' then 'kin' else 'ww' end;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  price := gc_buy_price(p_game, p_kind); if price is null then raise exception 'invalid_bonus'; end if;
  if p_stake is null or p_stake < 5 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  if exists (select 1 from wallet_transactions where settlement_ref = tag || 'buy:' || u || ':' || p_ref) then raise exception 'duplicate'; end if;
  cost := p_stake * price;
  perform apply_tx(u, p_game, 'stake', -cost, tag || 'buy:' || u || ':' || p_ref);
  select count(*) into n from buy_seeds where game = p_game and kind = p_kind; pick := rl_randint(n);
  select * into k from buy_seeds where game = p_game and kind = p_kind and id = pick;
  pay := floor(p_stake * k.total * 1.045)::bigint;
  if pay > 0 then bal := apply_tx(u, p_game, 'payout', pay, tag || 'buypay:' || u || ':' || p_ref); else bal := (select balance from wallets where user_id = u); end if;
  if pay >= cost * 3 then perform chat_sys('lobby', '🎁 ' || (select nickname from profiles where id = u) || ' קנה בונוס וזכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') || '!'); end if;
  return jsonb_build_object('seed', k.seed, 'total', k.total, 'payout', pay, 'stake', p_stake, 'cost', cost, 'kind', p_kind, 'balance', bal);
end $$;
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
  pay := floor(p_stake * total * 1.03)::bigint;
  res := jsonb_build_object('grid', '[]'::jsonb, 'badges', '{}'::jsonb, 'wins', '[]'::jsonb, 'line_mult', 0, 'bonus', bonus, 'stake', p_stake, 'cost', cost, 'payout', pay, 'bought', true);
  insert into pc_spins (user_id, ref, stake, result, payout) values (u, p_ref, cost, res, pay);
  bal := apply_tx(u, 'pachinko', 'payout', pay, 'pcpay:' || u || ':' || p_ref);
  if pay >= cost * 3 then perform chat_sys('lobby', '🎁 ' || (select nickname from profiles where id = u) || ' קנה בונוס בפצ׳ינקו וזכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') || '!'); end if;
  return res || jsonb_build_object('balance', bal);
end $$;
create or replace function admin_clear_chat() returns void language plpgsql security definer set search_path = public as $$
begin
  if not gc_is_admin() then raise exception 'not_admin'; end if;
  delete from chat_messages where true;
end $$;
revoke all on function admin_clear_chat() from public, anon; grant execute on function admin_clear_chat() to authenticated;
