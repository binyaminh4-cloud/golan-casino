\set ON_ERROR_STOP on
grant select on all tables in schema public to authenticated;

-- helper
create or replace function t_assert(ok boolean, msg text) returns void language plpgsql as
$$ begin if not ok then raise exception 'FAIL: %', msg; end if; raise notice 'PASS: %', msg; end $$;
create or replace function t_raises(sql text, expected text) returns boolean language plpgsql as
$$ begin execute sql; return false; exception when others then return sqlerrm like '%'||expected||'%'; end $$;

-- 1. Uninvited signup is rejected
select t_assert(t_raises($$insert into auth.users(email) values ('stranger@x.com')$$, 'not_invited'), 'uninvited signup rejected');

-- 2. Invited signup gets profile + 10,000
insert into invitations(email) values ('a@x.com'),('b@x.com');
insert into auth.users(id,email) values ('00000000-0000-0000-0000-00000000000a','a@x.com'),('00000000-0000-0000-0000-00000000000b','b@x.com');
select t_assert((select balance from wallets where user_id='00000000-0000-0000-0000-00000000000a')=(select starting_balance from app_settings where id=1), 'starting balance from settings');
-- the rest of this file works in small numbers: bring both players to 10,000 through the ledger
insert into wallet_transactions(user_id,game,kind,amount,balance_after,settlement_ref) select user_id,'admin','grant',10000-balance,10000,'norm-'||user_id from wallets;
update wallets set balance = 10000;

-- 3. Bet above balance rejected, balance unchanged
select t_assert(t_raises($$select open_round('00000000-0000-0000-0000-00000000000a','roulette',20000,'r-big')$$,'insufficient_funds'), 'overspend rejected');
select t_assert((select balance from wallets where user_id='00000000-0000-0000-0000-00000000000a')=10000, 'balance unchanged after reject');

-- 4. Duplicate bet (same ref) debits once
select open_round('00000000-0000-0000-0000-00000000000a','roulette',500,'r1');
select open_round('00000000-0000-0000-0000-00000000000a','roulette',500,'r1');
select t_assert((select balance from wallets where user_id='00000000-0000-0000-0000-00000000000a')=9500, 'duplicate bet debited once');

-- 5. Duplicate payout credits once
select settle_round((select id from game_rounds where state->>'ref'='r1'), 1000);
select settle_round((select id from game_rounds where state->>'ref'='r1'), 1000);
select t_assert((select balance from wallets where user_id='00000000-0000-0000-0000-00000000000a')=10500, 'duplicate payout credited once');

-- 6. Negative values rejected
select t_assert(t_raises($$select open_round('00000000-0000-0000-0000-00000000000a','slots',-5,'neg')$$,'invalid_stake'), 'negative stake rejected');

-- 7. Poker: buy-in reserves, leaderboard counts stack once, cashout returns it
insert into poker_tables(id,name,max_seats,small_blind,big_blind) values ('00000000-0000-0000-0000-0000000000f1','t',6,10,20);
select poker_buyin('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000f1',0,2000,'buy-b-1');
select t_assert((select balance from wallets where user_id='00000000-0000-0000-0000-00000000000b')=8000, 'buyin debits wallet');
select t_assert((select wealth from leaderboard where id='00000000-0000-0000-0000-00000000000b')=10000, 'leaderboard counts table stack once');
select poker_cashout('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-00000000000b','out-b-1');
select poker_cashout('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-00000000000b','out-b-2');
select t_assert((select balance from wallets where user_id='00000000-0000-0000-0000-00000000000b')=10000, 'cashout returns stack once');

-- 8. Ledger matches balances (conservation)
select t_assert(not exists (select 1 from wallets w where w.balance <> (select sum(amount) from wallet_transactions t where t.user_id=w.user_id)), 'ledger sum equals every balance');

-- 9. Clients cannot touch money
set role authenticated;
select set_config('request.jwt.sub','00000000-0000-0000-0000-00000000000a',false);
select t_assert(t_raises($$update wallets set balance=999999 where user_id='00000000-0000-0000-0000-00000000000a'$$,'permission denied'), 'client cannot edit wallet');
select t_assert(t_raises($$select apply_tx('00000000-0000-0000-0000-00000000000a','x','grant',1000,'hack')$$,'permission denied'), 'client cannot call money functions');
select t_assert((select count(*) from wallet_transactions where user_id<>'00000000-0000-0000-0000-00000000000a')=0, 'client sees only own ledger');
select set_config('request.jwt.sub','00000000-0000-0000-0000-00000000000b',false);
select t_assert(t_raises($$update profiles set is_admin=true where id='00000000-0000-0000-0000-00000000000b'$$,'permission denied') and not (select is_admin from profiles where id='00000000-0000-0000-0000-00000000000b'), 'client cannot make self admin');
select t_assert((select is_admin from profiles where id='00000000-0000-0000-0000-00000000000a') and not (select is_admin from profiles where id='00000000-0000-0000-0000-00000000000b'), 'first member is admin, later ones are not');
reset role;
