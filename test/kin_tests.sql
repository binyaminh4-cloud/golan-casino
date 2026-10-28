\set ON_ERROR_STOP on
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
update wallets set balance = 100000000 where user_id = '00000000-0000-0000-0000-00000000000a';
do $$ declare v jsonb; i int; st bigint := 0; pd bigint := 0; begin
  for i in 1..5000 loop v := kin_spin(100, 'k' || i); st := st + 100; pd := pd + (v->>'payout')::bigint;
    perform t_assert((v->>'payout')::bigint = floor(100 * (select total from kin_seeds where seed = (v->>'seed')::bigint limit 1)), 'pays the seed total'); end loop;
  raise warning 'KIN sample return %', round(pd::numeric / st, 3);
  perform t_assert((select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') = 100000000 - st + pd, 'ledger matches');
end $$;
\echo KIN TESTS DONE
