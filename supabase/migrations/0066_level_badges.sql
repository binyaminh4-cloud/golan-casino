-- Level badges next to every name, and a level-up announcement (a personal popup + a line in the group chat).
create table if not exists gc_level_seen (user_id uuid primary key references profiles(id) on delete cascade, level int not null);
alter table gc_level_seen enable row level security; revoke all on gc_level_seen from anon, authenticated;
insert into gc_level_seen (user_id, level) select id, (gc_level_info(id)->>'level')::int from profiles on conflict (user_id) do nothing;   -- today's levels, no announcements

create or replace function gc_levels() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(p.id, (gc_level_info(p.id)->>'level')::int), '{}'::jsonb) from profiles p where auth.uid() is not null $$;

create or replace function gc_level_check() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); L jsonb; lv int; old int;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  L := gc_level_info(u); lv := (L->>'level')::int;
  select level into old from gc_level_seen where user_id = u for update;
  if old is null then insert into gc_level_seen values (u, lv); return L || jsonb_build_object('up', false); end if;
  if lv <= old then return L || jsonb_build_object('up', false); end if;
  update gc_level_seen set level = lv where user_id = u;
  perform chat_sys('lobby', '⬆️ ' || (select nickname from profiles where id = u) || ' עלה לרמה ' || lv || '!');
  return L || jsonb_build_object('up', true, 'from', old);
end $$;
revoke all on function gc_levels(), gc_level_check() from public, anon;
grant execute on function gc_levels(), gc_level_check() to authenticated;
