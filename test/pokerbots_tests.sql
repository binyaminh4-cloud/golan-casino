\set ON_ERROR_STOP on
-- poker against the bots
do $$ declare tb uuid; i int; st jsonb; begin
  perform set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
  update wallets set balance = 10000000 where user_id = '00000000-0000-0000-0000-00000000000a';
  tb := (poker_bot_table(20000)->>'table')::uuid;
  perform t_assert((poker_bot_table(20000)->>'table')::uuid = tb, 'same table on the second call');
  perform t_assert((select count(*) from poker_seats where table_id = tb) = 3, '3 bots seated');
  perform t_assert((select bool_and(name like 'בוט %') from poker_bots where table_id = tb), 'bot names');
  perform t_assert(not exists (select 1 from poker_tables_list() x, jsonb_array_elements(x) e where (e->>'id')::uuid = tb), 'not in the public list');
  perform poker_sit(tb, 0, 1000000);
  for i in 1..800 loop
    update poker_hands set next_at = now(), updated_at = now() - interval '5 seconds' where table_id = tb;
    st := poker_state(tb);
    if (st->>'to_act')::int = 0 and st->>'street' in ('preflop','flop','turn','river') then
      begin perform poker_act(tb, 'call', 0, (st->>'hand_no')::bigint); exception when others then perform poker_act(tb, 'check', 0, (st->>'hand_no')::bigint); end;
    end if;
  end loop;
  st := poker_state(tb);
  perform t_assert((st->>'hand_no')::int >= 2, 'hands are played: ' || (st->>'hand_no'));
  perform t_assert((select count(*) from jsonb_object_keys(st->'seats')) >= 3, 'bots stay');
  perform t_assert((st->'seats'->'1'->>'name') like 'בוט %' and (st->'seats'->'1'->>'bot') is not null, 'state shows bot name + picture');
  perform poker_leave(tb);
  update poker_hands set next_at = now() where table_id = tb; perform poker_tick(tb);
  perform t_assert(not exists (select 1 from poker_seats where table_id = tb and user_id = '00000000-0000-0000-0000-00000000000a'), 'player left');
  perform t_assert((select street from poker_hands where table_id = tb) = 'idle', 'bots wait without a human');
end $$;
\echo POKERBOTS TESTS DONE
do $$ declare tb uuid; begin
  perform set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
  tb := (poker_bot_table(2000000000000)->>'table')::uuid;
  perform t_assert((select big_blind from poker_tables where id = tb) = 2000000000000, 'blinds switch to 2T while not seated');
  perform t_assert((select min(stack) from poker_seats where table_id = tb) = 200000000000000, 'bots sit with 100 big blinds');
end $$;
\echo BLINDS TESTS DONE
do $$ declare tb uuid; t1 uuid := (select id from poker_tables where level = 1); begin
  perform set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
  perform poker_sit(t1, 0, 1000);
  tb := (poker_bot_table(20000)->>'table')::uuid;
  perform poker_sit(tb, 0, 400000);
  perform t_assert(not exists (select 1 from poker_seats where table_id = t1 and user_id = '00000000-0000-0000-0000-00000000000a'), 'stood up from the forgotten table');
end $$;
\echo STANDUP TESTS DONE
delete from poker_seats where user_id = '00000000-0000-0000-0000-00000000000a';
do $$ declare t1 uuid; t2 uuid; begin
  perform set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000b', false);
  update wallets set balance = 10000000 where user_id in ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a');
  t1 := (poker_bot_shared(20000)->>'table')::uuid; perform poker_sit(t1, 0, 400000);
  perform set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
  t2 := (poker_bot_shared(20000)->>'table')::uuid;
  perform t_assert(t1 = t2, 'second player joins the same shared table');
  perform poker_sit(t2, 2, 400000);
  perform t_assert((select count(*) from poker_seats where table_id = t1) = 5, '3 bots + 2 players');
end $$;
\echo SHARED TESTS DONE
