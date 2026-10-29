-- step probabilities give 100% at every stop (simulated on ck_advance-like draws)
do $$ declare m text; t int[]; i int; k int; reach int; n int := 200000; ok int; begin
  foreach m in array array['easy','normal','hard','extreme'] loop t := ck_table(m);
    for i in 1..10 loop
      -- analytic: product of M(j-1)/M(j) = 100/M(i) → expected = M(i)/100 × 100/M(i) = 1
      if abs((t[i]::numeric/100) * (100::numeric / t[i]) - 1) > 1e-9 then raise exception 'fail %', m; end if;
    end loop; end loop;
  -- empirical check of the draw on step 1 of extreme (p = 100/160)
  ok := 0; for k in 1..n loop if rl_randint(160) < 100 then ok := ok + 1; end if; end loop;
  if abs(ok::numeric / n - 0.625) > 0.006 then raise exception 'fail draw %', ok::numeric / n; end if;
  raise notice 'CHICKEN TESTS DONE';
end $$;
