-- Golan Casino · "Zeus's duel": head-to-head, live, on the shared lightning roulette (season challenge 'zeus').
-- Invite a friend; once accepted the duel takes the next 10 live rounds. Each player has 10,000 duel chips (never the wallet).
-- Bets settle with the round's real result and its lightning strikes (lucky_l). The last round pays double ("Zeus doubles everything").
-- More chips after round 10 wins: 30 points, tie 10 each. An invite is valid for 10 minutes.

create table if not exists zeus_duels (
  id uuid primary key default gen_random_uuid(),
  season int not null references seasons(no),
  a uuid not null references profiles(id) on delete cascade,
  b uuid not null references profiles(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'active', 'done', 'declined', 'expired')),
  start_round bigint,
  a_chips bigint not null default 10000,
  b_chips bigint not null default 10000,
  winner uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create table if not exists zeus_bets (
  id uuid primary key default gen_random_uuid(),
  duel uuid not null references zeus_duels(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  round_no bigint not null,
  ref text not null,
  bets jsonb not null,
  total bigint not null,
  payout bigint,
  settled boolean not null default false,
  unique (user_id, ref)
);
alter table zeus_duels enable row level security; alter table zeus_bets enable row level security;
revoke all on zeus_duels, zeus_bets from anon, authenticated;

create or replace function zeus_rounds() returns int language sql immutable as $$ select 10 $$;

-- settle closed rounds of one duel, then close the duel after its last round
create or replace function zeus_settle(p_duel uuid) returns void language plpgsql security definer set search_path = public as $$
declare d zeus_duels; zb_r record; v_pay bigint; v_closed bigint; na text; nb text;
begin
  select * into d from zeus_duels where id = p_duel for update;
  if not found or d.status <> 'active' then return; end if;
  v_closed := floor((rl_live_now() - rl_live_window()) / rl_live_cycle());
  for zb_r in select zb.*, r.result, r.lucky_l from zeus_bets zb join rl_live_rounds r using (round_no)
           where zb.duel = p_duel and not zb.settled and zb.round_no <= v_closed loop
    v_pay := rl_pay2(zb_r.bets, zb_r.result, 'lightning', zb_r.lucky_l) * case when zb_r.round_no = d.start_round + zeus_rounds() - 1 then 2 else 1 end;
    update zeus_bets set payout = v_pay, settled = true where id = zb_r.id;
    if zb_r.user_id = d.a then update zeus_duels set a_chips = a_chips + v_pay where id = p_duel;
    else update zeus_duels set b_chips = b_chips + v_pay where id = p_duel; end if;
  end loop;
  select * into d from zeus_duels where id = p_duel;
  if v_closed >= d.start_round + zeus_rounds() - 1 then
    update zeus_duels set status = 'done', finished_at = now(),
      winner = case when a_chips > b_chips then a when b_chips > a_chips then b end where id = p_duel returning * into d;
    na := (select nickname from profiles where id = d.a); nb := (select nickname from profiles where id = d.b);
    if d.winner is null then
      perform ch_add_points(d.season, d.a, 'zeus', 10); perform ch_add_points(d.season, d.b, 'zeus', 10);
      perform chat_sys('lobby', '⚡ תיקו בדו־קרב של זאוס בין ' || na || ' ל' || nb || '. זאוס לא מרוצה.');
    else
      perform ch_add_points(d.season, d.winner, 'zeus', 30);
      perform chat_sys('lobby', '⚡ ' || case when d.winner = d.a then na else nb end || ' ניצח בדו־קרב של זאוס: ' ||
        to_char(greatest(d.a_chips, d.b_chips), 'FM999,999') || ' מול ' || to_char(least(d.a_chips, d.b_chips), 'FM999,999') || '.');
    end if;
  end if;
end $$;

create or replace function zeus_invite(p_opponent uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s seasons; d zeus_duels;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_opponent is null or p_opponent = u or not exists (select 1 from profiles where id = p_opponent) then raise exception 'invalid_opponent'; end if;
  if exists (select 1 from zeus_duels where u in (a, b) and (status = 'active' or (status = 'invited' and created_at > now() - interval '10 minutes'))) then raise exception 'challenge_in_progress'; end if;
  s := ch_season();
  insert into zeus_duels (season, a, b) values (s.no, u, p_opponent) returning * into d;
  perform chat_sys('lobby', '⚡ ' || (select nickname from profiles where id = u) || ' מזמין את ' || (select nickname from profiles where id = p_opponent) ||
    ' לדו־קרב של זאוס! יש 10 דקות לקבל, בעמוד האתגרים.');
  return jsonb_build_object('duel', d.id);
end $$;

create or replace function zeus_answer(p_duel uuid, p_accept boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); d zeus_duels; n bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into d from zeus_duels where id = p_duel and b = u for update;
  if not found or d.status <> 'invited' or d.created_at < now() - interval '10 minutes' then raise exception 'challenge_closed'; end if;
  if not p_accept then update zeus_duels set status = 'declined', finished_at = now() where id = d.id; return jsonb_build_object('duel', d.id, 'status', 'declined'); end if;
  if exists (select 1 from zeus_duels where u in (a, b) and status = 'active') then raise exception 'challenge_in_progress'; end if;
  n := floor(rl_live_now() / rl_live_cycle()) + 1;            -- starts with the next live round
  update zeus_duels set status = 'active', start_round = n where id = d.id;
  return jsonb_build_object('duel', d.id, 'status', 'active');
end $$;

create or replace function zeus_state(p_duel uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); d zeus_duels; n bigint; me_a boolean;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  perform zeus_settle(p_duel);
  select * into d from zeus_duels where id = p_duel and u in (a, b);
  if not found then raise exception 'challenge_closed'; end if;
  me_a := d.a = u; n := floor(rl_live_now() / rl_live_cycle());
  return jsonb_build_object('id', d.id, 'status', d.status, 'start_round', d.start_round, 'rounds', zeus_rounds(),
    'round', case when d.start_round is null then null else n - d.start_round + 1 end,
    'my_chips', case when me_a then d.a_chips else d.b_chips end, 'their_chips', case when me_a then d.b_chips else d.a_chips end,
    'them', (select nickname from profiles where id = case when me_a then d.b else d.a end), 'winner', d.winner, 'me', u,
    'my_payout', (select sum(payout) from zeus_bets where duel = d.id and user_id = u and round_no = n and settled),
    'my_bets', (select coalesce(jsonb_agg(x), '[]') from zeus_bets zb, jsonb_array_elements(zb.bets) x where zb.duel = d.id and zb.user_id = u and zb.round_no = n));
end $$;

create or replace function zeus_bet(p_duel uuid, p_round bigint, p_bets jsonb, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); d zeus_duels; t numeric; n bigint; cl jsonb; v_total bigint; v_chips bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_ref is null or length(p_ref) > 80 then raise exception 'invalid_ref'; end if;
  if exists (select 1 from zeus_bets where user_id = u and ref = p_ref) then return zeus_state(p_duel); end if;
  perform zeus_settle(p_duel);
  select * into d from zeus_duels where id = p_duel and u in (a, b) for update;
  if not found or d.status <> 'active' then raise exception 'challenge_closed'; end if;
  t := rl_live_now(); n := floor(t / rl_live_cycle());
  if p_round <> n or n < d.start_round or n > d.start_round + zeus_rounds() - 1 or t >= n * rl_live_cycle() + rl_live_window() then raise exception 'betting_closed'; end if;
  cl := rl_clean_bets(p_bets); v_total := (cl->>'total')::bigint;
  v_chips := case when d.a = u then d.a_chips else d.b_chips end;
  if v_total > v_chips then raise exception 'insufficient_funds'; end if;
  perform rl_live_ensure(n);
  if d.a = u then update zeus_duels set a_chips = a_chips - v_total where id = d.id; else update zeus_duels set b_chips = b_chips - v_total where id = d.id; end if;
  insert into zeus_bets (duel, user_id, round_no, ref, bets, total) values (d.id, u, n, p_ref, cl->'bets', v_total);
  return zeus_state(p_duel);
end $$;

-- list for the challenges page
create or replace function zeus_list() returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'status', case when d.status = 'invited' and d.created_at < now() - interval '10 minutes' then 'expired' else d.status end,
      'mine', d.a = auth.uid(), 'them', p.nickname, 'a_chips', d.a_chips, 'b_chips', d.b_chips, 'winner', d.winner, 'me', auth.uid()) order by d.created_at desc), '[]')
  from (select * from zeus_duels where auth.uid() in (a, b) order by created_at desc limit 6) d
  join profiles p on p.id = case when d.a = auth.uid() then d.b else d.a end $$;

revoke all on function zeus_rounds, zeus_settle from public, anon, authenticated;
revoke all on function zeus_invite(uuid), zeus_answer(uuid, boolean), zeus_state(uuid), zeus_bet(uuid, bigint, jsonb, text), zeus_list() from public, anon;
grant execute on function zeus_invite(uuid), zeus_answer(uuid, boolean), zeus_state(uuid), zeus_bet(uuid, bigint, jsonb, text), zeus_list() to authenticated;
