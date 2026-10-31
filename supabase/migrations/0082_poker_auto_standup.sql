-- sitting down at a table stands you up from a table you forgot to leave
create or replace function poker_sit(p_table uuid, p_seat int, p_amount bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); t poker_tables; s record;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into t from poker_tables where id = p_table and (level is not null or bots_owner = u);
  if not found then raise exception 'invalid_table'; end if;
  if p_seat not between 0 and 5 then raise exception 'invalid_seat'; end if;
  if p_amount < t.min_buyin or p_amount > t.max_buyin then raise exception 'invalid_amount'; end if;
  -- still sitting at another table (left the page without standing up)? if no hand is running there for me, stand up automatically
  for s in select ps.* from poker_seats ps join poker_hands h on h.table_id = ps.table_id join poker_tables pt on pt.id = ps.table_id
           where ps.user_id = u and ps.table_id <> p_table and pt.tourney is null
             and (h.street in ('idle', 'done') or not h.players ? ps.seat_index::text or (h.players -> ps.seat_index::text ->> 'folded')::boolean) loop
    perform poker_cashout(s.table_id, u, 'pkout:' || s.table_id || ':' || u || ':auto:' || extract(epoch from clock_timestamp())::bigint);
  end loop;
  if exists (select 1 from poker_seats where user_id = u) then raise exception 'already_seated'; end if;
  if exists (select 1 from poker_seats where table_id = p_table and seat_index = p_seat) then raise exception 'seat_taken'; end if;
  perform poker_buyin(u, p_table, p_seat, p_amount, 'pkin:' || p_table || ':' || u || ':' || extract(epoch from clock_timestamp())::text);
  return poker_state(p_table);
end $$;
