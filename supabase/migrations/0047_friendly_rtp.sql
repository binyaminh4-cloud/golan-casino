-- Machines a little in the friends' favour (owner's call): each machine's payout gets a small top-up so it returns ~100%.
-- Kinneret 0.954→~1.00, Wild West 0.967→~1.00, Dragons 0.978→~1.00, Pachinko 0.958→~1.00, bought bonuses ~0.96→~1.00.


create or replace function kin_spin(p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); old kin_spins; k kin_seeds; n int; pick int; pay bigint; bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into old from kin_spins where user_id = u and ref = p_ref;
  if found then return jsonb_build_object('seed', old.seed, 'total', old.total, 'payout', old.payout, 'stake', old.stake, 'balance', (select balance from wallets where user_id = u)); end if;
  if p_stake is null or p_stake < 5 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'kinneret', 'stake', -p_stake, 'kinstake:' || u || ':' || p_ref);
  select count(*) into n from kin_seeds;
  pick := rl_randint(n); select * into k from kin_seeds where id = pick;
  pay := floor(p_stake * k.total * 1.05)::bigint;
  insert into kin_spins (user_id, ref, stake, seed, total, payout) values (u, p_ref, p_stake, k.seed, k.total, pay);
  if pay > 0 then bal := apply_tx(u, 'kinneret', 'payout', pay, 'kinpay:' || u || ':' || p_ref); else bal := (select balance from wallets where user_id = u); end if;
  if k.total >= 100 then perform chat_sys('lobby', '🔥 ' || (select nickname from profiles where id = u) || ' זכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') || ' על האש בכינרת!'); end if;
  return jsonb_build_object('seed', k.seed, 'total', k.total, 'payout', pay, 'stake', p_stake, 'balance', bal);
end $$;

create or replace function ww_spin(p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); old ww_spins; k ww_seeds; n int; pick int; pay bigint; bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into old from ww_spins where user_id = u and ref = p_ref;
  if found then return jsonb_build_object('seed', old.seed, 'total', old.total, 'payout', old.payout, 'stake', old.stake, 'balance', (select balance from wallets where user_id = u)); end if;
  if p_stake is null or p_stake < 5 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'wild_west', 'stake', -p_stake, 'wwstake:' || u || ':' || p_ref);
  select count(*) into n from ww_seeds;
  pick := rl_randint(n); select * into k from ww_seeds where id = pick;
  pay := floor(p_stake * k.total * 1.035)::bigint;
  insert into ww_spins (user_id, ref, stake, seed, total, payout) values (u, p_ref, p_stake, k.seed, k.total, pay);
  if pay > 0 then bal := apply_tx(u, 'wild_west', 'payout', pay, 'wwpay:' || u || ':' || p_ref); else bal := (select balance from wallets where user_id = u); end if;
  if k.total >= 100 then perform chat_sys('lobby', '🤠 ' || (select nickname from profiles where id = u) || ' זכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') || ' במערב הפרוע!'); end if;
  return jsonb_build_object('seed', k.seed, 'total', k.total, 'payout', pay, 'stake', p_stake, 'balance', bal);
end $$;

create or replace function dg_spin(p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); old dg_spins; k dg_seeds; n int; pick int; pay bigint; bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into old from dg_spins where user_id = u and ref = p_ref;
  if found then return jsonb_build_object('seed', old.seed, 'total', old.total, 'payout', old.payout, 'stake', old.stake, 'balance', (select balance from wallets where user_id = u)); end if;
  if p_stake is null or p_stake < 25 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'dragons', 'stake', -p_stake, 'dgstake:' || u || ':' || p_ref);
  select count(*) into n from dg_seeds;
  pick := rl_randint(n); select * into k from dg_seeds where id = pick;
  pay := floor(p_stake * k.total * 1.022)::bigint;
  insert into dg_spins (user_id, ref, stake, seed, total, payout) values (u, p_ref, p_stake, k.seed, k.total, pay);
  if pay > 0 then bal := apply_tx(u, 'dragons', 'payout', pay, 'dgpay:' || u || ':' || p_ref); else bal := (select balance from wallets where user_id = u); end if;
  if k.total >= 100 then perform chat_sys('lobby', '🐉 ' || (select nickname from profiles where id = u) || ' זכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') || ' בדרקוני הגולן!'); end if;
  return jsonb_build_object('seed', k.seed, 'total', k.total, 'payout', pay, 'stake', p_stake, 'balance', bal);
end $$;

create or replace function seed_buy(p_game text, p_kind text, p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); price int; cost bigint; n int; pick int; k buy_seeds; pay bigint; bal bigint; tag text := case p_game when 'kinneret' then 'kin' else 'ww' end;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  price := gc_buy_price(p_game, p_kind); if price is null then raise exception 'invalid_bonus'; end if;
  if p_stake is null or p_stake < 5 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  if exists (select 1 from wallet_transactions where settlement_ref = tag || 'buy:' || u || ':' || p_ref) then raise exception 'duplicate'; end if;
  cost := p_stake * price;
  perform apply_tx(u, p_game, 'stake', -cost, tag || 'buy:' || u || ':' || p_ref);
  select count(*) into n from buy_seeds where game = p_game and kind = p_kind; pick := rl_randint(n);
  select * into k from buy_seeds where game = p_game and kind = p_kind and id = pick;
  pay := floor(p_stake * k.total * 1.045)::bigint;
  if pay > 0 then bal := apply_tx(u, p_game, 'payout', pay, tag || 'buypay:' || u || ':' || p_ref); else bal := (select balance from wallets where user_id = u); end if;
  if pay >= cost * 3 and pay >= 50000 then perform chat_sys('lobby', '🎁 ' || (select nickname from profiles where id = u) || ' קנה בונוס וזכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') || '!'); end if;
  return jsonb_build_object('seed', k.seed, 'total', k.total, 'payout', pay, 'stake', p_stake, 'cost', cost, 'kind', p_kind, 'balance', bal);
end $$;

create or replace function pc_spin(p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); old pc_spins; g int[] := array_fill(0, array[15]); badges jsonb := '{}'; bsum int := 0; nb int := 0; t int := 0;
  c int; r int; s int; k int; L int[]; lines int[][] := array[[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],[0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[1,0,1,2,1]];
  pays int[][] := array[[4,10,30],[6,16,50],[8,24,80],[12,40,150],[20,80,300],[40,200,1000]];
  wins jsonb := '[]'; linesum bigint := 0; bonus jsonb := null; entry int; scale bigint; total bigint := 0; i int; tg jsonb := '[]'; pay bigint; res jsonb; bal bigint;
  RV int[] := array[5,100,10,0,20,50,15,25]; SV int[] := array[5,100,10,20,50,15,25];
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into old from pc_spins where user_id = u and ref = p_ref;
  if found then return old.result || jsonb_build_object('balance', (select balance from wallets where user_id = u)); end if;
  if p_stake is null or p_stake < 10 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'pachinko', 'stake', -p_stake, 'pcstake:' || u || ':' || p_ref);
  for i in 1..15 loop g[i] := pc_pick(array[20,18,16,14,11,7]); end loop;            -- grid index = row*5 + col (+1)
  for c in 0..4 loop
    if random() < 0.12 then
      r := floor(random() * 3)::int; g[r * 5 + c + 1] := 6; t := t + 1;
      if random() < 0.12 then nb := (array[2,3,5])[pc_pick(array[60,30,10]) + 1]; badges := badges || jsonb_build_object((r * 5 + c)::text, nb); bsum := bsum + nb; end if;
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
  if total * p_stake >= 50000 then perform chat_sys('lobby', '🚽 ' || (select nickname from profiles where id = u) || ' זכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') || ' במכונת השירותים!'); end if;
  return res || jsonb_build_object('balance', bal);
end $$;

create or replace function pc_buy(p_kind text, p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); price int; cost bigint; scale bigint := 1; entry int; total bigint := 0; tg jsonb := '[]'; i int; k int; pay bigint; bal bigint; res jsonb; bonus jsonb;
  RV int[] := array[5,100,10,0,20,50,15,25]; SV int[] := array[5,100,10,20,50,15,25];
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_kind not in ('regular', 'super') then raise exception 'invalid_bonus'; end if;
  if exists (select 1 from pc_spins where user_id = u and ref = p_ref) then raise exception 'duplicate'; end if;
  if p_stake is null or p_stake < 10 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  price := gc_buy_price('pachinko', p_kind); cost := p_stake * price;
  perform apply_tx(u, 'pachinko', 'stake', -cost, 'pcbuy:' || u || ':' || p_ref);
  -- a random entry multiplier makes bought bonuses swing: mostly ×1, sometimes ×2, rarely ×5 / ×10
  entry := (array[1,2,5,10])[pc_pick(array[90,8,1.7,0.3]) + 1]; scale := entry;
  if p_kind = 'regular' then
    loop i := pc_pick(array[24,1,18,8,12,3,16,8]); tg := tg || to_jsonb(i);
      if i = 3 then scale := scale * 2; else total := RV[i + 1] * scale; exit; end if; end loop;
  else
    for k in 1..20 loop i := pc_pick(array[84,7,3,1,2,2,1]); tg := tg || to_jsonb(i); total := total + SV[i + 1] * entry; end loop;
  end if;
  bonus := jsonb_build_object('kind', p_kind, 'entry', entry, 'targets', tg, 'total', total);
  pay := floor(p_stake * total * 1.03)::bigint;
  res := jsonb_build_object('grid', '[]'::jsonb, 'badges', '{}'::jsonb, 'wins', '[]'::jsonb, 'line_mult', 0, 'bonus', bonus, 'stake', p_stake, 'cost', cost, 'payout', pay, 'bought', true);
  insert into pc_spins (user_id, ref, stake, result, payout) values (u, p_ref, cost, res, pay);
  bal := apply_tx(u, 'pachinko', 'payout', pay, 'pcpay:' || u || ':' || p_ref);
  return res || jsonb_build_object('balance', bal);
end $$;
