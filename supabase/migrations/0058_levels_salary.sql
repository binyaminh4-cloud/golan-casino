-- Player levels 1–10: XP from paid job shifts (5 / 8 / 12 by difficulty) and finished challenges (30 each).
-- Each level needs more XP than the one before. Salaries grow with the level:
-- weekly ₪10,000,000 × level, monthly ₪50,000,000 × level (level 10 = ₪100M a week).
insert into gc_settings values ('salary_weekly', '10000000'), ('salary_monthly', '50000000')
  on conflict (key) do update set value = excluded.value;

create or replace function gc_level_info(p_user uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare xp bigint; th int[] := array[0, 100, 250, 500, 900, 1500, 2400, 3700, 5500, 8000]; lv int := 1; i int;
begin
  select coalesce((select sum(case level when 1 then 5 when 2 then 8 else 12 end) from job_runs where user_id = p_user and paid > 0), 0)
       + coalesce((select count(*) * 30 from ch_runs where user_id = p_user and status = 'done' and hands > 0), 0) into xp;
  for i in 1..10 loop if xp >= th[i] then lv := i; end if; end loop;
  return jsonb_build_object('level', lv, 'xp', xp, 'from', th[lv], 'to', case when lv < 10 then th[lv + 1] end,
    'weekly', gc_num('salary_weekly') * lv, 'monthly', gc_num('salary_monthly') * lv);
end $$;
revoke all on function gc_level_info(uuid) from public, anon, authenticated;

create or replace function gc_my_level() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Jerusalem')::date; wk date := d - extract(dow from d)::int; mo date := date_trunc('month', d)::date;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  return gc_level_info(auth.uid()) || jsonb_build_object('next_weekly', wk + 7, 'next_monthly', (mo + interval '1 month')::date);
end $$;
revoke all on function gc_my_level() from public, anon; grant execute on function gc_my_level() to authenticated;

create or replace function salary_claim() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); d date := (now() at time zone 'Asia/Jerusalem')::date; wk date; mo date;
        out jsonb := '{}'; v_bal bigint; L jsonb; w bigint; m bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  L := gc_level_info(u); w := (L->>'weekly')::bigint; m := (L->>'monthly')::bigint;
  if w <= 0 and m <= 0 then return '{}'::jsonb; end if;
  wk := d - extract(dow from d)::int; mo := date_trunc('month', d)::date;
  if not exists (select 1 from salary_claims where user_id = u and kind = 'weekly' and period = wk) then
    insert into salary_claims values (u, 'weekly', wk, w) on conflict do nothing;
    if found then v_bal := apply_tx(u, 'salary', 'grant', w, 'salary:w:' || u || ':' || wk); out := out || jsonb_build_object('weekly', w); end if;
  end if;
  if not exists (select 1 from salary_claims where user_id = u and kind = 'monthly' and period = mo) then
    insert into salary_claims values (u, 'monthly', mo, m) on conflict do nothing;
    if found then v_bal := apply_tx(u, 'salary', 'grant', m, 'salary:m:' || u || ':' || mo); out := out || jsonb_build_object('monthly', m); end if;
  end if;
  return out || jsonb_build_object('balance', (select balance from wallets where user_id = u),
    'next_weekly', wk + 7, 'next_monthly', (mo + interval '1 month')::date, 'level', L->'level');
end $$;

-- fishing wheel: the bet limit is fixed for the whole round, like the roulettes
create or replace function if_bet(p_round bigint, p_bets jsonb, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); cap bigint; r if_rounds; k text; v bigint; tot bigint := 0; clean jsonb := '{}'; v_bal bigint; prev bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_ref is null or length(p_ref) > 80 then raise exception 'invalid_ref'; end if;
  if exists (select 1 from if_bets where ref = p_ref and user_id = u) then
    return jsonb_build_object('ok', true, 'balance', (select balance from wallets where user_id = u));
  end if;
  r := if_current();
  if r.round_no <> p_round or rl_live_now() >= r.start_at + 10 then raise exception 'betting_closed'; end if;
  if jsonb_typeof(p_bets) <> 'object' then raise exception 'invalid_bets'; end if;
  perform pg_advisory_xact_lock(hashtext('ifb:' || u));
  cap := gc_max_for((select balance from wallets where user_id = u) + coalesce((select sum(total) from if_bets where round_no = r.round_no and user_id = u), 0));
  for k, v in select key, value::bigint from jsonb_each_text(p_bets) loop
    if k not in ('dark', 'light', 'blue', 'orange', 'red') or v < 1 then raise exception 'invalid_bet'; end if;
    select coalesce(sum((b.bets->>k)::bigint), 0) into prev from if_bets b where b.round_no = r.round_no and b.user_id = u;
    if prev + v > cap then raise exception 'invalid_amount'; end if;
    clean := clean || jsonb_build_object(k, v); tot := tot + v;
  end loop;
  if tot = 0 then raise exception 'invalid_bets'; end if;
  v_bal := apply_tx(u, 'ido_fishing', 'stake', -tot, 'ifstake:' || u || ':' || p_ref);
  insert into if_bets (round_no, user_id, ref, bets, total) values (r.round_no, u, p_ref, clean, tot);
  return jsonb_build_object('ok', true, 'balance', v_bal);
end $$;
