-- Minimal stand-in for Supabase's auth schema and roles, for local tests only.
create role anon; create role authenticated; create role service_role;
alter default privileges in schema public grant all on tables to anon, authenticated;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text not null);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated, service_role;
