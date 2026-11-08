-- Golan Dragons (owner request 8.11): bonus every ~40 spins (was ~91), smaller on average (×25 instead of ×51),
-- a bit more generous than today (~131%, was ~124%). Bonus seeds are picked with weight total^-0.8, so the small ones come
-- more often and the big ones (×100+) still appear, just more rarely. Seeds and their animations are unchanged.
-- Base: 0102.
create or replace function dg_spin(p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); old dg_spins; k dg_seeds; n int; b int; pick int; pay bigint; bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into old from dg_spins where user_id = u and ref = p_ref;
  if found then return jsonb_build_object('seed', old.seed, 'total', old.total, 'payout', old.payout, 'stake', old.stake, 'balance', (select balance from wallets where user_id = u)); end if;
  if p_stake is null or p_stake < 25 or p_stake > (select greatest(0, balance) from wallets where user_id = u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'dragons', 'stake', -p_stake, 'dgstake:' || u || ':' || p_ref);
  select count(*), count(*) filter (where bonus) into n, b from dg_seeds;
  if n = 0 or b = 0 or 1.75 * b >= n then raise exception 'invalid_bonus_catalog'; end if;
  if random() < 0.025 then   -- a bonus: small ones more likely (weighted sampling, weight = total^-0.8)
    select * into k from dg_seeds where bonus order by -ln(1 - random()) * power(total, 0.8) limit 1;
  else
    loop pick := rl_randint(n); select * into k from dg_seeds where id = pick; exit when not k.bonus; end loop;
  end if;
  pay := floor(p_stake * k.total * 1.022)::bigint;
  insert into dg_spins (user_id, ref, stake, seed, total, payout) values (u, p_ref, p_stake, k.seed, k.total, pay);
  if pay > 0 then bal := apply_tx(u, 'dragons', 'payout', pay, 'dgpay:' || u || ':' || p_ref); else bal := (select balance from wallets where user_id = u); end if;
  if k.total >= 200 then perform chat_sys('lobby', '🐉 ' || (select nickname from profiles where id = u) || ' זכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') || ' בדרקוני הגולן!'); end if;
  return jsonb_build_object('seed', k.seed, 'total', k.total, 'payout', pay, 'stake', p_stake, 'balance', bal);
end $$;

