-- Big numbers in system chat lines no longer overflow into ####.
create or replace function rl_live_settle() returns void language plpgsql volatile as $$
declare b record; v_pay bigint; v_game text; v_closed bigint;
begin
  v_closed := floor((rl_live_now() - rl_live_window()) / rl_live_cycle());
  for b in select lb.*, r.result, case lb.mode when 'lightning' then r.lucky_l when 'xxx' then r.lucky_x else '{}'::jsonb end as lucky
           from rl_live_bets lb join rl_live_rounds r using (round_no)
           where not lb.settled and lb.round_no <= v_closed
           for update of lb skip locked loop
    v_pay := rl_pay2(b.bets, b.result, b.mode, b.lucky);
    v_game := case b.mode when 'classic' then 'roulette' when 'lightning' then 'lightning_roulette' else 'xxx_roulette' end;
    if v_pay > 0 then perform apply_tx(b.user_id, v_game, 'payout', v_pay, 'rllpay:' || b.id); end if;
    update rl_live_bets set payout = v_pay, settled = true where id = b.id;
    if v_pay >= b.total * 20 then
      perform chat_sys('roulette', '🎉 ' || (select nickname from profiles where id = b.user_id) || ' זכה ב־₪' || to_char(v_pay, 'FM999,999,999,999,999,999') ||
        ' על ' || b.result || case when b.lucky ? b.result::text then ' ⚡ ' || (b.lucky->>b.result::text) || 'x' else '' end);
    end if;
  end loop;
end $$;
create or replace function ph_showdown(p_table uuid) returns void language plpgsql security definer set search_path = public as $$
declare h poker_hands; p jsonb; levels bigint[]; lv bigint; prev bigint := 0; pot bigint; elig text[]; best bigint; winners text[];
        k text; sc jsonb := '{}'; v bigint; share bigint; rest bigint; res jsonb := '[]'; won jsonb := '{}'; nm text; live int;
begin
  select * into h from poker_hands where table_id = p_table for update;
  p := h.players; live := ph_count(p, 'live');
  for k in select key from jsonb_each(p) where not (value->>'folded')::boolean loop
    v := case when live > 1 then ph_best(array(select jsonb_array_elements_text(p -> k -> 'hole')) || h.board) else 0 end;
    sc := sc || jsonb_build_object(k, v);
  end loop;
  select array_agg(distinct (value->>'committed')::bigint order by (value->>'committed')::bigint) into levels from jsonb_each(p) where (value->>'committed')::bigint > 0;
  foreach lv in array coalesce(levels, '{}') loop
    select coalesce(sum(least((value->>'committed')::bigint, lv) - least((value->>'committed')::bigint, prev)), 0) into pot from jsonb_each(p);
    select array_agg(key order by key::int) into elig from jsonb_each(p) where not (value->>'folded')::boolean and (value->>'committed')::bigint >= lv;
    if pot > 0 and elig is not null then
      select max((sc->>e)::bigint) into best from unnest(elig) e;
      select array_agg(e order by ((e::int - h.dealer + 5) % 6)) into winners from unnest(elig) e where (sc->>e)::bigint = best;
      share := pot / array_length(winners, 1); rest := pot - share * array_length(winners, 1);
      foreach k in array winners loop
        won := won || jsonb_build_object(k, coalesce((won->>k)::bigint, 0) + share + case when rest > 0 then 1 else 0 end);
        if rest > 0 then rest := rest - 1; end if;
      end loop;
      res := res || jsonb_build_object('pot', pot, 'winners', to_jsonb(winners));
    elsif pot > 0 then                                    -- uncalled chips: back to their owner
      select array_agg(key) into elig from jsonb_each(p) where (value->>'committed')::bigint >= lv;
      won := won || jsonb_build_object(elig[1], coalesce((won->>elig[1])::bigint, 0) + pot);
    end if;
    prev := lv;
  end loop;
  for k in select jsonb_object_keys(won) loop
    p := jsonb_set(p, array[k, 'stack'], to_jsonb((p -> k ->> 'stack')::bigint + (won->>k)::bigint));
  end loop;
  -- write back
  update poker_seats ps set stack = (p -> ps.seat_index::text ->> 'stack')::bigint
    where ps.table_id = p_table and p ? ps.seat_index::text;
  update poker_hands set street = 'done', players = p, to_act = null, deadline = null, next_at = now() + interval '6 seconds',
    result = jsonb_build_object('pots', res, 'won', won, 'live', live,
      'shown', case when live > 1 then (select jsonb_object_agg(key, jsonb_build_object('hole', value->'hole', 'hand', ph_cat_name((sc->>key)::bigint)))
                                         from jsonb_each(p) where not (value->>'folded')::boolean) else '{}'::jsonb end),
    updated_at = now() where table_id = p_table;
  -- big pots in the chat
  for k in select jsonb_object_keys(won) loop
    if (won->>k)::bigint >= 20 * (select big_blind from poker_tables where id = p_table) and live > 1 then
      nm := (select nickname from profiles where id = (p -> k ->> 'user')::uuid);
      perform chat_sys('lobby', '♠️ ' || nm || ' לקח קופה של ₪' || to_char((won->>k)::bigint, 'FM999,999,999,999,999,999') || ' עם ' || ph_cat_name((sc->>k)::bigint) || '.');
    end if;
  end loop;
end $$;
create or replace function tn_between_hands(p_table uuid) returns void language plpgsql security definer set search_path = public as $$
declare t tourneys; s record; n int; w record; nm text; lvl int;
begin
  select * into t from tourneys where table_id = p_table for update;
  if not found or t.status <> 'running' then return; end if;
  for s in select * from poker_seats where table_id = p_table and (stack = 0 or leaving) order by stack loop
    delete from poker_seats where table_id = p_table and user_id = s.user_id;
    n := (select count(*) from poker_seats where table_id = p_table);
    update tourneys set places = places || jsonb_build_object('user', s.user_id, 'place', n + 1) where id = t.id;
    if n + 1 = 2 then perform ch_add_points(t.season, s.user_id, 'tourney', 10); end if;
  end loop;
  if (select count(*) from poker_seats where table_id = p_table) <= 1 then
    select * into w from poker_seats where table_id = p_table limit 1;
    if found then
      perform apply_tx(w.user_id, 'tourney', 'payout', t.prize, 'tnpay:' || t.id);
      perform ch_add_points(t.season, w.user_id, 'tourney', 30);
      delete from poker_seats where table_id = p_table;
      nm := (select nickname from profiles where id = w.user_id);
      update tourneys set status = 'done', finished_at = now(), places = places || jsonb_build_object('user', w.user_id, 'place', 1) where id = t.id;
      perform chat_sys('lobby', '🎡 ' || nm || ' ניצח בטורניר הג׳קפוט ולקח ₪' || to_char(t.prize, 'FM999,999,999,999,999,999') || '!');
    else
      update tourneys set status = 'done', finished_at = now() where id = t.id;
    end if;
    update poker_hands set street = 'idle', players = '{}' where table_id = p_table;
    return;
  end if;
  lvl := (select hand_no from poker_hands where table_id = p_table) / 5;
  update poker_tables set small_blind = tn_blinds(lvl), big_blind = tn_blinds(lvl) * 2 where id = p_table;
end $$;
create or replace function tourney_join() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s seasons; t tourneys; tb uuid; i int;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if not gc_on('challenges') then raise exception 'challenges_paused'; end if;
  select * into t from tourneys where u = any(players) and status in ('registering', 'running');
  if found then return jsonb_build_object('id', t.id, 'status', t.status, 'table', t.table_id); end if;
  if exists (select 1 from poker_seats where user_id = u) then raise exception 'already_seated'; end if;
  s := ch_season();
  select * into t from tourneys where status = 'registering' order by created_at limit 1 for update;
  if not found then insert into tourneys (season) values (s.no) returning * into t; end if;
  perform apply_tx(u, 'tourney', 'stake', -t.buyin, 'tnin:' || t.id || ':' || u);
  update tourneys set players = players || u where id = t.id returning * into t;
  if array_length(t.players, 1) = 1 then
    perform chat_sys('lobby', '🎡 ' || (select nickname from profiles where id = u) || ' נרשם לטורניר ג׳קפוט. חסרים 2 שחקנים!');
  end if;
  if array_length(t.players, 1) >= 3 then
    t.mult := tn_wheel(); t.prize := (t.buyin * t.mult)::bigint;
    insert into poker_tables (name, max_seats, small_blind, big_blind, tourney) values ('טורניר ג׳קפוט', 6, 10, 20, t.id) returning id into tb;
    insert into poker_hands (table_id, next_at) values (tb, now() + interval '8 seconds');    -- time for the wheel
    for i in 1..3 loop
      insert into poker_seats (table_id, seat_index, user_id, stack) values (tb, (i - 1) * 2, t.players[i], 500);
    end loop;
    update tourneys set status = 'running', started_at = now(), mult = t.mult, prize = t.prize, table_id = tb where id = t.id;
    perform chat_sys('lobby', '🎡 טורניר ג׳קפוט התחיל! הגלגל קבע פרס של ₪' || to_char(t.prize, 'FM999,999,999,999,999,999') ||
      case when t.mult >= 10 then ' 🔥' else '' end);
    return jsonb_build_object('id', t.id, 'status', 'running', 'table', tb);
  end if;
  return jsonb_build_object('id', t.id, 'status', 'registering');
end $$;
create or replace function ch_finish_run(p_run uuid) returns void language plpgsql security definer set search_path = public as $$
declare c ch_runs; d ch_duels; pts int := 0; nm text; nb text; today int;
begin
  update ch_runs set status = 'done', finished_at = now() where id = p_run and status = 'playing' returning * into c;
  if not found then return; end if;
  nm := (select nickname from profiles where id = c.user_id);
  if c.kind = 'fisher' then
    select count(*) into today from ch_runs where user_id = c.user_id and kind = 'fisher' and status = 'done' and points > 0
      and (finished_at at time zone 'Asia/Jerusalem')::date = (now() at time zone 'Asia/Jerusalem')::date and id <> c.id;
    pts := case when today < 3 then greatest(0, (c.chips - 10000) / 100)::int else 0 end;
    update ch_runs set points = pts where id = c.id;
    if pts > 0 then perform ch_add_points(c.season, c.user_id, 'fisher', pts); end if;
    if c.chips >= 30000 then perform chat_sys('lobby', '🎧 ' || nm || ' סיים את הסט של פישר עם ' || to_char(c.chips, 'FM999,999,999,999,999,999') || ' צ׳יפים!'); end if;
    if c.chips <= 10000 and not exists (select 1 from bj_rounds where ch_run = c.id and (result->'side'->>'strike_extra')::bigint > 0) then
      perform chat_sys('lobby', '🎧 פישר מקדיש שיר עצוב ל' || nm || ': סט שלם בלי אף ברק 🎻');
    end if;
  elsif c.kind = 'ido' then
    select * into d from ch_duels where id = c.duel for update;
    if c.id = d.run_a then
      update ch_duels set score_a = c.chips, status = 'waiting' where id = d.id;
      perform chat_sys('lobby', '🃏 ' || nm || ' סיים את החפיסה של עידו עם ' || to_char(c.chips, 'FM999,999,999,999,999,999') || '. ' ||
        (select nickname from profiles where id = d.opponent) || ', תורך!');
    else
      d.score_b := c.chips; d.score_a := coalesce(d.score_a, 0);
      update ch_duels set score_b = c.chips, status = 'done', finished_at = now(),
        winner = case when d.score_a > d.score_b then d.challenger when d.score_b > d.score_a then d.opponent end where id = d.id;
      nb := (select nickname from profiles where id = d.challenger);
      if d.score_a = d.score_b then
        perform ch_add_points(d.season, d.challenger, 'ido', 10); perform ch_add_points(d.season, d.opponent, 'ido', 10);
        perform chat_sys('lobby', '🃏 תיקו בחפיסה של עידו: ' || nb || ' ו' || nm || ' (' || to_char(d.score_a, 'FM999,999,999,999,999,999') || '). עידו טוען שזה בגללו.');
      else
        perform ch_add_points(d.season, case when d.score_a > d.score_b then d.challenger else d.opponent end, 'ido', 30);
        perform chat_sys('lobby', '🃏 ' || case when d.score_a > d.score_b then nb else nm end || ' ניצח בחפיסה של עידו, ' ||
          to_char(greatest(d.score_a, d.score_b), 'FM999,999,999,999,999,999') || ' מול ' || to_char(least(d.score_a, d.score_b), 'FM999,999,999,999,999,999') || '.');
      end if;
    end if;
  end if;
end $$;
create or replace function zeus_settle(p_duel uuid) returns void language plpgsql security definer set search_path = public as $$
declare d zeus_duels; zb_r record; v_pay bigint; v_closed bigint; na text; nb text;
begin
  select * into d from zeus_duels where id = p_duel for update;
  if not found or d.status <> 'active' then return; end if;
  v_closed := floor((rl_live_now() - rl_live_window()) / rl_live_cycle());
  for zb_r in select zb.*, r.result, r.lucky_l from zeus_bets zb join rl_live_rounds r using (round_no)
           where zb.duel = p_duel and not zb.settled and zb.round_no <= v_closed loop
    v_pay := rl_pay2(zb_r.bets, zb_r.result, 'lightning', zb_r.lucky_l) * case when zb_r.round_no = d.start_round + zeus_rounds() - 1 then 2 else 1 end;
    update zeus_bets set payout = v_pay, settled = true where id = zb_r.id;
    if zb_r.user_id = d.a then update zeus_duels set a_chips = a_chips + v_pay where id = p_duel;
    else update zeus_duels set b_chips = b_chips + v_pay where id = p_duel; end if;
  end loop;
  select * into d from zeus_duels where id = p_duel;
  if v_closed >= d.start_round + zeus_rounds() - 1 then
    update zeus_duels set status = 'done', finished_at = now(),
      winner = case when a_chips > b_chips then a when b_chips > a_chips then b end where id = p_duel returning * into d;
    na := (select nickname from profiles where id = d.a); nb := (select nickname from profiles where id = d.b);
    if d.winner is null then
      perform ch_add_points(d.season, d.a, 'zeus', 10); perform ch_add_points(d.season, d.b, 'zeus', 10);
      perform chat_sys('lobby', '⚡ תיקו בדו־קרב של זאוס בין ' || na || ' ל' || nb || '. זאוס לא מרוצה.');
    else
      perform ch_add_points(d.season, d.winner, 'zeus', 30);
      perform chat_sys('lobby', '⚡ ' || case when d.winner = d.a then na else nb end || ' ניצח בדו־קרב של זאוס: ' ||
        to_char(greatest(d.a_chips, d.b_chips), 'FM999,999,999,999,999,999') || ' מול ' || to_char(least(d.a_chips, d.b_chips), 'FM999,999,999,999,999,999') || '.');
    end if;
  end if;
end $$;

-- Bet limits in round steps: under ₪500K -> ₪50K; ₪500K -> 100K, ₪1M -> 200K, ₪2.5M -> 500K, ₪5M -> 1M, ₪10M -> 2M, ₪25M -> 5M ...
create or replace function gc_max_bet(p_user uuid) returns bigint language plpgsql stable security definer set search_path = public as $$
declare b numeric; v numeric := 500000; k int := 0;
begin
  select balance into b from wallets where user_id = p_user;
  if b is null or b < 500000 then return 50000; end if;
  loop
    exit when v * (case k % 3 when 1 then 2.5 else 2 end) > b;
    v := v * (case k % 3 when 1 then 2.5 else 2 end); k := k + 1;
  end loop;
  return (v / 5)::bigint;
end $$;
revoke all on function gc_max_bet(uuid) from public, anon, authenticated;

-- Golan Fortune: both jackpots scale with the bet (₪500 a spin = the full amount, ₪1,000 = double ...)
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

