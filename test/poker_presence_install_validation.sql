-- Installation checks only. These checks do not call the sweep or touch seats/wallets.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'golan-poker-seat-presence'
    and schedule = '15 seconds' and active and database = current_database()) then
    raise exception 'poker_cleanup_job_missing';
  end if;
  if has_function_privilege('anon', 'poker_presence_sweep()', 'execute')
    or has_function_privilege('authenticated', 'poker_expire_table(uuid)', 'execute') then
    raise exception 'internal_cleanup_permissions';
  end if;
  if position('already_seated' in pg_get_functiondef('poker_sit(uuid,integer,bigint)'::regprocedure)) > 0 then
    raise exception 'single_table_restriction_remains';
  end if;
end $$;
select 'PASS: poker presence functions and 15-second cleanup job installed' as validation;
