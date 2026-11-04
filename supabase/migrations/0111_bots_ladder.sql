-- 0111 · Challenge vs the bots #2: סולם הבוטים (owner-approved 2026-11-04). "Dare dice" (Pig) to 30 points.
-- Roll a die and add it to this turn's pot; stop any time to bank the pot. Roll a 1 and the pot is gone. First to 30 wins.
-- 5 stages per season: 1 אביחי ניוטון · 2 נתנאל אמלקה · 3 יואב הנחוש · 4 23עידו11 · 5 המלך בנימין (the boss).
-- Each bot banks at its own (slightly random) pot size; higher stages dare more. From stage 4 the bot opens the game.
-- Win = next stage (+5 season points, the boss +30, then the ladder is done for the season). Lose = one stage down.
-- 5 battles a day (Israel date). No money. The server rolls every die; the browser only animates. Re-runnable.
begin;
create table if not exists ld_progress(user_id uuid not null references auth.users(id) on delete cascade, season int not null,
  stage int not null default 1, done boolean not null default false, primary key(user_id, season));
create table if not exists ld_runs(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  season int not null, day date not null, stage int not null check (stage between 1 and 5),
  me int not null default 0, bot int not null default 0, pot int not null default 0, rolls int not null default 0,
  status text not null default 'active' check (status in ('active','won','lost')), season_pts int,
  created_at timestamptz not null default now());
create index if not exists ld_runs_user_day on ld_runs(user_id, day);
alter table ld_progress enable row level security; alter table ld_runs enable row level security;
revoke all on ld_progress, ld_runs from public, anon, authenticated;

create or replace function ld_view(r ld_runs) returns jsonb language sql stable as $$
  select jsonb_build_object('id', r.id, 'stage', r.stage, 'me', r.me, 'bot', r.bot, 'pot', r.pot, 'rolls', r.rolls, 'goal', 30,
    'status', r.status, 'season_pts', r.season_pts,
    'left_today', greatest(0, 5 - (select count(*) from ld_runs x where x.user_id = r.user_id and x.day = r.day))::int) $$;

create or replace function ld_state() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s int; p ld_progress; r ld_runs; today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  s := (ch_season()).no;
  select * into p from ld_progress where user_id = u and season = s;
  select * into r from ld_runs where user_id = u and status = 'active' order by created_at desc limit 1;
  return jsonb_build_object('stage', coalesce(p.stage, 1), 'done', coalesce(p.done, false),
    'left_today', greatest(0, 5 - (select count(*) from ld_runs where user_id = u and day = today))::int,
    'run', case when r.id is null then null else ld_view(r) end);
end $$;

create or replace function ld_start() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s int; p ld_progress; r ld_runs; opening int[]; today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if not gc_on('challenges') then raise exception 'challenges_paused'; end if;
  select * into r from ld_runs where user_id = u and status = 'active' order by created_at desc limit 1;
  if found then return ld_view(r); end if;
  s := (ch_season()).no;
  insert into ld_progress(user_id, season) values (u, s) on conflict do nothing;
  select * into p from ld_progress where user_id = u and season = s;
  if p.done then raise exception 'ladder_done'; end if;
  if (select count(*) from ld_runs where user_id = u and day = today) >= 5 then raise exception 'daily_limit'; end if;
  insert into ld_runs(user_id, season, day, stage) values (u, s, today, p.stage) returning * into r;
  -- from stage 4 the bot rolls first
  if r.stage >= 4 then
    opening := ld_bot_turn(r.stage, 0, 0);
    if opening[array_length(opening, 1)] <> 1 then update ld_runs set bot = (select sum(x) from unnest(opening) x) where id = r.id returning * into r; end if;
    return ld_view(r) || jsonb_build_object('bot_rolls', to_jsonb(opening), 'opening', true);
  end if;
  return ld_view(r);
end $$;

-- the bot plays a whole turn; returns the rolls it made (a final 1 means the turn scored nothing)
create or replace function ld_bot_turn(p_stage int, p_me int, p_bot int) returns int[] language plpgsql as $$
declare d int; pot int := 0; target int; rolls int[] := '{}';
begin
  -- tuned by simulation vs a player who banks at 20 (player wins ≈ 83% · 71% · 59% · 40% · 34%):
  -- stage 1 banks at ~6, 2 at ~10, 3 at ~15; stage 4 races (more when behind); the boss goes for the win once you reach 20.
  target := case p_stage when 1 then 6 + floor(random() * 5)::int - 2 when 2 then 10 + floor(random() * 5)::int - 2
            when 3 then 15 + floor(random() * 5)::int - 2
            when 4 then greatest(14, least(26, 20 + (p_me - p_bot) / 3)) + floor(random() * 5)::int - 2
            else case when p_me >= 20 then 30 else greatest(16, least(30, 21 + (p_me - p_bot) / 2)) end end;
  loop
    d := 1 + floor(random() * 6)::int; rolls := rolls || d;
    if d = 1 then exit; end if;
    pot := pot + d;
    if p_bot + pot >= 30 or pot >= target then exit; end if;
  end loop;
  return rolls;
end $$;

create or replace function ld_finish(r inout ld_runs) language plpgsql as $$
declare won boolean := r.me >= 30; pts int;
begin
  if won then
    pts := case when r.stage = 5 then 30 else 5 end;
    perform ch_add_points(r.season, r.user_id, 'bots', pts);
    update ld_progress set stage = least(5, stage + 1), done = (r.stage = 5) where user_id = r.user_id and season = r.season;
    r.status := 'won'; r.season_pts := pts;
  else
    update ld_progress set stage = greatest(1, stage - 1) where user_id = r.user_id and season = r.season;
    r.status := 'lost'; r.season_pts := 0;
  end if;
end $$;

create or replace function ld_act(p_run uuid, p_hold boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r ld_runs; d int; bot_rolls int[]; bust boolean := false; banked int := 0;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into r from ld_runs where id = p_run and user_id = u for update;
  if not found or r.status <> 'active' then raise exception 'run_closed'; end if;
  if not p_hold then
    d := 1 + floor(random() * 6)::int; r.rolls := r.rolls + 1;
    if d = 1 then bust := true; r.pot := 0; else r.pot := r.pot + d; end if;
    if not bust and r.me + r.pot < 30 then
      update ld_runs set pot = r.pot, rolls = r.rolls where id = r.id;
      return ld_view(r) || jsonb_build_object('roll', d);
    end if;
  elsif r.pot = 0 then raise exception 'nothing_to_hold';
  end if;
  banked := r.pot; r.me := r.me + r.pot; r.pot := 0; r.rolls := 0;   -- bank (or lose it on a 1, pot already 0)
  if r.me >= 30 then select * into r from ld_finish(r);
  else
    bot_rolls := ld_bot_turn(r.stage, r.me, r.bot);
    if bot_rolls[array_length(bot_rolls, 1)] <> 1 then r.bot := r.bot + (select sum(x) from unnest(bot_rolls) x); end if;
    if r.bot >= 30 then select * into r from ld_finish(r); end if;
  end if;
  update ld_runs set me = r.me, bot = r.bot, pot = 0, rolls = 0, status = r.status, season_pts = r.season_pts where id = r.id;
  return ld_view(r) || jsonb_build_object('roll', d, 'bust', bust, 'banked', banked, 'bot_rolls', coalesce(to_jsonb(bot_rolls), '[]'::jsonb),
    'stage_now', (select stage from ld_progress where user_id = u and season = r.season));
end $$;

revoke all on function ld_state(), ld_start(), ld_act(uuid, boolean), ld_view(ld_runs), ld_bot_turn(int, int, int), ld_finish(ld_runs) from public, anon;
grant execute on function ld_state(), ld_start(), ld_act(uuid, boolean) to authenticated;
commit;
