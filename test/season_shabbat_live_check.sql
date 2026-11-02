-- Read only; run AFTER the complete 0104 migration.
select case when
 exists(select 1 from pg_proc where oid=to_regprocedure('public.ch_settle()') and md5(replace(prosrc,chr(13),''))='be2c3ae23c1fd7c30479d483ca535cee')
 and exists(select 1 from pg_proc where oid=to_regprocedure('public.gc_job_mult()') and md5(replace(prosrc,chr(13),''))='0f2f1d815784e7631d9de1e130b301e8')
 and gc_job_mult()=case when gc_shabbat_until() is null then 1 else 3 end
 then 'PASS: season champion 15B; Shabbat bonus +200% (x3 total)'
 else 'FAIL: definitions or multiplier do not match' end as validation;
