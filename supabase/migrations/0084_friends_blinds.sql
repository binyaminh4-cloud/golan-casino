-- Friends' poker: pick the blinds (₪20K … ₪2T) on the game card; everyone who picks the same blinds sits at the same table
-- (a new one opens when it is full). Buy-in 20–100 big blinds.
alter table poker_tables add column if not exists friends_bb bigint;
create or replace function poker_friends_table(p_bb bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); tb uuid;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_bb is null or not p_bb = any(pb_blinds()) then p_bb := 20000; end if;
  select s.table_id into tb from poker_seats s join poker_tables t on t.id = s.table_id where s.user_id = u and t.friends_bb = p_bb;
  if found then return jsonb_build_object('table', tb, 'bb', p_bb); end if;
  select t.id into tb from poker_tables t where t.friends_bb = p_bb and (select count(*) from poker_seats s where s.table_id = t.id) < 6
   order by (select count(*) from poker_seats s where s.table_id = t.id) desc, t.id limit 1;
  if found then return jsonb_build_object('table', tb, 'bb', p_bb); end if;
  insert into poker_tables (name, max_seats, small_blind, big_blind, min_buyin, max_buyin, friends_bb)
    values ('שולחן החבר׳ה', 6, p_bb / 2, p_bb, p_bb * 20, p_bb * 100, p_bb) returning id into tb;
  insert into poker_hands (table_id) values (tb);
  return jsonb_build_object('table', tb, 'bb', p_bb);
end $$;
revoke all on function poker_friends_table(bigint) from public, anon;
grant execute on function poker_friends_table(bigint) to authenticated;

create or replace function poker_sit(p_table uuid, p_seat int, p_amount bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); t poker_tables; s record;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into t from poker_tables where id = p_table and (level is not null or bots_owner = u or bots_shared is not null or friends_bb is not null);
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
