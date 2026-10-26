-- Golan Casino · admin page: settings the owner controls (challenges on/off, games shown in the lobby, salaries),
-- the members list, and a clean season restart. Challenges start PAUSED until the owner turns them on.

create table if not exists gc_settings (key text primary key, value jsonb not null);
alter table gc_settings enable row level security;
revoke all on gc_settings from anon, authenticated;
insert into gc_settings values
  ('challenges', 'false'),
  ('games', '{"blackjack":true,"lightning_bj":true,"roulette":true,"lightning":true,"xxx":true,"slots":true,"fortune":true,"poker":true,"jobs":true}'),
  ('salary_weekly', '5000'), ('salary_monthly', '25000')
on conflict (key) do nothing;

create or replace function gc_on(p_key text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select value::text::boolean from gc_settings where key = p_key), false) $$;
create or replace function gc_num(p_key text) returns bigint language sql stable security definer set search_path = public as $$
  select coalesce((select (value::text)::bigint from gc_settings where key = p_key), 0) $$;

-- what every member's lobby needs to know
create or replace function gc_public() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('challenges', gc_on('challenges'), 'games', (select value from gc_settings where key = 'games'))
  where auth.uid() is not null $$;

create or replace function gc_is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_admin) $$;

create or replace function admin_settings() returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not gc_is_admin() then raise exception 'not_admin'; end if;
  return (select jsonb_object_agg(key, value) from gc_settings) || jsonb_build_object('starting_balance', (select starting_balance from app_settings where id = 1),
    'season', (select jsonb_build_object('no', no, 'ends_at', ends_at) from seasons where now() >= starts_at and now() < ends_at order by no desc limit 1));
end $$;

create or replace function admin_set(p_key text, p_value jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not gc_is_admin() then raise exception 'not_admin'; end if;
  if p_key = 'starting_balance' then
    update app_settings set starting_balance = greatest(0, (p_value::text)::bigint) where id = 1;
  elsif p_key in ('challenges') then
    insert into gc_settings values (p_key, to_jsonb((p_value::text)::boolean)) on conflict (key) do update set value = excluded.value;
  elsif p_key in ('salary_weekly', 'salary_monthly') then
    insert into gc_settings values (p_key, to_jsonb(greatest(0, least(10000000, (p_value::text)::bigint)))) on conflict (key) do update set value = excluded.value;
  elsif p_key = 'games' then
    if jsonb_typeof(p_value) <> 'object' then raise exception 'invalid_value'; end if;
    update gc_settings set value = value || p_value where key = 'games';
  else raise exception 'invalid_key'; end if;
  return admin_settings();
end $$;

-- end the current season without prizes and start a fresh one right away
create or replace function admin_season_restart() returns jsonb language plpgsql security definer set search_path = public as $$
declare s seasons;
begin
  if not gc_is_admin() then raise exception 'not_admin'; end if;
  update seasons set ends_at = now(), settled = true, results = coalesce(results, '{}') || '{"restarted":true}'
    where not settled and now() < ends_at;
  update ch_runs set status = 'done', finished_at = now() where status = 'playing';
  update ch_duels set status = 'expired', finished_at = now() where status in ('challenger', 'waiting', 'playing');
  update zeus_duels set status = 'expired', finished_at = now() where status in ('invited', 'active');
  s := ch_season();
  return jsonb_build_object('season', s.no, 'ends_at', s.ends_at);
end $$;

create or replace function admin_members() returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not gc_is_admin() then raise exception 'not_admin'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.nickname, 'username', p.username, 'admin', p.is_admin,
     'balance', w.balance, 'character', p.character_key, 'joined', p.created_at,
     'seated', (select t.name from poker_seats s join poker_tables t on t.id = s.table_id where s.user_id = p.id limit 1)) order by p.created_at), '[]')
    from profiles p join wallets w on w.user_id = p.id);
end $$;

create or replace function ch_start_fisher() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s seasons; r ch_runs;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if not gc_on('challenges') then raise exception 'challenges_paused'; end if;
  s := ch_season();
  select * into r from ch_runs where user_id = u and status = 'playing' limit 1;
  if found then return jsonb_build_object('run', r.id, 'kind', r.kind); end if;
  insert into ch_runs (season, user_id, kind, deck, max_hands) values (s.no, u, 'fisher', ch_new_deck(), 15) returning * into r;
  return jsonb_build_object('run', r.id, 'kind', 'fisher');
end $$;

create or replace function ch_challenge_ido(p_opponent uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s seasons; d ch_duels; r ch_runs;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if not gc_on('challenges') then raise exception 'challenges_paused'; end if;
  if p_opponent is null or p_opponent = u or not exists (select 1 from profiles where id = p_opponent) then raise exception 'invalid_opponent'; end if;
  if exists (select 1 from ch_runs where user_id = u and status = 'playing') then raise exception 'challenge_in_progress'; end if;
  if (select count(*) from ch_duels where challenger = u and opponent = p_opponent and created_at > now() - interval '1 day') >= 2 then raise exception 'slow_down'; end if;
  s := ch_season();
  insert into ch_duels (season, challenger, opponent, deck) values (s.no, u, p_opponent, ch_new_deck()) returning * into d;
  insert into ch_runs (season, user_id, kind, duel, deck, max_hands) values (s.no, u, 'ido', d.id, d.deck, 20) returning * into r;
  update ch_duels set run_a = r.id where id = d.id;
  return jsonb_build_object('run', r.id, 'kind', 'ido', 'duel', d.id);
end $$;

create or replace function ch_accept_ido(p_duel uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); d ch_duels; r ch_runs;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if not gc_on('challenges') then raise exception 'challenges_paused'; end if;
  select * into d from ch_duels where id = p_duel and opponent = u for update;
  if not found or d.status not in ('waiting', 'playing') then raise exception 'challenge_closed'; end if;
  if d.run_b is not null then return jsonb_build_object('run', d.run_b, 'kind', 'ido', 'target', d.score_a); end if;
  if exists (select 1 from ch_runs where user_id = u and status = 'playing') then raise exception 'challenge_in_progress'; end if;
  insert into ch_runs (season, user_id, kind, duel, deck, max_hands) values (d.season, u, 'ido', d.id, d.deck, 20) returning * into r;
  update ch_duels set run_b = r.id, status = 'playing' where id = d.id;
  return jsonb_build_object('run', r.id, 'kind', 'ido', 'target', d.score_a);
end $$;

create or replace function zeus_invite(p_opponent uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s seasons; d zeus_duels;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if not gc_on('challenges') then raise exception 'challenges_paused'; end if;
  if p_opponent is null or p_opponent = u or not exists (select 1 from profiles where id = p_opponent) then raise exception 'invalid_opponent'; end if;
  if exists (select 1 from zeus_duels where u in (a, b) and (status = 'active' or (status = 'invited' and created_at > now() - interval '10 minutes'))) then raise exception 'challenge_in_progress'; end if;
  s := ch_season();
  insert into zeus_duels (season, a, b) values (s.no, u, p_opponent) returning * into d;
  perform chat_sys('lobby', '⚡ ' || (select nickname from profiles where id = u) || ' מזמין את ' || (select nickname from profiles where id = p_opponent) ||
    ' לדו־קרב של זאוס! יש 10 דקות לקבל, בעמוד האתגרים.');
  return jsonb_build_object('duel', d.id);
end $$;

create or replace function zeus_answer(p_duel uuid, p_accept boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); d zeus_duels; n bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if not gc_on('challenges') then raise exception 'challenges_paused'; end if;
  select * into d from zeus_duels where id = p_duel and b = u for update;
  if not found or d.status <> 'invited' or d.created_at < now() - interval '10 minutes' then raise exception 'challenge_closed'; end if;
  if not p_accept then update zeus_duels set status = 'declined', finished_at = now() where id = d.id; return jsonb_build_object('duel', d.id, 'status', 'declined'); end if;
  if exists (select 1 from zeus_duels where u in (a, b) and status = 'active') then raise exception 'challenge_in_progress'; end if;
  n := floor(rl_live_now() / rl_live_cycle()) + 1;            -- starts with the next live round
  update zeus_duels set status = 'active', start_round = n where id = d.id;
  return jsonb_build_object('duel', d.id, 'status', 'active');
end $$;

create or replace function tourney_join() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s seasons; t tourneys; tb uuid; i int;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if not gc_on('challenges') then raise exception 'challenges_paused'; end if;
  select * into t from tourneys where u = any(players) and status in ('registering', 'running');
  if found then return jsonb_build_object('id', t.id, 'status', t.status, 'table', t.table_id); end if;
  if exists (select 1 from poker_seats where user_id = u) then raise exception 'already_seated'; end if;
  s := ch_season();
  select * into t from tourneys where status = 'registering' order by created_at limit 1 for update;
  if not found then insert into tourneys (season) values (s.no) returning * into t; end if;
  perform apply_tx(u, 'tourney', 'stake', -t.buyin, 'tnin:' || t.id || ':' || u);
  update tourneys set players = players || u where id = t.id returning * into t;
  if array_length(t.players, 1) = 1 then
    perform chat_sys('lobby', '🎡 ' || (select nickname from profiles where id = u) || ' נרשם לטורניר ג׳קפוט. חסרים 2 שחקנים!');
  end if;
  if array_length(t.players, 1) >= 3 then
    t.mult := tn_wheel(); t.prize := (t.buyin * t.mult)::bigint;
    insert into poker_tables (name, max_seats, small_blind, big_blind, tourney) values ('טורניר ג׳קפוט', 6, 10, 20, t.id) returning id into tb;
    insert into poker_hands (table_id, next_at) values (tb, now() + interval '8 seconds');    -- time for the wheel
    for i in 1..3 loop
      insert into poker_seats (table_id, seat_index, user_id, stack) values (tb, (i - 1) * 2, t.players[i], 500);
    end loop;
    update tourneys set status = 'running', started_at = now(), mult = t.mult, prize = t.prize, table_id = tb where id = t.id;
    perform chat_sys('lobby', '🎡 טורניר ג׳קפוט התחיל! הגלגל קבע פרס של ₪' || to_char(t.prize, 'FM999,999,999') ||
      case when t.mult >= 10 then ' 🔥' else '' end);
    return jsonb_build_object('id', t.id, 'status', 'running', 'table', tb);
  end if;
  return jsonb_build_object('id', t.id, 'status', 'registering');
end $$;

create or replace function ch_state() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s seasons; out jsonb;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if not gc_on('challenges') then return jsonb_build_object('paused', true); end if;
  s := ch_season();
  out := jsonb_build_object('season', s.no, 'ends_at', s.ends_at, 'me', u,
    'vault', ch_vault(s.no), 'vault_target', 3000000,
    'board', (select coalesce(jsonb_agg(x order by (x->>'total')::int desc), '[]') from (
        select jsonb_build_object('id', p.id, 'name', p.nickname,
          'fisher', coalesce(sum(cp.points) filter (where cp.kind = 'fisher'), 0),
          'ido', coalesce(sum(cp.points) filter (where cp.kind = 'ido'), 0),
          'zeus', coalesce(sum(cp.points) filter (where cp.kind = 'zeus'), 0),
          'tourney', coalesce(sum(cp.points) filter (where cp.kind = 'tourney'), 0),
          'total', coalesce(sum(cp.points), 0)) x
        from profiles p left join ch_points cp on cp.user_id = p.id and cp.season = s.no group by p.id, p.nickname) t),
    'my_run', (select jsonb_build_object('id', id, 'kind', kind, 'hands', hands, 'max', max_hands, 'chips', chips) from ch_runs
               where user_id = u and status = 'playing' order by created_at desc limit 1),
    'fisher_best', (select max(chips) from ch_runs where user_id = u and season = s.no and kind = 'fisher' and status = 'done'),
    'duels', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'status', d.status,
                 'challenger', d.challenger, 'challenger_name', pa.nickname, 'opponent', d.opponent, 'opponent_name', pb.nickname,
                 'score_a', case when d.status in ('waiting', 'playing', 'done', 'expired') then d.score_a end,
                 'score_b', case when d.status = 'done' then d.score_b end, 'winner', d.winner, 'created_at', d.created_at)
               order by d.created_at desc), '[]')
              from ch_duels d join profiles pa on pa.id = d.challenger join profiles pb on pb.id = d.opponent
              where d.season = s.no and (d.challenger = u or d.opponent = u)),
    'tourney', (select jsonb_build_object('id', id, 'status', status, 'players', (select jsonb_agg(p.nickname) from profiles p where p.id = any(t.players)),
                 'prize', prize, 'table', table_id) from tourneys t where u = any(players) and status in ('registering', 'running') order by created_at desc limit 1),
    'tourney_open', (select count(*) from tourneys where status = 'registering'),
    'last_results', (select results from seasons where settled order by no desc limit 1),
    'members', (select jsonb_agg(jsonb_build_object('id', id, 'name', nickname) order by nickname) from profiles where id <> u));
  return out;
end $$;

create or replace function salary_claim() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); d date := (now() at time zone 'Asia/Jerusalem')::date; wk date; mo date;
        out jsonb := '{}'; v_bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if gc_num('salary_weekly') <= 0 and gc_num('salary_monthly') <= 0 then return '{}'::jsonb; end if;
  wk := d - extract(dow from d)::int;          -- this week's Sunday
  mo := date_trunc('month', d)::date;
  if not exists (select 1 from salary_claims where user_id = u and kind = 'weekly' and period = wk) then
    insert into salary_claims values (u, 'weekly', wk, gc_num('salary_weekly')) on conflict do nothing;
    if found then v_bal := apply_tx(u, 'salary', 'grant', gc_num('salary_weekly'), 'salary:w:' || u || ':' || wk); out := out || jsonb_build_object('weekly', gc_num('salary_weekly')); end if;
  end if;
  if not exists (select 1 from salary_claims where user_id = u and kind = 'monthly' and period = mo) then
    insert into salary_claims values (u, 'monthly', mo, gc_num('salary_monthly')) on conflict do nothing;
    if found then v_bal := apply_tx(u, 'salary', 'grant', gc_num('salary_monthly'), 'salary:m:' || u || ':' || mo); out := out || jsonb_build_object('monthly', gc_num('salary_monthly')); end if;
  end if;
  return out || jsonb_build_object('balance', (select balance from wallets where user_id = u),
    'next_weekly', wk + 7, 'next_monthly', (mo + interval '1 month')::date);
end $$;
revoke all on function gc_on, gc_num, gc_is_admin from public, anon, authenticated;
revoke all on function gc_public(), admin_settings(), admin_set(text, jsonb), admin_season_restart(), admin_members() from public, anon;
grant execute on function gc_public(), admin_settings(), admin_set(text, jsonb), admin_season_restart(), admin_members() to authenticated;
