-- Cash poker seat leases. No wallet balances are written directly.
begin;

-- Hold the hand lock before touching seats, matching the settlement lock order.
create or replace function poker_expire_table(p_table uuid) returns void
language plpgsql security definer set search_path = public as $$
declare h poker_hands; s record; i int;
begin
  if not exists (select 1 from poker_tables where id = p_table and tourney is null) then return; end if;
  select * into h from poker_hands where table_id = p_table for update;
  if not found then return; end if;
  update poker_seats set leaving = true
    where table_id = p_table and not pb_is_bot(user_id) and not leaving
      and last_seen < now() - interval '2 minutes';
  -- Fold only an absent player's ordinary turn. All-ins retain their pot eligibility.
  for i in 1..6 loop
    exit when h.street not in ('preflop','flop','turn','river') or h.to_act is null;
    exit when not exists (select 1 from poker_seats where table_id = p_table
      and seat_index = h.to_act and leaving and not pb_is_bot(user_id));
    exit when coalesce((h.players -> h.to_act::text ->> 'allin')::boolean, false);
    perform ph_apply(p_table, h.to_act, 'fold', 0);
    select * into h from poker_hands where table_id = p_table;
  end loop;
  if h.street in ('idle','done') then
    for s in select user_id from poker_seats where table_id = p_table and leaving and not pb_is_bot(user_id) loop
      perform poker_cashout(p_table, s.user_id,
        'pkout:' || p_table || ':' || s.user_id || ':presence:' || gen_random_uuid());
    end loop;
  end if;
end $$;
revoke all on function poker_expire_table(uuid) from public, anon, authenticated;

create or replace function poker_touch(p_table uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  perform poker_expire_table(p_table);
  perform 1 from poker_hands where table_id = p_table for update;
  update poker_seats set last_seen = now() where table_id = p_table and user_id = auth.uid() and not leaving;
  return found;
end $$;
revoke all on function poker_touch(uuid) from public, anon;
grant execute on function poker_touch(uuid) to authenticated;

create or replace function poker_presence_sweep() returns void
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if not pg_try_advisory_xact_lock(18504, 95) then return; end if;
  for t in select h.table_id from poker_hands h join poker_tables pt on pt.id = h.table_id
    where pt.tourney is null and exists (select 1 from poker_seats s where s.table_id = h.table_id and not pb_is_bot(s.user_id))
    order by h.table_id for update of h skip locked
  loop
    perform poker_expire_table(t.table_id);
    perform poker_tick(t.table_id);
    perform poker_expire_table(t.table_id);
  end loop;
end $$;
revoke all on function poker_presence_sweep() from public, anon, authenticated;

create or replace function poker_my_tables() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name,
    'bb', t.big_blind, 'seat', s.seat_index, 'leaving', s.leaving, 'tourney', t.tourney,
    'stack', coalesce((h.players -> s.seat_index::text ->> 'stack')::bigint, s.stack)) order by t.id), '[]')
    from poker_seats s join poker_tables t on t.id = s.table_id left join poker_hands h on h.table_id = t.id
    where s.user_id = auth.uid());
end $$;
revoke all on function poker_my_tables() from public, anon;
grant execute on function poker_my_tables() to authenticated;

create or replace function poker_cash_leave(p_table uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); h poker_hands; s poker_seats;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from poker_tables where id = p_table and tourney is not null) then return poker_leave(p_table); end if;
  select * into h from poker_hands where table_id = p_table for update;
  select * into s from poker_seats where table_id = p_table and user_id = u;
  if not found then return jsonb_build_object('left', true, 'pending', false); end if;
  if h.street in ('preflop','flop','turn','river') and h.players ? s.seat_index::text then
    update poker_seats set leaving = true where table_id = p_table and user_id = u;
    -- An all-in hand must still receive its share at showdown.
    if not coalesce((h.players -> s.seat_index::text ->> 'allin')::boolean, false)
       and not coalesce((h.players -> s.seat_index::text ->> 'folded')::boolean, false) then
      if h.to_act = s.seat_index then perform ph_apply(p_table, s.seat_index, 'fold', 0);
      else
        update poker_hands set players = jsonb_set(players, array[s.seat_index::text, 'folded'], 'true') where table_id = p_table;
        if ph_count((select players from poker_hands where table_id = p_table), 'live') = 1 then perform ph_showdown(p_table); end if;
      end if;
    end if;
    select * into h from poker_hands where table_id = p_table;
  end if;
  if h.street in ('idle','done') or not h.players ? s.seat_index::text then
    perform poker_cashout(p_table, u, 'pkout:' || p_table || ':' || u || ':leave:' || gen_random_uuid());
  end if;
  return jsonb_build_object('left', true, 'pending', exists(select 1 from poker_seats where table_id = p_table and user_id = u),
    'balance', (select balance from wallets where user_id = u));
end $$;
revoke all on function poker_cash_leave(uuid) from public, anon;
grant execute on function poker_cash_leave(uuid) to authenticated;

-- Current poker_sit and poker_state definitions are appended below.
create or replace function poker_sit(p_table uuid, p_seat int, p_amount bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); t poker_tables; s record;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into t from poker_tables where id = p_table and (level is not null or bots_owner = u or bots_shared is not null or friends_bb is not null);
  if not found then raise exception 'invalid_table'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text, 95));
  perform 1 from poker_hands where table_id = p_table for update;
  perform poker_expire_table(p_table);
  if exists (select 1 from poker_seats where table_id = p_table and user_id = u) then return poker_state(p_table); end if;
  if p_seat not between 0 and 5 then raise exception 'invalid_seat'; end if;
  if p_amount < t.min_buyin or p_amount > t.max_buyin then raise exception 'invalid_amount'; end if;
  if exists (select 1 from poker_seats where table_id = p_table and seat_index = p_seat) then raise exception 'seat_taken'; end if;
  perform poker_buyin(u, p_table, p_seat, p_amount, 'pkin:' || p_table || ':' || u || ':' || extract(epoch from clock_timestamp())::text);
  return poker_state(p_table);
end $$;

create or replace function poker_state(p_table uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); h poker_hands; t poker_tables; myseat int; seats jsonb;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  perform poker_touch(p_table);
  perform poker_tick(p_table);
  select * into h from poker_hands where table_id = p_table;
  select * into t from poker_tables where id = p_table;
  select seat_index into myseat from poker_seats where table_id = p_table and user_id = u;
  select coalesce(jsonb_object_agg(s.seat_index::text, jsonb_build_object('user', s.user_id, 'name', coalesce(p.nickname, b.name), 'bot', b.img, 'stack',
           coalesce((h.players -> s.seat_index::text ->> 'stack')::bigint, s.stack), 'leaving', s.leaving, 'away', s.last_seen < now() - interval '15 seconds',
           'in_hand', h.players ? s.seat_index::text,
           'bet', coalesce((h.players -> s.seat_index::text ->> 'bet')::bigint, 0),
           'folded', coalesce((h.players -> s.seat_index::text ->> 'folded')::boolean, false),
           'allin', coalesce((h.players -> s.seat_index::text ->> 'allin')::boolean, false),
           'last', h.players -> s.seat_index::text ->> 'last',
           'hole', case when s.user_id = u then h.players -> s.seat_index::text -> 'hole'
                        when h.street = 'done' then h.result -> 'shown' -> s.seat_index::text -> 'hole' end)), '{}')
    into seats from poker_seats s left join profiles p on p.id = s.user_id left join poker_bots b on b.id = s.user_id where s.table_id = p_table;
  return jsonb_build_object('table', jsonb_build_object('id', t.id, 'name', t.name, 'sb', t.small_blind, 'bb', t.big_blind, 'min', t.min_buyin, 'max', t.max_buyin),
    'hand_no', h.hand_no, 'street', h.street, 'board', to_jsonb(h.board), 'dealer', h.dealer, 'to_act', h.to_act,
    'deadline', h.deadline, 'now', now(), 'current_bet', h.current_bet, 'min_raise', h.min_raise,
    'pot', (select coalesce(sum((value->>'committed')::bigint), 0) from jsonb_each(h.players)),
    'seats', seats, 'me', myseat, 'result', case when h.street = 'done' then h.result - 'shown' ||
      jsonb_build_object('hands', (select jsonb_object_agg(key, value->'hand') from jsonb_each(coalesce(h.result->'shown', '{}')))) end,
    'balance', (select balance from wallets where user_id = u),
    'tourney', (select jsonb_build_object('id', tn.id, 'prize', tn.prize, 'mult', tn.mult, 'status', tn.status, 'places', tn.places,
                 'left', (select count(*) from poker_seats where table_id = p_table), 'join_until', tn.started_at + interval '5 minutes') from tourneys tn where tn.table_id = p_table));
end $$;

-- Fail atomically if Cron is unavailable; do not silently leave cleanup dependent on clients.
create extension if not exists pg_cron;
select cron.schedule('golan-poker-seat-presence', '15 seconds', 'select public.poker_presence_sweep();');
commit;

