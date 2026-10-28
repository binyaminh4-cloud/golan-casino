\set ON_ERROR_STOP on
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
update wallets set balance = 1000000 where user_id = '00000000-0000-0000-0000-00000000000a';
do $$ declare v jsonb; i int; tot_stake bigint := 0; tot_paid bigint := 0; s int; a text; begin
  for i in 1..20000 loop
    v := f90_start(100, 'r' || i); tot_stake := tot_stake + 100;
    while v->>'status' = 'active' loop
      s := (v->>'stage')::int;
      if s > 0 and random() < 0.2 then v := f90_cash((v->>'id')::uuid);
      else a := (array['pass','wing','enter','side','normal'])[s + 1]; if random() < .5 then a := (array['dribble','through','longshot','burst','corner'])[s + 1]; end if;
        v := f90_act((v->>'id')::uuid, a); end if;
    end loop;
    tot_paid := tot_paid + (v->>'paid')::bigint;
  end loop;
  raise notice 'F90 RTP %', round(tot_paid::numeric / tot_stake, 4);
  perform t_assert(tot_paid::numeric / tot_stake between 0.93 and 1.02, 'return near 36/37');
  perform t_assert((select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') = 1000000 - tot_stake + tot_paid, 'ledger matches');
end $$;
select t_assert(f90_amount(100, 7, 5) = 140 and f90_amount(100, 2734375, 1000000) = 273, 'rounding');
\echo F90 TESTS DONE
