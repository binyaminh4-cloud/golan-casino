-- 0112 · Challenge vs the bots #3: טורניר הבוטים (owner-approved 2026-11-04).
-- You + 4 of the bots (אביחי ניוטון, נתנאל אמלקה, יואב הנחוש, 23עידו11, המלך בנימין), Hold'em, 1,500 tournament chips each.
-- Blinds go up a little every hand (big blind 20 × 1.15^hand); whoever runs out of chips is out. Last one standing wins.
-- Season points by place: 1st 30, 2nd 15, 3rd 5 (kind 'bots'). 3 tournaments a day (Israel date). No money at all.
-- Safety: the table is marked tourney (= the run) and bots_shared = -1, so the leaderboard, lobby lists, presence sweeps and
-- pot chat skip it; poker_tick returns early for it and poker_cashout never pays its chips into a wallet. Re-runnable.
begin;
create table if not exists pbt_runs(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  season int not null, day date not null, table_id uuid unique references poker_tables(id) on delete set null,
  status text not null default 'running' check (status in ('running','done')), place int, season_pts int,
  out_order jsonb not null default '[]', created_at timestamptz not null default now());
create index if not exists pbt_runs_user_day on pbt_runs(user_id, day);
alter table pbt_runs enable row level security;
revoke all on pbt_runs from public, anon, authenticated;

create or replace function poker_tick(p_table uuid) returns void language plpgsql security definer set search_path = public as $$
declare h poker_hands; x jsonb; s record; tn tourneys; bt boolean := exists (select 1 from poker_tables where id = p_table and (bots_owner is not null or bots_shared is not null));
begin
  -- bots tournament tables (0112) are driven only by pbt_state; nothing here may cash their chips out
  if exists (select 1 from pbt_runs where table_id = p_table) then return; end if;
  select * into h from poker_hands where table_id = p_table for update;
  -- bot table: the bot to act thinks for a moment, then plays
  if bt and h.street in ('preflop', 'flop', 'turn', 'river') and pb_is_bot((h.players -> h.to_act::text ->> 'user')::uuid)
     and now() >= h.updated_at + make_interval(secs => 1.1 + random() * 1.2) then
    perform pb_act(p_table);
    select * into h from poker_hands where table_id = p_table;
  end if;
  if h.street in ('preflop', 'flop', 'turn', 'river') and h.deadline < now() then
    x := h.players -> h.to_act::text;
    update poker_seats set missed = missed + 1 where table_id = p_table and seat_index = h.to_act;
    perform ph_apply(p_table, h.to_act, case when (x->>'bet')::bigint >= h.current_bet then 'check' else 'fold' end, 0);
    select * into h from poker_hands where table_id = p_table;
  end if;
  -- tournament: a player away for 15 s (after the game began) is out; the others don't wait for him
  select * into tn from tourneys where table_id = p_table and status = 'running';
  if found and h.hand_no > 0 then
    update poker_seats set leaving = true where table_id = p_table and not leaving and last_seen < now() - interval '15 seconds';
    while h.street in ('preflop', 'flop', 'turn', 'river') and exists (select 1 from poker_seats where table_id = p_table and seat_index = h.to_act and leaving) loop
      perform ph_apply(p_table, h.to_act, 'fold', 0);
      select * into h from poker_hands where table_id = p_table;
    end loop;
  end if;
  -- tournament start: everyone has 5 minutes to sit down; it starts the moment all 3 are in
  if found and h.hand_no = 0 then
    if exists (select 1 from poker_seats where table_id = p_table and last_seen < now() - interval '15 seconds') then
      if now() < tn.started_at + interval '5 minutes' then return; end if;
      update poker_seats set leaving = true where table_id = p_table and last_seen < now() - interval '15 seconds';
    end if;
    update poker_hands set next_at = least(next_at, now()) where table_id = p_table;
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
    if bt then
      update poker_seats ps set stack = t2.big_blind * 100, last_seen = now(), missed = 0 from poker_tables t2
        where t2.id = p_table and ps.table_id = p_table and pb_is_bot(ps.user_id) and ps.stack < t2.big_blind * 10;
      update poker_seats ps set last_seen = now() where ps.table_id = p_table and pb_is_bot(ps.user_id);
    end if;
    for s in select * from poker_seats where table_id = p_table and not pb_is_bot(user_id) and (leaving or stack = 0 or missed >= 3 or last_seen < now() - interval '2 minutes') loop
      perform poker_cashout(p_table, s.user_id, 'pkout:' || p_table || ':' || s.user_id || ':' || h.hand_no || ':' || extract(epoch from now())::bigint);
    end loop;
    if bt and not exists (select 1 from poker_seats where table_id = p_table and not pb_is_bot(user_id)) then
      update poker_hands set street = 'idle', players = '{}', board = '{}', to_act = null, deadline = null where table_id = p_table; return;
    end if;
    perform ph_start(p_table);
  end if;
end $$;

-- tournament chips never become money
create or replace function poker_cashout(p_table uuid, p_user uuid, p_ref text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_stack bigint;
begin
  if exists (select 1 from pbt_runs where table_id = p_table) then
    delete from poker_seats where table_id = p_table and user_id = p_user;
    return (select balance from wallets where user_id = p_user);
  end if;
  delete from poker_seats where table_id = p_table and user_id = p_user returning stack into v_stack;
  if not found then
    return (select balance from wallets where user_id = p_user); -- already cashed out
  end if;
  return apply_tx(p_user, 'poker', 'cashout', v_stack, p_ref);
end $$;

create or replace function pbt_names() returns text[] language sql immutable as $$
  select array['אביחי ניוטון', 'נתנאל אמלקה', 'יואב הנחוש', '23עידו11', 'המלך בנימין'] $$;

create or replace function pbt_view(r pbt_runs) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare h poker_hands; t poker_tables; seats jsonb; me int;
begin
  select * into h from poker_hands where table_id = r.table_id;
  select * into t from poker_tables where id = r.table_id;
  select seat_index into me from poker_seats where table_id = r.table_id and user_id = r.user_id;
  select coalesce(jsonb_object_agg(s.seat_index::text, jsonb_build_object('name', coalesce(b.name, 'אתה'), 'bot', b.img,
      'stack', coalesce((h.players -> s.seat_index::text ->> 'stack')::bigint, s.stack),
      'in_hand', h.players ? s.seat_index::text,
      'bet', coalesce((h.players -> s.seat_index::text ->> 'bet')::bigint, 0),
      'folded', coalesce((h.players -> s.seat_index::text ->> 'folded')::boolean, false),
      'allin', coalesce((h.players -> s.seat_index::text ->> 'allin')::boolean, false),
      'hole', case when s.user_id = r.user_id then h.players -> s.seat_index::text -> 'hole'
                   when h.street = 'done' then h.result -> 'shown' -> s.seat_index::text -> 'hole' end)), '{}')
    into seats from poker_seats s left join poker_bots b on b.id = s.user_id where s.table_id = r.table_id;
  return jsonb_build_object('id', r.id, 'status', r.status, 'place', r.place, 'season_pts', r.season_pts, 'out', r.out_order,
    'table', r.table_id, 'hand_no', h.hand_no, 'street', h.street, 'board', to_jsonb(h.board), 'dealer', h.dealer, 'to_act', h.to_act,
    'deadline', h.deadline, 'now', now(), 'current_bet', h.current_bet, 'min_raise', h.min_raise, 'sb', t.small_blind, 'bb', t.big_blind,
    'pot', (select coalesce(sum((value->>'committed')::bigint), 0) from jsonb_each(coalesce(h.players, '{}'))),
    'seats', seats, 'me', me,
    'result', case when h.street = 'done' then h.result - 'shown' || jsonb_build_object('hands', (select jsonb_object_agg(key, value->'hand') from jsonb_each(coalesce(h.result->'shown', '{}')))) end,
    'left_today', greatest(0, 3 - (select count(*) from pbt_runs x where x.user_id = r.user_id and x.day = r.day))::int);
end $$;

create or replace function pbt_finish(p_run uuid, p_place int) returns void language plpgsql security definer set search_path = public as $$
declare r pbt_runs; pts int;
begin
  select * into r from pbt_runs where id = p_run for update;
  if r.status <> 'running' then return; end if;
  pts := case p_place when 1 then 30 when 2 then 15 when 3 then 5 else 0 end;
  if pts > 0 then perform ch_add_points(r.season, r.user_id, 'bots', pts); end if;
  update pbt_runs set status = 'done', place = p_place, season_pts = pts where id = p_run;
  -- the tournament table is gone with the run's end (bots, seats, hand)
  delete from poker_seats where table_id = r.table_id;
  update poker_hands set street = 'idle', players = '{}', board = '{}', to_act = null, deadline = null where table_id = r.table_id;
end $$;

create or replace function pbt_start() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r pbt_runs; tb uuid; today date := (now() at time zone 'Asia/Jerusalem')::date; nm text[]; i int; bid uuid; picks int[];
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if not gc_on('challenges') then raise exception 'challenges_paused'; end if;
  select * into r from pbt_runs where user_id = u and status = 'running' order by created_at desc limit 1;
  if found then return pbt_view(r); end if;
  if (select count(*) from pbt_runs where user_id = u and day = today) >= 3 then raise exception 'daily_limit'; end if;
  insert into pbt_runs(user_id, season, day) values (u, (ch_season()).no, today) returning * into r;
  insert into poker_tables (name, max_seats, small_blind, big_blind, min_buyin, max_buyin, tourney, bots_shared)
    values ('טורניר הבוטים', 6, 10, 20, 0, 0, r.id, -1) returning id into tb;
  insert into poker_hands (table_id) values (tb);
  update pbt_runs set table_id = tb where id = r.id returning * into r;
  insert into poker_seats (table_id, user_id, seat_index, stack) values (tb, u, 0, 1500);
  nm := pbt_names(); select array_agg(x order by random()) into picks from generate_series(1, 5) x;
  for i in 1..4 loop
    insert into poker_bots (table_id, name, img, style) values (tb, nm[picks[i]], picks[i], 1 + floor(random() * 3)::int) returning id into bid;
    insert into poker_seats (table_id, user_id, seat_index, stack) values (tb, bid, i, 1500);
  end loop;
  perform ph_start(tb);
  return pbt_view(r);
end $$;

-- the tournament's own clock: bots act, a sleepy player is checked/folded, between hands the busted are out and blinds go up
create or replace function pbt_state(p_run uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r pbt_runs; h poker_hands; x jsonb; s record; n int; bb bigint; mine boolean;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into r from pbt_runs where id = p_run and user_id = u for update;
  if not found then raise exception 'run_closed'; end if;
  if r.status <> 'running' then return pbt_view(r); end if;
  select * into h from poker_hands where table_id = r.table_id for update;
  if h.street in ('preflop', 'flop', 'turn', 'river') and pb_is_bot((h.players -> h.to_act::text ->> 'user')::uuid)
     and now() >= h.updated_at + make_interval(secs => 0.9 + random() * 0.9) then
    perform pb_act(r.table_id); select * into h from poker_hands where table_id = r.table_id;
  end if;
  if h.street in ('preflop', 'flop', 'turn', 'river') and h.deadline < now() then
    x := h.players -> h.to_act::text;
    perform ph_apply(r.table_id, h.to_act, case when (x->>'bet')::bigint >= h.current_bet then 'check' else 'fold' end, 0);
    select * into h from poker_hands where table_id = r.table_id;
  end if;
  if h.street in ('idle', 'done') and coalesce(h.next_at, now()) <= now() then
    for s in select ps.*, b.name from poker_seats ps left join poker_bots b on b.id = ps.user_id where ps.table_id = r.table_id and ps.stack = 0 order by ps.seat_index loop
      n := (select count(*) from poker_seats where table_id = r.table_id);
      delete from poker_seats where table_id = r.table_id and user_id = s.user_id;
      update pbt_runs set out_order = out_order || jsonb_build_object('name', coalesce(s.name, 'אתה'), 'place', n) where id = r.id returning * into r;
      if s.user_id = u then perform pbt_finish(r.id, n); select * into r from pbt_runs where id = r.id; return pbt_view(r); end if;
    end loop;
    if (select count(*) from poker_seats where table_id = r.table_id) <= 1 then
      perform pbt_finish(r.id, 1); select * into r from pbt_runs where id = r.id; return pbt_view(r);
    end if;
    bb := greatest(20, round(20 * power(1.15, h.hand_no) / 10) * 10)::bigint;
    update poker_tables set big_blind = bb, small_blind = bb / 2 where id = r.table_id;
    perform ph_start(r.table_id);
  end if;
  return pbt_view(r);
end $$;

create or replace function pbt_act(p_run uuid, p_action text, p_amount bigint default 0) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r pbt_runs; h poker_hands; s poker_seats;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into r from pbt_runs where id = p_run and user_id = u for update;
  if not found or r.status <> 'running' then raise exception 'run_closed'; end if;
  select * into s from poker_seats where table_id = r.table_id and user_id = u;
  select * into h from poker_hands where table_id = r.table_id for update;
  if not found or h.street not in ('preflop', 'flop', 'turn', 'river') or h.to_act <> s.seat_index then raise exception 'not_your_turn'; end if;
  perform ph_apply(r.table_id, s.seat_index, p_action, coalesce(p_amount, 0));
  return pbt_view(r);
end $$;

revoke all on function pbt_start(), pbt_state(uuid), pbt_act(uuid, text, bigint), pbt_view(pbt_runs), pbt_finish(uuid, int), pbt_names() from public, anon;
grant execute on function pbt_start(), pbt_state(uuid), pbt_act(uuid, text, bigint) to authenticated;
commit;
