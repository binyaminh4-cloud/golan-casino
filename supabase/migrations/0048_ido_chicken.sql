-- עידו חוצה את הכביש (chicken road): 10 lanes, 4 levels. Each step succeeds with probability M(i-1)/M(i) (M0 = 1),
-- so every stopping point returns exactly 100% (the approved table). The server draws every step; cash-out pays stake × M(step).
-- Owner's defaults: bet limit = gc_max_bet, no win cap, payout rounded down to whole shekels, an unfinished run stays open
-- until the player comes back (no auto cash-out, nothing charged again).
create table if not exists ck_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade, ref text not null unique,
  stake bigint not null, mode text not null, step int not null default 0,
  status text not null default 'active' check (status in ('active','lost','cashed','won')),
  paid bigint not null default 0, created_at timestamptz not null default now(), finished_at timestamptz);
create unique index if not exists ck_one_open on ck_runs(user_id) where status = 'active';
alter table ck_runs enable row level security; revoke all on ck_runs from anon, authenticated;

-- multipliers × 100
create or replace function ck_table(p_mode text) returns int[] language sql immutable as $$
  select case p_mode
    when 'easy'    then array[105,110,115,122,130,140,152,167,185,210]
    when 'normal'  then array[115,130,150,175,205,245,295,360,445,550]
    when 'hard'    then array[130,170,220,290,380,500,670,900,1200,1600]
    when 'extreme' then array[160,260,420,700,1200,2000,3500,6000,10000,17500] end $$;

create or replace function ck_view(r ck_runs) returns jsonb language sql stable as $$
  select jsonb_build_object('id', r.id, 'stake', r.stake, 'mode', r.mode, 'step', r.step, 'status', r.status, 'paid', r.paid,
    'balance', (select balance from wallets where user_id = r.user_id)) $$;

-- one step forward (internal): success with probability M(step)/M(step+1); step 10 cashes out by itself
create or replace function ck_advance(r ck_runs) returns ck_runs language plpgsql volatile as $$
declare t int[] := ck_table(r.mode); prev int; nxt int;
begin
  prev := case when r.step = 0 then 100 else t[r.step] end; nxt := t[r.step + 1];
  if rl_randint(nxt) < prev then
    r.step := r.step + 1;
    if r.step = 10 then r.status := 'won'; r.paid := floor(r.stake * t[10] / 100.0)::bigint; r.finished_at := now();
      perform apply_tx(r.user_id, 'ido_chicken', 'payout', r.paid, 'ckpay:' || r.id); end if;
  else r.status := 'lost'; r.finished_at := now(); end if;
  update ck_runs set step = r.step, status = r.status, paid = r.paid, finished_at = r.finished_at where id = r.id;
  return r;
end $$;

-- start = charge the bet and take the first step
create or replace function ck_start(p_stake bigint, p_mode text, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r ck_runs;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into r from ck_runs where ref = p_ref and user_id = u; if found then return ck_view(r); end if;
  if p_mode not in ('easy','normal','hard','extreme') then raise exception 'invalid_mode'; end if;
  if exists (select 1 from ck_runs where user_id = u and status = 'active') then raise exception 'run_in_progress'; end if;
  if p_stake is null or p_stake < 10 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'ido_chicken', 'stake', -p_stake, 'ckstake:' || p_ref);
  insert into ck_runs (user_id, ref, stake, mode) values (u, p_ref, p_stake, p_mode) returning * into r;
  r := ck_advance(r);
  return ck_view(r);
end $$;

-- next step; p_from = the step the player saw, so a double tap can't take two steps
create or replace function ck_step(p_run uuid, p_from int) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r ck_runs;
begin
  select * into r from ck_runs where id = p_run and user_id = u for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.status <> 'active' or r.step <> p_from then return ck_view(r); end if;
  r := ck_advance(r);
  return ck_view(r);
end $$;

create or replace function ck_cash(p_run uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r ck_runs;
begin
  select * into r from ck_runs where id = p_run and user_id = u for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.status <> 'active' or r.step < 1 then return ck_view(r); end if;
  r.paid := floor(r.stake * (ck_table(r.mode))[r.step] / 100.0)::bigint;
  update ck_runs set status = 'cashed', paid = r.paid, finished_at = now() where id = r.id returning * into r;
  perform apply_tx(u, 'ido_chicken', 'payout', r.paid, 'ckpay:' || r.id);
  if r.paid >= 50000 and r.paid >= r.stake * 10 then perform chat_sys('lobby', '🐔 ' || (select nickname from profiles where id = u) || ' חצה עם עידו ולקח ₪' || to_char(r.paid, 'FM999,999,999,999,999,999') || '!'); end if;
  return ck_view(r);
end $$;

create or replace function ck_current() returns jsonb language sql security definer set search_path = public as $$
  select ck_view(r) from ck_runs r where user_id = auth.uid() and status = 'active' limit 1 $$;

revoke all on function ck_table(text), ck_view(ck_runs), ck_advance(ck_runs) from public, anon, authenticated;
revoke all on function ck_start(bigint, text, text), ck_step(uuid, int), ck_cash(uuid), ck_current() from public, anon;
grant execute on function ck_start(bigint, text, text), ck_step(uuid, int), ck_cash(uuid), ck_current() to authenticated;
