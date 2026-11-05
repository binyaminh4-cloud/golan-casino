-- 0120: "פרסומות החבר׳ה" — watch a funny video to the end, get paid to the bank.
-- The server picks the video at random, keeps the clock, and pays only after the video's full length has passed.
-- Up to 10 paid views a day per player (Israel day). Starting a new video cancels any unfinished one.

create table if not exists gc_ads (
  id text primary key,
  file text not null,
  seconds numeric not null check (seconds > 0),
  payout bigint not null check (payout > 0),
  active boolean not null default true
);
alter table gc_ads enable row level security; revoke all on gc_ads from anon, authenticated;

create table if not exists gc_ad_views (
  id bigserial primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  ad_id text not null references gc_ads(id),
  started_at timestamptz not null default now(),
  done_at timestamptz,
  status text not null default 'open' check (status in ('open', 'paid', 'dropped'))
);
create index if not exists gc_ad_views_user_day on gc_ad_views (user_id, started_at);
alter table gc_ad_views enable row level security; revoke all on gc_ad_views from anon, authenticated;

create or replace function gc_ads_paid_today(u uuid) returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from gc_ad_views
  where user_id = u and status = 'paid'
    and (done_at at time zone 'Asia/Jerusalem')::date = (now() at time zone 'Asia/Jerusalem')::date
$$;
revoke all on function gc_ads_paid_today(uuid) from public, anon, authenticated;

-- how many paid views are left today
create or replace function ad_status() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  return jsonb_build_object('left', greatest(0, 10 - gc_ads_paid_today(u)), 'per_day', 10);
end $$;

-- draw a random video and start the clock
create or replace function ad_start() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); a gc_ads; v bigint; n int;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  n := gc_ads_paid_today(u);
  if n >= 10 then return jsonb_build_object('ok', false, 'reason', 'daily_limit', 'left', 0); end if;
  update gc_ad_views set status = 'dropped' where user_id = u and status = 'open';
  select * into a from gc_ads where active order by random() limit 1;
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'no_ads'); end if;
  insert into gc_ad_views (user_id, ad_id) values (u, a.id) returning id into v;
  return jsonb_build_object('ok', true, 'view', v, 'file', a.file, 'seconds', a.seconds, 'payout', a.payout, 'left', 10 - n);
end $$;

-- the video ended: pay if the full length really passed on the server's clock
create or replace function ad_finish(p_view bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r gc_ad_views; a gc_ads; b bigint; n int;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into r from gc_ad_views where id = p_view and user_id = u for update;
  if r.id is null or r.status <> 'open' then return jsonb_build_object('ok', false, 'reason', 'not_open'); end if;
  select * into a from gc_ads where id = r.ad_id;
  if extract(epoch from now() - r.started_at) < a.seconds - 1 then
    return jsonb_build_object('ok', false, 'reason', 'too_early');
  end if;
  n := gc_ads_paid_today(u);
  if n >= 10 then
    update gc_ad_views set status = 'dropped' where id = r.id;
    return jsonb_build_object('ok', false, 'reason', 'daily_limit', 'left', 0);
  end if;
  update gc_ad_views set status = 'paid', done_at = now() where id = r.id;
  b := bank_add(u, 'job', a.payout, 'ad:' || r.id);
  return jsonb_build_object('ok', true, 'paid', a.payout, 'bank', b, 'left', 9 - n);
end $$;

revoke all on function ad_status() from public, anon; grant execute on function ad_status() to authenticated;
revoke all on function ad_start() from public, anon; grant execute on function ad_start() to authenticated;
revoke all on function ad_finish(bigint) from public, anon; grant execute on function ad_finish(bigint) to authenticated;

-- the videos (owner's payouts by length)
insert into gc_ads (id, file, seconds, payout) values
  ('ad01', 'vid/ads/ad01.mp4', 15.0, 75000000),
  ('ad02', 'vid/ads/ad02.mp4', 10.0, 10000000),
  ('ad03', 'vid/ads/ad03.mp4', 6.0, 5000000),
  ('ad04', 'vid/ads/ad04.mp4', 10.0, 10000000),
  ('ad05', 'vid/ads/ad05.mp4', 10.0, 10000000),
  ('ad06', 'vid/ads/ad06.mp4', 10.0, 10000000),
  ('ad07', 'vid/ads/ad07.mp4', 10.0, 10000000),
  ('ad08', 'vid/ads/ad08.mp4', 10.0, 10000000),
  ('ad09', 'vid/ads/ad09.mp4', 10.0, 10000000),
  ('ad10', 'vid/ads/ad10.mp4', 10.0, 10000000),
  ('ad11', 'vid/ads/ad11.mp4', 10.0, 10000000),
  ('ad12', 'vid/ads/ad12.mp4', 10.0, 10000000),
  ('ad13', 'vid/ads/ad13.mp4', 10.0, 10000000),
  ('ad14', 'vid/ads/ad14.mp4', 10.0, 10000000),
  ('ad15', 'vid/ads/ad15.mp4', 15.0, 75000000),
  ('ad16', 'vid/ads/ad16.mp4', 10.0, 10000000),
  ('ad17', 'vid/ads/ad17.mp4', 172.4, 50000000),
  ('ad18', 'vid/ads/ad18.mp4', 172.4, 50000000),
  ('ad19', 'vid/ads/ad19.mp4', 70.7, 100000000),
  ('ad20', 'vid/ads/ad20.mp4', 58.8, 100000000)
on conflict (id) do update set file = excluded.file, seconds = excluded.seconds, payout = excluded.payout, active = true;
