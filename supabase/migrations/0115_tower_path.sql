-- מגדל הכסף v2 (owner's update 5.11): one path through the tower. 8 floors × 6 rooms = 48 rooms in a row (room 1–6 left to right,
-- then up to floor 2 room 1 …). The tower is drawn at the start and shown BEFORE the first roll; each roll moves forward by the die.
-- Floors 1–6: guards 1,2,2,2,3,3; other rooms hold vaults worth 0.2/0.5/1/2/5 × the bet (stored ×100). A guard = round lost.
-- Floor 4 room 3 (room 21) is the exit gate: take the loot or carry on. Passing floor 6 enters the bonus floors 7–8 (5 guards each):
-- floor 7 = regular, floor 8 = super, passing it = crazy. A guard on a bonus floor just ends the climb. Then מלך המטווח at that level.
-- Shooting v2: 45 s, 12 shots, 36 targets of 6 kinds + golden birds, slower. Exact best-play return ≈ 97% for a skilled shooter.
alter table tw_runs add column if not exists pos int not null default 0;

-- rounds still open from 0114 (old rules) are refunded and closed
do $$ declare r tw_runs; begin
  for r in select * from tw_runs where status in ('active','choice','bonus','shoot') and cfg <> 'P' loop
    perform apply_tx(r.user_id, 'tower', 'refund', r.stake * (case when r.bought then (array[100,250,500])[r.bonus] else 1 end), 'twrefund:' || r.id);
    update tw_runs set status = 'cashed', paid = r.stake, finished_at = now() where id = r.id;
  end loop;
end $$;

create or replace function tw_vault() returns int language plpgsql volatile as $$
declare r int := rl_randint(100);
begin
  return case when r < 30 then 20 when r < 60 then 50 when r < 80 then 100 when r < 94 then 200 else 500 end;
end $$;

create or replace function tw_layout() returns jsonb language plpgsql volatile as $$
declare g int[] := array[1,2,2,2,3,3,5,5]; cells int[] := '{}'; f int; i int; j int; t int; idx int[];
begin
  for f in 1..8 loop
    idx := array[1,2,3,4,5,6];
    for i in reverse 6..2 loop j := rl_randint(i) + 1; t := idx[i]; idx[i] := idx[j]; idx[j] := t; end loop;
    for i in 1..6 loop cells := cells || 0; end loop;
    for i in 1..6 loop
      cells[(f - 1) * 6 + idx[i]] := case when i <= g[f] then -1 when f >= 7 then 0 else tw_vault() end;
    end loop;
  end loop;
  if cells[21] = -1 then   -- the exit gate is always safe: move that guard to another room on floor 4
    for i in 19..24 loop if i <> 21 and cells[i] <> -1 then cells[i] := -1; exit; end if; end loop;
  end if;
  cells[21] := 0;
  return to_jsonb(cells);
end $$;

create or replace function tw_view(r tw_runs) returns jsonb language sql stable as $$
  select jsonb_build_object('id', r.id, 'stake', r.stake, 'layout', r.layout, 'pos', r.pos, 'loot', r.loot, 'bonus', r.bonus,
    'rolls', r.rolls, 'shoot', r.shoot, 'hits', r.hits, 'bought', r.bought, 'status', r.status, 'paid', r.paid,
    'balance', (select balance from wallets where user_id = r.user_id)) $$;

-- loot is in hundredths of the bet; the shooting result (if any) is already in r.paid
create or replace function tw_pay(r tw_runs, p_status text) returns tw_runs language plpgsql volatile as $$
begin
  r.paid := floor(r.stake * r.loot / 100.0)::bigint + coalesce(r.paid, 0); r.status := p_status; r.finished_at := now();
  update tw_runs set paid = r.paid, status = r.status, finished_at = r.finished_at, bonus = r.bonus, pos = r.pos, rolls = r.rolls where id = r.id;
  if r.paid > 0 then perform apply_tx(r.user_id, 'tower', 'payout', r.paid, 'twpay:' || r.id); end if;
  if r.paid >= r.stake * 200 and r.paid >= 20000 then
    perform chat_sys('lobby', '🏰 ' || (select nickname from profiles where id = r.user_id) || ' טיפס במגדל הכסף ולקח ₪' || to_char(r.paid, 'FM999,999,999,999,999,999') || '!'); end if;
  return r;
end $$;

create or replace function tw_advance(r tw_runs) returns tw_runs language plpgsql volatile as $$
declare d int := rl_randint(6) + 1; frm int := r.pos; cell int;
begin
  r.pos := r.pos + d;
  cell := case when r.pos <= 48 then (r.layout ->> (r.pos - 1))::int else 0 end;
  r.rolls := r.rolls || jsonb_build_array(jsonb_build_object('die', d, 'from', frm, 'to', r.pos, 'cell', cell));
  if r.pos > 36 then   -- bonus floors
    r.status := 'bonus';
    if r.pos > 48 then r.bonus := 3; r.pos := 49; return tw_begin_shoot(r); end if;
    r.bonus := case when r.pos <= 42 then 1 else 2 end;
    if cell = -1 then return tw_begin_shoot(r); end if;
  elsif cell = -1 then r.status := 'lost'; r.finished_at := now();
  elsif r.pos = 21 then r.status := 'choice';
  else r.loot := r.loot + cell;
  end if;
  update tw_runs set pos = r.pos, loot = r.loot, bonus = r.bonus, rolls = r.rolls, status = r.status, finished_at = r.finished_at where id = r.id;
  return r;
end $$;

create or replace function tw_begin_shoot(r tw_runs) returns tw_runs language plpgsql volatile as $$
begin
  r.status := 'shoot'; r.shoot := tw_make_range(r.bonus);
  update tw_runs set status = r.status, shoot = r.shoot, bonus = r.bonus, pos = r.pos, loot = r.loot, rolls = r.rolls where id = r.id;
  return r;
end $$;

-- start = charge the bet and draw the tower. No roll: the player sees the whole floor first, then presses המר.
create or replace function tw_start(p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r tw_runs;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into r from tw_runs where ref = p_ref and user_id = u; if found then return tw_view(r); end if;
  if exists (select 1 from tw_runs where user_id = u and status in ('active','choice','bonus','shoot')) then raise exception 'run_in_progress'; end if;
  if p_stake is null or p_stake < 10 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'tower', 'stake', -p_stake, 'twstake:' || p_ref);
  insert into tw_runs (user_id, ref, stake, cfg, layout) values (u, p_ref, p_stake, 'P', tw_layout()) returning * into r;
  return tw_view(r);
end $$;

create or replace function tw_choose(p_run uuid, p_go boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r tw_runs;
begin
  select * into r from tw_runs where id = p_run and user_id = u for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.status <> 'choice' then return tw_view(r); end if;
  if p_go then update tw_runs set status = 'active' where id = r.id returning * into r;
  else r := tw_pay(r, 'cashed'); end if;
  return tw_view(r);
end $$;

-- shooting v2: 36 targets over 45 s, slower, 6 kinds; values ×100 of the bet per level
create or replace function tw_make_range(lvl int) returns jsonb language plpgsql volatile as $$
declare t jsonb := '[]'; i int; k int; vx float8; nb int; t0 int; vals int[]; drops int[]; j int; cands int[]; o jsonb;
  kinds text[] := array['can','bottle','bal','plate','dia','gold']; w int[] := array[30,22,18,14,10,6];
begin
  vals := case lvl when 1 then array[27,54,108,161,672,1614] when 2 then array[31,61,122,184,765,1836] else array[52,104,207,311,1295,3108] end;
  drops := case lvl when 1 then array[378,236,114,118,118,36] when 2 then array[406,241,116,124,90,23] else array[411,239,115,129,82,24] end;
  for i in 0..35 loop
    k := tw_pick(w, array[1,2,3,4,5,6]);
    vx := 160 + rl_randint(120); if rl_randint(2) = 0 then vx := -vx; end if;
    t := t || jsonb_build_object('k', kinds[k], 'v', vals[k], 't0', (i * 39000 / 36) + rl_randint(500),
      'x0', case when vx > 0 then -80 else 1680 end, 'vx', vx,
      'y0', case when kinds[k] in ('bal') then 200 + rl_randint(250) else 420 + rl_randint(300) end,
      'amp', case when kinds[k] = 'bal' then 30 + rl_randint(40) else 0 end,
      'w', 1 + rl_randint(100) / 100.0, 'ph', rl_randint(628) / 100.0, 'life', round((1760 / abs(vx))::numeric, 3));
  end loop;
  nb := case lvl when 1 then tw_pick(array[50,35,15], array[0,1,2]) when 2 then tw_pick(array[40,40,20], array[3,4,5]) else tw_pick(array[45,35,20], array[5,6,7]) end;
  for i in 1..nb loop
    t0 := 3000 + rl_randint(34000); vx := 300 + rl_randint(120); if rl_randint(2) = 0 then vx := -vx; end if;
    cands := '{}';
    for j in 0..35 loop if (t -> j ->> 't0')::int > t0 + 500 and coalesce(array_length(cands, 1), 0) < 3 then cands := cands || j; end if; end loop;
    o := jsonb_build_object('k', 'bird', 'v', 0, 't0', t0, 'x0', case when vx > 0 then -80 else 1680 end, 'vx', vx, 'y0', 120 + rl_randint(160),
      'amp', 40, 'w', 2.5, 'ph', 0, 'life', round((1760 / abs(vx))::numeric, 3), 'm', tw_pick(drops, array[2,5,10,50,100,1000]),
      'on', case when coalesce(array_length(cands, 1), 0) = 0 then -1 else cands[rl_randint(array_length(cands, 1)) + 1] end);
    t := t || o;
  end loop;
  return jsonb_build_object('lvl', lvl, 'targets', t, 'shots', 12, 'secs', 45);
end $$;

create or replace function tw_score(p_range jsonb, p_shots jsonb, out total bigint, out hits jsonb) language plpgsql immutable as $$
declare tg jsonb := p_range -> 'targets'; n int := jsonb_array_length(p_range -> 'targets'); i int; j int; sx float8; sy float8; st int; last int := -1000;
  hit boolean[]; mult int[]; best int; bd float8; d float8; s float8; px float8; py float8; rad float8; o jsonb; v bigint; ns int;
begin
  total := 0; hits := '[]'; hit := array_fill(false, array[n]); mult := array_fill(1, array[n]);
  ns := coalesce((p_range ->> 'shots')::int, 10);
  if jsonb_typeof(p_shots) <> 'array' then return; end if;
  for i in 0..least(jsonb_array_length(p_shots), ns) - 1 loop
    sx := (p_shots -> i ->> 0)::float8; sy := (p_shots -> i ->> 1)::float8; st := (p_shots -> i ->> 2)::int;
    if st is null or st < last + 300 or st > coalesce((p_range ->> 'secs')::int, 30) * 1000 + 1000 then continue; end if;
    last := st; best := -1; bd := 1e9;
    for j in 0..n - 1 loop
      if hit[j + 1] then continue; end if;
      o := tg -> j; s := (st - (o ->> 't0')::int) / 1000.0;
      if s < 0 or s > (o ->> 'life')::float8 then continue; end if;
      px := (o ->> 'x0')::float8 + (o ->> 'vx')::float8 * s; py := (o ->> 'y0')::float8 + (o ->> 'amp')::float8 * sin((o ->> 'w')::float8 * s + (o ->> 'ph')::float8);
      rad := case o ->> 'k' when 'can' then 46 when 'bottle' then 40 when 'bal' then 54 when 'plate' then 58 when 'dia' then 44 when 'gold' then 44 else 56 end;
      d := sqrt((px - sx) ^ 2 + (py - sy) ^ 2);
      if d <= rad and d < bd then bd := d; best := j; end if;
    end loop;
    if best >= 0 then
      hit[best + 1] := true; o := tg -> best;
      if o ->> 'k' = 'bird' then
        if (o ->> 'on')::int >= 0 then mult[(o ->> 'on')::int + 1] := (o ->> 'm')::int; end if;
        hits := hits || jsonb_build_object('i', i, 'j', best, 'v', 0);
      else
        v := (o ->> 'v')::bigint * mult[best + 1]; total := total + v;
        hits := hits || jsonb_build_object('i', i, 'j', best, 'v', v, 'm', mult[best + 1]);
      end if;
    end if;
  end loop;
  total := least(total, 500000);
end $$;

-- buy: start right at the shooting range
create or replace function tw_buy(p_level int, p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r tw_runs; price bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into r from tw_runs where ref = p_ref and user_id = u; if found then return tw_view(r); end if;
  if p_level not in (1, 2, 3) then raise exception 'invalid_level'; end if;
  if exists (select 1 from tw_runs where user_id = u and status in ('active','choice','bonus','shoot')) then raise exception 'run_in_progress'; end if;
  if p_stake is null or p_stake < 10 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  price := p_stake * (array[100, 250, 500])[p_level];
  perform apply_tx(u, 'tower', 'stake', -price, 'twbuy:' || p_ref);
  insert into tw_runs (user_id, ref, stake, cfg, layout, bonus, bought, status) values (u, p_ref, p_stake, 'P', '[]', p_level, true, 'active') returning * into r;
  r := tw_begin_shoot(r);
  return tw_view(r);
end $$;

revoke all on function tw_layout() from public, anon, authenticated;
revoke all on function tw_vault(), tw_view(tw_runs), tw_pay(tw_runs, text), tw_advance(tw_runs), tw_begin_shoot(tw_runs), tw_make_range(int), tw_score(jsonb, jsonb) from public, anon, authenticated;
revoke all on function tw_start(bigint, text), tw_roll(uuid, int), tw_choose(uuid, boolean), tw_shoot(uuid, jsonb), tw_buy(int, bigint, text), tw_current() from public, anon;
grant execute on function tw_start(bigint, text), tw_roll(uuid, int), tw_choose(uuid, boolean), tw_shoot(uuid, jsonb), tw_buy(int, bigint, text), tw_current() to authenticated;
