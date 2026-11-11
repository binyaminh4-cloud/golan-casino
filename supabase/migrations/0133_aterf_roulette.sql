-- רולטת האטרף של בנימין XXX (owner's plan, claude/BONUS_ROULETTE_PLAN.md, 11.11.2026).
-- A shared live roulette with its own clock, separate from the other roulettes. Play money only.
--  * Betting 15 s. Then Binyamin waves his stick and bonus pockets grow out of numbers: always one "Binyamin's balls"
--    pocket and 2–13 "VIP range" pockets (weighted, drawn fresh every round), two of the pockets carry a ×2–×20 multiplier.
--    Pockets and the result are drawn only after betting is locked.
--  * A straight bet on a number without a pocket pays 19:1 (stake back as well). Other bets pay the usual roulette odds.
--  * Ball on a pocket: everyone at the table watches the bonus (like זמן למטווח); players with a straight bet on that
--    number play it (3 VIP shots out of 5 targets ×10/×20/×25/×50/×100, or pick a colour in the balls draw, ×5–×1000).
--    Straight bet pays stake × (1 + bonus × multiplier), the win capped at ×10,000.
--  * Money moves only at "settle", after the result was shown on screen; the chat announcement (×200+) comes with it.
-- Re-runnable. Self-contained: new schema atf_private, new public functions atf_*.
begin;
create schema if not exists atf_private;
revoke all on schema atf_private from public, anon, authenticated;

create table if not exists atf_private.rounds (
 id uuid primary key default gen_random_uuid(),
 seq bigint generated always as identity,
 phase text not null default 'betting', phase_at timestamptz not null default clock_timestamp(),
 deadline timestamptz not null default clock_timestamp() + interval '15 seconds',
 result int, pockets jsonb not null default '{}', bonus text, secret jsonb not null default '{}', draws int not null default 0,
 created_at timestamptz not null default clock_timestamp()
);
create table if not exists atf_private.control (
 id int primary key check (id = 1), round_id uuid references atf_private.rounds(id),
 viewed_at timestamptz not null default clock_timestamp()
);
insert into atf_private.control(id) values (1) on conflict do nothing;
create table if not exists atf_private.bets (
 round_id uuid not null references atf_private.rounds(id), user_id uuid not null references public.profiles(id),
 nums int[] not null, amount bigint not null check (amount > 0), payout bigint not null default 0, settled boolean not null default false,
 primary key (round_id, user_id, nums)
);
create index if not exists atf_bets_user on atf_private.bets(user_id, round_id);
create index if not exists atf_rounds_seq on atf_private.rounds(seq desc);
create table if not exists atf_private.players (
 round_id uuid not null references atf_private.rounds(id), user_id uuid not null references public.profiles(id),
 stake bigint not null default 0, picks int[] not null default '{}', profit int not null default 0,
 primary key (round_id, user_id)
);
create table if not exists atf_private.requests (
 user_id uuid not null references public.profiles(id), request_id uuid not null,
 round_id uuid not null references atf_private.rounds(id), primary key (user_id, request_id)
);
create table if not exists atf_private.presence (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 seen_at timestamptz not null default now(), since timestamptz not null default now()
);
alter table atf_private.rounds enable row level security;
alter table atf_private.control enable row level security;
alter table atf_private.bets enable row level security;
alter table atf_private.players enable row level security;
alter table atf_private.requests enable row level security;
alter table atf_private.presence enable row level security;
revoke all on all tables in schema atf_private from public, anon, authenticated;

-- ---------- helpers ----------
create or replace function atf_private.shuffle(a int[]) returns int[] language plpgsql volatile set search_path = public, pg_temp as $$
declare i int; j int; t int;
begin
 for i in reverse cardinality(a)..2 loop j := 1 + public.rl_randint(i); t := a[i]; a[i] := a[j]; a[j] := t; end loop;
 return a;
end $$;
create or replace function atf_private.weighted(vals int[], weights int[]) returns int language plpgsql volatile set search_path = public, pg_temp as $$
declare i int; total int := 0; n int;
begin
 for i in 1..cardinality(vals) loop total := total + weights[i]; end loop;
 n := public.rl_randint(total);
 for i in 1..cardinality(vals) loop n := n - weights[i]; if n < 0 then return vals[i]; end if; end loop;
 raise exception 'invalid_weights';
end $$;
-- the balls draw of זמן למטווח: 3 colours × (27 regular + 3 double) + 20 black, no replacement; ends at the 4th black
create or replace function atf_private.balls_result(deck int[], count_drawn int) returns jsonb language plpgsql immutable set search_path = pg_catalog as $$
declare pos int[] := array[0,0,0]; ladder int[] := array[5,10,15,20,30,50,75,100,150,250,500,1000]; b int := 0; i int; v int; c int;
begin
 if count_drawn > 0 then for i in 1..least(count_drawn, cardinality(deck)) loop
  v := deck[i]; if v = 0 then b := b + 1; else c := (v - 1) % 3 + 1; pos[c] := least(11, pos[c] + case when v > 3 then 2 else 1 end); end if;
  if b = 4 then exit; end if;
 end loop; end if;
 return jsonb_build_object('black', b, 'levels', pos, 'values', array[ladder[pos[1]+1], ladder[pos[2]+1], ladder[pos[3]+1]]);
end $$;
-- bonus pockets for one round: {"<number>": {"t": "balls"|"vip", "m": multiplier}}
-- VIP pockets 2–13 (weights 30/24/17/11/7/4/2.5/1.5/1/0.6/0.25/0.15 %), one balls pocket, two pockets with ×2–×20
create or replace function atf_private.draw_pockets() returns jsonb language plpgsql volatile set search_path = public, pg_temp as $$
declare k int; nums int[]; out jsonb := '{}'; i int; m int; two int[];
begin
 k := atf_private.weighted(array[2,3,4,5,6,7,8,9,10,11,12,13], array[3000,2400,1700,1100,700,400,250,150,100,60,25,15]);
 nums := (atf_private.shuffle(array(select generate_series(0, 36))))[1:k + 1];
 two := (atf_private.shuffle(array(select generate_series(1, k + 1))))[1:2];
 for i in 1..k + 1 loop
  m := case when i = any(two) then atf_private.weighted(array[2,3,4,5,7,10,15,20], array[40,25,13,9,6,4,2,1]) else 1 end;
  out := out || jsonb_build_object(nums[i]::text, jsonb_build_object('t', case when i = 1 then 'balls' else 'vip' end, 'm', m));
 end loop;
 return out;
end $$;

-- ---------- the round clock ----------
-- betting 15 s → grow 6 s (pockets appear) → spin 15 s (ball) → [intro 4 s → choice (VIP 15 s / balls 10 s) → reveal 4 s | balls 3 s each]
-- → settle (money + chat) → summary 7 s → next round (only while someone watched in the last minute).
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
    update atf_private.rounds set phase = 'reveal', phase_at = r.deadline, deadline = r.deadline + interval '4 seconds' where id = r.id;
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
   update atf_private.rounds set phase = 'summary', phase_at = r.deadline, deadline = r.deadline + interval '7 seconds' where id = r.id;
  when 'summary' then
   if ctl.viewed_at < t - interval '60 seconds' then return; end if;
   insert into atf_private.rounds default values returning * into r;
   update atf_private.control set round_id = r.id where id = 1; return;
  else raise exception 'invalid_phase';
  end case;
  select * into r from atf_private.rounds where id = ctl.round_id;
 end loop;
end $$;

-- ---------- what the page sees (whitelisted: no hidden pocket, result, target or future ball) ----------
create or replace function atf_state() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); r atf_private.rounds; p atf_private.players; shooter atf_private.players; bonus jsonb := '{}';
 targets jsonb := '[]'; obj jsonb; i int; opened boolean; deck int[]; ball jsonb; shown int[]; v_players jsonb; v_hist jsonb; v_mine jsonb; v_pay bigint;
begin
 if u is null then raise exception 'not_signed_in'; end if;
 perform atf_private.tick(true);
 insert into atf_private.presence(user_id, seen_at) values (u, now()) on conflict (user_id) do update set seen_at = now(),
  since = case when atf_private.presence.seen_at < now() - interval '15 seconds' then now() else atf_private.presence.since end;
 select r1.* into r from atf_private.rounds r1 join atf_private.control c on c.round_id = r1.id where c.id = 1;
 select * into p from atf_private.players where round_id = r.id and user_id = u;
 -- spectators follow the biggest straight bet on the number (the "shooter")
 select * into shooter from atf_private.players where round_id = r.id order by stake desc, user_id limit 1;
 if r.bonus is not null and r.phase in ('intro','choice','reveal','balls','settle','summary') then
  shown := case when p.user_id is not null then p.picks else shooter.picks end;
  bonus := jsonb_build_object('type', r.bonus, 'eligible', p.user_id is not null, 'picks', coalesce(p.picks, '{}'::int[]),
   'shown_picks', coalesce(shown, '{}'::int[]), 'shooter', (select nickname from profiles where id = shooter.user_id),
   'mult', coalesce((r.pockets -> r.result::text ->> 'm')::int, 1),
   'profit', case when r.phase in ('settle','summary') or (r.bonus = 'vip' and r.phase = 'reveal') then coalesce(p.profit, shooter.profit, 0) else 0 end,
   'participants', (select coalesce(jsonb_agg(jsonb_build_object('id', pp.user_id, 'name', pr.nickname, 'stake', pp.stake::text,
      'picks', case when r.phase in ('reveal','balls','settle','summary') then to_jsonb(pp.picks) else '[]'::jsonb end,
      'profit', case when r.phase in ('settle','summary') or (r.bonus = 'vip' and r.phase = 'reveal') then pp.profit else null end) order by pp.stake desc), '[]')
      from atf_private.players pp join profiles pr on pr.id = pp.user_id where pp.round_id = r.id));
  if r.bonus = 'vip' then
   for i in 0..4 loop
    opened := r.phase in ('reveal','settle','summary');
    obj := jsonb_build_object('index', i, 'open', opened);
    if opened then obj := obj || jsonb_build_object('person', r.secret->'people'->i, 'value', r.secret->'values'->i); end if;
    targets := targets || jsonb_build_array(obj);
   end loop;
   bonus := bonus || jsonb_build_object('targets', targets);
  else
   select coalesce(array_agg(x::int order by ord), '{}') into deck from jsonb_array_elements_text(r.secret->'deck') with ordinality a(x, ord)
    where ord <= case when r.phase in ('settle','summary') then 1000 when r.phase = 'balls' then r.draws else 0 end;
   ball := atf_private.balls_result(deck, cardinality(deck));
   bonus := bonus || ball || jsonb_build_object('events', to_jsonb(deck));
  end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('nums', to_jsonb(nums), 'amt', amount::text)), '[]'),
        case when bool_and(settled) then sum(payout) end into v_mine, v_pay
  from atf_private.bets where round_id = r.id and user_id = u;
 select coalesce(jsonb_agg(jsonb_build_object('id', s.user_id, 'name', pr.nickname, 'total', s.tot::text, 'bets', s.bets,
   'payout', case when r.phase = 'summary' then s.pay::text end) order by s.tot desc), '[]') into v_players
  from (select user_id, sum(amount) tot, sum(payout) pay, jsonb_agg(jsonb_build_object('nums', to_jsonb(nums), 'amt', amount::text)) bets
        from atf_private.bets where round_id = r.id group by user_id) s join profiles pr on pr.id = s.user_id;
 select coalesce(jsonb_agg(jsonb_build_object('n', h.result, 'b', h.pockets -> h.result::text ->> 't') order by h.seq desc), '[]') into v_hist
  from (select seq, result, pockets from atf_private.rounds where phase = 'summary' and id <> r.id order by seq desc limit 18) h;
 return jsonb_build_object('id', r.id, 'phase', r.phase, 'phase_at', r.phase_at, 'deadline', r.deadline, 'server_time', clock_timestamp(),
  'pockets', case when r.phase = 'betting' then '{}'::jsonb else r.pockets end,
  'result', case when r.phase in ('betting','grow') then null else r.result end,
  'bonus', bonus, 'draws', r.draws, 'mine', v_mine, 'payout', case when r.phase = 'summary' then v_pay::text end,
  'players', v_players, 'history', v_hist,
  'present', (select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.nickname) order by ps.since), '[]')
              from atf_private.presence ps join profiles pr on pr.id = ps.user_id where ps.seen_at > now() - interval '15 seconds'),
  'balance', (select balance::text from wallets where user_id = u));
end $$;

-- place chips (only while betting is open). Same per-spot limit as the roulettes, fixed for the whole round.
create or replace function atf_bet(p_round uuid, p_bets jsonb, p_request uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); r atf_private.rounds; b jsonb; v_nums int[]; v_amt bigint; v_total bigint := 0; v_prev bigint; v_max bigint; v_cur bigint;
begin
 if u is null then raise exception 'not_signed_in'; end if;
 perform atf_private.tick(false);
 perform 1 from atf_private.control where id = 1 for update;
 if p_request is null then raise exception 'invalid_bet'; end if;
 if exists (select 1 from atf_private.requests where user_id = u and request_id = p_request) then return atf_state(); end if;
 select * into r from atf_private.rounds where id = p_round;
 if not found or r.id <> (select round_id from atf_private.control where id = 1) or r.phase <> 'betting' or clock_timestamp() >= r.deadline then raise exception 'betting_closed'; end if;
 if p_bets is null or jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) not between 1 and 200 then raise exception 'invalid_bet'; end if;
 select coalesce(sum(amount), 0) into v_prev from atf_private.bets where round_id = r.id and user_id = u;
 v_max := gc_max_for((select balance from wallets where user_id = u) + v_prev);
 insert into atf_private.requests values (u, p_request, r.id);
 for b in select * from jsonb_array_elements(p_bets) loop
  if jsonb_typeof(b->'amt') not in ('number','string') or (b->>'amt') !~ '^[1-9][0-9]{0,15}$' then raise exception 'invalid_amount'; end if;
  v_amt := (b->>'amt')::bigint;
  select array_agg(x::int order by x::int) into v_nums from jsonb_array_elements_text(b->'nums') x;
  if v_nums is null or not exists (select 1 from rl_legal where nums = v_nums) then raise exception 'invalid_bet'; end if;
  select coalesce(sum(amount), 0) into v_cur from atf_private.bets where round_id = r.id and user_id = u and nums = v_nums;
  if v_cur + v_amt > v_max then raise exception 'invalid_amount'; end if;
  insert into atf_private.bets(round_id, user_id, nums, amount) values (r.id, u, v_nums, v_amt)
   on conflict (round_id, user_id, nums) do update set amount = atf_private.bets.amount + excluded.amount;
  v_total := v_total + v_amt;
 end loop;
 perform apply_tx(u, 'aterf_roulette', 'stake', -v_total, 'atfstake:' || u || ':' || p_request);
 return atf_state();
end $$;

-- bonus picks: VIP = 3 different targets (0–4), balls = one colour (0–2). Only players in the bonus, only during "choice".
create or replace function atf_choose(p_round uuid, p_pick int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); r atf_private.rounds; p atf_private.players;
begin
 if u is null then raise exception 'not_signed_in'; end if;
 perform atf_private.tick(false);
 perform 1 from atf_private.control where id = 1 for update;
 select * into r from atf_private.rounds where id = p_round;
 if not found or r.id <> (select round_id from atf_private.control where id = 1) or r.phase <> 'choice' or clock_timestamp() >= r.deadline then raise exception 'choice_closed'; end if;
 select * into p from atf_private.players where round_id = r.id and user_id = u;
 if not found then raise exception 'not_participant'; end if;
 if p_pick is null or p_pick < 0 or p_pick >= (case when r.bonus = 'vip' then 5 else 3 end) then raise exception 'invalid_pick'; end if;
 if not p_pick = any(p.picks) and cardinality(p.picks) < (case when r.bonus = 'vip' then 3 else 1 end) then
  update atf_private.players set picks = picks || p_pick where round_id = r.id and user_id = u;
 end if;
 return atf_state();
end $$;

revoke all on all functions in schema atf_private from public, anon, authenticated;
revoke all on function atf_state(), atf_bet(uuid, jsonb, uuid), atf_choose(uuid, int) from public, anon, authenticated;
grant execute on function atf_state(), atf_bet(uuid, jsonb, uuid), atf_choose(uuid, int) to authenticated;
-- the clock keeps running even when every player disconnects mid-bonus (named job: re-running replaces it)
select cron.schedule('golan-aterf-roulette', '3 seconds', $job$select atf_private.tick(false);$job$);
commit;
select case when to_regproc('public.atf_state') is not null and to_regproc('atf_private.tick') is not null
 and has_function_privilege('authenticated', 'atf_bet(uuid,jsonb,uuid)', 'execute')
 and not has_function_privilege('anon', 'atf_state()', 'execute')
 then 'PASS: aterf roulette installed' else 'FAIL' end as validation;
