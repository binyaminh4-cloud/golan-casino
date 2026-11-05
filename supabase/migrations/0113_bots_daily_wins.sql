-- 0113 · Owner 5.11: daily limits count only WINS. Baccarat vs bot: play as much as you like until you beat the bot 3 times today.
-- Bots' ladder: play until you win once today. Losses never close the challenge. Re-runnable.
begin;
create or replace function bb_view(r bb_runs) returns jsonb language sql stable as $$
  select jsonb_build_object('id', r.id, 'bot', r.bot, 'hand', r.hand, 'hands', 20, 'me', r.me_pts, 'bot_pts', r.bot_pts,
    'log', r.log, 'status', r.status, 'season_pts', r.season_pts,
    'left_today', greatest(0, 3 - (select count(*) from bb_runs x where x.user_id = r.user_id and x.day = r.day and x.season_pts = 30))::int) $$;

create or replace function bb_start() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r bb_runs; today date := (now() at time zone 'Asia/Jerusalem')::date; shoe int[];
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if not gc_on('challenges') then raise exception 'challenges_paused'; end if;
  select * into r from bb_runs where user_id = u and status = 'active' order by created_at desc limit 1;
  if found then return bb_view(r); end if;
  if (select count(*) from bb_runs where user_id = u and day = today and season_pts = 30) >= 3 then raise exception 'daily_limit'; end if;
  select array_agg(c order by random()) into shoe from (select ((i % 13) + 1) c from generate_series(0, 311) i) s;
  insert into bb_runs(user_id, season, day, bot, shoe) values (u, (ch_season()).no, today, 1 + floor(random() * 5)::int, shoe) returning * into r;
  return bb_view(r);
end $$;

create or replace function ld_view(r ld_runs) returns jsonb language sql stable as $$
  select jsonb_build_object('id', r.id, 'stage', r.stage, 'me', r.me, 'bot', r.bot, 'pot', r.pot, 'rolls', r.rolls, 'goal', 30,
    'status', r.status, 'season_pts', r.season_pts,
    'left_today', greatest(0, 1 - (select count(*) from ld_runs x where x.user_id = r.user_id and x.day = r.day and x.status = 'won'))::int) $$;

create or replace function ld_state() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s int; p ld_progress; r ld_runs; today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  s := (ch_season()).no;
  select * into p from ld_progress where user_id = u and season = s;
  select * into r from ld_runs where user_id = u and status = 'active' order by created_at desc limit 1;
  return jsonb_build_object('stage', coalesce(p.stage, 1), 'done', coalesce(p.done, false),
    'left_today', greatest(0, 1 - (select count(*) from ld_runs where user_id = u and day = today and status = 'won'))::int,
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
  if (select count(*) from ld_runs where user_id = u and day = today and status = 'won') >= 1 then raise exception 'daily_limit'; end if;
  insert into ld_runs(user_id, season, day, stage) values (u, s, today, p.stage) returning * into r;
  -- from stage 4 the bot rolls first
  if r.stage >= 4 then
    opening := ld_bot_turn(r.stage, 0, 0);
    if opening[array_length(opening, 1)] <> 1 then update ld_runs set bot = (select sum(x) from unnest(opening) x) where id = r.id returning * into r; end if;
    return ld_view(r) || jsonb_build_object('bot_rolls', to_jsonb(opening), 'opening', true);
  end if;
  return ld_view(r);
end $$;
commit;
