-- מגדל הכסף (the money tower): 5 floors × 6 rooms. Every roll of the die is drawn here; the page only animates the answer.
-- Floors 1–3: the die picks a room. A guard = the round is lost (with all the loot). A vault adds its multiplier to the loot
-- and the ladder takes you up. Floor 3 room 2 is the exit gate: take the loot, or try the corridor (2 guards in 6) to the bonus.
-- Any other safe room on floor 3 climbs straight to the top = regular bonus. Floors 4 and 5 (one safe room each) upgrade
-- the bonus to super / crazy; a guard there just ends the bonus, nothing is lost. Bonus pays loot + prize (×14 / ×35 / ×70).
-- Two layouts (A 44%: guards 3,4,4,5,5 · B 56%: 3,4,5,5,5). Exact return with best play ≈ 94.7% (tools: tower rtp sheet).
-- layout = jsonb array of 6 rows (floors 1..5, row 6 = the corridor), each 6 cells: -1 guard, 0 safe/exit/ladder, n = vault ×n.
create table if not exists tw_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade, ref text not null unique,
  stake bigint not null, cfg text not null, layout jsonb not null, floor int not null default 1, loot int not null default 0,
  bonus int not null default 0, rolls jsonb not null default '[]',
  status text not null default 'active' check (status in ('active','choice','bonus','lost','cashed','won')),
  paid bigint not null default 0, created_at timestamptz not null default now(), finished_at timestamptz);
create unique index if not exists tw_one_open on tw_runs(user_id) where status in ('active','choice','bonus');
alter table tw_runs enable row level security; revoke all on tw_runs from anon, authenticated;

create or replace function tw_prize(lvl int) returns int language sql immutable as $$
  select case lvl when 1 then 14 when 2 then 35 when 3 then 70 else 0 end $$;

-- vault values (×stake), weighted 30/25/20/13/8/4
create or replace function tw_vault() returns int language plpgsql volatile as $$
declare r int := rl_randint(100);
begin
  return case when r < 30 then 2 when r < 55 then 3 when r < 75 then 5 when r < 88 then 8 when r < 96 then 12 else 20 end;
end $$;

-- one row: g guards spread over the rooms in p_free (1-based), every other free room gets f(), fixed rooms keep their value
create or replace function tw_row(g int, vaults boolean, exit_room int) returns jsonb language plpgsql volatile as $$
declare cells int[] := array[0,0,0,0,0,0]; free int[] := '{}'; i int; j int; t int;
begin
  for i in 1..6 loop if i <> coalesce(exit_room, 0) then free := free || i; end if; end loop;
  for i in reverse array_length(free, 1)..2 loop j := rl_randint(i) + 1; t := free[i]; free[i] := free[j]; free[j] := t; end loop;   -- shuffle
  for i in 1..array_length(free, 1) loop cells[free[i]] := case when i <= g then -1 when vaults then tw_vault() else 0 end; end loop;
  return to_jsonb(cells);
end $$;

create or replace function tw_view(r tw_runs) returns jsonb language sql stable as $$
  select jsonb_build_object('id', r.id, 'stake', r.stake, 'layout', r.layout, 'floor', r.floor, 'loot', r.loot, 'bonus', r.bonus,
    'rolls', r.rolls, 'status', r.status, 'paid', r.paid, 'balance', (select balance from wallets where user_id = r.user_id)) $$;

create or replace function tw_pay(r tw_runs, p_status text) returns tw_runs language plpgsql volatile as $$
begin
  r.paid := r.stake * (r.loot + tw_prize(r.bonus)); r.status := p_status; r.finished_at := now();
  update tw_runs set paid = r.paid, status = r.status, finished_at = r.finished_at, bonus = r.bonus, floor = r.floor, rolls = r.rolls where id = r.id;
  if r.paid > 0 then perform apply_tx(r.user_id, 'tower', 'payout', r.paid, 'twpay:' || r.id); end if;
  if r.paid >= r.stake * 30 and r.paid >= 20000 then
    perform chat_sys('lobby', '🏰 ' || (select nickname from profiles where id = r.user_id) || ' טיפס במגדל הכסף ולקח ₪' || to_char(r.paid, 'FM999,999,999,999,999,999') || '!'); end if;
  return r;
end $$;

-- one roll (internal). In 'choice' it is the corridor roll (player chose to continue).
create or replace function tw_advance(r tw_runs) returns tw_runs language plpgsql volatile as $$
declare d int := rl_randint(6) + 1; row int; cell int;
begin
  row := case when r.status = 'choice' then 6 else r.floor end;
  cell := (r.layout -> (row - 1) ->> (d - 1))::int;
  r.rolls := r.rolls || jsonb_build_array(jsonb_build_object('row', row, 'die', d, 'cell', cell));
  if r.status = 'bonus' then
    if cell = -1 then return tw_pay(r, 'won'); end if;
    r.bonus := r.bonus + 1;
    if r.bonus >= 3 then return tw_pay(r, 'won'); end if;
    r.floor := 5;
  elsif r.status = 'choice' then
    if cell = -1 then r.status := 'lost'; r.finished_at := now();
    else r.status := 'bonus'; r.bonus := 1; r.floor := 4; end if;
  else
    if cell = -1 then r.status := 'lost'; r.finished_at := now();
    elsif r.floor = 3 and d = 2 then r.status := 'choice';
    else
      r.loot := r.loot + cell;
      if r.floor < 3 then r.floor := r.floor + 1; else r.status := 'bonus'; r.bonus := 1; r.floor := 4; end if;
    end if;
  end if;
  update tw_runs set floor = r.floor, loot = r.loot, bonus = r.bonus, rolls = r.rolls, status = r.status, finished_at = r.finished_at where id = r.id;
  return r;
end $$;

-- start = charge the bet, draw the tower, and roll the first die
create or replace function tw_start(p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r tw_runs; c text; g int[];
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into r from tw_runs where ref = p_ref and user_id = u; if found then return tw_view(r); end if;
  if exists (select 1 from tw_runs where user_id = u and status in ('active','choice','bonus')) then raise exception 'run_in_progress'; end if;
  if p_stake is null or p_stake < 10 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'tower', 'stake', -p_stake, 'twstake:' || p_ref);
  c := case when rl_randint(100) < 44 then 'A' else 'B' end;
  g := case c when 'A' then array[3,4,4,5,5] else array[3,4,5,5,5] end;
  insert into tw_runs (user_id, ref, stake, cfg, layout) values (u, p_ref, p_stake, c,
    jsonb_build_array(tw_row(g[1], true, null), tw_row(g[2], true, null), tw_row(g[3], true, 2),
                      tw_row(g[4], false, null), tw_row(g[5], false, null), tw_row(2, false, null))) returning * into r;
  r := tw_advance(r);
  return tw_view(r);
end $$;

-- next roll; p_n = how many rolls the player has seen, so a double tap can't roll twice
create or replace function tw_roll(p_run uuid, p_n int) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r tw_runs;
begin
  select * into r from tw_runs where id = p_run and user_id = u for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.status not in ('active','bonus') or jsonb_array_length(r.rolls) <> p_n then return tw_view(r); end if;
  r := tw_advance(r);
  return tw_view(r);
end $$;

-- at the exit gate: true = try the corridor to the bonus, false = take the loot
create or replace function tw_choose(p_run uuid, p_go boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r tw_runs;
begin
  select * into r from tw_runs where id = p_run and user_id = u for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.status <> 'choice' then return tw_view(r); end if;
  if p_go then r := tw_advance(r); else r := tw_pay(r, 'cashed'); end if;
  return tw_view(r);
end $$;

create or replace function tw_current() returns jsonb language sql security definer set search_path = public as $$
  select tw_view(r) from tw_runs r where user_id = auth.uid() and status in ('active','choice','bonus') limit 1 $$;

revoke all on function tw_prize(int), tw_vault(), tw_row(int, boolean, int), tw_view(tw_runs), tw_pay(tw_runs, text), tw_advance(tw_runs) from public, anon, authenticated;
revoke all on function tw_start(bigint, text), tw_roll(uuid, int), tw_choose(uuid, boolean), tw_current() from public, anon;
grant execute on function tw_start(bigint, text), tw_roll(uuid, int), tw_choose(uuid, boolean), tw_current() to authenticated;
