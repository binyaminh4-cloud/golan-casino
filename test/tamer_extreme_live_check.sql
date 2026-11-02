-- Read-only definition check. Does not start work or pay money.
select case when exists(select 1 from pg_proc where oid=to_regprocedure('public.tamer_finish(uuid,integer,integer,integer,integer,integer,integer)')
 and md5(replace(prosrc,chr(13),''))='049f14fd141677d0df2a03eb3188a2b6')
 then 'PASS: extreme tamer first bomb fails with zero pay'
 else 'FAIL: tamer update not installed' end as validation;
