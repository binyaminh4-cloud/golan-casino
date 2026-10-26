\set ON_ERROR_STOP on
update wallets set balance = 100000 where user_id in ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b');
select set_config('gc.test_now', '500000', false);
-- both sit down
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false); select bjt_state(1);
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000b', false); select bjt_state(1);
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
select t_assert((bjt_bet(1, 100, 10, 0, 0, 0, 'T1')->>'phase') = 'betting', 'A bet; still waiting for B');
select t_assert((select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') = 100000 - 110, 'A staked');
select t_assert(t_raises($$select bjt_bet(1,100,0,0,0,0,'T1b')$$, 'already_bet'), 'one bet per round');
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ declare s jsonb; begin
  s := bjt_bet(1, 200, 0, 0, 0, 0, 'T2');
  perform t_assert(s->>'phase' = 'playing', 'everyone bet: dealt at once');
  perform t_assert(jsonb_array_length(s->'players') = 2 and s->'dealer'->>1 = '??', 'two players, hole card hidden');
  perform t_assert((select count(distinct dealer) from bj_rounds where t_round is not null) = 1, 'one shared dealer');
end $$;
-- B plays, A runs out of time
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ declare v jsonb; begin
  v := bjt_state(1)->'me';
  if v->>'status' = 'insurance' then v := bj_action((v->>'id')::uuid, 'no_insurance'); end if;
  if v->>'status' = 'playing' then v := bj_action((v->>'id')::uuid, 'stand'); end if;
  perform t_assert(v->>'status' in ('waiting','done'), 'B waits for the dealer');
end $$;
select set_config('gc.test_now', '500031', false);
do $$ declare s jsonb; tot bigint; begin
  s := bjt_state(1);
  perform t_assert(s->>'phase' = 'done' and s->'dealer'->>1 <> '??', 'time up: dealer played');
  perform t_assert((select bool_and(status = 'done') from bj_rounds where t_round is not null), 'every hand settled');
  select sum(payout) into tot from bj_rounds where t_round is not null;
  perform t_assert((select sum(balance) from wallets where user_id in ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b')) = 200000 - 310 + tot, 'paid exactly');
end $$;
select set_config('gc.test_now', '500039', false);
select t_assert((bjt_state(1)->>'round')::int = 2 and bjt_state(1)->>'phase' = 'betting', 'next round opens');
select t_assert(bj_current() is null, 'solo page ignores table hands');
select set_config('gc.test_now', '', false);
\echo BJ TABLE TESTS DONE
