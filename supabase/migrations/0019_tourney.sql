-- Golan Casino · "Jackpot tournament" (season challenge 'tourney'): a 3-player sit-and-go on the poker engine.
-- Buy-in 10,000 from the wallet. When the third player joins, a wheel sets the prize (all to the winner):
--   x1.5 60% · x2 25% · x5 8% · x10 5% · x25 1.6% · x50 0.4%  -> expected 2.90 buy-ins out of 3 paid in (96.7%).
-- Everyone starts with 500 tournament chips (not wallet money); blinds go up every 5 hands. Points: winner 30, runner-up 10.

alter table poker_tables add column if not exists tourney uuid;
alter table ch_points drop constraint if exists ch_points_kind_check;
alter table ch_points add constraint ch_points_kind_check check (kind in ('fisher', 'ido', 'zeus', 'tourney'));

create table if not exists tourneys (
  id uuid primary key default gen_random_uuid(),
  season int not null references seasons(no),
  status text not null default 'registering' check (status in ('registering', 'running', 'done', 'cancelled')),
  buyin bigint not null default 10000,
  players uuid[] not null default '{}',
  mult numeric, prize bigint,
  table_id uuid references poker_tables(id),
  places jsonb not null default '[]',
  created_at timestamptz not null default now(),
  started_at timestamptz, finished_at timestamptz
);
alter table tourneys enable row level security;
revoke all on tourneys from anon, authenticated;

-- the leaderboard counts cash-table chips only (tournament chips are not money)
create or replace view leaderboard with (security_invoker = true) as
  select p.id, p.nickname, p.avatar_url, p.character_key,
         w.balance + coalesce((select sum(s.stack) from poker_seats s join poker_tables t on t.id = s.table_id where s.user_id = p.id and t.tourney is null), 0) as wealth
  from profiles p join wallets w on w.user_id = p.id;

create or replace function tn_wheel() returns numeric language plpgsql volatile as $$
declare r int := rl_randint(1000);
begin
  return case when r < 600 then 1.5 when r < 850 then 2 when r < 930 then 5 when r < 980 then 10 when r < 996 then 25 else 50 end;
end $$;

create or replace function tn_blinds(p_level int) returns bigint language sql immutable as $$
  select (array[10, 15, 25, 40, 60, 100, 150, 250, 400, 600, 1000])[least(p_level + 1, 11)]::bigint $$;

-- between hands: knock out empty stacks and leavers, pay the winner, raise the blinds
create or replace function tn_between_hands(p_table uuid) returns void language plpgsql security definer set search_path = public as $$
declare t tourneys; s record; n int; w record; nm text; lvl int;
begin
  select * into t from tourneys where table_id = p_table for update;
  if not found or t.status <> 'running' then return; end if;
  for s in select * from poker_seats where table_id = p_table and (stack = 0 or leaving) order by stack loop
    delete from poker_seats where table_id = p_table and user_id = s.user_id;
    n := (select count(*) from poker_seats where table_id = p_table);
    update tourneys set places = places || jsonb_build_object('user', s.user_id, 'place', n + 1) where id = t.id;
    if n + 1 = 2 then perform ch_add_points(t.season, s.user_id, 'tourney', 10); end if;
  end loop;
  if (select count(*) from poker_seats where table_id = p_table) <= 1 then
    select * into w from poker_seats where table_id = p_table limit 1;
    if found then
      perform apply_tx(w.user_id, 'tourney', 'payout', t.prize, 'tnpay:' || t.id);
      perform ch_add_points(t.season, w.user_id, 'tourney', 30);
      delete from poker_seats where table_id = p_table;
      nm := (select nickname from profiles where id = w.user_id);
      update tourneys set status = 'done', finished_at = now(), places = places || jsonb_build_object('user', w.user_id, 'place', 1) where id = t.id;
      perform chat_sys('lobby', '🎡 ' || nm || ' ניצח בטורניר הג׳קפוט ולקח ₪' || to_char(t.prize, 'FM999,999,999') || '!');
    else
      update tourneys set status = 'done', finished_at = now() where id = t.id;
    end if;
    update poker_hands set street = 'idle', players = '{}' where table_id = p_table;
    return;
  end if;
  lvl := (select hand_no from poker_hands where table_id = p_table) / 5;
  update poker_tables set small_blind = tn_blinds(lvl), big_blind = tn_blinds(lvl) * 2 where id = p_table;
end $$;

create or replace function tourney_join() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s seasons; t tourneys; tb uuid; i int;
begin
  if u is null then raise exception 'not_signed_in'; end if;
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

create or replace function tourney_leave() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); t tourneys;
begin
  select * into t from tourneys where u = any(players) and status = 'registering' for update;
  if not found then raise exception 'challenge_closed'; end if;
  update tourneys set players = array_remove(players, u) where id = t.id;
  perform apply_tx(u, 'tourney', 'payout', t.buyin, 'tnout:' || t.id || ':' || u);
  return jsonb_build_object('left', true);
end $$;

create or replace function poker_tick(p_table uuid) returns void language plpgsql security definer set search_path = public as $$
declare h poker_hands; x jsonb; s record;
begin
  select * into h from poker_hands where table_id = p_table for update;
  if h.street in ('preflop', 'flop', 'turn', 'river') and h.deadline < now() then
    x := h.players -> h.to_act::text;
    update poker_seats set missed = missed + 1 where table_id = p_table and seat_index = h.to_act;
    perform ph_apply(p_table, h.to_act, case when (x->>'bet')::bigint >= h.current_bet then 'check' else 'fold' end, 0);
    select * into h from poker_hands where table_id = p_table;
  end if;
  if h.street in ('idle', 'done') and h.next_at <= now() and (select tourney from poker_tables where id = p_table) is not null then
    perform tn_between_hands(p_table);
    select * into h from poker_hands where table_id = p_table;
    if h.street in ('idle', 'done') and (select status from tourneys where table_id = p_table) = 'running' then perform ph_start(p_table); end if;
    return;
  end if;
  if h.street in ('idle', 'done') and h.next_at <= now() then
    -- between hands: players who left, went quiet, missed 3 turns in a row or have no chips go back to the wallet
    for s in select * from poker_seats where table_id = p_table and (leaving or stack = 0 or missed >= 3 or last_seen < now() - interval '2 minutes') loop
      perform poker_cashout(p_table, s.user_id, 'pkout:' || p_table || ':' || s.user_id || ':' || h.hand_no || ':' || extract(epoch from now())::bigint);
    end loop;
    perform ph_start(p_table);
  end if;
end $$;

create or replace function poker_state(p_table uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); h poker_hands; t poker_tables; myseat int; seats jsonb;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  update poker_seats set last_seen = now() where table_id = p_table and user_id = u;
  perform poker_tick(p_table);
  select * into h from poker_hands where table_id = p_table;
  select * into t from poker_tables where id = p_table;
  select seat_index into myseat from poker_seats where table_id = p_table and user_id = u;
  select coalesce(jsonb_object_agg(s.seat_index::text, jsonb_build_object('user', s.user_id, 'name', p.nickname, 'stack',
           coalesce((h.players -> s.seat_index::text ->> 'stack')::bigint, s.stack), 'leaving', s.leaving,
           'in_hand', h.players ? s.seat_index::text,
           'bet', coalesce((h.players -> s.seat_index::text ->> 'bet')::bigint, 0),
           'folded', coalesce((h.players -> s.seat_index::text ->> 'folded')::boolean, false),
           'allin', coalesce((h.players -> s.seat_index::text ->> 'allin')::boolean, false),
           'hole', case when s.user_id = u then h.players -> s.seat_index::text -> 'hole'
                        when h.street = 'done' then h.result -> 'shown' -> s.seat_index::text -> 'hole' end)), '{}')
    into seats from poker_seats s join profiles p on p.id = s.user_id where s.table_id = p_table;
  return jsonb_build_object('table', jsonb_build_object('id', t.id, 'name', t.name, 'sb', t.small_blind, 'bb', t.big_blind, 'min', t.min_buyin, 'max', t.max_buyin),
    'hand_no', h.hand_no, 'street', h.street, 'board', to_jsonb(h.board), 'dealer', h.dealer, 'to_act', h.to_act,
    'deadline', h.deadline, 'now', now(), 'current_bet', h.current_bet, 'min_raise', h.min_raise,
    'pot', (select coalesce(sum((value->>'committed')::bigint), 0) from jsonb_each(h.players)),
    'seats', seats, 'me', myseat, 'result', case when h.street = 'done' then h.result - 'shown' ||
      jsonb_build_object('hands', (select jsonb_object_agg(key, value->'hand') from jsonb_each(coalesce(h.result->'shown', '{}')))) end,
    'balance', (select balance from wallets where user_id = u),
    'tourney', (select jsonb_build_object('id', tn.id, 'prize', tn.prize, 'mult', tn.mult, 'status', tn.status, 'places', tn.places,
                 'left', (select count(*) from poker_seats where table_id = p_table)) from tourneys tn where tn.table_id = p_table));
end $$;

create or replace function ch_settle() returns void language plpgsql security definer set search_path = public as $$
declare s seasons; champ record; best record; res jsonb; k text; v bigint; m record;
begin
  for s in select * from seasons where not settled and ends_at <= now() order by no for update skip locked loop
    -- unplayed duels: the challenger takes half a win
    update ch_duels set status = 'expired', finished_at = now(), winner = challenger where season = s.no and status in ('waiting', 'playing');
    insert into ch_points (season, user_id, kind, points)
      select season, challenger, 'ido', 15 from ch_duels where season = s.no and status = 'expired' and score_a is not null
      on conflict (season, user_id, kind) do update set points = ch_points.points + 15;
    res := jsonb_build_object('season', s.no);
    select user_id, sum(points) pts into champ from ch_points where season = s.no group by user_id having sum(points) > 0 order by 2 desc, max(updated_at) limit 1;
    if found then
      perform apply_tx(champ.user_id, 'season', 'grant', 500000, 'season:' || s.no || ':champion');
      res := res || jsonb_build_object('champion', champ.user_id, 'champion_points', champ.pts);
    end if;
    foreach k in array array['fisher', 'ido', 'zeus', 'tourney'] loop
      select user_id, points into best from ch_points where season = s.no and kind = k and points > 0 order by points desc, updated_at limit 1;
      if found then
        perform apply_tx(best.user_id, 'season', 'grant', 100000, 'season:' || s.no || ':' || k);
        res := res || jsonb_build_object('best_' || k, best.user_id);
      end if;
    end loop;
    v := ch_vault(s.no);
    res := res || jsonb_build_object('vault', v, 'vault_hit', v >= 3000000);
    if v >= 3000000 then
      for m in select id from profiles loop
        perform apply_tx(m.id, 'season', 'grant', 50000, 'season:' || s.no || ':vault:' || m.id);
      end loop;
    end if;
    update seasons set settled = true, results = res where no = s.no;
    perform chat_sys('lobby', '🏆 עונה ' || s.no || ' הסתיימה! ' || coalesce('האלוף: ' || (select nickname from profiles where id = champ.user_id) || ' (₪500,000)', 'אין אלוף הפעם') ||
      case when v >= 3000000 then ' · 💼 הכספת התמלאה: ₪50,000 לכל אחד!' else '' end);
  end loop;
end $$;

create or replace function ch_state() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s seasons; out jsonb;
begin
  if u is null then raise exception 'not_signed_in'; end if;
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
revoke all on function tn_wheel, tn_blinds, tn_between_hands from public, anon, authenticated;
revoke all on function tourney_join(), tourney_leave() from public, anon;
grant execute on function tourney_join(), tourney_leave() to authenticated;
