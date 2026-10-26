-- Golan Fortune v2: FREE scatter (a FREE anywhere on each reel = 10 free spins at the same bet, can retrigger, ~1 in 96 spins);
-- strip and pays rebalanced (sim/fortune2.py): base 85.31%, with free spins 95.18%, plus the two jackpots.
-- Also: trainee dealer job timing 15s / 30s / 35s.

create table if not exists sl_free (user_id uuid primary key references profiles(id) on delete cascade, left_spins int not null default 0, bet bigint not null default 1);
alter table sl_free enable row level security;
revoke all on sl_free from anon, authenticated;

create or replace function fo_strip() returns text[] language sql immutable as $$
  select array['CH','COIN','BAR','SEV','DIA','FISHER','BIN','ZEUS','FREE','CH','COIN','BAR','SEV','DIA','FISHER','BIN','FREE','CH','COIN','BAR','SEV','DIA','CH','COIN','BAR','SEV','CH','COIN','BAR','CH','COIN','CH'] $$;
create or replace function fo_pay3(sym text) returns int language sql immutable as $$
  select case sym when 'BIN' then 400 when 'FISHER' then 200 when 'DIA' then 100 when 'SEV' then 50
                  when 'BAR' then 30 when 'COIN' then 12 when 'CH' then 6 else 0 end $$;
create or replace function fo_free_left() returns int language sql stable security definer set search_path = public as $$
  select coalesce((select left_spins from sl_free where user_id = auth.uid()), 0) $$;
create or replace function job_secs(p_game text, p_level int) returns int language sql immutable as $$
  select case p_game when 'dealer' then (array[15, 30, 35])[p_level] else (array[45, 45, 40])[p_level] end $$;

create or replace function fo_stop() returns int language plpgsql volatile as $$
declare r int := rl_randint(133); s text[] := fo_strip(); i int; acc int := 0;
begin
  for i in 1 .. 32 loop
    acc := acc + case s[i] when 'ZEUS' then 3 when 'FREE' then 7 else 4 end;
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
    'zeus', grid->0->>1 = 'ZEUS' and grid->1->>1 = 'ZEUS' and grid->2->>1 = 'ZEUS',
    'free', (grid->0) ? 'FREE' and (grid->1) ? 'FREE' and (grid->2) ? 'FREE');
end $$;

create or replace function fo_spin(p_line_bet bigint, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s sl_spins; st int[]; ev jsonb; v_total bigint; v_pay bigint; v_bal bigint;
        g sl_jackpots; m sl_jackpots; fr sl_free; v_free boolean := false; v_bet bigint; jp jsonb := null; v_j bigint; nm text;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_ref is null or length(p_ref) > 80 then raise exception 'invalid_ref'; end if;
  select * into s from sl_spins where user_id = u and ref = p_ref;
  if found then
    return fo_eval(s.stops) || jsonb_build_object('id', s.id, 'stops', to_jsonb(s.stops), 'total', s.total, 'payout', s.payout,
      'jackpot', s.jackpot, 'balance', (select balance from wallets where user_id = u)) || fo_state();
  end if;
  select * into fr from sl_free where user_id = u for update;
  if found and fr.left_spins > 0 then                      -- a free spin: same bet as the spin that won it, nothing charged
    v_free := true; p_line_bet := fr.bet; v_total := 0;
    update sl_free set left_spins = left_spins - 1 where user_id = u;
  else
    if p_line_bet is null or p_line_bet < 1 or p_line_bet > 10000 then raise exception 'invalid_amount'; end if;
    v_total := p_line_bet * 5;
    perform apply_tx(u, 'fortune_slots', 'stake', -v_total, 'fostake:' || u || ':' || p_ref);
  end if;
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

  if (ev->>'free')::boolean then
    insert into sl_free (user_id, left_spins, bet) values (u, 10, p_line_bet)
      on conflict (user_id) do update set left_spins = sl_free.left_spins + 10, bet = excluded.bet;
  end if;
  v_pay := (ev->>'mult')::bigint * p_line_bet + coalesce(v_j, 0);
  insert into sl_spins (user_id, ref, line_bet, total, stops, payout, wins, machine, jackpot)
    values (u, p_ref, p_line_bet, v_total, st, v_pay, ev->'wins', 'fortune', jp) returning * into s;
  if v_pay > 0 then v_bal := apply_tx(u, 'fortune_slots', 'payout', v_pay, 'fopay:' || s.id);
  else v_bal := (select balance from wallets where user_id = u); end if;
  return ev || jsonb_build_object('id', s.id, 'stops', to_jsonb(st), 'total', v_total, 'payout', v_pay, 'jackpot', jp, 'balance', v_bal,
    'free_spin', v_free, 'free_left', coalesce((select left_spins from sl_free where user_id = u), 0), 'bet', p_line_bet * 5) || fo_state();
end $$;

revoke all on function fo_strip, fo_pay3, fo_stop, fo_eval, job_secs from public, anon, authenticated;
grant execute on function fo_free_left() to authenticated;
