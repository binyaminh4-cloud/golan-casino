\set ON_ERROR_STOP on
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ declare n0 int; a uuid; b uuid; begin
  select id into a from profiles where not gc_is_test(id) order by id limit 1;
  select id into b from profiles where not gc_is_test(id) and id <> a order by id limit 1;
  update wallets set balance = 1e12 where user_id = a; update wallets set balance = 0 where user_id = b;
  perform gc_top_check(); n0 := (select count(*) from chat_messages where kind = 'sys');
  perform t_assert((select value->>'id' from gc_settings where key = 'rich_top')::uuid = a, 'first leader stored silently');
  perform gc_top_check(); perform t_assert((select count(*) from chat_messages where kind = 'sys') = n0, 'no repeat');
  update wallets set balance = 2e12 where user_id = b;
  perform gc_top_check();
  perform t_assert((select count(*) from chat_messages where kind = 'sys') = n0 + 1, 'new leader announced');
  perform t_assert((select body from chat_messages where kind = 'sys' order by id desc limit 1) like '%עקף את%', 'text');
end $$;
\echo RICHTOP TESTS DONE
