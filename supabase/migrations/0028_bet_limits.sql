-- Bet limits grow with the wallet: up to ₪500K the max bet is ₪50K; from ₪500K it is ₪100K for every ₪500K
-- (₪1M -> 200K, ₪1.5M -> 300K ...). No table cap on roulette any more: only the per-bet limit and the wallet.
-- Poker is not affected.
create or replace function gc_max_bet(p_user uuid) returns bigint language sql stable security definer set search_path = public as $$
  select case when coalesce(balance, 0) >= 500000 then 100000 * (balance / 500000) else 50000 end from wallets where user_id = p_user $$;
create or replace function gc_my_max_bet() returns bigint language sql stable security definer set search_path = public as $$ select gc_max_bet(auth.uid()) $$;
revoke all on function gc_max_bet(uuid) from public, anon, authenticated;
revoke all on function gc_my_max_bet() from public, anon; grant execute on function gc_my_max_bet() to authenticated;
create or replace function rl_spin(p_bets jsonb, p_ref text, p_mode text default 'classic') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s rl_spins; b jsonb; v_total bigint := 0; v_res int; v_pay bigint; v_bal bigint; v_nums int[];
        v_clean jsonb := '[]'; v_lucky jsonb := '{}'; v_game text;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_mode not in ('classic', 'lightning', 'xxx') then raise exception 'invalid_mode'; end if;
  if p_ref is null or length(p_ref) > 80 then raise exception 'invalid_ref'; end if;
  select * into s from rl_spins where user_id = u and ref = p_ref;
  if found then
    return jsonb_build_object('id', s.id, 'result', s.result, 'total', s.total, 'payout', s.payout, 'mode', s.mode, 'lucky', s.lucky,
      'balance', (select balance from wallets where user_id = u));
  end if;
  if jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) not between 1 and 300 then raise exception 'invalid_bets'; end if;
  for b in select * from jsonb_array_elements(p_bets) loop
    if jsonb_typeof(b->'amt') <> 'number' or (b->>'amt')::numeric <> floor((b->>'amt')::numeric)
       or (b->>'amt')::bigint < 1 or (b->>'amt')::bigint > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
    select array_agg(x::int order by x::int) into v_nums from jsonb_array_elements_text(b->'nums') x;
    if not exists (select 1 from rl_legal where nums = v_nums) then raise exception 'invalid_bet'; end if;
    v_total := v_total + (b->>'amt')::bigint;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('nums', to_jsonb(v_nums), 'amt', (b->>'amt')::bigint));
  end loop;
  

  v_game := case p_mode when 'classic' then 'roulette' when 'lightning' then 'lightning_roulette' else 'xxx_roulette' end;
  perform apply_tx(u, v_game, 'stake', -v_total, 'rlstake:' || u || ':' || p_ref);
  if p_mode <> 'classic' then v_lucky := rl_strike(p_mode); end if;   -- lightning first, then the ball
  v_res := rl_rand37();
  v_pay := rl_pay2(v_clean, v_res, p_mode, v_lucky);
  insert into rl_spins (user_id, ref, bets, total, result, payout, mode, lucky)
    values (u, p_ref, v_clean, v_total, v_res, v_pay, p_mode, v_lucky) returning * into s;
  if v_pay > 0 then v_bal := apply_tx(u, v_game, 'payout', v_pay, 'rlpay:' || s.id);
  else v_bal := (select balance from wallets where user_id = u); end if;
  return jsonb_build_object('id', s.id, 'result', v_res, 'total', v_total, 'payout', v_pay, 'balance', v_bal, 'mode', p_mode, 'lucky', v_lucky);
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
  
  perform rl_live_ensure(n);
  v_game := case p_mode when 'classic' then 'roulette' when 'lightning' then 'lightning_roulette' else 'xxx_roulette' end;
  v_bal := apply_tx(u, v_game, 'stake', -v_total, 'rllstake:' || u || ':' || p_ref);
  insert into rl_live_bets (round_no, user_id, mode, ref, bets, total) values (n, u, p_mode, p_ref, cl->'bets', v_total);
  return jsonb_build_object('ok', true, 'balance', v_bal);
end $$;
create or replace function bj_deal(p_main bigint, p_pp bigint, p_t3 bigint, p_ll bigint, p_bust bigint, p_ref text, p_mode text default 'classic', p_run uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); cr ch_runs; v_id uuid; p text[]; d text[]; total bigint; up int; v_side jsonb := '{}'; v_fee bigint := 0; v_boost int := 0; v_cap bigint := 0;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select id into v_id from bj_rounds where ref = p_ref and user_id = u;
  if found then return bj_view(v_id); end if;                -- duplicate request
  if exists (select 1 from bj_rounds where user_id = u and status <> 'done') then raise exception 'round_in_progress'; end if;
  if p_main is null or p_main < 10 or p_main > gc_max_bet(u) then raise exception 'invalid_main_bet'; end if;
  if least(coalesce(p_pp,0), coalesce(p_t3,0), coalesce(p_ll,0), coalesce(p_bust,0)) < 0
     or greatest(coalesce(p_pp,0), coalesce(p_t3,0), coalesce(p_ll,0), coalesce(p_bust,0)) > p_main then raise exception 'invalid_side_bet'; end if;
  if p_mode not in ('classic', 'lightning') then raise exception 'invalid_mode'; end if;
  if p_mode = 'lightning' then
    if coalesce(p_pp,0) + coalesce(p_t3,0) + coalesce(p_ll,0) + coalesce(p_bust,0) > 0 then raise exception 'invalid_side_bet'; end if;
    v_fee := (p_main + 1) / 2;                                            -- Lightning fee = 50% of the main bet
  end if;
  if p_run is not null then                                 -- a challenge hand: chips come from the run, never the wallet
    select * into cr from ch_runs where id = p_run and user_id = u for update;
    if not found or cr.status <> 'playing' or cr.kind not in ('fisher', 'ido') then raise exception 'challenge_closed'; end if;
    if (cr.kind = 'fisher') <> (p_mode = 'lightning') then raise exception 'invalid_mode'; end if;
    if coalesce(p_pp,0) + coalesce(p_t3,0) + coalesce(p_ll,0) + coalesce(p_bust,0) > 0 then raise exception 'invalid_side_bet'; end if;
    perform set_config('gc.ch_run', p_run::text, true);
  end if;
  total := p_main + coalesce(p_pp,0) + coalesce(p_t3,0) + coalesce(p_ll,0) + coalesce(p_bust,0) + v_fee;
  perform bj_tx(u, case p_mode when 'lightning' then 'lightning_blackjack' else 'blackjack' end, 'stake', -total, 'bjstake:' || p_ref);

  if coalesce(p_pp,0) > 0 then v_side := v_side || jsonb_build_object('pp', p_pp); end if;
  if coalesce(p_t3,0) > 0 then v_side := v_side || jsonb_build_object('t3', p_t3); end if;
  if coalesce(p_ll,0) > 0 then v_side := v_side || jsonb_build_object('ll', p_ll); end if;
  if coalesce(p_bust,0) > 0 then v_side := v_side || jsonb_build_object('bust', p_bust); end if;

  p := array[bj_draw(u)]; d := array[bj_draw(u)]; p := p || bj_draw(u); d := d || bj_draw(u);
  insert into bj_rounds (user_id, ref, status, main_bet, side, hands, dealer, total_staked, mode, fee, strikes, ch_run)
    values (u, p_ref, 'playing', p_main, v_side,
            jsonb_build_array(jsonb_build_object('cards', to_jsonb(p), 'cards0', to_jsonb(p), 'bet', p_main,
              'done', bj_is_bj(p), 'surrendered', false, 'aces', false, 'split', false)),
            d, total, p_mode, v_fee, case when p_mode = 'lightning' then bj_strikes() else '{}'::jsonb end, p_run)
    returning id into v_id;

  up := bj_val(d[1]);
  if up = 11 and not bj_is_bj(p) then
    update bj_rounds set status = 'insurance' where id = v_id;
  elsif bj_is_bj(p) or ((up = 10 or up = 11) and bj_is_bj(d)) then
    perform bj_finish(v_id);                                  -- blackjack or dealer peek
  end if;
  return bj_view(v_id);
end $$;
create or replace function bjt_bet(p_t int, p_main bigint, p_pp bigint, p_t3 bigint, p_ll bigint, p_bust bigint, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r bjt_rounds; v_side jsonb := '{}'; total bigint; v_seat int;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_t not between 1 and 3 then raise exception 'invalid_table'; end if;
  if exists (select 1 from bjt_bets where ref = p_ref and user_id = u) then return bjt_state(p_t); end if;   -- duplicate request
  if p_main is null or p_main < 10 or p_main > gc_max_bet(u) then raise exception 'invalid_main_bet'; end if;
  if least(coalesce(p_pp,0), coalesce(p_t3,0), coalesce(p_ll,0), coalesce(p_bust,0)) < 0
     or greatest(coalesce(p_pp,0), coalesce(p_t3,0), coalesce(p_ll,0), coalesce(p_bust,0)) > p_main then raise exception 'invalid_side_bet'; end if;
  perform bjt_tick(p_t);
  select * into r from bjt_rounds where t_no = p_t order by round_no desc limit 1 for update;
  if r.phase <> 'betting' then raise exception 'betting_closed'; end if;
  if exists (select 1 from bjt_bets where t_no = p_t and round_no = r.round_no and user_id = u) then raise exception 'already_bet'; end if;
  if exists (select 1 from bj_rounds where user_id = u and status <> 'done') then raise exception 'round_in_progress'; end if;
  select coalesce(max(seat), 0) + 1 into v_seat from bjt_bets where t_no = p_t and round_no = r.round_no;
  if v_seat > 5 then raise exception 'table_full'; end if;
  if coalesce(p_pp,0) > 0 then v_side := v_side || jsonb_build_object('pp', p_pp); end if;
  if coalesce(p_t3,0) > 0 then v_side := v_side || jsonb_build_object('t3', p_t3); end if;
  if coalesce(p_ll,0) > 0 then v_side := v_side || jsonb_build_object('ll', p_ll); end if;
  if coalesce(p_bust,0) > 0 then v_side := v_side || jsonb_build_object('bust', p_bust); end if;
  total := p_main + coalesce(p_pp,0) + coalesce(p_t3,0) + coalesce(p_ll,0) + coalesce(p_bust,0);
  perform bj_tx(u, 'blackjack', 'stake', -total, 'bjstake:' || p_ref);
  insert into bjt_bets (t_no, round_no, user_id, seat, main, side, total, ref) values (p_t, r.round_no, u, v_seat, p_main, v_side, total, p_ref);
  if r.bet_until is null then update bjt_rounds set bet_until = rl_live_now() + 15 where t_no = p_t and round_no = r.round_no; end if;
  return bjt_state(p_t);
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
  if p_line_bet is null or p_line_bet < 1 or p_line_bet > gc_max_bet(u) / 5 then raise exception 'invalid_amount'; end if;
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
create or replace function rl_clean_bets(p_bets jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b jsonb; v_total bigint := 0; v_nums int[]; v_clean jsonb := '[]';
begin
  if jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) not between 1 and 300 then raise exception 'invalid_bets'; end if;
  for b in select * from jsonb_array_elements(p_bets) loop
    if jsonb_typeof(b->'amt') <> 'number' or (b->>'amt')::numeric <> floor((b->>'amt')::numeric)
       or (b->>'amt')::bigint < 1 or (b->>'amt')::bigint > coalesce(gc_max_bet(auth.uid()), 50000) then raise exception 'invalid_amount'; end if;
    select array_agg(x::int order by x::int) into v_nums from jsonb_array_elements_text(b->'nums') x;
    if not exists (select 1 from rl_legal where nums = v_nums) then raise exception 'invalid_bet'; end if;
    v_total := v_total + (b->>'amt')::bigint;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('nums', to_jsonb(v_nums), 'amt', (b->>'amt')::bigint));
  end loop;
  return jsonb_build_object('bets', v_clean, 'total', v_total);
end $$;
