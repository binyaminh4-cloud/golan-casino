-- Admin switch: open every "coming soon" game to all members at once.
create or replace function gc_public() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('challenges', gc_on('challenges'), 'games', (select value from gc_settings where key = 'games'), 'soon_open', gc_on('soon_open'))
  where auth.uid() is not null $$;

create or replace function admin_set(p_key text, p_value jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not gc_is_admin() then raise exception 'not_admin'; end if;
  if p_key = 'starting_balance' then
    update app_settings set starting_balance = greatest(0, (p_value::text)::bigint) where id = 1;
  elsif p_key in ('challenges', 'soon_open') then
    insert into gc_settings values (p_key, to_jsonb((p_value::text)::boolean)) on conflict (key) do update set value = excluded.value;
  elsif p_key in ('salary_weekly', 'salary_monthly') then
    insert into gc_settings values (p_key, to_jsonb(greatest(0, least(10000000, (p_value::text)::bigint)))) on conflict (key) do update set value = excluded.value;
  elsif p_key = 'games' then
    if jsonb_typeof(p_value) <> 'object' then raise exception 'invalid_value'; end if;
    update gc_settings set value = value || p_value where key = 'games';
  else raise exception 'invalid_key'; end if;
  return admin_settings();
end $$;
