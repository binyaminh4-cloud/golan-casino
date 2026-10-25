\set ON_ERROR_STOP on
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
select t_assert((select round(avg((sl_eval(array[a,b,c])->>'mult')::numeric)/5*100,2) from generate_series(0,31) a, generate_series(0,31) b, generate_series(0,31) c) = 96.24, 'exact slots RTP 96.24% over all 32768 stops');
select t_assert(sl_line('DIA','DIA','DIA')=1000 and sl_line('CH','CH','LE')=3 and sl_line('CH','LE','CH')=1 and sl_line('LE','CH','CH')=0, 'line pays');
select t_assert(t_raises($$select sl_spin(0,'z')$$, 'invalid_amount'), 'zero bet rejected');
do $$ declare i int; r jsonb; b0 bigint; begin
  update wallets set balance = 1000000 where user_id = '00000000-0000-0000-0000-00000000000a';
  for i in 1..1000 loop
    b0 := (select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a');
    r := sl_spin(10, 'S'||i);
    if (select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') <> b0 - 50 + (r->>'payout')::bigint
       or (r->>'payout')::bigint <> (r->>'mult')::bigint * 10 then raise exception 'mismatch %', r; end if;
  end loop;
  perform t_assert(true, '1000 slot spins: ledger consistent');
end $$;
select t_assert((sl_spin(10,'S1')->>'id') = (select id::text from sl_spins where ref='S1'), 'duplicate spin returns the same result');
\echo SLOTS TESTS DONE
