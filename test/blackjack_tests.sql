\set ON_ERROR_STOP on
revoke all on bj_shoes, bj_rounds from authenticated;  -- undo the blanket grant in wallet_tests.sql
-- uses t_assert / t_raises and users a,b from wallet_tests.sql
create or replace function t_rig(u uuid, cards text[]) returns void language sql as
  $$ insert into bj_shoes values (u, cards || array_fill('2S'::text, array[300]), 0)
     on conflict (user_id) do update set cards = excluded.cards, pos = 0 $$;
create or replace function t_bal(u uuid) returns bigint language sql as $$ select balance from wallets where user_id = u $$;
create or replace function t_as(u uuid) returns void language sql as $$ select set_config('request.jwt.sub', u::text, false) $$;

-- Card order dealt: player1, dealer1(up), player2, dealer2(hole), then hits.
select t_as('00000000-0000-0000-0000-00000000000a');
update wallets set balance = 10000 where user_id = '00000000-0000-0000-0000-00000000000a';
delete from wallet_transactions where user_id = '00000000-0000-0000-0000-00000000000a';
insert into wallet_transactions(user_id,game,kind,amount,balance_after,settlement_ref) values ('00000000-0000-0000-0000-00000000000a','admin','reset',10000,10000,'reset-a');

-- 1. Player blackjack pays 3:2
select t_rig('00000000-0000-0000-0000-00000000000a', array['AS','9H','KD','7C']);
select t_assert((bj_deal(100,0,0,0,0,'t1')->'result'->'hands'->0->>'outcome') = 'blackjack', 'blackjack detected');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = 10150, 'blackjack pays 3:2');

-- 2. Duplicate deal request does not charge twice
select bj_deal(100,0,0,0,0,'t1');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = 10150, 'duplicate deal ignored');

-- 3. Hole card hidden while playing; stand on 20 vs dealer 17 wins
select t_rig('00000000-0000-0000-0000-00000000000a', array['KS','7H','QD','KC']);
select t_assert((bj_deal(100,0,0,0,0,'t3')->'dealer'->>1) = '??', 'hole card hidden during play');
select t_assert((bj_action((select id from bj_rounds where ref='t3'),'stand')->'result'->'hands'->0->>'outcome') = 'win', 'stand 20 vs 17 wins');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = 10250, 'win pays 1:1');

-- 4. Double down: 11 vs 6, draw 10 -> 21, dealer 6+10+10 busts
select t_rig('00000000-0000-0000-0000-00000000000a', array['6S','6H','5D','TC','KH','TD']);
select bj_deal(100,0,0,0,0,'t4');
select t_assert((bj_action((select id from bj_rounds where ref='t4'),'double')->'result'->'hands'->0->>'outcome') = 'win', 'double down wins');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = 10450, 'double pays on 2x stake');

-- 5. Illegal action rejected (double after 3 cards)
select t_rig('00000000-0000-0000-0000-00000000000a', array['2S','9H','3D','8C','4H','TD']);
select bj_deal(100,0,0,0,0,'t5');
select bj_action((select id from bj_rounds where ref='t5'),'hit');
select t_assert(t_raises($$select bj_action((select id from bj_rounds where ref='t5'),'double')$$,'illegal_action'), 'double after hit rejected');
select bj_action((select id from bj_rounds where ref='t5'),'stand');

-- 6. Split 8s vs 6: two hands, each gets a card, dealer busts -> both win
select t_rig('00000000-0000-0000-0000-00000000000a', array['8S','6H','8D','TC','TH','TD','KS']);
select t_bal('00000000-0000-0000-0000-00000000000a') as before_split \gset
select bj_deal(100,0,0,0,0,'t6');
select t_assert(jsonb_array_length(bj_action((select id from bj_rounds where ref='t6'),'split')->'hands') = 2, 'split makes 2 hands');
select bj_action((select id from bj_rounds where ref='t6'),'stand');
select t_assert((bj_action((select id from bj_rounds where ref='t6'),'stand')->>'status') = 'done', 'both split hands played');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = :before_split + 200, 'split hands both paid');

-- 7. Surrender returns half
select t_bal('00000000-0000-0000-0000-00000000000a') as b7 \gset
select t_rig('00000000-0000-0000-0000-00000000000a', array['TS','9H','6D','8C']);
select bj_deal(100,0,0,0,0,'t7');
select bj_action((select id from bj_rounds where ref='t7'),'surrender');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = :b7 - 50, 'surrender loses half');

-- 8. Insurance pays when dealer has blackjack
select t_bal('00000000-0000-0000-0000-00000000000a') as b8 \gset
select t_rig('00000000-0000-0000-0000-00000000000a', array['TS','AH','9D','KC']);
select t_assert((bj_deal(100,0,0,0,0,'t8')->>'status') = 'insurance', 'insurance offered on ace');
select bj_action((select id from bj_rounds where ref='t8'),'insurance');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = :b8, 'insurance covers loss (net 0)');

-- 9. Side bets: perfect pair + 21+3 suited trips + Lucky Ladies matched 20
select t_bal('00000000-0000-0000-0000-00000000000a') as b9 \gset
select t_rig('00000000-0000-0000-0000-00000000000a', array['QS','QS','QS','7C']);
select bj_deal(100,10,10,10,0,'t9');
select bj_action((select id from bj_rounds where ref='t9'),'stand');
-- main: 20 vs 17 win +100; pp 25x +250; t3 suited trips 100x +1000; ll matched 25x +250
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = :b9 + 100 + 250 + 1000 + 250, 'side bets pay by paytable');

-- 10. Buster: dealer busts with 5 cards pays 9:1
select t_bal('00000000-0000-0000-0000-00000000000a') as b10 \gset
select t_rig('00000000-0000-0000-0000-00000000000a', array['TS','6H','8D','2C','3D','4S','TH']);
select bj_deal(100,0,0,0,10,'t10');
select bj_action((select id from bj_rounds where ref='t10'),'stand');
select t_assert(t_bal('00000000-0000-0000-0000-00000000000a') = :b10 + 100 + 90, 'buster 5-card bust pays 9:1');

-- 11. One open round at a time; bet above balance rejected
select t_rig('00000000-0000-0000-0000-00000000000a', array['2S','9H','3D','8C']);
select bj_deal(100,0,0,0,0,'t11');
select t_assert(t_raises($$select bj_deal(100,0,0,0,0,'t11b')$$,'round_in_progress'), 'second open round rejected');
select bj_action((select id from bj_rounds where ref='t11'),'stand');
select t_assert(t_raises($$select bj_deal(50000,0,0,0,0,'t11c')$$,'insufficient_funds'), 'bet above balance rejected');

-- 12. Client cannot read the shoe or rounds table directly
set role authenticated;
select t_assert(t_raises($$select * from bj_shoes$$,'permission denied'), 'shoe hidden from clients');
select t_assert(t_raises($$select * from bj_rounds$$,'permission denied'), 'rounds table hidden from clients');
select t_assert(t_raises($$select bj_draw('00000000-0000-0000-0000-00000000000a')$$,'permission denied'), 'client cannot draw cards');
reset role;

-- 13. 3,000 random rounds with random legal actions: money is conserved
delete from bj_shoes where user_id = '00000000-0000-0000-0000-00000000000b';
select t_as('00000000-0000-0000-0000-00000000000b');
update wallets set balance = 10000000 where user_id='00000000-0000-0000-0000-00000000000b';
insert into wallet_transactions(user_id,game,kind,amount,balance_after,settlement_ref) values ('00000000-0000-0000-0000-00000000000b','admin','grant',9990000,10000000,'big-b');
do $$
declare v jsonb; n int; a text;
begin
  for n in 1..3000 loop
    v := bj_deal(100, (random()*20)::int, (random()*20)::int, (random()*20)::int, (random()*20)::int, 'fuzz'||n);
    while v->>'status' <> 'done' loop
      a := (v->'actions')->>floor(random()*jsonb_array_length(v->'actions'))::int;
      v := bj_action((v->>'id')::uuid, a);
    end loop;
  end loop;
end $$;
select t_assert((select count(*) from bj_rounds where ref like 'fuzz%' and status='done') = 3000, '3000 random rounds all finished');
select t_assert(not exists (select 1 from wallets w where w.balance <> (select sum(amount) from wallet_transactions t where t.user_id=w.user_id)), 'ledger equals balances after fuzz');
select t_assert((select sum(total_staked) - sum(payout) from bj_rounds where ref like 'fuzz%')
                = -(select sum(amount) from wallet_transactions where settlement_ref like 'bj%' and user_id='00000000-0000-0000-0000-00000000000b'
                    and settlement_ref not like 'bjstake:t%'), 'rounds and ledger agree on every shekel');
select t_assert((select count(*) from wallet_transactions where settlement_ref like 'bjpay:%') = (select count(*) from bj_rounds where payout > 0), 'each round paid at most once');
select t_assert((select bool_and(bj_total(dealer) >= 17 or bj_is_bj(dealer) or (array_length(dealer,1) = 2 and coalesce((side->>'bust')::bigint,0) = 0
   and not exists (select 1 from jsonb_array_elements(hands) x where not coalesce((x->>'surrendered')::boolean,false) and bj_total(bj_jcards(x->'cards')) <= 21)))
   from bj_rounds where ref like 'fuzz%'), 'dealer reaches 17 unless every hand is already lost');
select t_assert((select count(*) from bj_rounds where ref like 'fuzz%' and array_length(dealer,1) = 2 and bj_total(dealer) < 17) > 0, 'dealer stops when all hands bust');
