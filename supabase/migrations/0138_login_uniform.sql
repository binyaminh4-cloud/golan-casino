-- Security review (13.11): a stranger must not be able to learn which usernames are members.
-- Changes ONLY two functions (login_email, redeem_code). No table, no data, no grant is changed.
--   login_email:  an unknown username now gets a made-up address of the same shape as a real one
--                 (the sign-in then fails with "wrong password", exactly like a real member with a wrong password).
--   redeem_code:  "no code / expired code" now returns NULL, like a wrong code (it used to raise 'bad_code').
--                 A bcrypt check is still done so the answer takes the same time.
-- Still visible on purpose: after 8 wrong tries on a pending code the answer is 'code_locked'.
--
-- UNDO: re-run the two definitions from 0005_username_login.sql (functions login_email and redeem_code, and the grant line).
-- Safe to run again.

create or replace function login_email(p_username text) returns text
language plpgsql security definer set search_path = public as $$
declare u text := gc_norm(p_username); v_email text;
begin
  select au.email into v_email from profiles p join auth.users au on au.id = p.id where p.username = u;
  -- same shape as a real member address: 'm' + 32 hex + domain
  return coalesce(v_email, 'm' || md5('gc-no-such-user:' || u) || '@members.golan-casino.app');
end $$;

create or replace function redeem_code(p_username text, p_code text, p_password text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare u text := gc_norm(p_username); c access_codes; v_uid uuid; v_email text;
begin
  if length(coalesce(p_password, '')) < 6 then raise exception 'weak_password'; end if;
  select * into c from access_codes where username = u for update;
  if not found or c.expires_at < now() then
    perform crypt(coalesce(p_code, ''), gen_salt('bf'));         -- same cost as a real check
    return null;                                                -- looks like a wrong code
  end if;
  if c.attempts >= 8 then raise exception 'code_locked'; end if;
  if crypt(coalesce(p_code, ''), c.code_hash) <> c.code_hash then
    update access_codes set attempts = attempts + 1 where username = u;
    return null;                                                -- wrong code (attempt counted, not rolled back)
  end if;
  if c.user_id is not null then                                 -- existing member: reset password
    update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now()
      where id = c.user_id returning email into v_email;
  else                                                          -- new member
    if exists (select 1 from profiles where username = u) then raise exception 'username_taken'; end if;
    v_uid := gen_random_uuid();
    v_email := 'm' || replace(v_uid::text, '-', '') || '@members.golan-casino.app';
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
        crypt(p_password, gen_salt('bf')), now(),
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'gc_member', true),
        jsonb_build_object('username', u, 'has_password', true), now(), now(), '', '', '', '');
    begin execute 'update auth.users set email_change_token_current = '''', reauthentication_token = '''' where id = $1' using v_uid;
    exception when undefined_column then null; end;
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (v_uid::text, v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
  end if;
  delete from access_codes where username = u;
  return v_email;
end $$;

revoke all on function login_email(text), redeem_code(text, text, text) from public;
grant execute on function login_email(text), redeem_code(text, text, text) to anon, authenticated;
