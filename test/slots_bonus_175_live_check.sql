-- Read-only verification AFTER the whole 0102 migration. No money is reset here.
select case when
 exists(select 1 from pg_proc where oid=to_regprocedure('public.dg_spin(bigint,text)') and md5(replace(prosrc,chr(13),''))='d11cc108980d6309503f355362aa21f3')
 and exists(select 1 from pg_proc where oid=to_regprocedure('public.kin_spin(bigint,text)') and md5(replace(prosrc,chr(13),''))='bea08e8c8dac109242bdefe76617cf11')
 and exists(select 1 from pg_proc where oid=to_regprocedure('public.ww_spin(bigint,text)') and md5(replace(prosrc,chr(13),''))='731f85be64b9de7db95cbee763cc4b31')
 and exists(select 1 from pg_proc where oid=to_regprocedure('public.pc_spin(bigint,text)') and md5(replace(prosrc,chr(13),''))='8a044058a9f8e15f87cc89db1d17f4c6')
 and exists(select 1 from pg_proc where oid=to_regprocedure('public.fo_spin(bigint,text)') and md5(replace(prosrc,chr(13),''))='0dcede68a370940666a9d54b4e88ee44')
 then 'PASS: all five machines use the tested 1.75 bonus probabilities' else 'FAIL: installation incomplete or definitions differ' end as validation;
