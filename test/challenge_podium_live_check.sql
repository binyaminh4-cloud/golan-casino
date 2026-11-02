-- Read only after 0104 and 0105. One result row; no prize payments.
select case when
 exists(select 1 from pg_proc where oid=to_regprocedure('public.ch_settle()') and md5(replace(prosrc,chr(13),''))='bf7e57fcfcb8d3c2017a6821c8f198eb')
 and exists(select 1 from pg_proc where oid=to_regprocedure('public.gc_job_mult()') and md5(replace(prosrc,chr(13),''))='0f2f1d815784e7631d9de1e130b301e8')
 and gc_job_mult()=case when gc_shabbat_until() is null then 1 else 3 end
 then 'PASS: each challenge 1B / 500M / 250M; overall champion 15B; Shabbat +200% (x3)'
 else 'FAIL: approved rules not fully installed' end as validation;
