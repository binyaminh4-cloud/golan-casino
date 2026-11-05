-- מגדל הכסף (the money tower): 5 floors × 6 rooms. Every roll of the die is drawn here; the page only animates the answer.
-- Floors 1–3: the die picks a room. A guard = the round is lost (with all the loot). A vault adds its multiplier to the loot
-- and the ladder takes you up. Floor 3 room 2 is the exit gate: take the loot, or try the corridor (2 guards in 6) to the bonus.
-- Floor 3 has 5 guards and the exit gate. The corridor has 5 guards in 6. Floors 4 and 5 (one safe room each) upgrade the
-- bonus to super / crazy; a guard there just ends the climbing. Then comes the shooting bonus (מלך המטווח) at that level.
-- Guards on floors 1,2,4,5: layout A 3,4,5,5 (44%) or B 3,4,5,5 (56%).
-- layout = jsonb array of 6 rows (floors 1..5, row 6 = the corridor), each 6 cells: -1 guard, 0 safe/exit/ladder, n = vault ×n.
create table if not exists tw_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade, ref text not null unique,
  stake bigint not null, cfg text not null, layout jsonb not null, floor int not null default 1, loot int not null default 0,
  bonus int not null default 0, rolls jsonb not null default '[]', shoot jsonb, shots jsonb, hits jsonb, bought boolean not null default false,
  status text not null default 'active' check (status in ('active','choice','bonus','shoot','lost','cashed','won')),
  paid bigint not null default 0, created_at timestamptz not null default now(), finished_at timestamptz);
create unique index if not exists tw_one_open on tw_runs(user_id) where status in ('active','choice','bonus','shoot');
alter table tw_runs add column if not exists shoot jsonb; alter table tw_runs add column if not exists shots jsonb;
alter table tw_runs add column if not exists hits jsonb; alter table tw_runs add column if not exists bought boolean not null default false;
alter table tw_runs drop constraint if exists tw_runs_status_check;
alter table tw_runs add constraint tw_runs_status_check check (status in ('active','choice','bonus','shoot','lost','cashed','won'));
drop index if exists tw_one_open; create unique index tw_one_open on tw_runs(user_id) where status in ('active','choice','bonus','shoot');
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
    'rolls', r.rolls, 'shoot', r.shoot, 'hits', r.hits, 'bought', r.bought, 'status', r.status, 'paid', r.paid, 'balance', (select balance from wallets where user_id = r.user_id)) $$;

create or replace function tw_pay(r tw_runs, p_status text) returns tw_runs language plpgsql volatile as $$
begin
  r.paid := r.stake * r.loot + coalesce(r.paid, 0); r.status := p_status; r.finished_at := now();
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
    if cell = -1 then return tw_begin_shoot(r); end if;
    r.bonus := r.bonus + 1;
    if r.bonus >= 3 then return tw_begin_shoot(r); end if;
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
  if exists (select 1 from tw_runs where user_id = u and status in ('active','choice','bonus','shoot')) then raise exception 'run_in_progress'; end if;
  if p_stake is null or p_stake < 10 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'tower', 'stake', -p_stake, 'twstake:' || p_ref);
  c := case when rl_randint(100) < 44 then 'A' else 'B' end;
  g := case c when 'A' then array[3,4,4,5,5] else array[3,4,5,5,5] end;
  insert into tw_runs (user_id, ref, stake, cfg, layout) values (u, p_ref, p_stake, c,
    jsonb_build_array(tw_row(g[1], true, null), tw_row(g[2], true, null), tw_row(5, true, 2),
                      tw_row(g[4], false, null), tw_row(g[5], false, null), tw_row(5, false, null))) returning * into r;
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


-- ───────── מלך המטווח (the shooting bonus) ─────────
-- The server draws the whole range (every target's path, value, every golden bird and which later target its multiplier drops on)
-- and stores it. The page plays it smoothly; at the end it sends the 10 shots (x, y, ms) in one request and the server
-- recomputes every hit from the stored range with the same formulas, then pays. Field 1600×900.
-- path: x = x0 + vx·s, y = y0 + amp·sin(w·s + ph), s = seconds since t0; alive while 0 ≤ s ≤ life.
-- Values are hundredths of the stake. Levels: 1 regular, 2 super, 3 crazy. Ceiling ×5000 per round.
create or replace function tw_pick(p_w int[], p_v int[]) returns int language plpgsql volatile as $$
declare tot int := 0; i int; r int;
begin
  for i in 1..array_length(p_w, 1) loop tot := tot + p_w[i]; end loop;
  r := rl_randint(tot);
  for i in 1..array_length(p_w, 1) loop if r < p_w[i] then return p_v[i]; end if; r := r - p_w[i]; end loop;
  return p_v[array_length(p_v, 1)];
end $$;

create or replace function tw_make_range(lvl int) returns jsonb language plpgsql volatile as $$
declare t jsonb := '[]'; i int; k int; x int; vx float8; nb int; t0 int; vals int[]; drops int[]; j int; cands int[]; o jsonb;
begin
  vals := case lvl when 1 then array[70,400,2700] when 2 then array[120,500,3000] else array[200,1300,6500] end;
  drops := case lvl when 1 then array[378,236,114,118,118,36] when 2 then array[406,241,116,124,90,23] else array[411,239,115,129,82,24] end;
  for i in 0..23 loop
    x := rl_randint(100); k := case when x < 60 then 0 when x < 90 then 1 else 2 end;
    vx := 320 + rl_randint(200); if rl_randint(2) = 0 then vx := -vx; end if;
    t := t || jsonb_build_object('k', (array['can','bal','dia'])[k + 1], 'v', vals[k + 1], 't0', i * 1150 + rl_randint(400),
      'x0', case when vx > 0 then -80 else 1680 end, 'vx', vx, 'y0', 170 + rl_randint(480), 'amp', rl_randint(70),
      'w', 1 + rl_randint(200) / 100.0, 'ph', rl_randint(628) / 100.0, 'life', round((1760 / abs(vx))::numeric, 3));
  end loop;
  nb := case lvl when 1 then tw_pick(array[50,35,15], array[0,1,2]) when 2 then tw_pick(array[40,40,20], array[3,4,5]) else tw_pick(array[45,35,20], array[5,6,7]) end;
  for i in 1..nb loop
    t0 := 2000 + rl_randint(23000); vx := 600 + rl_randint(200); if rl_randint(2) = 0 then vx := -vx; end if;
    cands := '{}';
    for j in 0..23 loop if (t -> j ->> 't0')::int > t0 + 500 and coalesce(array_length(cands, 1), 0) < 3 then cands := cands || j; end if; end loop;
    o := jsonb_build_object('k', 'bird', 'v', 0, 't0', t0, 'x0', case when vx > 0 then -80 else 1680 end, 'vx', vx, 'y0', 110 + rl_randint(200),
      'amp', 40, 'w', 3, 'ph', 0, 'life', round((1760 / abs(vx))::numeric, 3), 'm', tw_pick(drops, array[2,5,10,50,100,1000]),
      'on', case when coalesce(array_length(cands, 1), 0) = 0 then -1 else cands[rl_randint(array_length(cands, 1)) + 1] end);
    t := t || o;
  end loop;
  return jsonb_build_object('lvl', lvl, 'targets', t);
end $$;

-- recompute the shots against the stored range → total in hundredths of the stake, plus the list of hits for the page
create or replace function tw_score(p_range jsonb, p_shots jsonb, out total bigint, out hits jsonb) language plpgsql immutable as $$
declare tg jsonb := p_range -> 'targets'; n int := jsonb_array_length(p_range -> 'targets'); i int; j int; sx float8; sy float8; st int; last int := -1000;
  hit boolean[]; mult int[]; best int; bd float8; d float8; s float8; px float8; py float8; rad float8; o jsonb; v bigint;
begin
  total := 0; hits := '[]'; hit := array_fill(false, array[n]); mult := array_fill(1, array[n]);
  if jsonb_typeof(p_shots) <> 'array' then return; end if;
  for i in 0..least(jsonb_array_length(p_shots), 10) - 1 loop
    sx := (p_shots -> i ->> 0)::float8; sy := (p_shots -> i ->> 1)::float8; st := (p_shots -> i ->> 2)::int;
    if st is null or st < last + 300 or st > 31000 then continue; end if;   -- at most one shot every 0.3 s, within the round
    last := st; best := -1; bd := 1e9;
    for j in 0..n - 1 loop
      if hit[j + 1] then continue; end if;
      o := tg -> j; s := (st - (o ->> 't0')::int) / 1000.0;
      if s < 0 or s > (o ->> 'life')::float8 then continue; end if;
      px := (o ->> 'x0')::float8 + (o ->> 'vx')::float8 * s; py := (o ->> 'y0')::float8 + (o ->> 'amp')::float8 * sin((o ->> 'w')::float8 * s + (o ->> 'ph')::float8);
      rad := case o ->> 'k' when 'can' then 46 when 'bal' then 54 when 'dia' then 42 else 52 end;
      d := sqrt((px - sx) ^ 2 + (py - sy) ^ 2);
      if d <= rad and d < bd then bd := d; best := j; end if;
    end loop;
    if best >= 0 then
      hit[best + 1] := true; o := tg -> best;
      if o ->> 'k' = 'bird' then
        if (o ->> 'on')::int >= 0 then mult[(o ->> 'on')::int + 1] := (o ->> 'm')::int; end if;
        hits := hits || jsonb_build_object('i', i, 'j', best, 'v', 0);
      else
        v := (o ->> 'v')::bigint * mult[best + 1]; total := total + v;
        hits := hits || jsonb_build_object('i', i, 'j', best, 'v', v, 'm', mult[best + 1]);
      end if;
    end if;
  end loop;
  total := least(total, 500000);
end $$;

create or replace function tw_begin_shoot(r tw_runs) returns tw_runs language plpgsql volatile as $$
begin
  r.status := 'shoot'; r.shoot := tw_make_range(r.bonus);
  update tw_runs set status = r.status, shoot = r.shoot, bonus = r.bonus, floor = r.floor, rolls = r.rolls where id = r.id;
  return r;
end $$;

-- the 10 shots, sent once at the end of the round
create or replace function tw_shoot(p_run uuid, p_shots jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r tw_runs; sc record;
begin
  select * into r from tw_runs where id = p_run and user_id = u for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.status <> 'shoot' then return tw_view(r); end if;
  select * into sc from tw_score(r.shoot, p_shots);
  r.shots := p_shots; r.hits := sc.hits; r.paid := floor(r.stake * sc.total / 100.0)::bigint;
  update tw_runs set shots = r.shots, hits = r.hits where id = r.id;
  r := tw_pay(r, 'won');
  return tw_view(r);
end $$;

-- buy the shooting bonus directly: regular ×100, super ×250, crazy ×500 of the bet
create or replace function tw_buy(p_level int, p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r tw_runs; price bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into r from tw_runs where ref = p_ref and user_id = u; if found then return tw_view(r); end if;
  if p_level not in (1, 2, 3) then raise exception 'invalid_level'; end if;
  if exists (select 1 from tw_runs where user_id = u and status in ('active','choice','bonus','shoot')) then raise exception 'run_in_progress'; end if;
  if p_stake is null or p_stake < 10 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  price := p_stake * (array[100, 250, 500])[p_level];
  perform apply_tx(u, 'tower', 'stake', -price, 'twbuy:' || p_ref);
  insert into tw_runs (user_id, ref, stake, cfg, layout, bonus, floor, bought, status) values (u, p_ref, p_stake, 'buy', '[]', p_level, 3 + p_level, true, 'active') returning * into r;
  r := tw_begin_shoot(r);
  return tw_view(r);
end $$;

create or replace function tw_current() returns jsonb language sql security definer set search_path = public as $$
  select tw_view(r) from tw_runs r where user_id = auth.uid() and status in ('active','choice','bonus','shoot') limit 1 $$;

revoke all on function tw_pick(int[], int[]), tw_make_range(int), tw_score(jsonb, jsonb), tw_begin_shoot(tw_runs) from public, anon, authenticated;
revoke all on function tw_prize(int), tw_vault(), tw_row(int, boolean, int), tw_view(tw_runs), tw_pay(tw_runs, text), tw_advance(tw_runs) from public, anon, authenticated;
revoke all on function tw_start(bigint, text), tw_roll(uuid, int), tw_choose(uuid, boolean), tw_shoot(uuid, jsonb), tw_buy(int, bigint, text), tw_current() from public, anon;
grant execute on function tw_start(bigint, text), tw_roll(uuid, int), tw_choose(uuid, boolean), tw_shoot(uuid, jsonb), tw_buy(int, bigint, text), tw_current() to authenticated;
