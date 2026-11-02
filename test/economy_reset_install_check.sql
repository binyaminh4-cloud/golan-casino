-- Read only. Run after installing 0102 and 0103. This does not pause or reset.
select case when c.finished_at is not null then 'ALREADY RESET: do not reset again'
 when not c.maintenance
 and not has_schema_privilege('authenticated','gc_economy','usage')
 and not has_function_privilege('authenticated','gc_economy.reset_once()','execute')
 and not has_function_privilege('anon','gc_economy.reset_once()','execute')
 and not exists(select 1 from gc_economy.targets()t where not exists(
  select 1 from pg_trigger g where g.tgrelid=t and g.tgname='gc_economy_guard' and g.tgenabled='O'))
 then 'PASS: protected reset tools installed; money has NOT been reset'
 else 'FAIL: stop before resetting' end as validation,
 gc_economy.check_definitions() as definition_audit
from gc_economy.control c where id=1;
