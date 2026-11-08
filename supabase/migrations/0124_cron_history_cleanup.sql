-- The scheduler writes a history row for every run. golan-exchange runs every second, so cron.job_run_details
-- grew to millions of rows; gx.worker_ready() reads the latest row of that table and became too slow, the bank's
-- exchange_ready check timed out and the exchange button stayed hidden. Only scheduler logs are removed (no game data),
-- and an index plus an hourly cleanup keep it small from now on.
delete from cron.job_run_details where end_time < now() - interval '1 hour' or (end_time is null and start_time < now() - interval '1 hour');
create index if not exists job_run_details_job_start on cron.job_run_details (jobid, start_time desc);
select cron.unschedule('golan-cron-history-cleanup') where exists (select 1 from cron.job where jobname = 'golan-cron-history-cleanup');
select cron.schedule('golan-cron-history-cleanup', '7 * * * *', $$delete from cron.job_run_details where end_time < now() - interval '1 hour'$$);
