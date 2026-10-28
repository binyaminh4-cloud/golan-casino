-- Bonus buys in every machine. Price (in stakes) from buy_prices; outcome from the same engines / server math as a natural bonus.
create or replace function gc_buy_price(p_game text, p_kind text) returns int language sql stable security definer set search_path = public as $$
  select price from buy_prices where game = p_game and kind = p_kind $$;
create or replace function gc_buy_prices() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(game || ':' || kind, price), '{}') from buy_prices $$;

-- seed games (Kinneret free spins, Wild West bonuses)
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
  pay := floor(p_stake * k.total)::bigint;
  if pay > 0 then bal := apply_tx(u, p_game, 'payout', pay, tag || 'buypay:' || u || ':' || p_ref); else bal := (select balance from wallets where user_id = u); end if;
  if pay >= cost * 3 and pay >= 50000 then perform chat_sys('lobby', '🎁 ' || (select nickname from profiles where id = u) || ' קנה בונוס וזכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') || '!'); end if;
  return jsonb_build_object('seed', k.seed, 'total', k.total, 'payout', pay, 'stake', p_stake, 'cost', cost, 'kind', p_kind, 'balance', bal);
end $$;
create or replace function kin_buy(p_stake bigint, p_ref text) returns jsonb language sql security definer set search_path = public as $$ select seed_buy('kinneret', 'fs', p_stake, p_ref) $$;
create or replace function ww_buy(p_kind text, p_stake bigint, p_ref text) returns jsonb language sql security definer set search_path = public as $$ select seed_buy('wild_west', p_kind, p_stake, p_ref) $$;

-- Bathroom pachinko: the bonus is drawn on the server exactly like a natural one, entry ×1
create or replace function pc_buy(p_kind text, p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); price int; cost bigint; scale bigint := 1; total bigint := 0; tg jsonb := '[]'; i int; k int; pay bigint; bal bigint; res jsonb; bonus jsonb;
  RV int[] := array[5,100,10,0,20,50,15,25]; SV int[] := array[5,100,10,20,50,15,25];
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_kind not in ('regular', 'super') then raise exception 'invalid_bonus'; end if;
  if exists (select 1 from pc_spins where user_id = u and ref = p_ref) then raise exception 'duplicate'; end if;
  if p_stake is null or p_stake < 10 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  price := gc_buy_price('pachinko', p_kind); cost := p_stake * price;
  perform apply_tx(u, 'pachinko', 'stake', -cost, 'pcbuy:' || u || ':' || p_ref);
  if p_kind = 'regular' then
    loop i := pc_pick(array[24,1,18,8,12,3,16,8]); tg := tg || to_jsonb(i);
      if i = 3 then scale := scale * 2; else total := RV[i + 1] * scale; exit; end if; end loop;
  else
    for k in 1..20 loop i := pc_pick(array[85,0.05,8,2,0.25,4,0.7]); tg := tg || to_jsonb(i); total := total + SV[i + 1]; end loop;
  end if;
  bonus := jsonb_build_object('kind', p_kind, 'entry', 1, 'targets', tg, 'total', total);
  pay := p_stake * total;
  res := jsonb_build_object('grid', '[]'::jsonb, 'badges', '{}'::jsonb, 'wins', '[]'::jsonb, 'line_mult', 0, 'bonus', bonus, 'stake', p_stake, 'cost', cost, 'payout', pay, 'bought', true);
  insert into pc_spins (user_id, ref, stake, result, payout) values (u, p_ref, cost, res, pay);
  bal := apply_tx(u, 'pachinko', 'payout', pay, 'pcpay:' || u || ':' || p_ref);
  return res || jsonb_build_object('balance', bal);
end $$;

-- Binyamin's machine: buy 10 free spins at the chosen bet (price = 10 spins)
create or replace function fo_buy(p_line_bet bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); cost bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_line_bet is null or p_line_bet < 1 or p_line_bet > gc_max_bet(u) / 5 then raise exception 'invalid_amount'; end if;
  if exists (select 1 from sl_free where user_id = u and left_spins > 0) then raise exception 'free_spins_left'; end if;
  cost := p_line_bet * 5 * gc_buy_price('fortune', 'free');
  perform apply_tx(u, 'fortune', 'stake', -cost, 'fobuy:' || u || ':' || p_ref);
  insert into sl_free (user_id, left_spins, bet) values (u, 10, p_line_bet) on conflict (user_id) do update set left_spins = 10, bet = excluded.bet;
  return jsonb_build_object('free_left', 10, 'cost', cost, 'balance', (select balance from wallets where user_id = u));
end $$;

revoke all on function gc_buy_price(text, text), seed_buy(text, text, bigint, text) from public, anon, authenticated;
revoke all on function gc_buy_prices(), kin_buy(bigint, text), ww_buy(text, bigint, text), pc_buy(text, bigint, text), fo_buy(bigint, text) from public, anon;
grant execute on function gc_buy_prices(), kin_buy(bigint, text), ww_buy(text, bigint, text), pc_buy(text, bigint, text), fo_buy(bigint, text) to authenticated;
