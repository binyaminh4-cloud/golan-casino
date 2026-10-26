\set ON_ERROR_STOP on
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
update wallets set balance = 0 where user_id = '00000000-0000-0000-0000-00000000000a';
do $$ declare r jsonb; begin
  r := salary_claim();
  perform t_assert((r->>'weekly')::int = 5000 and (r->>'balance')::int = 30000, 'first claim pays weekly + monthly');
  r := salary_claim();
  perform t_assert(r->'weekly' is null and (r->>'balance')::int = 30000, 'second claim pays nothing');
end $$;
select t_assert(bj_hand_value('["AS","KD"]') = 21 and bj_hand_value('["AS","AD","9C"]') = 21 and bj_hand_value('["KS","QD","5C"]') = 25 and bj_hand_value('["AS","6D","9C"]') = 16, 'hand values');
select t_assert(drv_best('[[0,0],[0,3],[5,5],[5,0]]', 0, 0, 0, 2) = 3 + 5 + 2 + 5 + 0 or drv_best('[[0,0],[0,3],[5,5],[5,0]]', 0, 0, 0, 2) <= 13, 'route search');
-- dealer: right answer pays, wrong pays 0, replay pays once
do $$ declare j jsonb; r jsonb; b0 bigint; begin
  b0 := (select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a');
  j := job_start('dealer', 2);
  update job_runs set started_at = started_at - interval '5 seconds' where id = (j->>'id')::uuid;
  r := job_finish((j->>'id')::uuid, (select secret->'values' from job_runs where id = (j->>'id')::uuid));
  perform t_assert((r->>'ok')::boolean and (r->>'paid')::int = 500, 'dealer correct pays 500');
  r := job_finish((j->>'id')::uuid, (select secret->'values' from job_runs where id = (j->>'id')::uuid));
  perform t_assert((select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') = b0 + 500, 'paid once');
  j := job_start('dealer', 1);
  update job_runs set started_at = started_at - interval '5 seconds' where id = (j->>'id')::uuid;
  r := job_finish((j->>'id')::uuid, '[0,0,0,0]');
  perform t_assert(not (r->>'ok')::boolean and r->>'why' = 'wrong', 'wrong answer pays nothing');
  j := job_start('dealer', 1);
  r := job_finish((j->>'id')::uuid, (select secret->'values' from job_runs where id = (j->>'id')::uuid));
  perform t_assert(r->>'why' = 'too_fast', 'instant answers rejected');
  j := job_start('dealer', 3);
  update job_runs set started_at = started_at - interval '60 seconds', deadline = now() - interval '1 second' where id = (j->>'id')::uuid;
  r := job_finish((j->>'id')::uuid, (select secret->'values' from job_runs where id = (j->>'id')::uuid));
  perform t_assert(r->>'why' = 'time', 'late answers rejected');
end $$;
-- driver: the optimal route (found by brute force here) pays; illegal order rejected
do $$ declare j jsonb; r jsonb; p jsonb; best int; perm int[]; len int; x int; y int; s int; i int; ok boolean; bestperm int[]; begin
  delete from job_runs;
  j := job_start('driver', 1); p := j->'puzzle';
  update job_runs set started_at = started_at - interval '5 seconds' where id = (j->>'id')::uuid;
  best := null;
  for perm in select array[a,b,c,d] from generate_series(0,3) a, generate_series(0,3) b, generate_series(0,3) c, generate_series(0,3) d
               where array_length(array(select distinct unnest(array[a,b,c,d])),1) = 4 loop
    ok := array_position(perm,0) < array_position(perm,1) and array_position(perm,2) < array_position(perm,3);
    if ok then
      x := (p->'start'->>0)::int; y := (p->'start'->>1)::int; len := 0;
      foreach s in array perm loop len := len + abs((p->'stops'->s->>0)::int - x) + abs((p->'stops'->s->>1)::int - y); x := (p->'stops'->s->>0)::int; y := (p->'stops'->s->>1)::int; end loop;
      if best is null or len < best then best := len; bestperm := perm; end if;
    end if;
  end loop;
  perform t_assert(best = (p->>'best')::int, 'server optimum matches brute force (' || best || ')');
  r := job_finish((j->>'id')::uuid, to_jsonb(bestperm));
  perform t_assert((r->>'ok')::boolean and (r->>'paid')::int = 200, 'best route pays 200');
  j := job_start('driver', 3);
  update job_runs set started_at = started_at - interval '5 seconds' where id = (j->>'id')::uuid;
  r := job_finish((j->>'id')::uuid, '[1,0,2,3,4,5,6,7]');
  perform t_assert(r->>'why' = 'route', 'drop-off before pickup rejected');
end $$;
select t_assert(t_raises($$select job_start('poker', 1)$$, 'invalid_job'), 'unknown job rejected');
\echo JOBS TESTS DONE
