\set ON_ERROR_STOP on
create or replace function t_rig(u uuid, cards text[]) returns void language sql as
  $$ insert into bj_shoes values (u, cards || array_fill('2S'::text, array[300]), 0)
     on conflict (user_id) do update set cards = excluded.cards, pos = 0 $$;
create or replace function t_bal(u uuid) returns bigint language sql as $$ select balance from wallets where user_id = u $$;
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
update wallets set balance = 100000 where user_id = '00000000-0000-0000-0000-00000000000a';
delete from bj_boost;
-- 1. lightning round charges bet + fee and earns a multiplier
select t_rig('00000000-0000-0000-0000-00000000000a', array['KS','7H','QD','KC']);   -- player 20, dealer 17
select bj_deal(100,0,0,0,0,'L1','lightning');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = 99800, 'bet + fee charged (200)');
select bj_action((select id from bj_rounds where ref='L1'),'stand');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = 100000, 'first win pays 1:1 (no boost yet)');
select t_assert((select mult between 2 and 25 and cap = 100 from bj_boost), 'earned a 2x-25x multiplier');
-- 2. boost applies to next win
update bj_boost set mult = 10, cap = 100;
select t_rig('00000000-0000-0000-0000-00000000000a', array['KS','7H','QD','KC']);
select bj_deal(100,0,0,0,0,'L2','lightning'); select bj_action((select id from bj_rounds where ref='L2'),'stand');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = 100000 - 200 + 200 + 900, 'win with 10x boost: profit 100 -> 1000');
-- 3. cap: boost earned on a 50 bet only boosts 50 of a 100 bet
update bj_boost set mult = 10, cap = 50;
select t_rig('00000000-0000-0000-0000-00000000000a', array['KS','7H','QD','KC']);
create temp table b3 as select t_bal('00000000-0000-0000-0000-00000000000a') b;
select bj_deal(100,0,0,0,0,'L3','lightning'); select bj_action((select id from bj_rounds where ref='L3'),'stand');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = (select b from b3) - 200 + 200 + 450, 'boost capped at earning bet');
-- 4. blackjack boosted: 3:2 profit x mult
update bj_boost set mult = 4, cap = 100;
select t_rig('00000000-0000-0000-0000-00000000000a', array['AS','9H','KD','7C']);
create temp table b4 as select t_bal('00000000-0000-0000-0000-00000000000a') b;
select bj_deal(100,0,0,0,0,'L4','lightning');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = (select b from b4) - 200 + 250 + 450, 'blackjack profit 150 x4 = 600');
-- 5. losing round uses up the boost, no extra
update bj_boost set mult = 25, cap = 100;
select t_rig('00000000-0000-0000-0000-00000000000a', array['KS','TH','6D','KC']);   -- player 16, dealer 20
create temp table b5 as select t_bal('00000000-0000-0000-0000-00000000000a') b;
select bj_deal(100,0,0,0,0,'L5','lightning'); select bj_action((select id from bj_rounds where ref='L5'),'stand');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = (select b from b5) - 200, 'loss with boost: nothing extra');
select t_assert((select mult from bj_boost) between 2 and 25, 'a new multiplier is earned after the loss');
-- 6. side bets rejected, classic unaffected
select t_assert(t_raises($$select bj_deal(100,10,0,0,0,'L6','lightning')$$, 'invalid_side_bet'), 'no side bets in lightning');
update bj_boost set mult = 25, cap = 100;
select t_rig('00000000-0000-0000-0000-00000000000a', array['KS','7H','QD','KC']);
create temp table b7 as select t_bal('00000000-0000-0000-0000-00000000000a') b;
select bj_deal(100,0,0,0,0,'C7'); select bj_action((select id from bj_rounds where ref='C7'),'stand');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = (select b from b7) + 100, 'classic: no fee, no boost');
select t_assert((select mult from bj_boost) = 25, 'classic round keeps the stored boost');
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
