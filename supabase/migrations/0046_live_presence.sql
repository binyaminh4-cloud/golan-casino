-- Who is in which game right now: the chat poll (every page, every 15 s) also reports the page; gc_live() lists people per page
-- seen in the last 45 seconds, for the lobby tiles and the live rooms.
alter table profiles add column if not exists where_now text;
drop function if exists chat_since(text, bigint);
create or replace function chat_since(p_room text, p_after bigint default 0, p_where text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  update profiles set last_seen = now(), where_now = coalesce(left(p_where, 80), where_now)
   where id = auth.uid() and (last_seen is null or last_seen < now() - interval '10 seconds' or where_now is distinct from coalesce(left(p_where, 80), where_now));
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'body', m.body, 'at', m.created_at,
           'uid', m.user_id, 'name', p.nickname) order by m.id), '[]') into v
  from (select * from chat_messages where room = p_room and id > coalesce(p_after, 0) order by id desc limit 40) m
  left join profiles p on p.id = m.user_id;
  return v;
end $$;
revoke all on function chat_since(text, bigint, text) from public, anon; grant execute on function chat_since(text, bigint, text) to authenticated;
create or replace function gc_live() returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(w, ppl), '{}') from (
    select where_now w, jsonb_agg(jsonb_build_object('id', id, 'name', nickname) order by nickname) ppl
      from profiles where where_now is not null and last_seen > now() - interval '45 seconds' and auth.uid() is not null group by where_now) q $$;
revoke all on function gc_live() from public, anon; grant execute on function gc_live() to authenticated;
