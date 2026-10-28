-- מסע הדיג של עידו: a live wheel room. Everything is decided on the server when a round is created, before anyone sees it.
-- Round clock (seconds from start): 0-10 bets · 10-13 boosts revealed · 13-20 wheel · then the bonus catch (7.8/12.5/17 s) if a bonus fish
-- came up · 2 s results. Rounds follow each other; an idle room restarts on the next visit.
-- Wheel: 53 equal segments (23 dark friend fish, 23 light friend fish, 4 blue, 2 orange, 1 red).
-- Pays: friend fish gross ×2 (×2×boost on the one boosted segment); bonus fish gross = bet × fish × category boost.
create table if not exists if_rounds (
  round_no bigint primary key, start_at numeric not null, dur numeric not null,
  seg int not null, cat text not null,
  boost_seg int not null, boost_mult int not null,       -- one ordinary segment gets ×3..×10
  bonus_boost_cat text, bonus_boost_mult int not null default 1,   -- 4%: one bonus colour gets ×2..×10 on all its segments
  fish_mult int, total_mult int,                          -- the bonus fish (only when cat is blue/orange/red)
  created_at timestamptz not null default now());
create table if not exists if_bets (
  id bigint generated always as identity primary key, round_no bigint not null references if_rounds(round_no),
  user_id uuid not null references profiles(id) on delete cascade, ref text not null unique,
  bets jsonb not null, total bigint not null, payout bigint, settled boolean not null default false, created_at timestamptz not null default now());
create index if not exists if_bets_round on if_bets(round_no);
alter table if_rounds enable row level security; alter table if_bets enable row level security;
revoke all on if_rounds, if_bets from anon, authenticated;

create or replace function if_layout() returns text[] language sql immutable as $$
  select array['dark','light','dark','light','blue','dark','light','dark','light','dark','orange','light','dark','light','dark','light','dark','blue','light','dark','light','dark','light','dark','light','red','dark','light','dark','light','blue','dark','light','dark','light','dark','orange','light','dark','light','dark','light','dark','blue','light','dark','light','dark','light','dark','light','dark','light'] $$;

-- weighted pick: p_vals[i] with weight p_w[i]
create or replace function if_pick(p_vals int[], p_w int[]) returns int language plpgsql volatile as $$
declare tot int := 0; r int; i int;
begin
  for i in 1 .. array_length(p_w, 1) loop tot := tot + p_w[i]; end loop;
  r := rl_randint(tot);
  for i in 1 .. array_length(p_w, 1) loop
    if r < p_w[i] then return p_vals[i]; end if; r := r - p_w[i];
  end loop;
  return p_vals[array_length(p_vals, 1)];
end $$;

create or replace function if_bonus_secs(p_total int) returns numeric language sql immutable as $$
  select case when p_total is null then 0 when p_total < 300 then 8.3 when p_total < 1500 then 13 else 17.5 end $$;

create or replace function if_make(p_round bigint, p_start numeric) returns if_rounds language plpgsql volatile as $$
declare L text[] := if_layout(); s int; c text; bs int; bm int; bc text := null; bbm int := 1; fm int := null; tm int := null; ords int[]; r if_rounds;
begin
  s := rl_randint(53); c := L[s + 1];
  select array_agg(i - 1) into ords from generate_subscripts(L, 1) i where L[i] in ('dark', 'light');
  bs := ords[rl_randint(46) + 1];
  bm := if_pick(array[3,4,5,7,10], array[15,15,20,25,25]);
  if rl_randint(100) < 4 then
    bc := (array['blue','orange','red'])[rl_randint(3) + 1];
    bbm := if_pick(array[2,3,5,10], array[50,25,15,10]);
  end if;
  if c in ('blue', 'orange', 'red') then
    fm := case c when 'blue' then if_pick(array[12,16,25,50,100], array[9850,100,40,8,2])
                 when 'orange' then if_pick(array[16,20,40,100,200], array[700,100,145,50,5])
                 else if_pick(array[40,60,100,200,500], array[800,110,65,24,1]) end;
    tm := fm * (case when bc = c then bbm else 1 end);
  end if;
  insert into if_rounds (round_no, start_at, dur, seg, cat, boost_seg, boost_mult, bonus_boost_cat, bonus_boost_mult, fish_mult, total_mult)
    values (p_round, p_start, 22 + if_bonus_secs(tm), s, c, bs, bm, bc, bbm, fm, tm)
    on conflict (round_no) do nothing;
  select * into r from if_rounds where round_no = p_round;
  return r;
end $$;

-- the current round (creates the next ones as time passes)
create or replace function if_current() returns if_rounds language plpgsql volatile as $$
declare t numeric := rl_live_now(); r if_rounds;
begin
  perform pg_advisory_xact_lock(hashtext('if_clock'));
  select * into r from if_rounds order by round_no desc limit 1;
  if not found then return if_make(1, t); end if;
  while r.start_at + r.dur <= t loop
    if t - (r.start_at + r.dur) > 60 then r := if_make(r.round_no + 1, t);      -- the room was empty: start fresh now
    else r := if_make(r.round_no + 1, r.start_at + r.dur); end if;
  end loop;
  return r;
end $$;

create or replace function if_gross(p_bets jsonb, r if_rounds) returns bigint language sql immutable as $$
  select case
    when r.cat in ('dark', 'light') then coalesce((p_bets->>r.cat)::bigint, 0) * 2 * (case when r.seg = r.boost_seg then r.boost_mult else 1 end)
    else coalesce((p_bets->>r.cat)::bigint, 0) * coalesce(r.total_mult, 0) end $$;

-- pay every bet whose wheel has stopped (13 + 7 s after the start)
create or replace function if_settle() returns void language plpgsql volatile as $$
declare b record; v_pay bigint;
begin
  for b in select ib.id, ib.user_id, ib.bets, r as rr from if_bets ib join if_rounds r using (round_no)
           where not ib.settled and rl_live_now() >= r.start_at + 20 for update of ib skip locked loop
    v_pay := if_gross(b.bets, b.rr);
    if v_pay > 0 then perform apply_tx(b.user_id, 'ido_fishing', 'payout', v_pay, 'ifpay:' || b.id); end if;
    update if_bets set payout = v_pay, settled = true where id = b.id;
    if v_pay >= 50000 then perform chat_sys('lobby', '🎣 ' || (select nickname from profiles where id = b.user_id) || ' דג ₪' || to_char(v_pay, 'FM999,999,999,999,999,999') || ' אצל עידו!'); end if;
  end loop;
end $$;

create or replace function if_state() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); t numeric; r if_rounds; e numeric; v_mine jsonb; v_pay bigint; v_players jsonb; v_hist jsonb;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  r := if_current(); perform if_settle();
  t := rl_live_now(); e := t - r.start_at;
  select coalesce(jsonb_object_agg(k, s), '{}') into v_mine from (select k, sum(v::bigint) s from if_bets ib, jsonb_each_text(ib.bets) x(k, v)
     where ib.round_no = r.round_no and ib.user_id = u group by k) q;
  select sum(payout) into v_pay from if_bets where round_no = r.round_no and user_id = u and settled;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.nickname, 'total', s.tot, 'payout', case when e >= 20 then s.pay end) order by s.tot desc), '[]')
    into v_players from (select user_id, sum(total) tot, sum(payout) pay from if_bets where round_no = r.round_no group by user_id) s join profiles p on p.id = s.user_id;
  select coalesce(jsonb_agg(jsonb_build_object('cat', cat, 'x', case when cat in ('dark','light') then case when seg = boost_seg then boost_mult * 2 else 2 end else total_mult end) order by round_no desc), '[]')
    into v_hist from (select * from if_rounds where round_no < r.round_no order by round_no desc limit 12) h;
  return jsonb_build_object('now', round(t * 1000), 'round', r.round_no, 'start', round(r.start_at * 1000), 'dur', r.dur,
    'open', e < 10,
    'boosts', case when e >= 10 then jsonb_build_object('seg', r.boost_seg, 'mult', r.boost_mult, 'cat', r.bonus_boost_cat, 'cat_mult', r.bonus_boost_mult) end,
    'stop', case when e >= 13 then r.seg end, 'cat', case when e >= 20 then r.cat end,
    'total_mult', case when e >= 20 then r.total_mult end,
    'mine', v_mine, 'payout', v_pay, 'players', v_players, 'history', v_hist,
    'max_bet', gc_max_bet(u), 'balance', (select balance from wallets where user_id = u));
end $$;

-- p_bets: {"dark":100,"blue":25,...}; adds to what was already sent this round
create or replace function if_bet(p_round bigint, p_bets jsonb, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r if_rounds; k text; v bigint; tot bigint := 0; clean jsonb := '{}'; v_bal bigint; prev bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_ref is null or length(p_ref) > 80 then raise exception 'invalid_ref'; end if;
  if exists (select 1 from if_bets where ref = p_ref and user_id = u) then
    return jsonb_build_object('ok', true, 'balance', (select balance from wallets where user_id = u));
  end if;
  r := if_current();
  if r.round_no <> p_round or rl_live_now() >= r.start_at + 10 then raise exception 'betting_closed'; end if;
  if jsonb_typeof(p_bets) <> 'object' then raise exception 'invalid_bets'; end if;
  perform pg_advisory_xact_lock(hashtext('ifb:' || u));
  for k, v in select key, value::bigint from jsonb_each_text(p_bets) loop
    if k not in ('dark', 'light', 'blue', 'orange', 'red') or v < 1 then raise exception 'invalid_bet'; end if;
    select coalesce(sum((b.bets->>k)::bigint), 0) into prev from if_bets b where b.round_no = r.round_no and b.user_id = u;
    if prev + v > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
    clean := clean || jsonb_build_object(k, v); tot := tot + v;
  end loop;
  if tot = 0 then raise exception 'invalid_bets'; end if;
  v_bal := apply_tx(u, 'ido_fishing', 'stake', -tot, 'ifstake:' || u || ':' || p_ref);
  insert into if_bets (round_no, user_id, ref, bets, total) values (r.round_no, u, p_ref, clean, tot);
  return jsonb_build_object('ok', true, 'balance', v_bal);
end $$;

revoke all on function if_layout(), if_pick(int[], int[]), if_bonus_secs(int), if_make(bigint, numeric), if_current(), if_gross(jsonb, if_rounds), if_settle() from public, anon, authenticated;
revoke all on function if_state(), if_bet(bigint, jsonb, text) from public, anon;
grant execute on function if_state(), if_bet(bigint, jsonb, text) to authenticated;
