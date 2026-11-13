-- Issue #9: errors that happen in players' browsers are sent here, so the owner can see them.
-- Adds ONLY two new tables and one new function. Nothing that exists is changed.
--
-- UNDO (run these three lines to remove everything this file adds):
--   drop function if exists log_client_error(text, text, text);
--   drop table if exists client_errors;
--   drop table if exists client_error_rate;
--
-- Privacy: only the page file name (no ?parameters), a message of up to 300 characters, the device type and the time are stored.
-- No user id, nickname, token or full address is kept in the log (user id is used only in the separate rate table, to limit spam).
-- The log keeps the latest 5,000 rows; older rows are deleted on every write.
-- Safe to run again.

create table if not exists client_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  page text not null,
  message text not null,
  device text not null
);
alter table client_errors enable row level security;          -- no policy: the browser can never read or write it directly
revoke all on client_errors from anon, authenticated;

-- spam limit: how many errors one user may log in each 10-minute window
create table if not exists client_error_rate (
  user_id uuid not null,
  win timestamptz not null,
  n int not null default 0,
  primary key (user_id, win)
);
create index if not exists client_error_rate_win_idx on client_error_rate (win);
alter table client_error_rate enable row level security;
revoke all on client_error_rate from anon, authenticated;

-- returns true when the error was stored, false when it was dropped (over the limit / empty). Not signed in = error 'not_signed_in'.
create or replace function log_client_error(p_page text, p_message text, p_device text default 'other')
returns boolean language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  w timestamptz := date_bin(interval '10 minutes', now(), timestamptz '2000-01-01 00:00:00+00');
  cnt int; pg text; msg text; dv text;
begin
  if u is null then raise exception 'not_signed_in'; end if;

  insert into client_error_rate (user_id, win, n) values (u, w, 1)
  on conflict (user_id, win) do update set n = client_error_rate.n + 1
  returning n into cnt;
  if cnt = 1 then delete from client_error_rate where win < w - interval '1 day'; end if;
  if cnt > 20 then return false; end if;

  -- page: file name only, no ?parameters and no #hash
  pg := regexp_replace(coalesce(p_page, ''), '[?#].*$', '');
  pg := left(regexp_replace(pg, '^.*/', ''), 60);
  if pg = '' then pg := '?'; end if;

  -- message: strip anything that could identify a person, then cut to 300
  msg := coalesce(p_message, '');
  msg := regexp_replace(msg, 'https?://[^\s"'')]+', '[url]', 'gi');
  msg := regexp_replace(msg, 'eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*', '[token]', 'g');
  msg := regexp_replace(msg, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g');
  msg := regexp_replace(msg, '[A-Za-z0-9_-]{32,}', '[token]', 'g');
  msg := btrim(regexp_replace(msg, '[[:cntrl:]]+', ' ', 'g'));
  msg := left(msg, 300);
  if msg = '' then return false; end if;

  dv := case when p_device in ('iphone', 'ipad', 'android', 'desktop') then p_device else 'other' end;

  insert into client_errors (page, message, device) values (pg, msg, dv);
  -- keep only the latest 5,000 rows
  delete from client_errors
  where id <= (select id from client_errors order by id desc offset 5000 limit 1);
  return true;
end $$;

revoke all on function log_client_error(text, text, text) from public, anon, authenticated;
grant execute on function log_client_error(text, text, text) to authenticated;
