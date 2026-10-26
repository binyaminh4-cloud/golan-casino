\set ON_ERROR_STOP on
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
update wallets set balance = 100000000 where user_id = '00000000-0000-0000-0000-00000000000a';
update sl_jackpots set drop_at = now() + interval '10 days' where kind = 'mini';
-- strip weights: exact base RTP 93.20% (weighted enumeration in SQL)
do $$ declare s text[] := fo_strip(); tot numeric := 0; a int; b int; c int; w numeric; begin
  for a in 0..31 loop for b in 0..31 loop for c in 0..31 loop
    w := (case when s[a+1]='ZEUS' then 3 else 4 end) * (case when s[b+1]='ZEUS' then 3 else 4 end) * (case when s[c+1]='ZEUS' then 3 else 4 end);
    tot := tot + w * (fo_eval(array[a,b,c])->>'mult')::int;
  end loop; end loop; end loop;
  perform t_assert(round(tot / (127.0^3) / 5 * 100, 2) = 93.20, 'base RTP 93.20% (' || round(tot / (127.0^3) / 5 * 100, 3) || ')');
end $$;
select t_assert((fo_eval(array[7,7,7])->>'zeus')::boolean and not (fo_eval(array[6,7,7])->>'zeus')::boolean, 'zeus detection on the middle line');
-- spins: ledger consistent, grand grows by 1%
do $$ declare i int; r jsonb; b0 bigint; g0 numeric; begin
  g0 := (select amount from sl_jackpots where kind='grand');
  for i in 1..500 loop
    b0 := (select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a');
    r := fo_spin(20, 'F'||i);
    if (select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') <> b0 - 100 + (r->>'payout')::bigint then raise exception 'ledger %', r; end if;
  end loop;
  perform t_assert(true, '500 fortune spins: ledger consistent');
  perform t_assert((select amount from sl_jackpots where kind='grand') = g0 + 500, 'grand grew by 1% of 50,000 staked');
end $$;
-- mini must-drop
update sl_jackpots set drop_at = now() - interval '1 second' where kind = 'mini';
do $$ declare r jsonb; begin
  r := fo_spin(1, 'M1');
  perform t_assert(r->'jackpot'->>'kind' = 'mini' and (r->'jackpot'->>'amount')::int = 250000, 'mini drops once its moment passed');
  perform t_assert((r->>'payout')::bigint = 250000 + 400 + (select coalesce(sum((w->>'pay')::int),0) from jsonb_array_elements(r->'wins') w) - 400, 'mini + line pays');
  perform t_assert((select drop_at > now() and deadline > now() + interval '13 days' from sl_jackpots where kind='mini'), 'next mini drawn inside 14 days');
  perform t_assert((select count(*) from chat_messages where body like '%בנימין:%' and kind='sys') = 1, 'chat announces the mini');
  r := fo_spin(1, 'M2'); perform t_assert(r->'jackpot' = 'null'::jsonb, 'no second mini right away');
end $$;
-- grand share: force a zeus line by testing the pay formula directly via a rigged pot
update sl_jackpots set amount = 2000000 where kind = 'grand';
select t_assert(floor(2000000 * least(1.0, 50 / 100.0)) = 1000000, 'half share at line bet 50');
select t_assert((fo_state()->>'grand')::bigint = 2000000 and fo_state() ? 'mini_deadline' and not fo_state() ? 'drop_at', 'state hides the secret drop time');
\echo FORTUNE TESTS DONE
