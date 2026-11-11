-- 0134 · aterf roulette timing (no change to money or odds):
--   betting 15 s → 10 s · VIP reveal 4 s → 12 s (targets open one by one, 2.2 s each, then a hold) · summary 7 s → 4 s
-- the tick function below is 0133's, with only those three numbers changed.
alter table atf_private.rounds alter column deadline set default clock_timestamp() + interval '10 seconds';

create or replace function atf_private.tick(wake boolean default false) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare ctl atf_private.control; r atf_private.rounds; t timestamptz := clock_timestamp();
 k int; i int; j int; n int; arr int[]; vals int[]; chosen int[]; deck int[]; pk jsonb; mult int;
 pl atf_private.players; b record; v_win bigint; pay bigint; ball jsonb; u record; v_hit bigint;
begin
 select * into ctl from atf_private.control where id = 1 for update;
 if wake then
  if ctl.viewed_at < t - interval '10 seconds' then update atf_private.control set viewed_at = t where id = 1; end if;
  ctl.viewed_at := t;
 end if;
 if ctl.round_id is null then
  if not wake then return; end if;
  insert into atf_private.rounds default values returning * into r;
  update atf_private.control set round_id = r.id where id = 1; return;
 end if;
 select * into r from atf_private.rounds where id = ctl.round_id;
 for k in 1..200 loop
  if r.deadline > t then return; end if;
  case r.phase
  when 'betting' then
   update atf_private.rounds set phase = 'grow', phase_at = r.deadline, deadline = r.deadline + interval '6 seconds',
    pockets = atf_private.draw_pockets(), result = public.rl_randint(37) where id = r.id;
  when 'grow' then
   update atf_private.rounds set phase = 'spin', phase_at = r.deadline, deadline = r.deadline + interval '15 seconds' where id = r.id;
  when 'spin' then
   pk := r.pockets -> r.result::text;
   if pk is null then
    update atf_private.rounds set phase = 'settle', phase_at = r.deadline where id = r.id;
   else
    insert into atf_private.players(round_id, user_id, stake)
     select r.id, user_id, amount from atf_private.bets where round_id = r.id and nums = array[r.result] on conflict do nothing;
    if pk->>'t' = 'vip' then
     -- person index 1 is Binyamin and always pays ×100; only the positions are shuffled (as in זמן למטווח)
     arr := atf_private.shuffle(array[0,1,2,3,4]); vals := array[10,100,20,25,50]; chosen := '{}';
     for i in 1..5 loop chosen := chosen || vals[arr[i] + 1]; end loop;
     update atf_private.rounds set bonus = 'vip', secret = jsonb_build_object('people', arr, 'values', chosen),
      phase = 'intro', phase_at = r.deadline, deadline = r.deadline + interval '4 seconds' where id = r.id;
    else
     deck := array_fill(0, array[20]);
     for i in 1..3 loop deck := deck || array_fill(i, array[27]) || array_fill(i + 3, array[3]); end loop;
     deck := atf_private.shuffle(deck); j := 0;
     for i in 1..110 loop if deck[i] = 0 then j := j + 1; end if; n := i; exit when j = 4; end loop;
     update atf_private.rounds set bonus = 'balls', secret = jsonb_build_object('deck', deck[1:n]),
      phase = 'intro', phase_at = r.deadline, deadline = r.deadline + interval '4 seconds' where id = r.id;
    end if;
   end if;
  when 'intro' then
   update atf_private.rounds set phase = 'choice', phase_at = r.deadline,
    deadline = r.deadline + case when r.bonus = 'vip' then interval '15 seconds' else interval '10 seconds' end where id = r.id;
  when 'choice' then
   -- a pick not made in time is completed at random
   for pl in select * from atf_private.players where round_id = r.id loop
    n := case when r.bonus = 'vip' then 3 else 1 end;
    arr := atf_private.shuffle(case when r.bonus = 'vip' then array[0,1,2,3,4] else array[0,1,2] end); chosen := pl.picks;
    foreach i in array arr loop exit when cardinality(chosen) >= n; if not i = any(chosen) then chosen := chosen || i; end if; end loop;
    update atf_private.players set picks = chosen where round_id = r.id and user_id = pl.user_id;
   end loop;
   if r.bonus = 'vip' then
    update atf_private.players p set profit = (select sum((r.secret->'values'->>x)::int) from unnest(p.picks) x) where p.round_id = r.id;
    update atf_private.rounds set phase = 'reveal', phase_at = r.deadline, deadline = r.deadline + interval '12 seconds' where id = r.id;
   else
    update atf_private.rounds set phase = 'balls', phase_at = r.deadline, deadline = r.deadline + interval '3 seconds' where id = r.id;
   end if;
  when 'reveal' then
   update atf_private.rounds set phase = 'settle', phase_at = r.deadline where id = r.id;
  when 'balls' then
   select array_agg(x::int order by ord) into deck from jsonb_array_elements_text(r.secret->'deck') with ordinality a(x, ord);
   n := least(cardinality(deck), floor(extract(epoch from t - r.phase_at) / 3)::int);
   if n >= cardinality(deck) then
    ball := atf_private.balls_result(deck, cardinality(deck));
    update atf_private.players set profit = (ball->'values'->>picks[1])::int where round_id = r.id;
    update atf_private.rounds set draws = cardinality(deck), phase = 'settle', phase_at = r.phase_at + make_interval(secs => 3 * cardinality(deck)),
     deadline = r.phase_at + make_interval(secs => 3 * cardinality(deck)) where id = r.id;
   else
    update atf_private.rounds set draws = n, deadline = r.phase_at + make_interval(secs => 3 * (n + 1)) where id = r.id;
   end if;
  when 'settle' then
   pk := r.pockets -> r.result::text; mult := coalesce((pk->>'m')::int, 1);
   for b in select * from atf_private.bets where round_id = r.id and not settled order by user_id, nums for update loop
    pay := 0;
    if r.result = any(b.nums) then
     if cardinality(b.nums) = 1 then
      if pk is null then pay := b.amount * 20;
      else
       select least(10000::bigint, p.profit::bigint * mult) into v_win from atf_private.players p where p.round_id = r.id and p.user_id = b.user_id;
       pay := b.amount * (1 + coalesce(v_win, 0));
      end if;
     else pay := (b.amount * 36) / cardinality(b.nums);
     end if;
    end if;
    if pay > 0 then perform public.apply_tx(b.user_id, 'aterf_roulette', 'payout', pay, 'atfpay:' || r.id || ':' || b.user_id || ':' || array_to_string(b.nums, ',')); end if;
    update atf_private.bets set payout = pay, settled = true where round_id = r.id and user_id = b.user_id and nums = b.nums;
   end loop;
   -- lobby chat: ×200 of the round's bet or a bonus of ×200 and more (owner's rule); never for test users
   for u in select bt.user_id, sum(bt.amount) tot, sum(bt.payout) pay from atf_private.bets bt where bt.round_id = r.id group by bt.user_id loop
    v_hit := coalesce((select least(10000::bigint, p.profit::bigint * mult) from atf_private.players p where p.round_id = r.id and p.user_id = u.user_id), 0);
    if u.pay > 0 and (v_hit >= 200 or u.pay >= u.tot * 200) and not public.gc_is_test(u.user_id) then
     perform public.chat_sys('lobby', '🧪 ' || (select nickname from public.profiles where id = u.user_id) || ' זכה ב־₪' || to_char(u.pay, 'FM999,999,999,999,999,999') ||
      case when v_hit > 0 then case when r.bonus = 'vip' then ' במטווח VIP' else ' בכדורים של בנימין' end || ' ×' || v_hit else ' על ' || r.result end ||
      ' ברולטת האטרף של בנימין XXX!');
    end if;
   end loop;
   update atf_private.rounds set phase = 'summary', phase_at = r.deadline, deadline = r.deadline + interval '4 seconds' where id = r.id;
  when 'summary' then
   if ctl.viewed_at < t - interval '60 seconds' then return; end if;
   insert into atf_private.rounds default values returning * into r;
   update atf_private.control set round_id = r.id where id = 1; return;
  else raise exception 'invalid_phase';
  end case;
  select * into r from atf_private.rounds where id = ctl.round_id;
 end loop;
end $$;
