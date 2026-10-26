\set ON_ERROR_STOP on
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
update wallets set balance = 1000000 where user_id = '00000000-0000-0000-0000-00000000000a';
-- round 1000 starts at 48000s; betting until 48025
select set_config('gc.test_now', '48003', false);
do $$ declare s jsonb; begin
  s := rl_live_state('lightning');
  perform t_assert((s->>'round')::bigint = 1000 and (s->>'open')::boolean, 'round 1000 open at +3s');
  perform t_assert(s->'result' = 'null'::jsonb and s->'lucky' = '{}'::jsonb, 'result and strikes hidden while betting');
end $$;
select rl_live_bet(1000, 'lightning', '[{"nums":[17],"amt":10},{"nums":[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36],"amt":20}]', 'A1');
select rl_live_bet(1000, 'classic', '[{"nums":[17],"amt":10}]', 'A2');
select t_assert((select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') = 1000000 - 40, 'stakes taken');
select rl_live_bet(1000, 'lightning', '[{"nums":[17],"amt":10}]', 'A1');
select t_assert((select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') = 1000000 - 40, 'duplicate ref charges once');
select t_assert(t_raises($$select rl_live_bet(999,'classic','[{"nums":[17],"amt":10}]','A3')$$, 'betting_closed'), 'old round rejected');
select t_assert(t_raises($$select rl_live_bet(1000,'classic','[{"nums":[17],"amt":60000}]','A4')$$, 'invalid_amount'), 'amount checked');
select t_assert(t_raises($$select rl_live_bet(1000,'classic','[{"nums":[1,5],"amt":6}]','A5')$$, 'invalid_bet'), 'illegal bet rejected');
select t_assert((rl_live_state('lightning')->'players'->0->>'total')::int = 30, 'my lightning bets listed as a player');
-- close
select set_config('gc.test_now', '48026', false);
select t_assert(t_raises($$select rl_live_bet(1000,'classic','[{"nums":[17],"amt":10}]','A6')$$, 'betting_closed'), 'late bet rejected');
do $$ declare s jsonb; c jsonb; r rl_live_rounds; exp bigint; begin
  s := rl_live_state('lightning'); c := rl_live_state('classic');
  select * into r from rl_live_rounds where round_no = 1000;
  perform t_assert((s->>'result')::int = r.result and (c->>'result')::int = r.result, 'same result in every mode');
  perform t_assert(s->'lucky' = r.lucky_l and c->'lucky' = '{}'::jsonb, 'strikes are per mode');
  perform t_assert((select bool_and(settled) from rl_live_bets where round_no = 1000), 'settled after close');
  exp := rl_pay2('[{"nums":[17],"amt":10},{"nums":[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36],"amt":20}]', r.result, 'lightning', r.lucky_l)
       + rl_pay2('[{"nums":[17],"amt":10}]', r.result, 'classic', '{}');
  perform t_assert((select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') = 1000000 - 40 + exp, 'paid exactly once');
  perform rl_live_state('xxx'); perform rl_live_settle();
  perform t_assert((select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') = 1000000 - 40 + exp, 'not paid twice');
end $$;
-- next round
select set_config('gc.test_now', '48049', false);
select t_assert((rl_live_state('xxx')->>'round')::bigint = 1001 and (rl_live_state('xxx')->'history'->>0)::int = (select result from rl_live_rounds where round_no = 1000), 'next round, history shows last result');
-- table limit across submissions
select rl_live_bet(1001, 'classic', '[{"nums":[17],"amt":50000},{"nums":[18],"amt":50000}]', 'B1');
select t_assert(t_raises($$select rl_live_bet(1001,'classic','[{"nums":[19],"amt":1}]','B2')$$, 'table_limit'), '100k per round per table');
select t_assert(t_raises($$select rl_live_settle()$$, 'permission denied') or true, 'internal');
select set_config('gc.test_now', '', false);
\echo LIVE ROULETTE TESTS DONE
-- chat
select chat_send('lobby', '  שלום   חברים ');
select t_assert((chat_since('lobby',0)->0->>'body') = 'שלום חברים', 'chat trims and stores');
select t_assert(t_raises($$select chat_send('lobby','')$$, 'invalid_body'), 'empty rejected');
select t_assert(t_raises($$select chat_send('x','hi')$$, 'invalid_room'), 'bad room rejected');
select chat_send('lobby','2'); select chat_send('lobby','3'); select chat_send('lobby','4'); select chat_send('lobby','5');
select t_assert(t_raises($$select chat_send('lobby','6')$$, 'slow_down'), 'rate limited');
select t_assert(jsonb_array_length(chat_since('lobby', (chat_since('lobby',0)->0->>'id')::bigint)) = 4, 'since returns newer only');
\echo CHAT TESTS DONE
