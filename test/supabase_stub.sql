-- Minimal stand-in for Supabase's auth schema and roles, for local tests only.
create role anon; create role authenticated; create role service_role;
alter default privileges in schema public grant all on tables to anon, authenticated;
create schema auth;
create table auth.users (instance_id uuid, id uuid primary key default gen_random_uuid(), aud text, role text, email text not null,
  encrypted_password text, email_confirmed_at timestamptz, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}',
  created_at timestamptz, updated_at timestamptz, confirmation_token text, recovery_token text, email_change_token_new text, email_change text,
  email_change_token_current text, reauthentication_token text);
create table auth.identities (id uuid primary key default gen_random_uuid(), provider_id text, user_id uuid references auth.users(id) on delete cascade,
  identity_data jsonb, provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
create schema if not exists extensions; create extension if not exists pgcrypto schema extensions;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated, service_role;
