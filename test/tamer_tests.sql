\set ON_ERROR_STOP on
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ declare j jsonb; r jsonb; m bigint := gc_job_mult(); b0 bigint; begin
  j := tamer_start(1);
  perform t_assert((j->>'drops')::int = 20, 'level 1 has 20 balls');
  update job_runs set started_at = started_at - interval '60 seconds' where id = (j->>'id')::uuid;
  b0 := bank_bal('00000000-0000-0000-0000-00000000000a');
  r := tamer_finish((j->>'id')::uuid, 3, 2, 1, 20, 2, 0);
  perform t_assert((r->>'paid')::bigint = (3 * 30000 + 2 * 120000 + 600000) * m, 'level 1 pays like the fisher');
  perform t_assert(bank_bal('00000000-0000-0000-0000-00000000000a') = b0 + (r->>'paid')::bigint, 'paid into the bank');
  perform t_assert(t_raises(format('select tamer_finish(%L, 1, 0, 0, 20, 0, 0)', j->>'id'), 'already_done'), 'pays once');
  j := tamer_start(2);
  update job_runs set started_at = started_at - interval '60 seconds' where id = (j->>'id')::uuid;
  r := tamer_finish((j->>'id')::uuid, 5, 0, 1, 12, 0, 1);
  perform t_assert((r->>'paid')::bigint = 0, 'spiky bomb = no pay');
  j := tamer_start(4);
  perform t_assert((j->>'drops')::int = 10, 'extreme has 10 balls');
  update job_runs set started_at = started_at - interval '60 seconds' where id = (j->>'id')::uuid;
  r := tamer_finish((j->>'id')::uuid, 0, 0, 5, 10, 0, 0);
  perform t_assert((r->>'paid')::bigint = 5 * 2500000 * m, 'extreme 5 rare pays');
  j := tamer_start(4);
  update job_runs set started_at = started_at - interval '60 seconds' where id = (j->>'id')::uuid;
  r := tamer_finish((j->>'id')::uuid, 0, 0, 5, 10, 1, 0);
  perform t_assert((r->>'paid')::bigint = 0, 'extreme first bomb pays nothing after 5 rare');
  j := tamer_start(4);
  update job_runs set started_at = started_at - interval '60 seconds' where id = (j->>'id')::uuid;
  r := tamer_finish((j->>'id')::uuid, 0, 0, 4, 10, 0, 0);
  perform t_assert((r->>'paid')::bigint = 0, 'extreme under 5 pays nothing');
  j := tamer_start(1);
  perform t_assert(t_raises(format('select tamer_finish(%L, 5, 0, 0, 20, 0, 0)', j->>'id'), 'invalid_result'), 'too fast rejected');
  update job_runs set started_at = started_at - interval '60 seconds' where id = (j->>'id')::uuid;
  perform t_assert(t_raises(format('select tamer_finish(%L, 5, 0, 0, 21, 0, 0)', j->>'id'), 'invalid_result'), 'too many balls rejected');
  perform t_assert(t_raises(format('select tamer_finish(%L, 5, 0, 0, 20, 4, 0)', j->>'id'), 'invalid_result'), 'over 3 bombs rejected');
  perform t_assert(t_raises(format('select tamer_finish(%L, 9, 9, 9, 20, 0, 0)', j->>'id'), 'invalid_result'), 'more caught than dropped rejected');
end $$;
\echo TAMER TESTS DONE
