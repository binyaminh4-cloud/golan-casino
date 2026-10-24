-- Golan Casino core schema: profiles, invitations, wallets, ledger, solo game rounds.
-- All balance changes go through SECURITY DEFINER functions. Clients can only SELECT.

create table if not exists app_settings (
  id int primary key default 1 check (id = 1),
  starting_balance bigint not null default 10000 check (starting_balance >= 0)
);
insert into app_settings (id) values (1) on conflict do nothing;

create table invitations (
  email text primary key,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 40),
  avatar_url text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table wallets (
  user_id uuid primary key references profiles(id) on delete cascade,
  balance bigint not null check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table wallet_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references wallets(user_id),
  game text not null,               -- 'blackjack','roulette','slots','poker','admin','signup'
  kind text not null check (kind in ('stake','payout','buyin','cashout','grant','reset')),
  amount bigint not null,           -- signed: negative = money leaves wallet
  balance_after bigint not null check (balance_after >= 0),
  settlement_ref text not null unique,
  created_at timestamptz not null default now()
);
create index on wallet_transactions (user_id, created_at desc);

create table game_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  game text not null,
  stake bigint not null check (stake > 0),
  state jsonb not null default '{}',
  status text not null default 'open' check (status in ('open','settled','void')),
  payout bigint,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

-- Poker: chips at a table are a reservation from the wallet, recorded in the ledger.
create table poker_tables (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  max_seats int not null check (max_seats in (2,6,9)),
  small_blind bigint not null check (small_blind > 0),
  big_blind bigint not null check (big_blind > small_blind),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create table poker_seats (
  table_id uuid references poker_tables(id) on delete cascade,
  seat_index int not null,
  user_id uuid not null references profiles(id),
  stack bigint not null check (stack >= 0),
  last_seen timestamptz not null default now(),
  primary key (table_id, seat_index),
  unique (table_id, user_id)
);

-- ===== Core money primitive (server only) =====
create or replace function apply_tx(p_user uuid, p_game text, p_kind text, p_amount bigint, p_ref text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_bal bigint; v_existing bigint;
begin
  -- Idempotency: same ref returns the original result, never applies twice.
  select balance_after into v_existing from wallet_transactions where settlement_ref = p_ref;
  if found then return v_existing; end if;

  select balance into v_bal from wallets where user_id = p_user for update;
  if not found then raise exception 'wallet_not_found'; end if;
  if v_bal + p_amount < 0 then raise exception 'insufficient_funds'; end if;

  update wallets set balance = v_bal + p_amount, updated_at = now() where user_id = p_user;
  insert into wallet_transactions (user_id, game, kind, amount, balance_after, settlement_ref)
    values (p_user, p_game, p_kind, p_amount, v_bal + p_amount, p_ref);
  return v_bal + p_amount;
end $$;

-- Solo games: open round (debits stake) and settle once (credits payout).
create or replace function open_round(p_user uuid, p_game text, p_stake bigint, p_ref text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_stake <= 0 then raise exception 'invalid_stake'; end if;
  select id into v_id from game_rounds where state->>'ref' = p_ref;
  if found then return v_id; end if;
  perform apply_tx(p_user, p_game, 'stake', -p_stake, 'stake:' || p_ref);
  insert into game_rounds (user_id, game, stake, state) values (p_user, p_game, p_stake, jsonb_build_object('ref', p_ref))
    returning id into v_id;
  return v_id;
end $$;

create or replace function settle_round(p_round uuid, p_payout bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare r game_rounds;
begin
  if p_payout < 0 then raise exception 'invalid_payout'; end if;
  select * into r from game_rounds where id = p_round for update;
  if not found then raise exception 'round_not_found'; end if;
  if r.status = 'settled' then
    return (select balance from wallets where user_id = r.user_id);
  end if;
  update game_rounds set status = 'settled', payout = p_payout, settled_at = now() where id = p_round;
  if p_payout > 0 then
    return apply_tx(r.user_id, r.game, 'payout', p_payout, 'payout:' || p_round);
  end if;
  return (select balance from wallets where user_id = r.user_id);
end $$;

-- Poker buy-in / cash-out.
create or replace function poker_buyin(p_user uuid, p_table uuid, p_seat int, p_amount bigint, p_ref text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_amount <= 0 then raise exception 'invalid_buyin'; end if;
  perform apply_tx(p_user, 'poker', 'buyin', -p_amount, p_ref);
  insert into poker_seats (table_id, seat_index, user_id, stack) values (p_table, p_seat, p_user, p_amount);
end $$;

create or replace function poker_cashout(p_table uuid, p_user uuid, p_ref text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_stack bigint;
begin
  delete from poker_seats where table_id = p_table and user_id = p_user returning stack into v_stack;
  if not found then
    return (select balance from wallets where user_id = p_user); -- already cashed out
  end if;
  return apply_tx(p_user, 'poker', 'cashout', v_stack, p_ref);
end $$;

-- Signup: only invited emails get a profile + starting wallet.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_start bigint;
begin
  if not exists (select 1 from invitations where lower(email) = lower(new.email)) then
    raise exception 'not_invited';
  end if;
  update invitations set accepted_at = now() where lower(email) = lower(new.email);
  select starting_balance into v_start from app_settings where id = 1;
  insert into profiles (id, nickname, is_admin) values (new.id, split_part(new.email, '@', 1), not exists (select 1 from profiles));
  insert into wallets (user_id, balance) values (new.id, 0);
  perform apply_tx(new.id, 'signup', 'grant', v_start, 'signup:' || new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Leaderboard: wallet + chips currently at tables.
create or replace view leaderboard with (security_invoker = true) as
  select p.id, p.nickname, p.avatar_url,
         w.balance + coalesce((select sum(stack) from poker_seats s where s.user_id = p.id), 0) as wealth
  from profiles p join wallets w on w.user_id = p.id;

-- ===== Row level security =====
alter table profiles enable row level security;
alter table wallets enable row level security;
alter table wallet_transactions enable row level security;
alter table game_rounds enable row level security;
alter table poker_tables enable row level security;
alter table poker_seats enable row level security;
alter table invitations enable row level security;
alter table app_settings enable row level security;

create policy members_read_profiles on profiles for select to authenticated using (true);
create policy own_nickname on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on profiles from authenticated, anon;
grant update (nickname, avatar_url) on profiles to authenticated;
create policy members_read_wallets on wallets for select to authenticated using (true);
create policy own_tx on wallet_transactions for select to authenticated using (user_id = auth.uid());
create policy own_rounds on game_rounds for select to authenticated using (user_id = auth.uid());
create policy members_read_tables on poker_tables for select to authenticated using (true);
create policy members_read_seats on poker_seats for select to authenticated using (true);
create policy admin_invites on invitations for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and is_admin))
  with check (exists (select 1 from profiles where id = auth.uid() and is_admin));

-- Money functions are callable only by the game server (service_role).
revoke all on function apply_tx, open_round, settle_round, poker_buyin, poker_cashout from public, anon, authenticated;

-- Belt and braces: clients never write money tables directly, even if default grants change.
revoke insert, update, delete on wallets, wallet_transactions, game_rounds, poker_tables, poker_seats, app_settings from anon, authenticated;
revoke all on all tables in schema public from anon;

-- Owner invite (first member becomes admin).
insert into invitations (email) values ('binyaminh4@gmail.com') on conflict do nothing;
