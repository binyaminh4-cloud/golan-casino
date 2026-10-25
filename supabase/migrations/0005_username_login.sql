-- No email anywhere: members sign in with username + password.
-- The admin issues a one-time 6-digit code per username (sent on WhatsApp). The friend redeems it with a
-- password of his choice: a new account is created, or (for an existing member) the password is reset.
-- Accounts are created directly in auth with a private placeholder address the user never sees.

alter table profiles add column if not exists username text unique;

create table access_codes (
  username text primary key,
  code_hash text not null,
  user_id uuid references auth.users(id) on delete cascade,     -- null = new member invite
  expires_at timestamptz not null default now() + interval '7 days',
  attempts int not null default 0
);
alter table access_codes enable row level security;            -- no policies: functions only
revoke all on access_codes from anon, authenticated;

create or replace function gc_norm(u text) returns text language sql immutable as
  $$ select lower(regexp_replace(trim(coalesce(u, '')), '\s+', ' ', 'g')) $$;

-- Admin: issue (or re-issue) a code. Returns the plain code once; only its hash is stored.
create or replace function admin_issue_code(p_username text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare u text := gc_norm(p_username); v_code text; v_uid uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then raise exception 'not_admin'; end if;
  if u !~ '^[a-z0-9א-ת_. -]{2,20}$' then raise exception 'invalid_username'; end if;
  select id into v_uid from profiles where username = u;
  v_code := lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000))::text, 6, '0');
  insert into access_codes (username, code_hash, user_id) values (u, crypt(v_code, gen_salt('bf')), v_uid)
    on conflict (username) do update set code_hash = excluded.code_hash, user_id = excluded.user_id,
      expires_at = now() + interval '7 days', attempts = 0;
  return v_code;
end $$;

-- Anyone: redeem a code with a new password. Returns the sign-in address for the client to use.
create or replace function redeem_code(p_username text, p_code text, p_password text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare u text := gc_norm(p_username); c access_codes; v_uid uuid; v_email text;
begin
  if length(coalesce(p_password, '')) < 6 then raise exception 'weak_password'; end if;
  select * into c from access_codes where username = u for update;
  if not found or c.expires_at < now() then raise exception 'bad_code'; end if;
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

-- Anyone: the sign-in address for a username (lets the login screen ask only for username + password).
create or replace function login_email(p_username text) returns text
language sql security definer set search_path = public as $$
  select u.email from profiles p join auth.users u on u.id = p.id where p.username = gc_norm(p_username) $$;

-- Signup trigger: accounts created by redeem_code carry gc_member (app metadata, which clients cannot set).
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_start bigint; v_user text := gc_norm(new.raw_user_meta_data->>'username');
begin
  if coalesce((new.raw_app_meta_data->>'gc_member')::boolean, false) then
    null;
  elsif exists (select 1 from invitations where lower(email) = lower(new.email)) then
    update invitations set accepted_at = now() where lower(email) = lower(new.email);
    v_user := null;
  else
    raise exception 'not_invited';
  end if;
  select starting_balance into v_start from app_settings where id = 1;
  insert into profiles (id, nickname, username, is_admin)
    values (new.id, coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1)), nullif(v_user, ''),
            not exists (select 1 from profiles));
  insert into wallets (user_id, balance) values (new.id, 0);
  perform apply_tx(new.id, 'signup', 'grant', v_start, 'signup:' || new.id);
  return new;
end $$;

-- Admin list of pending codes (no codes, just who is waiting).
create or replace function admin_pending_codes() returns jsonb language sql security definer set search_path = public as $$
  select case when exists (select 1 from profiles where id = auth.uid() and is_admin)
    then coalesce((select jsonb_agg(jsonb_build_object('username', username, 'reset', user_id is not null, 'expires', expires_at) order by username) from access_codes), '[]')
    else '[]' end $$;

revoke all on function admin_issue_code, redeem_code, login_email, admin_pending_codes from public;
grant execute on function redeem_code, login_email to anon, authenticated;
grant execute on function admin_issue_code, admin_pending_codes to authenticated;

-- The owner keeps his account; give him a username (change it in the lobby later if you like).
update profiles set username = 'בנימין', nickname = 'בנימין' where is_admin and username is null;

-- One-time code for the owner to set his own password (shown once in the SQL result).
with g as (select lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000))::text, 6, '0') as code),
ins as (insert into access_codes (username, code_hash, user_id)
          select 'בנימין', extensions.crypt(code, extensions.gen_salt('bf')), (select id from profiles where is_admin order by created_at limit 1) from g
        on conflict (username) do update set code_hash = excluded.code_hash, user_id = excluded.user_id, expires_at = now() + interval '7 days', attempts = 0
        returning 1)
select 'שם משתמש: בנימין   קוד: ' || code as "הכניסה שלך" from g, ins;
