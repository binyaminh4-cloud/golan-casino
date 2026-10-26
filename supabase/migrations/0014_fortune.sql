-- Golan Fortune: the friends' slot machine with two jackpots.
-- 3 reels x 3 rows, 5 lines. 32 physical stops per reel, weighted (virtual reel): the ZEUS stop weighs 3, the rest 4 (total 127).
-- Line pays (x line bet): BIN 400, FISHER 200, DIA 100, SEV 50, BAR 25, COIN 10, CH 5; cherries from the left 1 -> 1, 2 -> 3.
-- Exact base RTP by enumeration (sim/fortune.py): 93.20%.
-- GRAND (Zeus): progressive, seed 1,000,000, +1% of every spin. 3 ZEUS on the MIDDLE line (1 in ~75,900 spins).
--   Full jackpot at a line bet of 100 or more; a smaller line bet wins its share (line_bet/100), the rest stays in the pot.
-- MINI (Binyamin): 250,000, not progressive, MUST drop within 14 days: after each drop the server draws a secret
--   moment inside the next 14 days; the first spin after it wins (shown as 3 BIN on the middle line).

alter table sl_spins add column if not exists machine text not null default 'classic';
alter table sl_spins add column if not exists jackpot jsonb;

create table if not exists sl_jackpots (
  kind text primary key check (kind in ('grand', 'mini')),
  amount numeric not null,
  drop_at timestamptz,          -- mini only: the secret moment (never returned to clients)
  deadline timestamptz,         -- mini only: public "must drop by"
  last_winner uuid references profiles(id) on delete set null,
  last_amount bigint,
  last_at timestamptz
);
alter table sl_jackpots enable row level security;
revoke all on sl_jackpots from anon, authenticated;
insert into sl_jackpots (kind, amount) values ('grand', 1000000) on conflict do nothing;
insert into sl_jackpots (kind, amount, drop_at, deadline)
  values ('mini', 250000, now() + make_interval(secs => rl_randint(14 * 86400)), now() + interval '14 days') on conflict do nothing;

create or replace function fo_strip() returns text[] language sql immutable as $$
  select array['CH','COIN','BAR','SEV','DIA','FISHER','BIN','ZEUS','CH','COIN','BAR','SEV','DIA','FISHER','BIN','CH','COIN','BAR','SEV','DIA','CH','COIN','BAR','SEV','CH','COIN','BAR','CH','COIN','CH','COIN','CH'] $$;
create or replace function fo_pay3(sym text) returns int language sql immutable as $$
  select case sym when 'BIN' then 400 when 'FISHER' then 200 when 'DIA' then 100 when 'SEV' then 50
                  when 'BAR' then 25 when 'COIN' then 10 when 'CH' then 5 else 0 end $$;
create or replace function fo_line(a text, b text, c text) returns int language sql immutable as $$
  select case when a = b and b = c then fo_pay3(a)
              when a = 'CH' and b = 'CH' then 3
              when a = 'CH' then 1 else 0 end $$;

-- one reel stop from the weighted virtual reel
create or replace function fo_stop() returns int language plpgsql volatile as $$
declare r int := rl_randint(127); s text[] := fo_strip(); i int; acc int := 0;
begin
  for i in 1 .. 32 loop
    acc := acc + case when s[i] = 'ZEUS' then 3 else 4 end;
    if r < acc then return i - 1; end if;
  end loop;
  return 31;
end $$;

create or replace function fo_eval(p_stops int[]) returns jsonb language plpgsql immutable as $$
declare s text[] := fo_strip(); n int := 32; lines int[][] := array[[1,1,1],[0,0,0],[2,2,2],[0,1,2],[2,1,0]];
        c int; r int; i int; p int; tot int := 0; wins jsonb := '[]'; grid jsonb := '[]'; col jsonb;
begin
  for c in 1..3 loop
    col := '[]';
    for r in 0..2 loop col := col || to_jsonb(s[((p_stops[c] - 1 + r) % n + n) % n + 1]); end loop;
    grid := grid || jsonb_build_array(col);
  end loop;
  for i in 1..5 loop
    p := fo_line(grid->0->>lines[i][1], grid->1->>lines[i][2], grid->2->>lines[i][3]);
    if p > 0 then wins := wins || jsonb_build_object('line', i - 1, 'pay', p); tot := tot + p; end if;
  end loop;
  return jsonb_build_object('grid', grid, 'wins', wins, 'mult', tot,
    'zeus', grid->0->>1 = 'ZEUS' and grid->1->>1 = 'ZEUS' and grid->2->>1 = 'ZEUS');
end $$;

create or replace function fo_state() returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'grand', (select floor(amount)::bigint from sl_jackpots where kind = 'grand'),
    'mini', (select floor(amount)::bigint from sl_jackpots where kind = 'mini'),
    'mini_deadline', (select deadline from sl_jackpots where kind = 'mini'),
    'last', (select jsonb_agg(jsonb_build_object('kind', j.kind, 'name', p.nickname, 'amount', j.last_amount, 'at', j.last_at))
               from sl_jackpots j left join profiles p on p.id = j.last_winner where j.last_at is not null))
  where auth.uid() is not null $$;

create or replace function fo_spin(p_line_bet bigint, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s sl_spins; st int[]; ev jsonb; v_total bigint; v_pay bigint; v_bal bigint;
        g sl_jackpots; m sl_jackpots; jp jsonb := null; v_j bigint; nm text;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_ref is null or length(p_ref) > 80 then raise exception 'invalid_ref'; end if;
  select * into s from sl_spins where user_id = u and ref = p_ref;
  if found then
    return fo_eval(s.stops) || jsonb_build_object('id', s.id, 'stops', to_jsonb(s.stops), 'total', s.total, 'payout', s.payout,
      'jackpot', s.jackpot, 'balance', (select balance from wallets where user_id = u)) || fo_state();
  end if;
  if p_line_bet is null or p_line_bet < 1 or p_line_bet > 10000 then raise exception 'invalid_amount'; end if;
  v_total := p_line_bet * 5;
  perform apply_tx(u, 'fortune_slots', 'stake', -v_total, 'fostake:' || u || ':' || p_ref);
  select * into g from sl_jackpots where kind = 'grand' for update;
  select * into m from sl_jackpots where kind = 'mini' for update;
  update sl_jackpots set amount = amount + v_total * 0.01 where kind = 'grand';
  nm := (select nickname from profiles where id = u);

  if now() >= m.drop_at then
    -- the must-drop jackpot falls on this spin: 3 BIN on the middle line
    st := array[array_position(fo_strip(), 'BIN') - 1, array_position(fo_strip(), 'BIN') - 1, array_position(fo_strip(), 'BIN') - 1];
    ev := fo_eval(st);
    v_j := floor(m.amount)::bigint;
    jp := jsonb_build_object('kind', 'mini', 'amount', v_j);
    update sl_jackpots set drop_at = now() + make_interval(secs => 3600 + rl_randint(14 * 86400 - 3600)), deadline = now() + interval '14 days',
           last_winner = u, last_amount = v_j, last_at = now() where kind = 'mini';
    perform chat_sys('slots', '💼 ' || nm || ' זכה בג׳קפוט של בנימין: ₪' || to_char(v_j, 'FM999,999,999') || '!');
  else
    st := array[fo_stop(), fo_stop(), fo_stop()];
    ev := fo_eval(st);
    if (ev->>'zeus')::boolean then
      v_j := floor((g.amount + v_total * 0.01) * least(1.0, p_line_bet / 100.0))::bigint;
      jp := jsonb_build_object('kind', 'grand', 'amount', v_j, 'share', least(1.0, p_line_bet / 100.0));
      update sl_jackpots set amount = greatest(1000000, amount - v_j), last_winner = u, last_amount = v_j, last_at = now() where kind = 'grand';
      perform chat_sys('slots', '⚡👑 ' || nm || ' זכה בג׳קפוט של זאוס: ₪' || to_char(v_j, 'FM999,999,999') || '!');
    end if;
  end if;

  v_pay := (ev->>'mult')::bigint * p_line_bet + coalesce(v_j, 0);
  insert into sl_spins (user_id, ref, line_bet, total, stops, payout, wins, machine, jackpot)
    values (u, p_ref, p_line_bet, v_total, st, v_pay, ev->'wins', 'fortune', jp) returning * into s;
  if v_pay > 0 then v_bal := apply_tx(u, 'fortune_slots', 'payout', v_pay, 'fopay:' || s.id);
  else v_bal := (select balance from wallets where user_id = u); end if;
  return ev || jsonb_build_object('id', s.id, 'stops', to_jsonb(st), 'total', v_total, 'payout', v_pay, 'jackpot', jp, 'balance', v_bal) || fo_state();
end $$;

revoke all on function fo_strip, fo_pay3, fo_line, fo_stop, fo_eval from public, anon, authenticated;
revoke all on function fo_spin(bigint, text), fo_state() from public, anon;
grant execute on function fo_spin(bigint, text), fo_state() to authenticated;
