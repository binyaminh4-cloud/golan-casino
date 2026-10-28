\set ON_ERROR_STOP on
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
update wallets set balance = 100000000 where user_id = '00000000-0000-0000-0000-00000000000a';
do $$ declare v jsonb; i int; st bigint := 0; pd bigint := 0; nr int := 0; ns int := 0; begin
  for i in 1..40000 loop v := pc_spin(100, 'pc' || i); st := st + 100; pd := pd + (v->>'payout')::bigint;
    if v->'bonus'->>'kind' = 'regular' then nr := nr + 1; elsif v->'bonus'->>'kind' = 'super' then ns := ns + 1; end if; end loop;
  raise warning 'PC RTP % reg % sup %', round(pd::numeric / st, 4), nr, ns;
  perform t_assert(pd::numeric / st between 0.7 and 1.3, 'return in a sane band');
  perform t_assert((select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') = 100000000 - st + pd, 'ledger matches');
  v := pc_spin(100, 'pc1'); perform t_assert((select count(*) from pc_spins where ref = 'pc1') = 1, 'same ref, same spin');
end $$;
\echo PC TESTS DONE
