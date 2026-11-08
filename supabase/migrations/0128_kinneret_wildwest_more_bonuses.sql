-- Kinneret and Wild West (owner request 8.11): bonuses about 2.25× as often, smaller on average, a bit more
-- generous overall (~5% above today). Same method as 0127 (dragons). Seeds and animations unchanged. Base: 0102.
-- Kinneret: bonus every ~16 spins (was ~37), weight total^-0.6, return ~133% (was ~128%).
-- Wild West: bonus every ~49 spins (was ~110), weight total^-0.4, return ~142% (was ~136%).
create or replace function kin_spin(p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); old kin_spins; k kin_seeds; n int; b int; pick int; pay bigint; bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into old from kin_spins where user_id = u and ref = p_ref;
  if found then return jsonb_build_object('seed', old.seed, 'total', old.total, 'payout', old.payout, 'stake', old.stake, 'balance', (select balance from wallets where user_id = u)); end if;
  if p_stake is null or p_stake < 5 or p_stake > (select greatest(0, balance) from wallets where user_id = u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'kinneret', 'stake', -p_stake, 'kinstake:' || u || ':' || p_ref);
  select count(*), count(*) filter (where bonus) into n, b from kin_seeds;
  if n = 0 or b = 0 or 1.75 * b >= n then raise exception 'invalid_bonus_catalog'; end if;
  if random() < 0.0613 then   -- a bonus: small ones more likely (weighted sampling, weight = total^-0.6)
    select * into k from kin_seeds where bonus order by -ln(1 - random()) * power(greatest(total, 1), 0.6) limit 1;
  else
    loop pick := rl_randint(n); select * into k from kin_seeds where id = pick; exit when not k.bonus; end loop;
  end if;
  pay := floor(p_stake * k.total * 1.05)::bigint;
  insert into kin_spins (user_id, ref, stake, seed, total, payout) values (u, p_ref, p_stake, k.seed, k.total, pay);
  if pay > 0 then bal := apply_tx(u, 'kinneret', 'payout', pay, 'kinpay:' || u || ':' || p_ref); else bal := (select balance from wallets where user_id = u); end if;
  if k.total >= 200 then perform chat_sys('lobby', '🔥 ' || (select nickname from profiles where id = u) || ' זכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') || ' על האש בכינרת!'); end if;
  return jsonb_build_object('seed', k.seed, 'total', k.total, 'payout', pay, 'stake', p_stake, 'balance', bal);
end $$;

create or replace function ww_spin(p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); old ww_spins; k ww_seeds; n int; b int; pick int; pay bigint; bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into old from ww_spins where user_id = u and ref = p_ref;
  if found then return jsonb_build_object('seed', old.seed, 'total', old.total, 'payout', old.payout, 'stake', old.stake, 'balance', (select balance from wallets where user_id = u)); end if;
  if p_stake is null or p_stake < 5 or p_stake > (select greatest(0, balance) from wallets where user_id = u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'wild_west', 'stake', -p_stake, 'wwstake:' || u || ':' || p_ref);
  select count(*), count(*) filter (where bonus) into n, b from ww_seeds;
  if n = 0 or b = 0 or 1.75 * b >= n then raise exception 'invalid_bonus_catalog'; end if;
  if random() < 0.0205 then   -- a bonus: small ones more likely (weighted sampling, weight = total^-0.4)
    select * into k from ww_seeds where bonus order by -ln(1 - random()) * power(greatest(total, 1), 0.4) limit 1;
  else
    loop pick := rl_randint(n); select * into k from ww_seeds where id = pick; exit when not k.bonus; end loop;
  end if;
  pay := floor(p_stake * k.total * 1.035)::bigint;
  insert into ww_spins (user_id, ref, stake, seed, total, payout) values (u, p_ref, p_stake, k.seed, k.total, pay);
  if pay > 0 then bal := apply_tx(u, 'wild_west', 'payout', pay, 'wwpay:' || u || ':' || p_ref); else bal := (select balance from wallets where user_id = u); end if;
  if k.total >= 200 then perform chat_sys('lobby', '🤠 ' || (select nickname from profiles where id = u) || ' זכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') || ' במערב הפרוע!'); end if;
  return jsonb_build_object('seed', k.seed, 'total', k.total, 'payout', pay, 'stake', p_stake, 'balance', bal);
end $$;

