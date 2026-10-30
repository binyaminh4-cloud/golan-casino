-- A signed-in member sets a new password for himself (same way the one-time code does it on the server).
create or replace function gc_set_password(p_password text) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if p_password is null or length(p_password) < 6 or length(p_password) > 72 then raise exception 'invalid_password'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = auth.uid();
end $$;
revoke all on function gc_set_password(text) from public, anon; grant execute on function gc_set_password(text) to authenticated;
