\set ON_ERROR_STOP on
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
update wallets set balance = 100000000 where user_id = '00000000-0000-0000-0000-00000000000a';
do $$ declare v jsonb; i int; c bigint := 0; p bigint := 0; begin
  for i in 1..300 loop v := ww_buy('duel', 100, 'wb' || i); c := c + (v->>'cost')::bigint; p := p + (v->>'payout')::bigint; end loop;
  for i in 1..300 loop v := kin_buy(100, 'kb' || i); c := c + (v->>'cost')::bigint; p := p + (v->>'payout')::bigint; end loop;
  for i in 1..300 loop v := pc_buy(case when i % 2 = 0 then 'regular' else 'super' end, 100, 'pb' || i); c := c + (v->>'cost')::bigint; p := p + (v->>'payout')::bigint; end loop;
  raise warning 'BUY sample return %', round(p::numeric / c, 3);
  v := fo_buy(10, 'fb1'); perform t_assert((v->>'free_left')::int = 10, 'fortune free spins bought');
  perform t_assert(t_raises($q$select fo_buy(10, 'fb2')$q$, 'free_spins_left'), 'cannot stack');
  perform t_assert((select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') = 100000000 - c + p - 500, 'ledger matches');
end $$;
\echo BUY TESTS DONE
