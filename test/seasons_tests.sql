\set ON_ERROR_STOP on
-- two members: a (exists in stub) and b
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@x') on conflict do nothing;
insert into profiles (id, nickname) values ('00000000-0000-0000-0000-00000000000b', 'דני') on conflict do nothing;
insert into wallets (user_id, balance) values ('00000000-0000-0000-0000-00000000000b', 1000) on conflict do nothing;
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
update wallets set balance = 1000 where user_id = '00000000-0000-0000-0000-00000000000a';
select t_assert((ch_state()->>'season')::int = 1, 'season 1 opens by itself');
select t_assert((select ends_at > now() + interval '13 days' from seasons where no = 1), 'two weeks long');
-- Fisher's set: chips, not the wallet
create temp table r1 as select (ch_start_fisher()->>'run')::uuid id;
update ch_runs set deck = array['KS','7H','QD','KC'] || deck where id = (select id from r1);
select bj_deal(100,0,0,0,0,'C1','lightning',(select id from r1));
select t_assert((select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') = 1000, 'wallet untouched by a challenge hand');
select t_assert((select chips from ch_runs where id = (select id from r1)) = 9850, 'bet + fee taken from challenge chips');
select bj_action((select id from bj_rounds where ref='C1'),'stand');
select t_assert((select hands from ch_runs where id = (select id from r1)) = 1, 'hand counted');
select t_assert((select chips from ch_runs where id = (select id from r1)) >= 10050, 'win paid in chips (20 vs 17)');
select t_assert((select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') = 1000, 'wallet still untouched');
select t_assert(t_raises($$select bj_deal(100,0,0,0,0,'C2','classic',(select id from r1))$$, 'invalid_mode'), 'fisher run needs fisher mode');
select t_assert(t_raises($$select bj_deal(20000,0,0,0,0,'C3','lightning',(select id from r1))$$, 'insufficient_funds'), 'cannot bet more chips than you have');
-- finish the run quickly
update ch_runs set hands = 14 where id = (select id from r1);
select bj_deal(10,0,0,0,0,'C4','lightning',(select id from r1));
do $$ declare v jsonb; begin
  v := bj_current();
  while v is not null and v->>'status' <> 'done' loop v := bj_action((v->>'id')::uuid, case when v->>'status'='insurance' then 'no_insurance' else 'stand' end); end loop;
end $$;
select t_assert((select status from ch_runs where id = (select id from r1)) = 'done', 'run closes after 15 hands');
select t_assert((select points from ch_runs where id = (select id from r1)) = greatest(0, ((select chips from ch_runs where id = (select id from r1)) - 10000) / 100), 'points = profit / 100');
-- normal blackjack after the run uses the wallet again
select t_rig('00000000-0000-0000-0000-00000000000a', array['KS','7H','QD','KC']);
select bj_deal(100,0,0,0,0,'N1'); select bj_action((select id from bj_rounds where ref='N1'),'stand');
select t_assert((select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') = 1100, 'normal hand back on the wallet');
-- Ido's deck: same deck for both
create temp table d1 as select (ch_challenge_ido('00000000-0000-0000-0000-00000000000b')->>'duel')::uuid id;
update ch_duels set deck = array['KS','7H','QD','KC'] || deck where id = (select id from d1);
update ch_runs set deck = (select deck from ch_duels where id = (select id from d1)), max_hands = 1 where duel = (select id from d1);
select bj_deal(500,0,0,0,0,'I1','classic',(select run_a from ch_duels where id = (select id from d1)));
select bj_action((select id from bj_rounds where ref='I1'),'stand');
select t_assert((select status from ch_duels where id = (select id from d1)) = 'waiting' and (select score_a from ch_duels where id = (select id from d1)) = 10500, 'challenger done: 10,500, waiting for the opponent');
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000b', false);
select t_assert((ch_state()->'duels'->0->>'score_b') is null and (ch_state()->'duels'->0->>'score_a')::int = 10500, 'opponent sees the target only');
create temp table rb as select (ch_accept_ido((select id from d1))->>'run')::uuid id;
update ch_runs set max_hands = 1 where id = (select id from rb);
select bj_deal(100,0,0,0,0,'I2','classic',(select id from rb));
select t_assert((select hands->0->'cards' from bj_rounds where ref='I2') = '["KS","QD"]', 'opponent gets the same cards');
select bj_action((select id from bj_rounds where ref='I2'),'stand');
select t_assert((select winner from ch_duels where id = (select id from d1)) = '00000000-0000-0000-0000-00000000000a', 'higher chips wins');
select t_assert((select points from ch_points where user_id = '00000000-0000-0000-0000-00000000000a' and kind = 'ido') = 30, 'winner gets 30');
-- season end pays prizes once
update seasons set ends_at = now() - interval '1 second' where no = 1;
select ch_state();
select t_assert((select settled from seasons where no = 1), 'season 1 settled');
select t_assert((select count(*) from wallet_transactions where settlement_ref like 'season:1:%') = 3, 'champion + fisher best + ido best paid');
select t_assert((select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') = 1100 + 500000 + 100000 + 100000, 'a wins 700k');
select ch_state();
select t_assert((select count(*) from wallet_transactions where settlement_ref like 'season:1:%') = 3, 'paid once');
select t_assert((select no from seasons where now() >= starts_at and now() < ends_at) = 2, 'season 2 opened');
\echo SEASONS TESTS DONE
