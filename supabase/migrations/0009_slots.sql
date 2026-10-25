-- Golan Casino slots ("מכונות מזל"): 3 reels x 3 rows, 5 fixed lines (middle, top, bottom, two diagonals).
-- Same 32-stop strip on every reel; the server picks the stops. Pays per line (x line bet):
-- 3x DIA 1000, SEV 300, BAR 100, BE 50, GR 30, OR 25, LE 20, CH 15; cherries from the left: 1 -> 1, 2 -> 3.
-- Exact RTP by full enumeration (sim/slots.py): 96.24%, house edge 3.76%.

create table if not exists sl_spins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  ref text not null, line_bet bigint not null, total bigint not null,
  stops int[] not null, payout bigint not null, wins jsonb not null default '[]',
  created_at timestamptz not null default now(), unique (user_id, ref));
alter table sl_spins enable row level security;
create policy own_slots on sl_spins for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on sl_spins from anon, authenticated;

create or replace function sl_strip() returns text[] language sql immutable as $$ select array['CH','LE','OR','GR','BE','BAR','SEV','DIA','CH','LE','OR','GR','BE','BAR','SEV','CH','LE','OR','GR','BE','BAR','CH','LE','OR','GR','BE','CH','LE','OR','GR','CH','LE'] $$;
create or replace function sl_pay3(sym text) returns int language sql immutable as $$
  select case sym when 'DIA' then 1000 when 'SEV' then 300 when 'BAR' then 100 when 'BE' then 50
                  when 'GR' then 30 when 'OR' then 25 when 'LE' then 20 when 'CH' then 15 else 0 end $$;
create or replace function sl_line(a text, b text, c text) returns int language sql immutable as $$
  select case when a = b and b = c then sl_pay3(a)
              when a = 'CH' and b = 'CH' then 3
              when a = 'CH' then 1 else 0 end $$;

-- grid[col][row] for stops (row 0 = top). Returns {"grid":[[..],[..],[..]], "wins":[{"line":i,"pay":x}], "mult": total multiple}
create or replace function sl_eval(p_stops int[]) returns jsonb language plpgsql immutable as $$
declare s text[] := sl_strip(); n int := array_length(s, 1); g text[][] := '{}'; lines int[][] := array[[1,1,1],[0,0,0],[2,2,2],[0,1,2],[2,1,0]];
        c int; r int; i int; p int; tot int := 0; wins jsonb := '[]'; grid jsonb := '[]'; col jsonb;
begin
  for c in 1..3 loop
    col := '[]';
    for r in 0..2 loop col := col || to_jsonb(s[((p_stops[c] - 1 + r) % n + n) % n + 1]); end loop;
    grid := grid || jsonb_build_array(col);
  end loop;
  for i in 1..5 loop
    p := sl_line(grid->0->>lines[i][1], grid->1->>lines[i][2], grid->2->>lines[i][3]);
    if p > 0 then wins := wins || jsonb_build_object('line', i - 1, 'pay', p); tot := tot + p; end if;
  end loop;
  return jsonb_build_object('grid', grid, 'wins', wins, 'mult', tot);
end $$;

create or replace function sl_spin(p_line_bet bigint, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s sl_spins; st int[]; ev jsonb; v_total bigint; v_pay bigint; v_bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_ref is null or length(p_ref) > 80 then raise exception 'invalid_ref'; end if;
  select * into s from sl_spins where user_id = u and ref = p_ref;
  if found then
    return sl_eval(s.stops) || jsonb_build_object('id', s.id, 'stops', to_jsonb(s.stops), 'total', s.total, 'payout', s.payout,
      'balance', (select balance from wallets where user_id = u));
  end if;
  if p_line_bet is null or p_line_bet < 1 or p_line_bet > 10000 then raise exception 'invalid_amount'; end if;
  v_total := p_line_bet * 5;
  perform apply_tx(u, 'slots', 'stake', -v_total, 'slstake:' || u || ':' || p_ref);
  st := array[rl_randint(32), rl_randint(32), rl_randint(32)];
  ev := sl_eval(st);
  v_pay := (ev->>'mult')::bigint * p_line_bet;
  insert into sl_spins (user_id, ref, line_bet, total, stops, payout, wins) values (u, p_ref, p_line_bet, v_total, st, v_pay, ev->'wins') returning * into s;
  if v_pay > 0 then v_bal := apply_tx(u, 'slots', 'payout', v_pay, 'slpay:' || s.id);
  else v_bal := (select balance from wallets where user_id = u); end if;
  return ev || jsonb_build_object('id', s.id, 'stops', to_jsonb(st), 'total', v_total, 'payout', v_pay, 'balance', v_bal);
end $$;

revoke all on function sl_strip, sl_pay3, sl_line, sl_eval from public, anon, authenticated;
revoke all on function sl_spin(bigint, text) from public, anon;
grant execute on function sl_spin(bigint, text) to authenticated;
