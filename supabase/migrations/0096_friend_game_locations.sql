-- Reuse existing presence: one read for the entire visible friends sheet.
begin;
create or replace function gc_friend_locations() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id,
    'where', case when p.where_now like 'poker.html?t=%' and t.id is null then 'poker.html'
                  when t.bots_owner is not null then 'poker_private' else p.where_now end,
    'table_name', case when t.bots_owner is null then t.name end)), '[]')
    from profiles p left join poker_tables t on t.id = case
      when p.where_now ~ '^poker\.html\?t=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then substring(p.where_now from 14)::uuid end
    where p.last_seen > now() - interval '45 seconds' and p.where_now is not null);
end $$;
revoke all on function gc_friend_locations() from public, anon;
grant execute on function gc_friend_locations() to authenticated;

create or replace function poker_state(p_table uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); h poker_hands; t poker_tables; myseat int; seats jsonb;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  perform poker_touch(p_table);
  perform poker_tick(p_table);
  select * into h from poker_hands where table_id = p_table;
  select * into t from poker_tables where id = p_table;
  -- poker_state is polled only by the visible table; background seat heartbeats do not overwrite this.
  if t.id is not null then
    update profiles set where_now = 'poker.html?t=' || p_table, last_seen = now()
      where id = u and (last_seen is null or last_seen < now() - interval '10 seconds'
        or where_now is distinct from 'poker.html?t=' || p_table);
  end if;
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

create or replace function chat_since(p_room text, p_after bigint default 0, p_where text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; v_where text := left(p_where, 80);
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  -- Keep the resolved table id instead of the generic ?bots/fr entry URL from chat.
  if split_part(v_where, '?', 1) = 'poker.html' then
    select case when where_now like 'poker.html?t=%' and last_seen > now() - interval '45 seconds'
      then where_now else 'poker.html' end into v_where from profiles where id = auth.uid();
  end if;
  update profiles set last_seen = now(), where_now = coalesce(v_where, where_now)
   where id = auth.uid() and (last_seen is null or last_seen < now() - interval '10 seconds' or where_now is distinct from coalesce(v_where, where_now));
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'body', m.body, 'at', m.created_at,
           'uid', m.user_id, 'name', p.nickname) order by m.id), '[]') into v
  from (select * from (select * from chat_messages where room = p_room and id > coalesce(p_after, 0)
          order by case when coalesce(p_after, 0) = 0 then -id else id end limit 40) q) m
  left join profiles p on p.id = m.user_id;
  return v;
end $$;
commit;

