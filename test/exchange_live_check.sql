-- Read-only. Run in a NEW SQL Editor query after both 0100 and 0101.
select case when
 to_regprocedure('public.exchange_ready()') is not null
 and to_regprocedure('public.exchange_state(text,integer)') is not null
 and to_regprocedure('public.exchange_open(text,integer,bigint,integer,integer,uuid)') is not null
 and to_regprocedure('public.exchange_close(uuid)') is not null
 and to_regprocedure('public.exchange_history(timestamp with time zone,uuid)') is not null
 and to_regprocedure('gx.worker_ready()') is not null
 and gx.worker_ready()
 and not has_schema_privilege('authenticated','gx','usage')
 and not has_function_privilege('anon','public.exchange_state(text,integer)','execute')
 and not has_function_privilege('anon','public.exchange_open(text,integer,bigint,integer,integer,uuid)','execute')
 and has_function_privilege('authenticated','public.exchange_state(text,integer)','execute')
 and (select count(*) from gx.markets)=9
 and (select count(*) from pg_trigger where not tgisinternal and tgname in('gx_game_feed','gx_poker_feed'))=16
 and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='gx' and c.relkind='r' and not c.relrowsecurity)
 and exists(select 1 from cron.job where jobname='golan-exchange' and active and schedule='1 second')
 then 'PASS: 9 markets, 16 settlement observers, private data, authenticated RPCs and active scheduler'
 else 'FAIL: installation incomplete' end as validation;

select j.jobname,d.status,d.start_time,d.end_time,d.return_message
from cron.job j left join lateral (
 select status,start_time,end_time,return_message from cron.job_run_details
 where jobid=j.jobid order by start_time desc limit 3
)d on true where j.jobname='golan-exchange';
