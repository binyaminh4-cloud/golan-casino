-- New characters served publicly from img/chars (pub_01, pub_02 …)
create or replace function admin_set_character(p_user uuid, p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
    raise exception 'admin_only';
  end if;
  if p_key is not null and p_key !~ '^(char_[0-9]{2}|pub_[0-9]{2}|animal_[1-5])$' then raise exception 'invalid_character'; end if;
  update profiles set character_key = p_key where id = p_user;
end $$;
