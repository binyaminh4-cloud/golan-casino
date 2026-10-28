-- על האש בכינרת: one paid spin (with every cascade, friend and free spin it triggers) = one row picked from kin_seeds.
create table if not exists kin_spins (
  id bigint generated always as identity primary key, user_id uuid not null references profiles(id) on delete cascade, ref text not null,
  stake bigint not null, seed bigint not null, total numeric not null, payout bigint not null, created_at timestamptz not null default now(), unique (user_id, ref));
alter table kin_spins enable row level security; revoke all on kin_spins from anon, authenticated;
create or replace function kin_spin(p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); old kin_spins; k kin_seeds; n int; pick int; pay bigint; bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into old from kin_spins where user_id = u and ref = p_ref;
  if found then return jsonb_build_object('seed', old.seed, 'total', old.total, 'payout', old.payout, 'stake', old.stake, 'balance', (select balance from wallets where user_id = u)); end if;
  if p_stake is null or p_stake < 5 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'kinneret', 'stake', -p_stake, 'kinstake:' || u || ':' || p_ref);
  select count(*) into n from kin_seeds;
  pick := rl_randint(n); select * into k from kin_seeds where id = pick;
  pay := floor(p_stake * k.total)::bigint;
  insert into kin_spins (user_id, ref, stake, seed, total, payout) values (u, p_ref, p_stake, k.seed, k.total, pay);
  if pay > 0 then bal := apply_tx(u, 'kinneret', 'payout', pay, 'kinpay:' || u || ':' || p_ref); else bal := (select balance from wallets where user_id = u); end if;
  if k.total >= 100 then perform chat_sys('lobby', '🔥 ' || (select nickname from profiles where id = u) || ' זכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') || ' על האש בכינרת!'); end if;
  return jsonb_build_object('seed', k.seed, 'total', k.total, 'payout', pay, 'stake', p_stake, 'balance', bal);
end $$;
revoke all on function kin_spin(bigint, text) from public, anon; grant execute on function kin_spin(bigint, text) to authenticated;
