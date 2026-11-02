-- OWNER SQL EDITOR ONLY. After 0102 + 0103 + the install check succeed.
-- These are THREE SEPARATE queries. Run one, inspect its result, then run the next.
-- 1. Pause financial writes; expect PAUSED. No balances are changed yet.
select gc_economy.pause();

-- 2. Snapshot, close old claims and reset once, atomically. Expect result PASS,
-- snapshot_complete true, outstanding_claims 0, wallet_total 0, bank_total
-- 50,000,000 x accounts (600,000,000 for the 12 currently existing accounts).
select gc_economy.reset_once();

-- 3. Only after step 2 PASS: verify again and reopen normal play.
select gc_economy.resume();

-- If step 2 FAILS, balances are rolled back and maintenance remains active.
-- Do NOT run more queries blindly: send the error to Codex.
-- Owner-only escape BEFORE any successful reset, to restore normal service:
-- select gc_economy.cancel_pause();
