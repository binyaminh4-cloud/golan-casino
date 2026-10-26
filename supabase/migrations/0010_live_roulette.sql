-- Golan Casino · live shared roulette.
-- One wall-clock cycle every 48s, shared by all three roulettes: the same ball result for everyone;
-- classic / lightning / xxx differ only in the lightning strikes (drawn per mode, per round).
-- Rounds are created lazily by whoever looks first and settled lazily by any later call (no cron).
-- The result is stored when the round is created but is never returned before betting closes.

create table if not exists rl_live_rounds (
  round_no bigint primary key,
  result int not null check (result between 0 and 36),
  lucky_l jsonb not null,
  lucky_x jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists rl_live_bets (
  id uuid primary key default gen_random_uuid(),
  round_no bigint not null references rl_live_rounds(round_no),
  user_id uuid not null references profiles(id) on delete cascade,
  mode text not null check (mode in ('classic', 'lightning', 'xxx')),
  ref text not null,
  bets jsonb not null,
  total bigint not null,
  payout bigint,
  settled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, ref)
);
create index if not exists rl_live_bets_open on rl_live_bets (round_no) where not settled;
create index if not exists rl_live_bets_round on rl_live_bets (round_no, mode);
alter table rl_live_rounds enable row level security;
alter table rl_live_bets enable row level security;
revoke all on rl_live_rounds, rl_live_bets from anon, authenticated;

-- cycle constants (seconds)
create or replace function rl_live_cycle() returns int language sql immutable as $$ select 48 $$;
create or replace function rl_live_window() returns int language sql immutable as $$ select 25 $$;

-- the clock; tests (never the API role) may pin it with the gc.test_now setting
create or replace function rl_live_now() returns numeric language plpgsql stable as $$
declare o text := current_setting('gc.test_now', true);
begin
  if o is not null and o <> '' and session_user <> 'authenticator' then return o::numeric; end if;
  return extract(epoch from clock_timestamp());
end $$;

-- validate a bet list; returns {"bets": cleaned, "total": n}
create or replace function rl_clean_bets(p_bets jsonb) returns jsonb language plpgsql stable as $$
declare b jsonb; v_total bigint := 0; v_nums int[]; v_clean jsonb := '[]';
begin
  if jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) not between 1 and 300 then raise exception 'invalid_bets'; end if;
  for b in select * from jsonb_array_elements(p_bets) loop
    if jsonb_typeof(b->'amt') <> 'number' or (b->>'amt')::numeric <> floor((b->>'amt')::numeric)
       or (b->>'amt')::bigint < 1 or (b->>'amt')::bigint > 50000 then raise exception 'invalid_amount'; end if;
    select array_agg(x::int order by x::int) into v_nums from jsonb_array_elements_text(b->'nums') x;
    if not exists (select 1 from rl_legal where nums = v_nums) then raise exception 'invalid_bet'; end if;
    v_total := v_total + (b->>'amt')::bigint;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('nums', to_jsonb(v_nums), 'amt', (b->>'amt')::bigint));
  end loop;
  return jsonb_build_object('bets', v_clean, 'total', v_total);
end $$;

create or replace function rl_live_ensure(p_round bigint) returns void language sql volatile as $$
  insert into rl_live_rounds (round_no, result, lucky_l, lucky_x)
  values (p_round, rl_rand37(), rl_strike('lightning'), rl_strike('xxx'))
  on conflict (round_no) do nothing $$;

-- pay out every bet whose betting window has closed
create or replace function rl_live_settle() returns void language plpgsql volatile as $$
declare b record; v_pay bigint; v_game text; v_closed bigint;
begin
  -- rounds whose window closed: round_no*cycle + window <= now
  v_closed := floor((rl_live_now() - rl_live_window()) / rl_live_cycle());
  for b in select lb.*, r.result, case lb.mode when 'lightning' then r.lucky_l when 'xxx' then r.lucky_x else '{}'::jsonb end as lucky
           from rl_live_bets lb join rl_live_rounds r using (round_no)
           where not lb.settled and lb.round_no <= v_closed
           for update of lb skip locked loop
    v_pay := rl_pay2(b.bets, b.result, b.mode, b.lucky);
    v_game := case b.mode when 'classic' then 'roulette' when 'lightning' then 'lightning_roulette' else 'xxx_roulette' end;
    if v_pay > 0 then perform apply_tx(b.user_id, v_game, 'payout', v_pay, 'rllpay:' || b.id); end if;
    update rl_live_bets set payout = v_pay, settled = true where id = b.id;
  end loop;
end $$;

create or replace function rl_live_state(p_mode text default 'classic') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); t numeric; n bigint; c int := rl_live_cycle(); w int := rl_live_window();
        r rl_live_rounds; open boolean; v_mine jsonb; v_pay bigint; v_players jsonb; v_hist jsonb;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_mode not in ('classic', 'lightning', 'xxx') then raise exception 'invalid_mode'; end if;
  perform rl_live_settle();
  t := rl_live_now(); n := floor(t / c);
  perform rl_live_ensure(n);
  select * into r from rl_live_rounds where round_no = n;
  open := t < n * c + w;
  select coalesce(jsonb_agg(x), '[]'), case when bool_and(settled) then sum(payout) end
    into v_mine, v_pay
    from (select jsonb_array_elements(bets) x, settled, payout from rl_live_bets where round_no = n and user_id = u and mode = p_mode) q;
  select coalesce(sum(payout), null) into v_pay from rl_live_bets where round_no = n and user_id = u and mode = p_mode and settled;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.nickname, 'total', s.tot, 'nums', s.nums) order by s.tot desc), '[]')
    into v_players
    from (select user_id, sum(total) tot,
                 (select jsonb_agg(distinct e->'nums') from rl_live_bets b2, jsonb_array_elements(b2.bets) e
                   where b2.round_no = n and b2.mode = p_mode and b2.user_id = lb.user_id) nums
          from rl_live_bets lb where round_no = n and mode = p_mode group by user_id) s
    join profiles p on p.id = s.user_id;
  select coalesce(jsonb_agg(result order by round_no desc), '[]') into v_hist
    from (select round_no, result from rl_live_rounds where round_no < n or (round_no = n and not open)
          order by round_no desc limit 18) h;
  return jsonb_build_object(
    'now', round(t * 1000), 'round', n,
    'start', n * c * 1000, 'close', (n * c + w) * 1000, 'end', (n + 1) * c * 1000,
    'open', open,
    'result', case when open then null else r.result end,
    'lucky', case when open or p_mode = 'classic' then '{}'::jsonb when p_mode = 'lightning' then r.lucky_l else r.lucky_x end,
    'mine', v_mine, 'payout', v_pay,
    'players', v_players, 'history', v_hist,
    'balance', (select balance from wallets where user_id = u));
end $$;

create or replace function rl_live_bet(p_round bigint, p_mode text, p_bets jsonb, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); t numeric; n bigint; cl jsonb; v_total bigint; v_prev bigint; v_game text; v_bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_mode not in ('classic', 'lightning', 'xxx') then raise exception 'invalid_mode'; end if;
  if p_ref is null or length(p_ref) > 80 then raise exception 'invalid_ref'; end if;
  if exists (select 1 from rl_live_bets where user_id = u and ref = p_ref) then
    return jsonb_build_object('ok', true, 'balance', (select balance from wallets where user_id = u));
  end if;
  t := rl_live_now(); n := floor(t / rl_live_cycle());
  if p_round <> n or t >= n * rl_live_cycle() + rl_live_window() then raise exception 'betting_closed'; end if;
  cl := rl_clean_bets(p_bets); v_total := (cl->>'total')::bigint;
  perform pg_advisory_xact_lock(hashtext('rll:' || u));
  select coalesce(sum(total), 0) into v_prev from rl_live_bets where round_no = n and user_id = u and mode = p_mode;
  if v_prev + v_total > 100000 then raise exception 'table_limit'; end if;
  perform rl_live_ensure(n);
  v_game := case p_mode when 'classic' then 'roulette' when 'lightning' then 'lightning_roulette' else 'xxx_roulette' end;
  v_bal := apply_tx(u, v_game, 'stake', -v_total, 'rllstake:' || u || ':' || p_ref);
  insert into rl_live_bets (round_no, user_id, mode, ref, bets, total) values (n, u, p_mode, p_ref, cl->'bets', v_total);
  return jsonb_build_object('ok', true, 'balance', v_bal);
end $$;

revoke all on function rl_live_cycle, rl_live_window, rl_live_now, rl_clean_bets, rl_live_ensure, rl_live_settle from public, anon, authenticated;
revoke all on function rl_live_state(text), rl_live_bet(bigint, text, jsonb, text) from public, anon;
grant execute on function rl_live_state(text), rl_live_bet(bigint, text, jsonb, text) to authenticated;
