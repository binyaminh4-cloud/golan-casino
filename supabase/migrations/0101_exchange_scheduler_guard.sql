-- Do not open escrow unless the offline settlement worker is healthy.
-- Install after 0100. This does not change any existing game or bank function.
begin;
create or replace function gx.worker_ready() returns boolean language sql stable set search_path=gx,public,pg_temp as $$
 select coalesce((select j.active and d.status='succeeded' and d.end_time>clock_timestamp()-interval '30 seconds'
 from cron.job j left join lateral (
  select status,end_time from cron.job_run_details where jobid=j.jobid and status in('succeeded','failed') order by start_time desc limit 1
 )d on true where j.jobname='golan-exchange'),false)
$$;
create or replace function gx.require_worker() returns trigger language plpgsql set search_path=gx,public,pg_temp as $$
begin
 if new.status='open' and not gx.worker_ready() then raise exception 'price_unavailable';end if;
 return new;
end $$;
drop trigger if exists gx_require_worker on gx.positions;
create trigger gx_require_worker before insert on gx.positions for each row execute function gx.require_worker();
create or replace function public.exchange_ready() returns int language plpgsql security definer set search_path=gx,public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'not_signed_in';end if;
 return case when gx.worker_ready() then 1 else 0 end;
end $$;
revoke all on function gx.worker_ready(),gx.require_worker() from public,anon,authenticated;
revoke all on function public.exchange_ready() from public,anon,authenticated;
grant execute on function public.exchange_ready() to authenticated;
commit;
