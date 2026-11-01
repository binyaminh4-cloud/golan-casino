-- Read-only checks after running the whole 0097 migration in a NEW SQL Editor query.
select case when
 to_regprocedure('public.zlm_state()') is not null
 and to_regprocedure('public.zlm_bet(uuid,text,bigint,uuid)') is not null
 and to_regprocedure('public.zlm_choose(uuid,integer)') is not null
 and to_regprocedure('public.zlm_ready()') is not null
 and cardinality(zlm_private.spots())=54
 and (zlm_private.balls_result(array[1,4,0,0,0,0,3],7)->>'black')::int=4
 and not has_schema_privilege('authenticated','zlm_private','usage')
 and not has_function_privilege('anon','public.zlm_state()','execute')
 and not has_function_privilege('anon','public.zlm_ready()','execute')
 and has_function_privilege('authenticated','public.zlm_state()','execute')
 and exists(select 1 from cron.job where jobname='golan-zman-lamatvach' and active)
 then 'PASS: functions, 54 cells, fourth black, private data and scheduler'
 else 'FAIL: installation incomplete' end as validation;
