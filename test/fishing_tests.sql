\set ON_ERROR_STOP on
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
update wallets set balance = 100000 where user_id = '00000000-0000-0000-0000-00000000000a';
select set_config('gc.test_now', '800000', false);
do $$ declare s jsonb; begin
  s := if_state(); perform t_assert((s->>'open')::boolean and s->'stop' = 'null'::jsonb and s->'boosts' = 'null'::jsonb, 'round open, outcome hidden');
end $$;
select if_bet((if_state()->>'round')::bigint, '{"dark":100,"blue":50,"orange":50,"red":50}', 'F1');
select if_bet((if_state()->>'round')::bigint, '{"dark":100,"blue":50,"orange":50,"red":50}', 'F1');
select t_assert((select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') = 100000 - 250, 'staked once');
select t_assert(t_raises($$select if_bet((if_state()->>'round')::bigint, '{"green":5}', 'F2')$$, 'invalid_bet'), 'unknown zone rejected');
select set_config('gc.test_now', '800011', false);
select t_assert(t_raises($$select if_bet((if_state()->>'round')::bigint, '{"dark":5}', 'F3')$$, 'betting_closed'), 'closed after 10 s');
select t_assert(if_state()->'boosts' <> 'null'::jsonb and if_state()->'stop' = 'null'::jsonb, 'boosts at 10 s, stop still hidden');
select set_config('gc.test_now', '800021', false);
do $$ declare s jsonb; r if_rounds; g bigint; begin
  s := if_state(); select * into r from if_rounds where round_no = (s->>'round')::bigint;
  g := if_gross('{"dark":100,"blue":50,"orange":50,"red":50}', r);
  perform t_assert((s->>'stop')::int = r.seg and s->>'cat' = r.cat, 'result shown after the wheel');
  perform t_assert((select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') = 100000 - 250 + g, 'paid exactly: ' || g);
  perform if_settle();
  perform t_assert((select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') = 100000 - 250 + g, 'not paid twice');
end $$;
-- the clock keeps rolling: rounds follow each other
select set_config('gc.test_now', '800200', false);
select t_assert((if_state()->>'round')::bigint > 1, 'later rounds created');
-- distribution sanity over many rounds
do $$ declare i int; begin for i in 1..5300 loop perform if_make(100000 + i, 0); end loop; end $$;
select t_assert((select count(*) filter (where cat = 'red') between 50 and 160 and count(*) filter (where cat in ('dark','light')) between 4300 and 4900 from if_rounds where round_no > 100000), 'segment odds look right');
select t_assert((select bool_and(total_mult between 12 and 5000) from if_rounds where round_no > 100000 and cat in ('blue','orange','red')), 'bonus multipliers in range');
select set_config('gc.test_now', '', false);
\echo FISHING TESTS DONE
