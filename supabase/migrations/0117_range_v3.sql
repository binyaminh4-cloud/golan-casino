-- מלך המטווח v3 (owner approved 5.11): tap to shoot, 40 s, 6-round magazine (1.5 s reload), one shot per 0.6 s at most,
-- 60 targets + a final 10-second wave of gold bars, golden birds as before. Aim assist: hit radius +40 px.
-- Streak: 3 hits in a row = ×2, 6 in a row = ×3; a miss resets it. Guaranteed minimum ×20 the bet, ceiling ×5000.
-- Calibrated so a strong shooter gets back ≈ 97% of the buy price and a regular player ≈ 60% (+ the minimum).
create or replace function tw_make_range(lvl int) returns jsonb language plpgsql volatile as $$
declare t jsonb := '[]'; i int; k int; vx float8; nb int; t0 int; vals int[]; drops int[]; j int; cands int[]; o jsonb;
  kinds text[] := array['can','bottle','bal','plate','dia','gold']; w int[] := array[30,22,18,14,10,6];
begin
  vals := case lvl when 1 then array[6,11,17,22,56,112] when 2 then array[10,21,31,41,103,205] else array[17,35,52,70,174,348] end;
  drops := case lvl when 1 then array[378,236,114,118,118,36] when 2 then array[406,241,116,124,90,23] else array[411,239,115,129,82,24] end;
  for i in 0..69 loop
    k := case when i >= 60 then 6 else tw_pick(w, array[1,2,3,4,5,6]) end;
    vx := 170 + rl_randint(90); if rl_randint(2) = 0 then vx := -vx; end if;
    t := t || jsonb_build_object('k', kinds[k], 'v', vals[k],
      't0', case when i >= 60 then 30000 + (i - 60) * 900 else i * 28000 / 60 + rl_randint(300) end,
      'x0', case when vx > 0 then -80 else 1680 end, 'vx', vx,
      'y0', case when kinds[k] = 'bal' then 200 + rl_randint(220) else 430 + rl_randint(220) end,
      'amp', case when kinds[k] = 'bal' then 30 + rl_randint(40) else 0 end,
      'w', 1 + rl_randint(100) / 100.0, 'ph', rl_randint(628) / 100.0, 'life', round((1760 / abs(vx))::numeric, 3));
  end loop;
  nb := case lvl when 1 then tw_pick(array[50,35,15], array[1,2,3]) when 2 then tw_pick(array[40,40,20], array[3,4,5]) else tw_pick(array[45,35,20], array[5,6,7]) end;
  for i in 1..nb loop
    t0 := 3000 + rl_randint(23000); vx := 330 + rl_randint(80); if rl_randint(2) = 0 then vx := -vx; end if;
    cands := '{}';
    for j in 0..59 loop if (t -> j ->> 't0')::int > t0 + 500 and coalesce(array_length(cands, 1), 0) < 3 then cands := cands || j; end if; end loop;
    o := jsonb_build_object('k', 'bird', 'v', 0, 't0', t0, 'x0', case when vx > 0 then -80 else 1680 end, 'vx', vx, 'y0', 120 + rl_randint(140),
      'amp', 40, 'w', 2.5, 'ph', 0, 'life', round((1760 / abs(vx))::numeric, 3), 'm', tw_pick(drops, array[2,5,10,50,100,1000]),
      'on', case when coalesce(array_length(cands, 1), 0) = 0 then -1 else cands[rl_randint(array_length(cands, 1)) + 1] end);
    t := t || o;
  end loop;
  return jsonb_build_object('lvl', lvl, 'targets', t, 'v', 3, 'secs', 40, 'mag', 6, 'min', 2000);
end $$;

create or replace function tw_score(p_range jsonb, p_shots jsonb, out total bigint, out hits jsonb) language plpgsql immutable as $$
declare tg jsonb := p_range -> 'targets'; n int := jsonb_array_length(p_range -> 'targets'); i int; j int; sx float8; sy float8; st int; last int := -100000;
  hit boolean[]; mult int[]; best int; bd float8; d float8; s float8; px float8; py float8; rad float8; o jsonb; v bigint;
  v3 boolean := coalesce((p_range ->> 'v')::int, 1) >= 3; secs int := coalesce((p_range ->> 'secs')::int, 30); ns int; fired int := 0; streak int := 0; c int;
begin
  total := 0; hits := '[]'; hit := array_fill(false, array[n]); mult := array_fill(1, array[n]);
  ns := case when v3 then 120 else coalesce((p_range ->> 'shots')::int, 10) end;
  if jsonb_typeof(p_shots) <> 'array' then if v3 then total := 2000; end if; return; end if;
  for i in 0..least(jsonb_array_length(p_shots), ns) - 1 loop
    sx := (p_shots -> i ->> 0)::float8; sy := (p_shots -> i ->> 1)::float8; st := (p_shots -> i ->> 2)::int;
    if st is null or st > secs * 1000 + 1000 then continue; end if;
    if v3 then   -- fire rate and magazine
      if st < last + (case when fired > 0 and fired % 6 = 0 then 1500 else 600 end) then continue; end if;
    elsif st < last + 300 then continue; end if;
    last := st; fired := fired + 1; best := -1; bd := 1e9;
    for j in 0..n - 1 loop
      if hit[j + 1] then continue; end if;
      o := tg -> j; s := (st - (o ->> 't0')::int) / 1000.0;
      if s < 0 or s > (o ->> 'life')::float8 then continue; end if;
      px := (o ->> 'x0')::float8 + (o ->> 'vx')::float8 * s; py := (o ->> 'y0')::float8 + (o ->> 'amp')::float8 * sin((o ->> 'w')::float8 * s + (o ->> 'ph')::float8);
      rad := case o ->> 'k' when 'can' then 46 when 'bottle' then 40 when 'bal' then 54 when 'plate' then 58 when 'dia' then 44 when 'gold' then 44 else 56 end
             + case when v3 then 40 else 0 end;
      d := sqrt((px - sx) ^ 2 + (py - sy) ^ 2);
      if d <= rad and d < bd then bd := d; best := j; end if;
    end loop;
    if best < 0 then streak := 0; continue; end if;
    hit[best + 1] := true; o := tg -> best; streak := streak + 1;
    c := case when not v3 then 1 when streak >= 6 then 3 when streak >= 3 then 2 else 1 end;
    if o ->> 'k' = 'bird' then
      if (o ->> 'on')::int >= 0 then mult[(o ->> 'on')::int + 1] := (o ->> 'm')::int; end if;
      hits := hits || jsonb_build_object('i', i, 'j', best, 'v', 0, 'c', c);
    else
      v := (o ->> 'v')::bigint * mult[best + 1] * c; total := total + v;
      hits := hits || jsonb_build_object('i', i, 'j', best, 'v', v, 'm', mult[best + 1], 'c', c);
    end if;
  end loop;
  total := least(greatest(total, case when v3 then 2000 else 0 end), 500000);
end $$;

revoke all on function tw_make_range(int), tw_score(jsonb, jsonb) from public, anon, authenticated;
