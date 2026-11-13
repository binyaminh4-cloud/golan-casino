-- Voice chat: our own monthly cap so Daily never bills past the free 10,000 participant-minutes.
-- Each connected player pings once a minute; at 9,000 minutes in a calendar month the voice chat closes until the next month.
create table if not exists voice_usage (
  month date not null,
  user_id uuid not null,
  minutes int not null default 0,
  last_at timestamptz,
  primary key (month, user_id)
);
alter table voice_usage enable row level security;

create or replace function voice_cap() returns int language sql immutable as $$ select 9000 $$;

create or replace function voice_used() returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(minutes), 0)::int from voice_usage where month = date_trunc('month', now())::date
$$;

-- before joining: is the voice chat open this month?
create or replace function voice_status() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('used', voice_used(), 'cap', voice_cap(), 'open', voice_used() < voice_cap())
$$;

-- while connected: one ping a minute (pings closer than 50 s apart are ignored)
create or replace function voice_tick() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); m date := date_trunc('month', now())::date;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  insert into voice_usage (month, user_id, minutes, last_at) values (m, u, 1, now())
  on conflict (month, user_id) do update set minutes = voice_usage.minutes + 1, last_at = now()
    where voice_usage.last_at is null or voice_usage.last_at < now() - interval '50 seconds';
  return voice_status();
end $$;

revoke all on function voice_used(), voice_status(), voice_tick() from public;
grant execute on function voice_status(), voice_tick() to authenticated;
