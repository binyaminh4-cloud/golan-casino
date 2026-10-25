\set ON_ERROR_STOP on
create or replace function t_as(u uuid) returns void language sql as $$ select set_config('request.jwt.sub', u::text, false) $$;
create or replace function t_bal(u uuid) returns bigint language sql as $$ select balance from wallets where user_id = u $$;
-- legal table
select t_assert((select count(*) from rl_legal) = 157, 'exactly 157 legal bets');
select t_assert((select count(*) from rl_legal where kind='split') = 60, '60 splits');
select t_assert((select count(*) from rl_legal where kind='corner') = 22, '22 corners');
select t_assert((select count(distinct n) from rl_legal, unnest(nums) n where kind in('red','black')) = 36, 'red+black cover 1..36');
select t_assert((select count(*) from rl_legal a, rl_legal b where a.kind='red' and b.kind='black' and a.nums && b.nums) = 0, 'red/black disjoint');
select t_assert(array_length((select nums from rl_legal where kind='column' and 1 = any(nums)),1)=12 and (select nums from rl_legal where kind='column' and 1 = any(nums)) @> array[1,4,34], 'column 1 = 1,4..34');
-- every legal bet returns exactly 36/37 of stake on average (house edge 2.70%)
select t_assert((select bool_and(s = 36*37) from (select l.nums, sum(rl_pay(jsonb_build_array(jsonb_build_object('nums',to_jsonb(l.nums),'amt',37)), r)) s
  from rl_legal l, generate_series(0,36) r group by l.nums) t) and (select count(*) from rl_legal where 36 % array_length(nums,1) <> 0)=0, 'every bet: expected return 36/37, edge 2.70%');
-- specific payouts
select t_assert(rl_pay('[{"nums":[17],"amt":10}]',17)=360, 'straight 35:1');
select t_assert(rl_pay('[{"nums":[17],"amt":10}]',18)=0, 'straight loses');
select t_assert(rl_pay('[{"nums":[0,1,2,3],"amt":10}]',0)=90, 'first four 8:1');
select t_assert(rl_pay('[{"nums":[1,2,3,4,5,6],"amt":10}]',6)=60, 'line 5:1');
select t_assert(rl_pay((select jsonb_build_array(jsonb_build_object('nums',to_jsonb(nums),'amt',10)) from rl_legal where kind='red'),0)=0, 'red loses on zero');
select t_assert(rl_pay((select jsonb_build_array(jsonb_build_object('nums',to_jsonb(nums),'amt',10)) from rl_legal where kind='red'),32)=20, 'red 32 pays 1:1');
-- spins
select t_as('00000000-0000-0000-0000-00000000000a');
update wallets set balance = 100000 where user_id = '00000000-0000-0000-0000-00000000000a';
select t_assert(t_raises($$select rl_spin('[{"nums":[1,5],"amt":10}]','x1')$$, 'invalid_bet'), 'non-adjacent split rejected');
select t_assert(t_raises($$select rl_spin('[{"nums":[3,4],"amt":10}]','x2')$$, 'invalid_bet'), 'split across streets rejected');
select t_assert(t_raises($$select rl_spin('[{"nums":[17],"amt":0}]','x3')$$, 'invalid_amount'), 'zero bet rejected');
select t_assert(t_raises($$select rl_spin('[{"nums":[17],"amt":1.5}]','x4')$$, 'invalid_amount'), 'fractional rejected');
select t_assert(t_raises($$select rl_spin('[{"nums":[17],"amt":5000000}]','x5')$$, 'invalid_amount'), 'over limit rejected');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a')=100000, 'rejected spins cost nothing');
do $$ declare r jsonb; r2 jsonb; b0 bigint; begin
  b0 := t_bal('00000000-0000-0000-0000-00000000000a');
  r := rl_spin('[{"nums":[3,0],"amt":100},{"nums":[17],"amt":50}]','s1');
  r2 := rl_spin('[{"nums":[3,0],"amt":100},{"nums":[17],"amt":50}]','s1');
  perform t_assert(r->>'result' = r2->>'result' and r->>'payout' = r2->>'payout', 'duplicate spin returns same result');
  perform t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = b0 - 150 + (r->>'payout')::bigint, 'balance = before - stake + payout, charged once');
  perform t_assert((r->>'payout')::bigint = case when (r->>'result')::int in (0,3) then 1800 when (r->>'result')::int=17 then 1800 else 0 end, 'payout matches result');
end $$;
-- fuzz 3700 spins: ledger consistent, all numbers appear, rough uniformity
do $$ declare i int; r jsonb; b bigint; bets jsonb; cnt int[] := array_fill(0, array[37]); mx int; mn int; begin
  update wallets set balance = 10000000 where user_id = '00000000-0000-0000-0000-00000000000a';
  for i in 1..3700 loop
    select jsonb_agg(jsonb_build_object('nums', to_jsonb(nums), 'amt', 1+floor(random()*20)::int)) into bets
      from (select nums from rl_legal order by random() limit 1+floor(random()*6)::int) t;
    b := t_bal('00000000-0000-0000-0000-00000000000a');
    r := rl_spin(bets, 'f'||i);
    if t_bal('00000000-0000-0000-0000-00000000000a') <> b - (r->>'total')::bigint + (r->>'payout')::bigint
       or (r->>'payout')::bigint <> rl_pay(bets,(r->>'result')::int) then raise exception 'fuzz mismatch at %', i; end if;
    cnt[(r->>'result')::int + 1] := cnt[(r->>'result')::int + 1] + 1;
  end loop;
  select max(c), min(c) into mx, mn from unnest(cnt) c;
  perform t_assert(mn > 50 and mx < 160, format('3700 spins roughly uniform (min %s max %s, expect 100)', mn, mx));
end $$;
select t_assert(jsonb_array_length(rl_history())=18, 'history returns last 18');
\echo ROULETTE TESTS DONE
