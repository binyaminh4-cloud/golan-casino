-- READ ONLY: run in a NEW SQL Editor query and export the three result sets.
-- Does not reset, lock, cancel, credit, delete or change any setting.
-- No names, emails, passwords, tokens or per-player balances are returned.
begin transaction read only;
select clock_timestamp() as checked_at,
 (select count(*) from public.profiles) as profiles,
 (select count(*) from public.wallets) as wallets,
 (select count(*) from public.bank_accounts) as bank_accounts,
 (select coalesce(sum(balance::numeric),0)::text from public.wallets) as wallet_total,
 (select coalesce(sum(balance::numeric),0)::text from public.bank_accounts) as bank_total,
 to_regprocedure('public.exchange_ready()') is not null as exchange_installed;

-- Aggregate state and monetary exposure. Includes active and historical states,
-- so outstanding claims can be distinguished from already paid records.
select n.nspname as schema_name,c.relname as table_name,
 ((xpath('/table/row/report/text()',query_to_xml(format(
  'select coalesce(jsonb_agg(s),''[]''::jsonb) as report from (
   select coalesce(to_jsonb(t)->>''status'',to_jsonb(t)->>''phase'',to_jsonb(t)->>''street'',to_jsonb(t)->>''kind'',''rows'') as state,
   count(*) as rows,
   sum((to_jsonb(t)->>''balance'')::numeric)::text as balance,
   sum((to_jsonb(t)->>''stack'')::numeric)::text as stack,
   sum((to_jsonb(t)->>''stake'')::numeric)::text as stake,
   sum((to_jsonb(t)->>''amount'')::numeric)::text as amount,
   sum((to_jsonb(t)->>''payout'')::numeric)::text as payout,
   sum((to_jsonb(t)->>''due_total'')::numeric)::text as due_total,
   sum((to_jsonb(t)->>''repaid'')::numeric)::text as repaid,
   count(*) filter(where to_jsonb(t)->>''settled''=''false'') as unsettled,
   count(*) filter(where to_jsonb(t)->>''done''=''false'') as unfinished,
   sum((to_jsonb(t)->>''left_spins'')::numeric)::text as free_spins
   from %I.%I t group by 1 order by 1)s',n.nspname,c.relname),true,false,'')))[1])::text::jsonb as states
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind='r' and (
 n.nspname='public' and c.relname in ('wallets','bank_accounts','loans','house_stats','poker_tables','poker_seats','poker_hands','poker_bots','tourneys','sl_free','sl_jackpots','bj_boost','bj_rounds','bjt_bets','bjt_rounds','dp_hands','dp_rounds','game_rounds','rl_live_bets','if_bets','pm_runs','ck_runs','f90_runs','job_runs','salary_claims','gc_level_seen','seasons','ch_points','ch_runs','ch_duels','zeus_duels','zeus_bets')
 or n.nspname in ('gx','zlm_private'))
order by n.nspname,c.relname;

-- Verify installed function versions against the repository before writing reset code.
select n.nspname as schema_name,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
 md5(replace(p.prosrc,chr(13),'')) as body_hash
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','gx','zlm_private') and p.prokind='f'
 and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
order by n.nspname,p.proname,arguments;
commit;
