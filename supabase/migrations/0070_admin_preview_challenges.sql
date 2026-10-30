-- while challenges are closed, the owner (admin) can still enter them to test
create or replace function gc_on(p_key text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select value::text::boolean from gc_settings where key = p_key), false)
      or (p_key = 'challenges' and exists (select 1 from profiles where id = auth.uid() and is_admin)) $$;
revoke all on function gc_on(text) from public, anon, authenticated;
