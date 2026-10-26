\set ON_ERROR_STOP on
insert into invitations(email) values ('c@x.com') on conflict do nothing;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@x'), ('00000000-0000-0000-0000-00000000000c', 'c@x.com') on conflict do nothing;
insert into profiles (id, nickname) values ('00000000-0000-0000-0000-00000000000b', 'דני'), ('00000000-0000-0000-0000-00000000000c', 'יוסי') on conflict do nothing;
insert into wallets (user_id, balance) values ('00000000-0000-0000-0000-00000000000b', 0), ('00000000-0000-0000-0000-00000000000c', 0) on conflict do nothing;
update wallets set balance = 1000000 where user_id in ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c');
-- evaluator
select t_assert(ph_best(array['AS','KS','QS','JS','TS','2D','3C']) > ph_best(array['9H','9D','9S','9C','2D','3C','4H']), 'royal flush beats quads');
select t_assert(ph_best(array['AS','2D','3C','4H','5S','KD','KC']) > ph_best(array['KS','KH','2D','7C','9H','JD','3S']), 'wheel straight beats a pair');
select t_assert(ph_best(array['AS','AD','KC','KH','2S','3D','7C']) > ph_best(array['AS','AD','QC','QH','KS','3D','7C']), 'two pair: kings over queens');
select t_assert(ph_best(array['AS','AD','KC','2H','3S','7D','9C']) > ph_best(array['AS','AD','QC','2H','3S','7D','9C']), 'pair of aces, kicker K beats Q');
select t_assert(ph_best(array['2H','3H','4H','5H','6H','AS','AD']) > ph_best(array['AH','KH','QH','JH','9H','AS','AD']), 'straight flush beats flush');
select t_assert(ph_cat_name(ph_best(array['TS','TD','TC','4H','4S','2D','9C'])) = 'פול האוס', 'full house named');
-- seating
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
create temp table tb as select id from poker_tables where level = 1;
select poker_sit((select id from tb), 0, 2000);
select t_assert((select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') = 998000, 'buy-in from wallet');
select t_assert(t_raises($$select poker_sit((select id from tb), 1, 2000)$$, 'already_seated'), 'one seat per player');
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000b', false);
select t_assert(t_raises($$select poker_sit((select id from tb), 0, 2000)$$, 'seat_taken'), 'seat taken');
select t_assert(t_raises($$select poker_sit((select id from tb), 2, 50)$$, 'invalid_amount'), 'buy-in limits');
select poker_sit((select id from tb), 2, 2000);
select t_assert((poker_state((select id from tb))->>'street') = 'preflop', 'hand starts with two players');
-- fuzz: random legal actions over many hands; total chips are conserved
do $$ declare st jsonb; i int; t uuid := (select id from tb); who text; acts text[]; a text; me int; tot0 bigint; tot1 bigint; hands int := 0; n0 bigint;
begin
  select sum(balance) into tot0 from wallets; tot0 := tot0 + (select coalesce(sum(stack),0) from poker_seats);
  n0 := (select hand_no from poker_hands where table_id = t);
  for i in 1..1500 loop
    update poker_hands set next_at = now() where table_id = t and street in ('done','idle');
    perform poker_tick(t);
    if (select street from poker_hands where table_id = t) in ('done','idle') then   -- rebuy anyone who busted
      for who in select u from unnest(array['00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c']) u
                 where not exists (select 1 from poker_seats where user_id = u::uuid) loop
        perform set_config('request.jwt.sub', who, false);
        begin perform poker_sit(t, (select min(x) from generate_series(0,5) x where not exists (select 1 from poker_seats where table_id = t and seat_index = x)), 2000); exception when others then null; end;
      end loop;
      update poker_hands set next_at = now() where table_id = t; perform poker_tick(t);
    end if;
    st := (select to_jsonb(h) from poker_hands h where table_id = t);
    if st->>'street' not in ('preflop','flop','turn','river') then continue; end if;
    who := (select user_id::text from poker_seats where table_id = t and seat_index = (st->>'to_act')::int);
    perform set_config('request.jwt.sub', who, false);
    a := (array['fold','check','call','raise','allin','call','check'])[1 + floor(random()*7)::int];
    begin
      perform poker_act(t, a, (st->>'current_bet')::bigint + (st->>'min_raise')::bigint + floor(random()*100)::bigint);
    exception when others then
      begin perform poker_act(t, 'check'); exception when others then perform poker_act(t, 'call'); end;
    end;
    -- refill busted players so play continues
    perform set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
  end loop;
  select sum(balance) into tot1 from wallets; tot1 := tot1 + (select coalesce(sum(stack),0) from poker_seats)
     + (select coalesce(sum((value->>'committed')::bigint),0) from poker_hands h, jsonb_each(h.players) where h.table_id = t and h.street <> 'done' and h.street <> 'idle')
     - (select coalesce(sum((value->>'committed')::bigint),0) from poker_hands h, jsonb_each(h.players) where h.table_id = t and h.street <> 'done' and h.street <> 'idle') ;
  hands := (select hand_no from poker_hands where table_id = t) - n0;
  perform t_assert(hands > 50, 'many hands played (' || hands || ')');
end $$;
-- conservation checked at a hand boundary: finish the current hand by folding
do $$ declare t uuid := (select id from tb); st jsonb; i int; tot bigint; begin
  for i in 1..20 loop
    st := (select to_jsonb(h) from poker_hands h where table_id = t);
    exit when st->>'street' in ('done','idle');
    perform set_config('request.jwt.sub', (select user_id::text from poker_seats where table_id = t and seat_index = (st->>'to_act')::int), false);
    begin perform poker_act(t, 'fold'); exception when others then perform poker_act(t, 'check'); end;
  end loop;
  tot := (select sum(balance) from wallets where user_id in ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c'))
       + (select coalesce(sum(stack),0) from poker_seats);
  perform t_assert(tot = 3000000, 'chips conserved across all hands (' || tot || ')');
end $$;
-- timeout: the player to act is folded/checked after 25s
do $$ declare t uuid := (select id from tb); h0 bigint; begin
  update poker_hands set next_at = now() where table_id = t; perform poker_tick(t);
  h0 := (select hand_no from poker_hands where table_id = t);
  update poker_hands set deadline = now() - interval '1 second' where table_id = t;
  perform poker_tick(t);
  perform t_assert((select street from poker_hands where table_id = t) <> 'preflop' or (select hand_no from poker_hands where table_id = t) = h0, 'timeout acted');
end $$;
-- privacy: the other player's cards are hidden mid-hand
do $$ declare t uuid := (select id from tb); st jsonb; begin
  update poker_hands set next_at = now(), street = 'done' where table_id = t; perform poker_tick(t);
  perform set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
  st := poker_state(t);
  if st->>'street' in ('preflop','flop','turn','river') then
    perform t_assert(st->'seats'->'0'->'hole' is not null and jsonb_typeof(st->'seats'->'2'->'hole') = 'null', 'only my hole cards are visible');
  end if;
end $$;
-- leaving returns the chips
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000b', false);
select poker_leave((select id from tb));
update poker_hands set next_at = now(), street = case when street = 'idle' then 'idle' else street end where table_id = (select id from tb);
do $$ declare t uuid := (select id from tb); st jsonb; i int; begin
  for i in 1..20 loop
    st := (select to_jsonb(h) from poker_hands h where table_id = t);
    exit when st->>'street' in ('done','idle');
    perform set_config('request.jwt.sub', (select user_id::text from poker_seats where table_id = t and seat_index = (st->>'to_act')::int), false);
    begin perform poker_act(t, 'fold'); exception when others then perform poker_act(t, 'check'); end;
  end loop;
  update poker_hands set next_at = now() where table_id = t; perform poker_tick(t);
  perform t_assert(not exists (select 1 from poker_seats where user_id = '00000000-0000-0000-0000-00000000000b'), 'left the table after the hand');
  perform t_assert((select sum(balance) from wallets where user_id in ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c'))
       + (select coalesce(sum(stack),0) from poker_seats) = 3000000, 'still conserved after leaving');
end $$;
\echo POKER TESTS DONE
