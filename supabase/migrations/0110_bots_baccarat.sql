-- 0110 · Challenge vs the bots #1: באקרה מול הבוט (owner-approved 2026-11-04).
-- 20 hands from a 6-deck shoe. Before each hand the player picks Player / Banker / Tie; the bot picks too (random, with a light
-- per-bot leaning), then the hand is dealt by standard baccarat drawing rules. Right pick = 1 point, right Tie = 3.
-- No money. At the end: beat the bot = 30 season points, draw = 10 (kind 'bots'). 3 runs a day (Israel time).
-- The shoe stays on the server; the browser only sees hands already dealt. Re-runnable.
begin;
alter table ch_points drop constraint if exists ch_points_kind_check;
alter table ch_points add constraint ch_points_kind_check check (kind in ('fisher','ido','zeus','tourney','bots'));

create table if not exists bb_runs(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  season int not null, day date not null, bot int not null check (bot between 1 and 5), shoe int[] not null, pos int not null default 0,
  hand int not null default 0, me_pts int not null default 0, bot_pts int not null default 0, log jsonb not null default '[]',
  status text not null default 'active' check (status in ('active','done')), season_pts int, created_at timestamptz not null default now());
create index if not exists bb_runs_user_day on bb_runs(user_id, day);
alter table bb_runs enable row level security;
revoke all on bb_runs from public, anon, authenticated;

create or replace function bb_val(c int) returns int language sql immutable as $$ select case when c >= 10 then 0 else c end $$;

-- view without the shoe
create or replace function bb_view(r bb_runs) returns jsonb language sql stable as $$
  select jsonb_build_object('id', r.id, 'bot', r.bot, 'hand', r.hand, 'hands', 20, 'me', r.me_pts, 'bot_pts', r.bot_pts,
    'log', r.log, 'status', r.status, 'season_pts', r.season_pts,
    'left_today', greatest(0, 3 - (select count(*) from bb_runs x where x.user_id = r.user_id and x.day = r.day))::int) $$;

create or replace function bb_start() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r bb_runs; today date := (now() at time zone 'Asia/Jerusalem')::date; shoe int[];
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if not gc_on('challenges') then raise exception 'challenges_paused'; end if;
  select * into r from bb_runs where user_id = u and status = 'active' order by created_at desc limit 1;
  if found then return bb_view(r); end if;
  if (select count(*) from bb_runs where user_id = u and day = today) >= 3 then raise exception 'daily_limit'; end if;
  select array_agg(c order by random()) into shoe from (select ((i % 13) + 1) c from generate_series(0, 311) i) s;
  insert into bb_runs(user_id, season, day, bot, shoe) values (u, (ch_season()).no, today, 1 + floor(random() * 5)::int, shoe) returning * into r;
  return bb_view(r);
end $$;

create or replace function bb_pick(p_run uuid, p_pick text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r bb_runs; bp text; x float; w int[]; pc int[]; bc int[]; pt int; bt int; v int; res text; mg int; bg int; e jsonb; sp int;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_pick not in ('P','B','T') then raise exception 'invalid_pick'; end if;
  select * into r from bb_runs where id = p_run and user_id = u for update;
  if not found or r.status <> 'active' then raise exception 'run_closed'; end if;
  -- the bot: random, with a light leaning per bot (P, B, T weights)
  w := (array[[45,45,10],[40,55,5],[35,50,15],[55,40,5],[44,50,6]])[r.bot:r.bot][1:3];
  x := random() * 100; bp := case when x < w[1][1] then 'P' when x < w[1][1] + w[1][2] then 'B' else 'T' end;
  -- standard baccarat third-card rules
  pc := array[r.shoe[r.pos+1], r.shoe[r.pos+3]]; bc := array[r.shoe[r.pos+2], r.shoe[r.pos+4]]; r.pos := r.pos + 4;
  pt := (bb_val(pc[1]) + bb_val(pc[2])) % 10; bt := (bb_val(bc[1]) + bb_val(bc[2])) % 10;
  if pt < 8 and bt < 8 then
    if pt <= 5 then
      pc := pc || r.shoe[r.pos+1]; r.pos := r.pos + 1; v := bb_val(pc[3]); pt := (pt + v) % 10;
      if bt <= 2 or (bt = 3 and v <> 8) or (bt = 4 and v between 2 and 7) or (bt = 5 and v between 4 and 7) or (bt = 6 and v between 6 and 7) then
        bc := bc || r.shoe[r.pos+1]; r.pos := r.pos + 1; bt := (bt + bb_val(bc[3])) % 10; end if;
    elsif bt <= 5 then bc := bc || r.shoe[r.pos+1]; r.pos := r.pos + 1; bt := (bt + bb_val(bc[3])) % 10; end if;
  end if;
  res := case when pt > bt then 'P' when bt > pt then 'B' else 'T' end;
  mg := case when p_pick = res then case when res = 'T' then 3 else 1 end else 0 end;
  bg := case when bp = res then case when res = 'T' then 3 else 1 end else 0 end;
  e := jsonb_build_object('n', r.hand + 1, 'me', p_pick, 'bot', bp, 'p', to_jsonb(pc), 'b', to_jsonb(bc), 'pt', pt, 'bt', bt, 'res', res, 'mg', mg, 'bg', bg);
  update bb_runs set pos = r.pos, hand = hand + 1, me_pts = me_pts + mg, bot_pts = bot_pts + bg, log = log || jsonb_build_array(e) where id = r.id returning * into r;
  if r.hand >= 20 then
    sp := case when r.me_pts > r.bot_pts then 30 when r.me_pts = r.bot_pts then 10 else 0 end;
    if sp > 0 then perform ch_add_points(r.season, u, 'bots', sp); end if;
    update bb_runs set status = 'done', season_pts = sp where id = r.id returning * into r;
  end if;
  return bb_view(r) || jsonb_build_object('last', e);
end $$;

revoke all on function bb_start(), bb_pick(uuid, text), bb_view(bb_runs), bb_val(int) from public, anon;
grant execute on function bb_start(), bb_pick(uuid, text) to authenticated;
commit;
