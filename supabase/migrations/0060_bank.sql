-- Bank: salaries and the owner's gifts go to the bank; players deposit / withdraw between the bank and their wallet.
-- Games only use the wallet. The rich list counts wallet + bank.
create table if not exists bank_accounts (user_id uuid primary key references profiles(id) on delete cascade, balance bigint not null default 0 check (balance >= 0));
create table if not exists bank_tx (
  id bigserial primary key, user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('salary_weekly', 'salary_monthly', 'gift', 'deposit', 'withdraw')),
  amount bigint not null, ref text unique, created_at timestamptz not null default now());
create index if not exists bank_tx_user on bank_tx (user_id, id desc);
alter table bank_accounts enable row level security; alter table bank_tx enable row level security;
revoke all on bank_accounts, bank_tx from anon, authenticated;
grant select on bank_tx to authenticated;
drop policy if exists bank_tx_own on bank_tx; create policy bank_tx_own on bank_tx for select to authenticated using (user_id = auth.uid());

create or replace function bank_add(p_user uuid, p_kind text, p_amount bigint, p_ref text) returns bigint language plpgsql security definer set search_path = public as $$
declare b bigint;
begin
  insert into bank_tx (user_id, kind, amount, ref) values (p_user, p_kind, p_amount, p_ref);
  insert into bank_accounts (user_id, balance) values (p_user, greatest(0, p_amount))
    on conflict (user_id) do update set balance = bank_accounts.balance + p_amount returning balance into b;
  if b < 0 then raise exception 'insufficient_bank'; end if;
  return b;
end $$;
revoke all on function bank_add(uuid, text, bigint, text) from public, anon, authenticated;

create or replace function bank_state() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  return jsonb_build_object('bank', coalesce((select balance from bank_accounts where user_id = u), 0),
    'wallet', (select balance from wallets where user_id = u),
    'tx', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'amount', amount, 'at', created_at) order by id desc)
                      from (select * from bank_tx where user_id = u order by id desc limit 15) t), '[]'::jsonb));
end $$;
create or replace function bank_move(p_amount bigint, p_dir text, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); bb bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_amount is null or p_amount < 1 then raise exception 'invalid_amount'; end if;
  if p_dir not in ('deposit', 'withdraw') then raise exception 'invalid_dir'; end if;
  perform pg_advisory_xact_lock(hashtext('bank:' || u));
  if p_dir = 'deposit' then
    perform apply_tx(u, 'bank', 'buyin', -p_amount, 'bankdep:' || u || ':' || p_ref);      -- fails if the wallet is short
    bb := bank_add(u, 'deposit', p_amount, 'bankdep:' || u || ':' || p_ref);
  else
    if coalesce((select balance from bank_accounts where user_id = u), 0) < p_amount then raise exception 'insufficient_bank'; end if;
    bb := bank_add(u, 'withdraw', -p_amount, 'bankwd:' || u || ':' || p_ref);
    perform apply_tx(u, 'bank', 'cashout', p_amount, 'bankwd:' || u || ':' || p_ref);
  end if;
  return bank_state();
end $$;
revoke all on function bank_state(), bank_move(bigint, text, text) from public, anon;
grant execute on function bank_state(), bank_move(bigint, text, text) to authenticated;

-- salaries go to the bank
create or replace function salary_claim() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); d date := (now() at time zone 'Asia/Jerusalem')::date; wk date; mo date;
        out jsonb := '{}'; L jsonb; w bigint; m bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  L := gc_level_info(u); w := (L->>'weekly')::bigint; m := (L->>'monthly')::bigint;
  if w <= 0 and m <= 0 then return '{}'::jsonb; end if;
  wk := d - extract(dow from d)::int; mo := date_trunc('month', d)::date;
  if not exists (select 1 from salary_claims where user_id = u and kind = 'weekly' and period = wk) then
    insert into salary_claims values (u, 'weekly', wk, w) on conflict do nothing;
    if found then perform bank_add(u, 'salary_weekly', w, 'salary:w:' || u || ':' || wk); out := out || jsonb_build_object('weekly', w); end if;
  end if;
  if not exists (select 1 from salary_claims where user_id = u and kind = 'monthly' and period = mo) then
    insert into salary_claims values (u, 'monthly', mo, m) on conflict do nothing;
    if found then perform bank_add(u, 'salary_monthly', m, 'salary:m:' || u || ':' || mo); out := out || jsonb_build_object('monthly', m); end if;
  end if;
  return out || jsonb_build_object('balance', (select balance from wallets where user_id = u),
    'next_weekly', wk + 7, 'next_monthly', (mo + interval '1 month')::date, 'level', L->'level', 'to_bank', true);
end $$;

-- the owner's gifts go to the bank
create or replace function admin_grant(p_user uuid, p_amount bigint) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_batch text := gen_random_uuid()::text;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then raise exception 'not_admin'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000000 then raise exception 'invalid_amount'; end if;
  for r in select id from profiles where p_user is null or id = p_user loop
    perform bank_add(r.id, 'gift', p_amount, 'admin-grant-' || v_batch || ':' || r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function bank_bal(p_user uuid) returns bigint language sql stable security definer set search_path = public as $$
  select coalesce((select balance from bank_accounts where user_id = p_user), 0) $$;
grant execute on function bank_bal(uuid) to authenticated;
-- rich list: wallet + bank (+ chips sitting at a poker table, as before)
create or replace view leaderboard with (security_invoker = true) as
  select p.id, p.nickname, p.avatar_url, p.character_key,
         w.balance + bank_bal(p.id)
           + coalesce((select sum(s.stack) from poker_seats s join poker_tables t on t.id = s.table_id where s.user_id = p.id and t.tourney is null), 0) as wealth
  from profiles p join wallets w on w.user_id = p.id;
