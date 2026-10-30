-- Bet limit is fixed for the whole round: chips already sent this round count as still yours when the limit step is worked out.
create or replace function gc_max_for(p_bal numeric) returns bigint language plpgsql immutable as $$
declare v numeric := 500000; k int := 0;
begin
  if p_bal is null or p_bal < 500000 then return 50000; end if;
  loop exit when v * (case k % 3 when 1 then 2.5 else 2 end) > p_bal; v := v * (case k % 3 when 1 then 2.5 else 2 end); k := k + 1; end loop;
  return (v / 5)::bigint;
end $$;
create or replace function rl_clean_bets(p_bets jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b jsonb; v_total bigint := 0; v_nums int[]; v_clean jsonb := '[]';
  v_max bigint := gc_max_for((select balance from wallets where user_id = auth.uid()) + coalesce(nullif(current_setting('gc.round_staked', true), '')::bigint, 0));
begin
  if jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) not between 1 and 300 then raise exception 'invalid_bets'; end if;
  for b in select * from jsonb_array_elements(p_bets) loop
    if jsonb_typeof(b->'amt') <> 'number' or (b->>'amt')::numeric <> floor((b->>'amt')::numeric)
       or (b->>'amt')::bigint < 1 or (b->>'amt')::bigint > v_max then raise exception 'invalid_amount'; end if;
    select array_agg(x::int order by x::int) into v_nums from jsonb_array_elements_text(b->'nums') x;
    if not exists (select 1 from rl_legal where nums = v_nums) then raise exception 'invalid_bet'; end if;
    v_total := v_total + (b->>'amt')::bigint;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('nums', to_jsonb(v_nums), 'amt', (b->>'amt')::bigint));
  end loop;
  return jsonb_build_object('bets', v_clean, 'total', v_total);
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
  perform pg_advisory_xact_lock(hashtext('rll:' || u));
  select coalesce(sum(total), 0) into v_prev from rl_live_bets where round_no = n and user_id = u;
  perform set_config('gc.round_staked', v_prev::text, true);
  cl := rl_clean_bets(p_bets); v_total := (cl->>'total')::bigint;
  perform rl_live_ensure(n);
  v_game := case p_mode when 'classic' then 'roulette' when 'lightning' then 'lightning_roulette' else 'xxx_roulette' end;
  v_bal := apply_tx(u, v_game, 'stake', -v_total, 'rllstake:' || u || ':' || p_ref);
  insert into rl_live_bets (round_no, user_id, mode, ref, bets, total) values (n, u, p_mode, p_ref, cl->'bets', v_total);
  return jsonb_build_object('ok', true, 'balance', v_bal);
end $$;
