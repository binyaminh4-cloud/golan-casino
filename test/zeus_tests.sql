\set ON_ERROR_STOP on
update gc_settings set value = 'true' where key = 'challenges';
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@x') on conflict do nothing;
insert into profiles (id, nickname) values ('00000000-0000-0000-0000-00000000000b', 'דני') on conflict do nothing;
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
select set_config('gc.test_now', (1000*rl_live_cycle()+3)::text, false);       -- live round 1000 open
create temp table z as select (zeus_invite('00000000-0000-0000-0000-00000000000b')->>'duel')::uuid id;
select t_assert(t_raises($$select zeus_invite('00000000-0000-0000-0000-00000000000b')$$, 'challenge_in_progress'), 'one invite at a time');
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000b', false);
select zeus_answer((select id from z), true);
select t_assert((select start_round from zeus_duels where id = (select id from z)) = 1001, 'duel starts with the next round');
select t_assert(t_raises($$select zeus_bet((select id from z), 1000, '[{"nums":[17],"amt":10}]', 'x0')$$, 'betting_closed'), 'no bets before the duel starts');
select set_config('gc.test_now', (1001*rl_live_cycle()+1)::text, false);       -- round 1001 open
select zeus_bet((select id from z), 1001, '[{"nums":[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36],"amt":1000}]', 'b1');
select t_assert((select b_chips from zeus_duels where id = (select id from z)) = 9000, 'duel chips taken, not the wallet');
select t_assert(t_raises($$select zeus_bet((select id from z), 1001, '[{"nums":[17],"amt":20000}]', 'b2')$$, 'insufficient_funds'), 'cannot bet more than duel chips');
select set_config('gc.test_now', (1001*rl_live_cycle()+27)::text, false);       -- round 1001 closed
select rl_live_state('lightning');
do $$ declare r int; exp bigint; begin
  r := (select result from rl_live_rounds where round_no = 1001);
  exp := 9000 + rl_pay2('[{"nums":[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36],"amt":1000}]', r, 'lightning', (select lucky_l from rl_live_rounds where round_no = 1001));
  perform zeus_state((select id from z));
  perform t_assert((select b_chips from zeus_duels where id = (select id from z)) = exp, 'round settled into duel chips');
end $$;
-- last round pays double
select set_config('gc.test_now', (1010*rl_live_cycle()+3)::text, false);
select zeus_bet((select id from z), 1010, '[{"nums":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36],"amt":1}]', 'b3')
  where false;   -- (37 numbers is not a legal bet; use red/black pair below)
select zeus_bet((select id from z), 1010, '[{"nums":[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36],"amt":100}]', 'b4');
select set_config('gc.test_now', (1010*rl_live_cycle()+30)::text, false);
do $$ declare before bigint; r int; begin
  before := (select b_chips from zeus_duels where id = (select id from z));
  r := (select result from rl_live_rounds where round_no = 1010);
  perform zeus_state((select id from z));
  perform t_assert((select b_chips from zeus_duels where id = (select id from z)) = before + 2 * rl_pay2('[{"nums":[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36],"amt":100}]', r, 'lightning', (select lucky_l from rl_live_rounds where round_no = 1010)), 'last round pays double');
  perform t_assert((select status from zeus_duels where id = (select id from z)) = 'done', 'duel closes after round 10');
  perform t_assert((select sum(points) from ch_points where kind = 'zeus') in (20, 30), 'points awarded');
end $$;
select set_config('gc.test_now', '', false);
\echo ZEUS TESTS DONE
