-- jackpot tournament: 5 minutes to connect, starts when all 3 are in; 15 s away = out
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
      insert into poker_seats (table_id, seat_index, user_id, stack, last_seen) values (tb, (i - 1) * 2, t.players[i], 500, now() - interval '1 hour');
    end loop;
    update tourneys set status = 'running', started_at = now(), mult = t.mult, prize = t.prize, table_id = tb where id = t.id;
    perform chat_sys('lobby', '🎡 טורניר ג׳קפוט מוכן! יש 5 דקות להיכנס לשולחן. הגלגל קבע פרס של ₪' || to_char(t.prize, 'FM999,999,999,999,999,999') ||
      case when t.mult >= 10 then ' 🔥' else '' end);
    return jsonb_build_object('id', t.id, 'status', 'running', 'table', tb);
  end if;
  return jsonb_build_object('id', t.id, 'status', 'registering');
end $$;

create or replace function poker_tick(p_table uuid) returns void language plpgsql security definer set search_path = public as $$
declare h poker_hands; x jsonb; s record; tn tourneys;
begin
  select * into h from poker_hands where table_id = p_table for update;
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
           coalesce((h.players -> s.seat_index::text ->> 'stack')::bigint, s.stack), 'leaving', s.leaving, 'away', s.last_seen < now() - interval '15 seconds',
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
                 'left', (select count(*) from poker_seats where table_id = p_table), 'join_until', tn.started_at + interval '5 minutes') from tourneys tn where tn.table_id = p_table));
end $$;
