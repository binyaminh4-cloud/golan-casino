\set ON_ERROR_STOP on
create or replace function t_rig(u uuid, cards text[]) returns void language sql as
  $$ insert into bj_shoes values (u, cards || array_fill('2S'::text, array[300]), 0)
     on conflict (user_id) do update set cards = excluded.cards, pos = 0 $$;
create or replace function t_bal(u uuid) returns bigint language sql as $$ select balance from wallets where user_id = u $$;
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
update wallets set balance = 100000 where user_id = '00000000-0000-0000-0000-00000000000a';
-- Fisher v2: strikes on ranks, same-hand multiplier, fee 50%
select t_assert(bj_hand_mult('["KS","7H"]','{"7":5,"A":3}') = 5 and bj_hand_mult('["KS","9H"]','{"7":5}') = 1 and bj_hand_mult('["7S","AH"]','{"7":5,"A":8}') = 8, 'highest struck multiplier in hand');
do $$ declare s jsonb; i int; begin
  for i in 1..2000 loop s := bj_strikes();
    if (select count(*) from jsonb_object_keys(s)) not between 2 and 3 or exists (select 1 from jsonb_each_text(s) where value::int not between 2 and 25) then raise exception 'bad strikes %', s; end if; end loop;
  perform t_assert(true, 'strikes: 2-3 ranks, 2x-25x');
end $$;
-- 1. charge bet + 50% fee; strikes visible from the deal
select t_rig('00000000-0000-0000-0000-00000000000a', array['KS','7H','QD','KC']);   -- player 20 (K,Q), dealer 17
select t_assert(jsonb_typeof(bj_deal(100,0,0,0,0,'L1','lightning')->'strikes') = 'object', 'strikes returned on deal');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = 99850, 'bet + 50% fee charged (150)');
update bj_rounds set strikes = '{"K":10}' where ref = 'L1';
select bj_action((select id from bj_rounds where ref='L1'),'stand');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = 99850 + 200 + 900, 'win with struck K x10: profit 100 -> 1000');
-- 2. win without a struck card pays 1:1
select t_rig('00000000-0000-0000-0000-00000000000a', array['KS','7H','QD','KC']);
create temp table b2 as select t_bal('00000000-0000-0000-0000-00000000000a') b;
select bj_deal(100,0,0,0,0,'L2','lightning'); update bj_rounds set strikes = '{"5":25,"9":8}' where ref = 'L2';
select bj_action((select id from bj_rounds where ref='L2'),'stand');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = (select b from b2) - 150 + 200, 'no struck card: plain win');
-- 3. loss with a struck card pays nothing
select t_rig('00000000-0000-0000-0000-00000000000a', array['KS','TH','6D','KC']);   -- player 16, dealer 20
create temp table b3 as select t_bal('00000000-0000-0000-0000-00000000000a') b;
select bj_deal(100,0,0,0,0,'L3','lightning'); update bj_rounds set strikes = '{"K":25}' where ref = 'L3';
select bj_action((select id from bj_rounds where ref='L3'),'stand');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = (select b from b3) - 150, 'loss: nothing extra');
-- 4. side bets rejected; classic unaffected
select t_assert(t_raises($$select bj_deal(100,10,0,0,0,'L6','lightning')$$, 'invalid_side_bet'), 'no side bets in lightning');
select t_rig('00000000-0000-0000-0000-00000000000a', array['KS','7H','QD','KC']);
create temp table b7 as select t_bal('00000000-0000-0000-0000-00000000000a') b;
select bj_deal(100,0,0,0,0,'C7'); select bj_action((select id from bj_rounds where ref='C7'),'stand');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = (select b from b7) + 100, 'classic: no fee, no strikes');
-- 7. fuzz: ledger always equals stake - payout
do $$ declare i int; v jsonb; b0 bigint; begin
  delete from bj_shoes where user_id = '00000000-0000-0000-0000-00000000000a';
  update wallets set balance = 10000000 where user_id = '00000000-0000-0000-0000-00000000000a';
  for i in 1..800 loop
    b0 := t_bal('00000000-0000-0000-0000-00000000000a');
    v := bj_deal(50,0,0,0,0,'F'||i,'lightning');
    while v->>'status' <> 'done' loop
      v := bj_action((v->>'id')::uuid, case when v->>'status'='insurance' then 'no_insurance' when (v->'hands'->((v->>'active')::int)->>'total')::int < 15 then 'hit' else 'stand' end);
    end loop;
    if t_bal('00000000-0000-0000-0000-00000000000a') <> b0 - (v->>'staked')::bigint + (v->>'payout')::bigint then raise exception 'ledger mismatch %', v; end if;
  end loop;
  perform t_assert(true, '800 lightning rounds: ledger consistent');
end $$;
\echo LIGHTNING BJ TESTS DONE
