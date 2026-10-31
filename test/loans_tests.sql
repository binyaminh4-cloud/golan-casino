\set ON_ERROR_STOP on
do $$ declare A uuid := '00000000-0000-0000-0000-00000000000a'; B uuid := '00000000-0000-0000-0000-00000000000b'; st jsonb; lid uuid; d bigint; begin
  perform set_config('request.jwt.sub', A::text, false);
  st := loan_bank_take('normal', 100000000);
  perform t_assert(bank_bal(A) >= 100000000 and loan_debt(A) = 115000000, 'bank loan: 100M in, 115M owed');
  perform t_assert(t_raises('select loan_bank_take(''fast'', 200000000)', 'invalid_amount'), 'level 1 cap is 100M');
  perform loan_bank_take('fast', 50000000); perform loan_bank_take('long', 50000000);
  perform t_assert(t_raises('select loan_bank_take(''fast'', 10000000)', 'too_many_loans'), 'max 3 bank loans');
  -- garnishment: a salary of 20M pays 10M of debt
  d := loan_debt(A); perform bank_add(A, 'gift', 20000000, 'g1');
  perform t_assert(loan_debt(A) = d - 10000000, 'half of the income went to the debt');
  -- friend loan: B offers 30M at 10%, A accepts
  perform set_config('request.jwt.sub', B::text, false);
  perform bank_add(B, 'deposit', 100000000, 'bdep');
  st := loan_offer(30000000, 10, 7, null); lid := (select id from loans where lender = B and status = 'offer');
  perform t_assert(bank_bal(B) = 70000000, 'offer money in escrow');
  perform set_config('request.jwt.sub', A::text, false);
  perform loan_accept(lid);
  perform t_assert((select due_total from loans where id = lid) = 33000000, 'p2p owed 33M');
  -- friends first: the next garnish goes to B
  perform bank_add(A, 'gift', 20000000, 'g2');
  perform t_assert((select repaid from loans where id = lid) = 10000000 and bank_bal(B) = 80000000, 'friend paid first');
  -- repay the rest of the friend loan
  perform loan_repay(lid, 999999999999);
  perform t_assert((select status from loans where id = lid) = 'paid' and bank_bal(B) = 103000000, 'friend loan closed, lender got interest');
  -- late
  update loans set due_at = now() - interval '1 hour' where borrower = A and status = 'active' and track = 'fast';
  perform loan_tick();
  perform t_assert(exists (select 1 from loans where borrower = A and status = 'late' and penalty), 'late with penalty');
  perform t_assert(t_raises('select bank_move(1000, ''withdraw'', ''x1'')', 'loan_late'), 'no withdrawals while late');
  perform t_assert((select late from leaderboard where id = A), 'rich list shows late');
  perform t_assert((house_stats()->>'total') is not null, 'house stats');
end $$;
\echo LOANS TESTS DONE
