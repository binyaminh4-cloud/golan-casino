-- Characters: caricature images stored in a PRIVATE storage bucket (members only).
-- Only the admin assigns a character to a member; members cannot change their own.

alter table profiles add column if not exists character_key text;   -- e.g. 'char_03'

-- Members may still edit nickname/avatar_url only (column grant from 0001); character_key is NOT granted.
revoke update on profiles from authenticated;
grant update (nickname) on profiles to authenticated;

create or replace function admin_set_character(p_user uuid, p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
    raise exception 'admin_only';
  end if;
  if p_key is not null and p_key !~ '^char_[0-9]{2}$' then raise exception 'invalid_character'; end if;
  update profiles set character_key = p_key where id = p_user;
end $$;
revoke all on function admin_set_character from public, anon;
grant execute on function admin_set_character to authenticated;

-- Leaderboard now also returns the character.
drop view if exists leaderboard;
create view leaderboard with (security_invoker = true) as
  select p.id, p.nickname, p.avatar_url, p.character_key,
         w.balance + coalesce((select sum(stack) from poker_seats s where s.user_id = p.id), 0) as wealth
  from profiles p join wallets w on w.user_id = p.id;
grant select on leaderboard to authenticated;

-- Private bucket for character art.
insert into storage.buckets (id, name, public) values ('characters', 'characters', false)
  on conflict (id) do update set public = false;

drop policy if exists "members read characters" on storage.objects;
create policy "members read characters" on storage.objects for select to authenticated
  using (bucket_id = 'characters');

drop policy if exists "admin writes characters" on storage.objects;
create policy "admin writes characters" on storage.objects for all to authenticated
  using (bucket_id = 'characters' and exists (select 1 from public.profiles where id = auth.uid() and is_admin))
  with check (bucket_id = 'characters' and exists (select 1 from public.profiles where id = auth.uid() and is_admin));
