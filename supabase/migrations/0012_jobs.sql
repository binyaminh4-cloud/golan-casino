-- Golan Casino · income: automatic salaries + small paid jobs (mini-games verified on the server).
-- Weekly salary ₪5,000 (each Sunday), monthly ₪25,000 (each 1st), Israel time. Claimed lazily from the lobby.
-- Jobs: the server makes the puzzle, keeps the answer, and pays only for a correct answer in time. No daily cap.

create table if not exists salary_claims (
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('weekly', 'monthly')),
  period date not null,
  amount bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, period)
);
alter table salary_claims enable row level security;
revoke all on salary_claims from anon, authenticated;

create or replace function salary_claim() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); d date := (now() at time zone 'Asia/Jerusalem')::date; wk date; mo date;
        out jsonb := '{}'; v_bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  wk := d - extract(dow from d)::int;          -- this week's Sunday
  mo := date_trunc('month', d)::date;
  if not exists (select 1 from salary_claims where user_id = u and kind = 'weekly' and period = wk) then
    insert into salary_claims values (u, 'weekly', wk, 5000) on conflict do nothing;
    if found then v_bal := apply_tx(u, 'salary', 'grant', 5000, 'salary:w:' || u || ':' || wk); out := out || '{"weekly":5000}'; end if;
  end if;
  if not exists (select 1 from salary_claims where user_id = u and kind = 'monthly' and period = mo) then
    insert into salary_claims values (u, 'monthly', mo, 25000) on conflict do nothing;
    if found then v_bal := apply_tx(u, 'salary', 'grant', 25000, 'salary:m:' || u || ':' || mo); out := out || '{"monthly":25000}'; end if;
  end if;
  return out || jsonb_build_object('balance', (select balance from wallets where user_id = u),
    'next_weekly', wk + 7, 'next_monthly', (mo + interval '1 month')::date);
end $$;

-- ---------- jobs ----------
create table if not exists job_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  game text not null check (game in ('dealer', 'driver')),
  level int not null check (level between 1 and 3),
  puzzle jsonb not null,
  secret jsonb not null,
  pay bigint not null,
  started_at timestamptz not null default clock_timestamp(),
  deadline timestamptz not null,
  done boolean not null default false,
  paid bigint
);
create index if not exists job_runs_user on job_runs (user_id, started_at desc);
alter table job_runs enable row level security;
revoke all on job_runs from anon, authenticated;

create or replace function job_pay(p_game text, p_level int) returns bigint language sql immutable as $$
  select case p_game when 'dealer' then (array[150, 500, 1600])[p_level] else (array[200, 600, 2000])[p_level] end::bigint $$;
create or replace function job_secs(p_game text, p_level int) returns int language sql immutable as $$
  select case p_game when 'dealer' then (array[30, 30, 25])[p_level] else (array[45, 45, 40])[p_level] end $$;

-- blackjack value of a hand like ["AS","TD","5H"]: best total (aces 1 or 11), busts report the plain sum
create or replace function bj_hand_value(p_cards jsonb) returns int language sql immutable as $$
  with v as (select case left(c, 1) when 'A' then 1 when 'T' then 10 when 'J' then 10 when 'Q' then 10 when 'K' then 10 else left(c, 1)::int end n,
                    left(c, 1) = 'A' ace from jsonb_array_elements_text(p_cards) c)
  select case when bool_or(ace) and sum(n) + 10 <= 21 then sum(n) + 10 else sum(n) end::int from v $$;

create or replace function job_card() returns text language sql volatile as $$
  select substr('A23456789TJQK', rl_randint(13) + 1, 1) || substr('SHDC', rl_randint(4) + 1, 1) $$;

-- shortest route (Manhattan) visiting every pickup before its drop-off; p_stops = [[x,y],...] as p0,d0,p1,d1,...
create or replace function drv_best(p_stops jsonb, p_x int, p_y int, p_mask int, p_n int) returns int language plpgsql immutable as $$
declare i int; best int := null; c int; sx int; sy int;
begin
  if p_mask = (1 << (2 * p_n)) - 1 then return 0; end if;
  for i in 0 .. 2 * p_n - 1 loop
    if p_mask & (1 << i) = 0 and (i % 2 = 0 or p_mask & (1 << (i - 1)) <> 0) then
      sx := (p_stops->i->>0)::int; sy := (p_stops->i->>1)::int;
      c := abs(sx - p_x) + abs(sy - p_y) + drv_best(p_stops, sx, sy, p_mask | (1 << i), p_n);
      if best is null or c < best then best := c; end if;
    end if;
  end loop;
  return best;
end $$;

create or replace function job_start(p_game text, p_level int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); pz jsonb; sc jsonb; r job_runs; i int; j int; k int; hand jsonb; hands jsonb := '[]'; vals jsonb := '[]';
        n int; sz int; stops jsonb := '[]'; used text[] := '{}'; x int; y int; sx int; sy int; slack numeric;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_game not in ('dealer', 'driver') or p_level not between 1 and 3 then raise exception 'invalid_job'; end if;
  if (select count(*) from job_runs where user_id = u and started_at > now() - interval '1 minute') >= 12 then raise exception 'slow_down'; end if;
  if p_game = 'dealer' then
    n := (array[4, 5, 6])[p_level];
    for i in 1 .. n loop
      k := case p_level when 1 then 2 when 2 then 3 + rl_randint(2) else 3 + rl_randint(3) end;
      hand := '[]';
      for j in 1 .. k loop hand := hand || to_jsonb(job_card()); end loop;
      if p_level = 3 and rl_randint(2) = 0 and not exists (select 1 from jsonb_array_elements_text(hand) c where left(c, 1) = 'A') then
        hand := jsonb_set(hand, '{0}', to_jsonb('A' || substr('SHDC', rl_randint(4) + 1, 1)));
      end if;
      hands := hands || jsonb_build_array(hand); vals := vals || to_jsonb(bj_hand_value(hand));
    end loop;
    pz := jsonb_build_object('hands', hands); sc := jsonb_build_object('values', vals);
  else
    n := (array[2, 3, 4])[p_level]; sz := (array[6, 7, 8])[p_level]; slack := (array[1.5, 1.25, 1.1])[p_level];
    sx := rl_randint(sz); sy := rl_randint(sz); used := array[sx || ',' || sy];
    for i in 1 .. 2 * n loop
      loop x := rl_randint(sz); y := rl_randint(sz); exit when not (x || ',' || y) = any(used); end loop;
      used := used || (x || ',' || y); stops := stops || jsonb_build_array(jsonb_build_array(x, y));
    end loop;
    k := drv_best(stops, sx, sy, 0, n);
    pz := jsonb_build_object('size', sz, 'start', jsonb_build_array(sx, sy), 'stops', stops, 'max', floor(k * slack)::int, 'best', k);
    sc := jsonb_build_object('max', floor(k * slack)::int);
  end if;
  insert into job_runs (user_id, game, level, puzzle, secret, pay, deadline)
    values (u, p_game, p_level, pz, sc, job_pay(p_game, p_level), clock_timestamp() + make_interval(secs => job_secs(p_game, p_level) + 2))
    returning * into r;
  return jsonb_build_object('id', r.id, 'puzzle', pz, 'seconds', job_secs(p_game, p_level), 'pay', r.pay);
end $$;

-- p_answer: dealer -> [21, 17, ...] (one total per hand); driver -> [0, 1, 2, 3, ...] stop indexes in visiting order
create or replace function job_finish(p_id uuid, p_answer jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r job_runs; ok boolean := false; why text := ''; len int := 0; x int; y int; i int; s int; seen int := 0; n int; v_bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into r from job_runs where id = p_id and user_id = u for update;
  if not found then raise exception 'invalid_job'; end if;
  if r.done then return jsonb_build_object('ok', r.paid > 0, 'paid', r.paid, 'balance', (select balance from wallets where user_id = u), 'again', true); end if;
  if clock_timestamp() > r.deadline then why := 'time';
  elsif clock_timestamp() < r.started_at + interval '2 seconds' then why := 'too_fast';
  elsif r.game = 'dealer' then
    ok := jsonb_typeof(p_answer) = 'array' and p_answer = r.secret->'values';
    if not ok then why := 'wrong'; end if;
  else
    n := jsonb_array_length(r.puzzle->'stops') / 2;
    if jsonb_typeof(p_answer) <> 'array' or jsonb_array_length(p_answer) <> 2 * n then why := 'route';
    else
      x := (r.puzzle->'start'->>0)::int; y := (r.puzzle->'start'->>1)::int;
      for i in 0 .. 2 * n - 1 loop
        s := (p_answer->>i)::int;
        if s is null or s < 0 or s >= 2 * n or seen & (1 << s) <> 0 or (s % 2 = 1 and seen & (1 << (s - 1)) = 0) then why := 'route'; exit; end if;
        seen := seen | (1 << s);
        len := len + abs((r.puzzle->'stops'->s->>0)::int - x) + abs((r.puzzle->'stops'->s->>1)::int - y);
        x := (r.puzzle->'stops'->s->>0)::int; y := (r.puzzle->'stops'->s->>1)::int;
      end loop;
      if why = '' then ok := len <= (r.secret->>'max')::int; if not ok then why := 'long'; end if; end if;
    end if;
  end if;
  update job_runs set done = true, paid = case when ok then pay else 0 end where id = r.id;
  if ok then v_bal := apply_tx(u, 'job_' || r.game, 'grant', r.pay, 'job:' || r.id); else v_bal := (select balance from wallets where user_id = u); end if;
  return jsonb_build_object('ok', ok, 'paid', case when ok then r.pay else 0 end, 'why', why, 'balance', v_bal, 'len', len,
    'values', case when r.game = 'dealer' then r.secret->'values' end);
end $$;

revoke all on function job_pay, job_secs, bj_hand_value, job_card, drv_best from public, anon, authenticated;
revoke all on function salary_claim(), job_start(text, int), job_finish(uuid, jsonb) from public, anon;
grant execute on function salary_claim(), job_start(text, int), job_finish(uuid, jsonb) to authenticated;
