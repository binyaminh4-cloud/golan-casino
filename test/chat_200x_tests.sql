\set ON_ERROR_STOP on
-- Lobby chat at ×200 (and not at ×199) for the games patched in 0139. Everything runs inside a transaction and is rolled back.
begin;
insert into invitations(email) values ('w200@x.com') on conflict do nothing;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c2', 'w200@x.com') on conflict do nothing;
insert into profiles (id, nickname) values ('00000000-0000-0000-0000-0000000000c2', 'זוכה') on conflict (id) do update set nickname = 'זוכה';
insert into wallets (user_id, balance) values ('00000000-0000-0000-0000-0000000000c2', 0) on conflict do nothing;
update wallets set balance = 100000000 where user_id = '00000000-0000-0000-0000-0000000000c2';
select set_config('request.jwt.sub', '00000000-0000-0000-0000-0000000000c2', true);
create or replace function pg_temp.chats() returns bigint language sql as $$ select count(*) from chat_messages where kind = 'sys' and body like '%זוכה%' $$;
create or replace function pg_temp.check(p_name text, p_before bigint, p_want boolean) returns void language plpgsql as $$
begin if (pg_temp.chats() > p_before) is distinct from p_want then raise exception 'FAIL %: expected chat=%', p_name, p_want; end if; raise notice 'ok  %', p_name; end $$;

-- roulette: ball forced to 17, lightning forced
create or replace function rl_rand37() returns int language sql as $$ select 17 $$;
do $$ declare c bigint; begin
  create or replace function rl_strike(p_mode text) returns jsonb language sql as 'select ''{"17":200}''::jsonb';
  c := pg_temp.chats(); perform rl_spin('[{"nums":[17],"amt":10},{"nums":[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36],"amt":10}]', 'r1', 'lightning'); perform pg_temp.check('roulette: lightning ×200 on the hit number', c, true);
  create or replace function rl_strike(p_mode text) returns jsonb language sql as 'select ''{"17":199}''::jsonb';
  c := pg_temp.chats(); perform rl_spin('[{"nums":[17],"amt":10},{"nums":[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36],"amt":10}]', 'r2', 'lightning'); perform pg_temp.check('roulette: lightning ×199, round below ×200', c, false);
  c := pg_temp.chats(); perform rl_spin('[{"nums":[17],"amt":10}]', 'r3', 'classic'); perform pg_temp.check('roulette classic straight ×36', c, false);
end $$;

-- blackjack: one surrendered hand returns bet/2; total_staked chosen to give exactly ×200 / ×199
do $$ declare c bigint; id uuid; begin
  c := pg_temp.chats();
  insert into bj_rounds (user_id, ref, status, main_bet, hands, dealer, total_staked) values (auth.uid(), 'b1', 'playing', 400, '[{"cards":["10H","6S"],"bet":400,"surrendered":true,"split":false}]', '{9C,8D}', 1) returning bj_rounds.id into id;
  perform bj_finish(id); perform pg_temp.check('blackjack ×200', c, true);
  c := pg_temp.chats();
  insert into bj_rounds (user_id, ref, status, main_bet, hands, dealer, total_staked) values (auth.uid(), 'b2', 'playing', 398, '[{"cards":["10H","6S"],"bet":398,"surrendered":true,"split":false}]', '{9C,8D}', 1) returning bj_rounds.id into id;
  perform bj_finish(id); perform pg_temp.check('blackjack ×199', c, false);
end $$;

-- fisher 90: a cashed-out run worth exactly ×200 / ×199
do $$ declare c bigint; id uuid; begin
  c := pg_temp.chats(); insert into f90_runs (user_id, ref, stake, num, den, stage) values (auth.uid(), 'f1', 100, 200, 1, 3) returning f90_runs.id into id;
  perform f90_cash(id); perform pg_temp.check('fisher90 ×200', c, true);
  c := pg_temp.chats(); insert into f90_runs (user_id, ref, stake, num, den, stage) values (auth.uid(), 'f2', 100, 199, 1, 3) returning f90_runs.id into id;
  perform f90_cash(id); perform pg_temp.check('fisher90 ×199', c, false);
end $$;

-- protein miner: cash at a checkpoint worth exactly ×200 / ×199
do $$ declare c bigint; id uuid; begin
  c := pg_temp.chats(); insert into pm_runs (user_id, ref, stake, mode, rocks, phase, bank_units) values (auth.uid(), 'p1', 100, 'easy', '[]', 'checkpoint', 20000) returning pm_runs.id into id;
  perform pm_next(id, true); perform pg_temp.check('protein ×200', c, true);
  c := pg_temp.chats(); insert into pm_runs (user_id, ref, stake, mode, rocks, phase, bank_units) values (auth.uid(), 'p2', 100, 'easy', '[]', 'checkpoint', 19900) returning pm_runs.id into id;
  perform pm_next(id, true); perform pg_temp.check('protein ×199', c, false);
end $$;

-- fortune slots: the result of a spin forced through fo_eval; bought free spins summed against ×3 the price
do $$ declare c bigint; v jsonb; begin
  delete from sl_free where user_id = auth.uid();
  update sl_jackpots set drop_at = now() + interval '1 day' where kind = 'mini';
  create or replace function fo_eval(p_stops int[]) returns jsonb language sql as 'select ''{"mult":1000,"wins":[]}''::jsonb';   -- ×1000 line bet = ×200 of the spin (5 lines)
  c := pg_temp.chats(); v := fo_spin(10, 's1'); perform pg_temp.check('fortune spin ×200 (payout ' || (v->>'payout') || ')', c, true);
  create or replace function fo_eval(p_stops int[]) returns jsonb language sql as 'select ''{"mult":995,"wins":[]}''::jsonb';
  c := pg_temp.chats(); v := fo_spin(10, 's2'); perform pg_temp.check('fortune spin ×199 (payout ' || (v->>'payout') || ')', c, false);
end $$;
-- fortune slots: a bought bonus (10 free spins) is announced once, at the end, only if it paid ×3 the price or more
do $$ declare c bigint; cost bigint; m bigint; v jsonb; i int; begin
  for m in select x from unnest(array[0, -1]) x loop
    delete from sl_free where user_id = auth.uid(); delete from fo_buy_track where user_id = auth.uid();
    cost := (fo_buy(10, 'buy' || m) ->> 'cost')::bigint;
    -- each free spin pays mult × 10; ten of them sum to exactly 3 × cost (m = 0) or one shekel-step under it (m = -1)
    execute format('create or replace function fo_eval(p_stops int[]) returns jsonb language sql as %L', format('select ''{"mult":%s,"wins":[]}''::jsonb', (3 * cost / 100) + m));
    c := pg_temp.chats();
    for i in 1..10 loop v := fo_spin(10, 'fr' || m || ':' || i); if i < 10 and pg_temp.chats() > c then raise exception 'FAIL fortune buy: announced before the last free spin'; end if; end loop;
    perform pg_temp.check('fortune buy ' || case m when 0 then '×3' else 'under ×3' end || ' (cost ' || cost || ')', c, m = 0);
  end loop;
end $$;

-- time for the kitchen: settle a round on "one" with a ×199 / ×198 boost (pay = bet × (1 + boost)) → ×200 / ×199
do $$ declare c bigint; rid uuid; bst int; begin
  for bst in select x from unnest(array[199, 198]) x loop
    insert into zlm_private.control (id, round_id) values (1, null) on conflict (id) do nothing;
    insert into zlm_private.rounds (phase, deadline, cell, spot, boosts) values ('settle', clock_timestamp() - interval '1 second', 1, 'one', jsonb_build_object('1', bst)) returning id into rid;
    update zlm_private.control set round_id = rid, viewed_at = clock_timestamp() where id = 1;
    insert into zlm_private.bets (round_id, user_id, spot, amount) values (rid, auth.uid(), 'one', 10);
    c := pg_temp.chats(); perform zlm_private.tick(true);
    perform pg_temp.check('zman ' || case bst when 199 then '×200' else '×199' end || ' (paid ' || (select payout from zlm_private.bets where round_id = rid) || ')', c, bst = 199);
  end loop;
end $$;

-- blackjack inside a challenge: challenge chips are not money, no announcement
do $$ declare c bigint; id uuid; run uuid; begin
  select r.id into run from ch_runs r limit 1;
  if run is null then raise notice 'skip blackjack-in-challenge (no challenge run to borrow locally)'; return; end if;
  c := pg_temp.chats();
  insert into bj_rounds (user_id, ref, status, main_bet, hands, dealer, total_staked, ch_run) values (auth.uid(), 'b3', 'playing', 400, '[{"cards":["10H","6S"],"bet":400,"surrendered":true,"split":false}]', '{9C,8D}', 1, run) returning bj_rounds.id into id;
  begin perform bj_finish(id); exception when others then null; end;
  perform pg_temp.check('blackjack ×200 inside a challenge', c, false);
end $$;
\echo CHAT 200x TESTS DONE
rollback;
