-- Replace the 0088 x4 boost with exactly 7/4 of the pre-0088 bonus probability.
-- Latest spin implementations: 0092. Keep wallet limits, payouts, buys and jackpots.
-- For a baseline event p, adding a conditional bonus with q=(3/4)*p/(1-p)
-- gives p+(1-p)*q=(7/4)*p, and preserves the relative bonus/super distribution.
-- No money reset is performed by this migration.
begin;
-- Refuse to overwrite an independently changed production function or seed catalog.
do $guard$
begin
  if not exists(select 1 from pg_proc where oid=to_regprocedure('public.dg_spin(bigint,text)') and md5(replace(prosrc,chr(13),'')) in ('2b05d2c1d899231794241b1d64597a53','d11cc108980d6309503f355362aa21f3')) then raise exception 'Unexpected installed dg_spin; stop and review the server definition'; end if;
  if not exists(select 1 from pg_proc where oid=to_regprocedure('public.kin_spin(bigint,text)') and md5(replace(prosrc,chr(13),'')) in ('4e45bf8e851cc2a1e229ad41e3eb11b2','bea08e8c8dac109242bdefe76617cf11')) then raise exception 'Unexpected installed kin_spin; stop and review the server definition'; end if;
  if not exists(select 1 from pg_proc where oid=to_regprocedure('public.ww_spin(bigint,text)') and md5(replace(prosrc,chr(13),'')) in ('2d6308a2c58c7a04fe723eeca0cf2031','731f85be64b9de7db95cbee763cc4b31')) then raise exception 'Unexpected installed ww_spin; stop and review the server definition'; end if;
  if not exists(select 1 from pg_proc where oid=to_regprocedure('public.pc_spin(bigint,text)') and md5(replace(prosrc,chr(13),'')) in ('75c3acc3cf4df9497cb31d2cd279ea04','8a044058a9f8e15f87cc89db1d17f4c6')) then raise exception 'Unexpected installed pc_spin; stop and review the server definition'; end if;
  if not exists(select 1 from pg_proc where oid=to_regprocedure('public.fo_spin(bigint,text)') and md5(replace(prosrc,chr(13),'')) in ('b923882d519e45cb1257a87260ef1edb','0dcede68a370940666a9d54b4e88ee44')) then raise exception 'Unexpected installed fo_spin; stop and review the server definition'; end if;
  if (select count(*) from dg_seeds)<>30000 or (select count(*) from dg_seeds where bonus)<>189
    or (select count(*) from kin_seeds)<>30000 or (select count(*) from kin_seeds where bonus)<>467
    or (select count(*) from ww_seeds)<>30000 or (select count(*) from ww_seeds where bonus)<>156
    then raise exception 'Unexpected seed catalog; stop and review'; end if;
end $guard$;

create or replace function dg_spin(p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); old dg_spins; k dg_seeds; n int; b int; pick int; pay bigint; bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into old from dg_spins where user_id = u and ref = p_ref;
  if found then return jsonb_build_object('seed', old.seed, 'total', old.total, 'payout', old.payout, 'stake', old.stake, 'balance', (select balance from wallets where user_id = u)); end if;
  if p_stake is null or p_stake < 25 or p_stake > (select greatest(0, balance) from wallets where user_id = u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'dragons', 'stake', -p_stake, 'dgstake:' || u || ':' || p_ref);
  select count(*), count(*) filter (where bonus) into n, b from dg_seeds;
  if n = 0 or b = 0 or 1.75 * b >= n then raise exception 'invalid_bonus_catalog'; end if;
  if random() < 0.75 * b / (n - b) then -- exact 1.75 times the original b/n
    select * into k from dg_seeds where bonus order by random() limit 1;
  else
    pick := rl_randint(n); select * into k from dg_seeds where id = pick;
  end if;
  pay := floor(p_stake * k.total * 1.022)::bigint;
  insert into dg_spins (user_id, ref, stake, seed, total, payout) values (u, p_ref, p_stake, k.seed, k.total, pay);
  if pay > 0 then bal := apply_tx(u, 'dragons', 'payout', pay, 'dgpay:' || u || ':' || p_ref); else bal := (select balance from wallets where user_id = u); end if;
  if k.total >= 200 then perform chat_sys('lobby', '🐉 ' || (select nickname from profiles where id = u) || ' זכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') || ' בדרקוני הגולן!'); end if;
  return jsonb_build_object('seed', k.seed, 'total', k.total, 'payout', pay, 'stake', p_stake, 'balance', bal);
end $$;

create or replace function kin_spin(p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); old kin_spins; k kin_seeds; n int; b int; pick int; pay bigint; bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into old from kin_spins where user_id = u and ref = p_ref;
  if found then return jsonb_build_object('seed', old.seed, 'total', old.total, 'payout', old.payout, 'stake', old.stake, 'balance', (select balance from wallets where user_id = u)); end if;
  if p_stake is null or p_stake < 5 or p_stake > (select greatest(0, balance) from wallets where user_id = u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'kinneret', 'stake', -p_stake, 'kinstake:' || u || ':' || p_ref);
  select count(*), count(*) filter (where bonus) into n, b from kin_seeds;
  if n = 0 or b = 0 or 1.75 * b >= n then raise exception 'invalid_bonus_catalog'; end if;
  if random() < 0.75 * b / (n - b) then -- exact 1.75 times the original b/n
    select * into k from kin_seeds where bonus order by random() limit 1;
  else
    pick := rl_randint(n); select * into k from kin_seeds where id = pick;
  end if;
  pay := floor(p_stake * k.total * 1.05)::bigint;
  insert into kin_spins (user_id, ref, stake, seed, total, payout) values (u, p_ref, p_stake, k.seed, k.total, pay);
  if pay > 0 then bal := apply_tx(u, 'kinneret', 'payout', pay, 'kinpay:' || u || ':' || p_ref); else bal := (select balance from wallets where user_id = u); end if;
  if k.total >= 200 then perform chat_sys('lobby', '🔥 ' || (select nickname from profiles where id = u) || ' זכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') || ' על האש בכינרת!'); end if;
  return jsonb_build_object('seed', k.seed, 'total', k.total, 'payout', pay, 'stake', p_stake, 'balance', bal);
end $$;

create or replace function ww_spin(p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); old ww_spins; k ww_seeds; n int; b int; pick int; pay bigint; bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into old from ww_spins where user_id = u and ref = p_ref;
  if found then return jsonb_build_object('seed', old.seed, 'total', old.total, 'payout', old.payout, 'stake', old.stake, 'balance', (select balance from wallets where user_id = u)); end if;
  if p_stake is null or p_stake < 5 or p_stake > (select greatest(0, balance) from wallets where user_id = u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'wild_west', 'stake', -p_stake, 'wwstake:' || u || ':' || p_ref);
  select count(*), count(*) filter (where bonus) into n, b from ww_seeds;
  if n = 0 or b = 0 or 1.75 * b >= n then raise exception 'invalid_bonus_catalog'; end if;
  if random() < 0.75 * b / (n - b) then -- exact 1.75 times the original b/n
    select * into k from ww_seeds where bonus order by random() limit 1;
  else
    pick := rl_randint(n); select * into k from ww_seeds where id = pick;
  end if;
  pay := floor(p_stake * k.total * 1.035)::bigint;
  insert into ww_spins (user_id, ref, stake, seed, total, payout) values (u, p_ref, p_stake, k.seed, k.total, pay);
  if pay > 0 then bal := apply_tx(u, 'wild_west', 'payout', pay, 'wwpay:' || u || ':' || p_ref); else bal := (select balance from wallets where user_id = u); end if;
  if k.total >= 200 then perform chat_sys('lobby', '🤠 ' || (select nickname from profiles where id = u) || ' זכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') || ' במערב הפרוע!'); end if;
  return jsonb_build_object('seed', k.seed, 'total', k.total, 'payout', pay, 'stake', p_stake, 'balance', bal);
end $$;

create or replace function pc_spin(p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); old pc_spins; g int[] := array_fill(0, array[15]); badges jsonb := '{}'; bsum int := 0; nb int := 0; t int := 0;
  c int; r int; s int; k int; L int[]; lines int[][] := array[[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],[0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[1,0,1,2,1]];
  pays int[][] := array[[4,10,30],[6,16,50],[8,24,80],[12,40,150],[20,80,300],[40,200,1000]];
  wins jsonb := '[]'; linesum bigint := 0; bonus jsonb := null; entry int; scale bigint; total bigint := 0; i int; tg jsonb := '[]'; pay bigint; res jsonb; bal bigint;
  force_bonus boolean := false;
  -- P(Binomial(5, 0.12) >= 3) from the original 0052 implementation.
  base_bonus numeric := 0.0143188992;
  RV int[] := array[5,100,10,0,20,50,15,25]; SV int[] := array[5,100,10,20,50,15,25];
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into old from pc_spins where user_id = u and ref = p_ref;
  if found then return old.result || jsonb_build_object('balance', (select balance from wallets where user_id = u)); end if;
  if p_stake is null or p_stake < 10 or p_stake > (select greatest(0, balance) from wallets where user_id = u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'pachinko', 'stake', -p_stake, 'pcstake:' || u || ':' || p_ref);
  loop
  g := array_fill(0, array[15]); badges := '{}'; bsum := 0; t := 0;
  for i in 1..15 loop g[i] := pc_pick(array[20,18,16,14,11,7]); end loop;            -- grid index = row*5 + col (+1)
  for c in 0..4 loop
    if random() < 0.12 then -- restore the original column probability
      r := floor(random() * 3)::int; g[r * 5 + c + 1] := 6; t := t + 1;
      if random() < 0.12 then nb := (array[2,3,5])[pc_pick(array[60,30,10]) + 1]; badges := badges || jsonb_build_object((r * 5 + c)::text, nb); bsum := bsum + nb; end if;
    end if;
  end loop;
  exit when t >= 3;
  -- Decide once whether to promote a non-bonus. Subsequent attempts are
  -- original boards conditioned on bonus, with original badge/super odds.
  if not force_bonus then
    if random() >= 0.75 * base_bonus / (1 - base_bonus) then exit; end if;
    force_bonus := true;
  end if;
  end loop;
  for i in 1..10 loop
    L := lines[i:i][1:5]; s := g[L[1][1] * 5 + 1];
    if s <> 6 then
      k := 1; while k < 5 and g[L[1][k + 1] * 5 + k + 1] = s loop k := k + 1; end loop;
      if k >= 3 then linesum := linesum + pays[s + 1][k - 2]; wins := wins || jsonb_build_object('line', i - 1, 'sym', s, 'n', k, 'pay', pays[s + 1][k - 2]); end if;
    end if;
  end loop;
  if t >= 3 then
    entry := case when bsum > 0 then bsum else 1 end;
    if t = 3 then
      scale := entry;
      loop i := pc_pick(array[24,1,18,8,12,3,16,8]); tg := tg || to_jsonb(i);
        if i = 3 then scale := scale * 2; else total := RV[i + 1] * scale; exit; end if; end loop;
      bonus := jsonb_build_object('kind', 'regular', 'entry', entry, 'targets', tg, 'total', total);
    else
      for k in 1..20 loop i := pc_pick(array[85,0.05,8,2,0.25,4,0.7]); tg := tg || to_jsonb(i); total := total + SV[i + 1]; end loop;
      total := total * entry;
      bonus := jsonb_build_object('kind', 'super', 'entry', entry, 'targets', tg, 'total', total);
    end if;
  end if;
  pay := floor(((p_stake * linesum) / 10 + p_stake * total) * 1.045)::bigint;
  res := jsonb_build_object('grid', to_jsonb(g), 'badges', badges, 'wins', wins, 'line_mult', linesum, 'bonus', bonus, 'stake', p_stake, 'payout', pay);
  insert into pc_spins (user_id, ref, stake, result, payout) values (u, p_ref, p_stake, res, pay);
  if pay > 0 then bal := apply_tx(u, 'pachinko', 'payout', pay, 'pcpay:' || u || ':' || p_ref); else bal := (select balance from wallets where user_id = u); end if;
  if total >= 200 then perform chat_sys('lobby', '🚽 ' || (select nickname from profiles where id = u) || ' זכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') || ' במכונת השירותים!'); end if;
  return res || jsonb_build_object('balance', bal);
end $$;

create or replace function fo_spin(p_line_bet bigint, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s sl_spins; st int[]; ev jsonb; v_total bigint; v_pay bigint; v_bal bigint;
        -- Original stop weights: FREE is visible at weight 29 of 133 on each reel.
        base_free numeric := power(29::numeric / 133, 3);
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
    if p_line_bet is null or p_line_bet < 1 or p_line_bet > (select greatest(0, balance) from wallets where user_id = u) / 5 then raise exception 'invalid_amount'; end if;
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
    v_j := floor(m.amount * p_line_bet / 100.0)::bigint;   -- the prize follows the bet: full at ₪500 a spin, more above it
    jp := jsonb_build_object('kind', 'mini', 'amount', v_j);
    update sl_jackpots set drop_at = now() + make_interval(secs => 3600 + rl_randint(14 * 86400 - 3600)), deadline = now() + interval '14 days',
           last_winner = u, last_amount = v_j, last_at = now() where kind = 'mini';
    perform chat_sys('slots', '💼 ' || nm || ' זכה בג׳קפוט של בנימין: ₪' || to_char(v_j, 'FM999,999,999,999,999,999') || '!');
  else
    st := array[fo_stop(), fo_stop(), fo_stop()];
    ev := fo_eval(st);
    -- Paid spins only: exact 1.75 times the original FREE probability; retriggers unchanged.
    if not v_free and not (ev->>'free')::boolean and random() < 0.75 * base_free / (1 - base_free) then
      loop st := array[fo_stop(), fo_stop(), fo_stop()]; ev := fo_eval(st); exit when (ev->>'free')::boolean; end loop;
    end if;
    if (ev->>'zeus')::boolean then
      v_j := floor((g.amount + v_total * 0.01) * (p_line_bet / 100.0))::bigint;
      jp := jsonb_build_object('kind', 'grand', 'amount', v_j, 'share', (p_line_bet / 100.0));
      update sl_jackpots set amount = greatest(1000000, amount - v_j), last_winner = u, last_amount = v_j, last_at = now() where kind = 'grand';
      perform chat_sys('slots', '⚡👑 ' || nm || ' זכה בג׳קפוט של זאוס: ₪' || to_char(v_j, 'FM999,999,999,999,999,999') || '!');
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
commit;
