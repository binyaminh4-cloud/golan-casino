-- Slot machines: 4× the chance to reach the bonus (and super bonus). Nothing else changes: same symbols, same pays,
-- same bonus rules. Seed games pick a bonus round more often; Pachinko shows the toilet more often; Fortune re-rolls into FREE.
-- (The owner accepted that the house may lose on these machines.)

alter table dg_seeds add column if not exists bonus boolean not null default false;

alter table kin_seeds add column if not exists bonus boolean not null default false;

alter table ww_seeds add column if not exists bonus boolean not null default false;

update dg_seeds set bonus = (id in (468,599,607,649,673,759,959,1469,1780,1885,1987,2004,2005,2066,2316,2332,2585,2748,2812,2964,3084,3108,3436,3824,3944,4050,4056,4340,4896,5037,5164,5460,5472,5605,5782,5848,6041,6541,6641,6670,6735,7287,7607,7623,7696,7778,7895,8297,8315,8398,8797,8809,9101,9250,9281,9413,9606,9777,9900,9930,9953,9988,10080,10207,10588,10653,10751,10826,10832,11212,11446,11451,11719,11762,12138,12184,12226,12286,12395,12584,12650,12819,12878,13065,13188,13456,13658,13660,13847,14005,14170,14177,14194,14200,14307,14442,14522,15086,15114,15346,15440,15581,15759,15833,16049,16074,16130,16240,16368,16658,16880,17198,17204,17265,17333,17611,17833,18591,18618,18883,18987,19059,19082,19678,19969,20302,20569,21054,21066,21125,21149,21151,21242,21365,21406,21459,21463,21522,21725,21809,22110,22139,22473,22789,22956,22983,23325,23424,24073,24094,24102,24239,24254,24429,24446,24633,24803,24815,24826,24943,25386,25528,25531,25618,25637,25639,25674,25777,26046,26073,26114,26122,26427,27245,27712,27794,27803,28351,28488,28811,28887,29130,29346,29362,29727,29842,29850,29855,29947));
-- dg_seeds: bonus 1 in 159 -> 1 in 40, extra pick 0.01902
update kin_seeds set bonus = (id in (77,125,169,201,207,211,223,360,367,512,561,571,606,630,639,741,758,836,843,859,949,979,983,1087,1171,1244,1295,1312,1468,1500,1540,1642,1658,1689,1734,2016,2079,2102,2240,2251,2266,2377,2392,2402,2446,2575,2577,2630,2647,2669,2686,2725,2751,2784,2879,2908,3134,3213,3224,3248,3257,3401,3463,3513,3546,3575,3721,3757,3765,3954,3975,4016,4131,4322,4356,4375,4382,4406,4407,4418,4650,4664,4773,4834,4894,4913,4928,4944,5004,5094,5106,5146,5223,5453,5475,5520,5553,5652,5727,5760,5764,5799,5895,5901,6029,6031,6088,6095,6105,6138,6143,6262,6266,6267,6351,6458,6616,6740,6752,6823,6860,6879,6981,7063,7126,7168,7181,7235,7291,7321,7337,7353,7412,7439,7445,7523,7684,7747,7977,7986,8156,8193,8224,8387,8406,8446,8532,8674,8684,8749,8852,8857,8878,8921,8994,9061,9070,9075,9089,9141,9156,9164,9270,9322,9490,9545,9571,9581,9589,9610,9681,9704,9746,9869,9971,10016,10035,10053,10065,10093,10096,10099,10231,10236,10355,10477,10502,10603,10606,10607,10620,10636,10791,10799,10823,11029,11145,11156,11178,11225,11355,11433,11472,11514,11599,11618,11655,11664,11668,11738,11744,11771,11863,12110,12222,12611,12632,12724,12909,13034,13053,13162,13175,13275,13293,13318,13347,13385,13464,13482,13622,13643,13645,13698,13708,13711,13731,13764,13818,13931,14043,14142,14174,14187,14228,14240,14257,14418,14507,14564,14594,14751,14778,14824,14853,14870,14878,14895,14901,14944,15097,15190,15255,15302,15340,15640,15650,15767,15769,15799,15826,15832,15867,15886,15965,15973,16151,16173,16221,16318,16414,16509,16511,16544,16546,16611,16804,16960,17055,17120,17211,17375,17427,17679,17866,17966,18030,18063,18116,18164,18172,18175,18200,18354,18432,18644,18734,18795,19014,19025,19039,19060,19109,19121,19123,19141,19156,19161,19191,19227,19246,19419,19420,19516,19535,19548,19585,19621,19670,19719,19806,19834,19882,19883,19999,20033,20040,20060,20064,20087,20129,20187,20243,20244,20248,20288,20789,20812,20862,20890,20934,20966,21103,21105,21117,21150,21223,21240,21264,21303,21352,21509,21523,21563,21618,21637,21790,21793,21796,21831,21872,21876,21892,21908,21969,21989,21997,22001,22279,22298,22481,22558,22773,23065,23184,23236,23377,23493,23513,23791,23841,24050,24153,24175,24235,24301,24347,24522,24560,24671,24688,24740,24744,24802,24864,24891,24950,24963,24970,25166,25384,25459,25562,25713,25728,25824,25922,25941,26017,26179,26186,26263,26308,26672,26741,26868,26941,27010,27054,27209,27218,27289,27290,27294,27359,27399,27664,27792,27806,28077,28133,28241,28244,28278,28403,28453,28497,28581,28646,28659,28714,28730,28778,28880,28910,28949,29053,29070,29096,29156,29208,29241,29263,29370,29504,29513,29885));
-- kin_seeds: bonus 1 in 64 -> 1 in 16, extra pick 0.04744
update ww_seeds set bonus = (id in (176,199,228,356,428,724,1019,1432,1773,1783,1790,2168,2395,2399,2763,2766,3163,3440,3441,3628,3916,4199,4541,4739,5022,5104,5114,5218,5414,5576,5583,5622,5733,5789,6078,6084,6242,6293,6341,6984,7077,7581,7677,7752,7838,8180,8273,8549,8716,8992,9106,9387,9435,9678,9906,9977,9996,10028,10090,10233,10428,10558,10579,11087,11294,11411,11412,11855,12053,12074,12180,12417,12594,12963,13061,13062,13380,13435,13538,13706,13774,14033,14045,14065,14070,14543,14929,15228,15473,15541,15625,16034,16271,16659,16688,16899,16983,17438,17557,18230,18252,18381,18474,18651,18750,19049,19147,19804,19952,20190,20201,20436,20484,20525,20653,20859,21344,21540,21693,21762,21794,22260,22460,23040,23146,23416,23463,23477,23527,23592,23770,24045,24047,24217,24267,24293,24294,24431,25096,25180,25635,26064,26070,26125,26400,26761,26845,27679,28295,28314,29102,29143,29165,29625,29799,29977));
-- ww_seeds: bonus 1 in 192 -> 1 in 48, extra pick 0.01568


create or replace function dg_spin(p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); old dg_spins; k dg_seeds; n int; pick int; pay bigint; bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into old from dg_spins where user_id = u and ref = p_ref;
  if found then return jsonb_build_object('seed', old.seed, 'total', old.total, 'payout', old.payout, 'stake', old.stake, 'balance', (select balance from wallets where user_id = u)); end if;
  if p_stake is null or p_stake < 25 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'dragons', 'stake', -p_stake, 'dgstake:' || u || ':' || p_ref);
  select count(*) into n from dg_seeds;
  if random() < 0.019 then          -- the extra bonus chance
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
declare u uuid := auth.uid(); old kin_spins; k kin_seeds; n int; pick int; pay bigint; bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into old from kin_spins where user_id = u and ref = p_ref;
  if found then return jsonb_build_object('seed', old.seed, 'total', old.total, 'payout', old.payout, 'stake', old.stake, 'balance', (select balance from wallets where user_id = u)); end if;
  if p_stake is null or p_stake < 5 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'kinneret', 'stake', -p_stake, 'kinstake:' || u || ':' || p_ref);
  select count(*) into n from kin_seeds;
  if random() < 0.0474 then          -- the extra bonus chance
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
declare u uuid := auth.uid(); old ww_spins; k ww_seeds; n int; pick int; pay bigint; bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into old from ww_spins where user_id = u and ref = p_ref;
  if found then return jsonb_build_object('seed', old.seed, 'total', old.total, 'payout', old.payout, 'stake', old.stake, 'balance', (select balance from wallets where user_id = u)); end if;
  if p_stake is null or p_stake < 5 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'wild_west', 'stake', -p_stake, 'wwstake:' || u || ':' || p_ref);
  select count(*) into n from ww_seeds;
  if random() < 0.0157 then          -- the extra bonus chance
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
  RV int[] := array[5,100,10,0,20,50,15,25]; SV int[] := array[5,100,10,20,50,15,25];
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into old from pc_spins where user_id = u and ref = p_ref;
  if found then return old.result || jsonb_build_object('balance', (select balance from wallets where user_id = u)); end if;
  if p_stake is null or p_stake < 10 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'pachinko', 'stake', -p_stake, 'pcstake:' || u || ':' || p_ref);
  for i in 1..15 loop g[i] := pc_pick(array[20,18,16,14,11,7]); end loop;            -- grid index = row*5 + col (+1)
  for c in 0..4 loop
    if random() < 0.20 then             -- was 0.12: bonus 1 in 70 -> 1 in 17
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
  if total >= 200 then perform chat_sys('lobby', '🚽 ' || (select nickname from profiles where id = u) || ' זכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') || ' במכונת השירותים!'); end if;
  return res || jsonb_build_object('balance', bal);
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
    if p_line_bet is null or p_line_bet < 1 or p_line_bet > gc_max_bet(u) / 5 then raise exception 'invalid_amount'; end if;
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
    -- the extra free-spins chance on a paid spin: re-roll until the FREE scatter shows (1 in 96 -> 1 in 24)
    if not v_free and not (ev->>'free')::boolean and random() < 0.0316 then
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
