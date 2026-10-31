-- Shabbat bonus: on Saturday (Jerusalem time) until motzaei Shabbat every job pays +500% (×6).
-- Motzaei Shabbat ≈ sunset in Jerusalem + 35 minutes, from a table of sunset times (UTC) by month, interpolated by day.
create or replace function gc_motzash(p_day date) returns timestamptz language plpgsql immutable as $$
declare s int[] := array[920, 945, 970, 995, 1015, 1030, 1030, 1010, 975, 945, 915, 910];   -- sunset+35m, minutes after 00:00 UTC, mid-month
        m int := extract(month from p_day)::int; d int := extract(day from p_day)::int; a int; b int; f numeric;
begin
  if d >= 15 then a := s[m]; b := s[m % 12 + 1]; f := (d - 15) / 30.0; else a := s[(m + 10) % 12 + 1]; b := s[m]; f := (d + 15) / 30.0; end if;
  return (p_day::timestamp at time zone 'UTC') + make_interval(mins => round(a + (b - a) * f)::int);
end $$;
-- when the current Shabbat bonus ends, or null when it's not Shabbat
create or replace function gc_shabbat_until() returns timestamptz language sql stable as $$
  select case when extract(dow from (now() at time zone 'Asia/Jerusalem')) = 6 and now() < gc_motzash((now() at time zone 'Asia/Jerusalem')::date)
              then gc_motzash((now() at time zone 'Asia/Jerusalem')::date) end $$;
create or replace function gc_job_mult() returns int language sql stable as $$
  select case when gc_shabbat_until() is not null then 6 else 1 end $$;
grant execute on function gc_shabbat_until() to authenticated, anon;

create or replace function job_finish(p_id uuid, p_answer jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r job_runs; ok boolean := false; why text := ''; len int := 0; x int; y int; i int; s int; seen int := 0; n int; v_bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into r from job_runs where id = p_id and user_id = u for update;
  if not found then raise exception 'invalid_job'; end if;
  if r.done then return jsonb_build_object('ok', r.paid > 0, 'paid', r.paid, 'balance', (select balance from wallets where user_id = u), 'again', true); end if;
  if clock_timestamp() > r.deadline then why := 'time';
  elsif clock_timestamp() < r.started_at + interval '2 seconds' then why := 'too_fast';
  elsif r.game = 'dealer' then
    ok := jsonb_typeof(p_answer) = 'array' and p_answer = r.secret->'values';
    if not ok then why := 'wrong'; end if;
  else
    n := jsonb_array_length(r.puzzle->'stops') / 2;
    if jsonb_typeof(p_answer) <> 'array' or jsonb_array_length(p_answer) <> 2 * n then why := 'route';
    else
      x := (r.puzzle->'start'->>0)::int; y := (r.puzzle->'start'->>1)::int;
      for i in 0 .. 2 * n - 1 loop
        s := (p_answer->>i)::int;
        if s is null or s < 0 or s >= 2 * n or seen & (1 << s) <> 0 or (s % 2 = 1 and seen & (1 << (s - 1)) = 0) then why := 'route'; exit; end if;
        seen := seen | (1 << s);
        len := len + abs((r.puzzle->'stops'->s->>0)::int - x) + abs((r.puzzle->'stops'->s->>1)::int - y);
        x := (r.puzzle->'stops'->s->>0)::int; y := (r.puzzle->'stops'->s->>1)::int;
      end loop;
      if why = '' then ok := len <= (r.secret->>'max')::int; if not ok then why := 'long'; end if; end if;
    end if;
  end if;
  r.pay := r.pay * gc_job_mult();
  update job_runs set done = true, paid = case when ok then r.pay else 0 end where id = r.id;
  if ok then v_bal := apply_tx(u, 'job_' || r.game, 'grant', r.pay, 'job:' || r.id); else v_bal := (select balance from wallets where user_id = u); end if;
  return jsonb_build_object('ok', ok, 'paid', case when ok then r.pay else 0 end, 'why', why, 'balance', v_bal, 'len', len,
    'values', case when r.game = 'dealer' then r.secret->'values' end);
end $$;

create or replace function bus_finish(p_id uuid, p_ok int, p_perfect int, p_hits int) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r job_runs; v_pay bigint; secs numeric; v_bal bigint;
begin
  select * into r from job_runs where id = p_id and user_id = u and game = 'driver' for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.done then raise exception 'already_done'; end if;
  if p_ok is null or p_ok < 0 or p_ok > (r.secret->>'stops')::int or p_perfect < 0 or p_perfect > p_ok or p_hits < 0 then raise exception 'invalid_result'; end if;
  secs := extract(epoch from clock_timestamp() - r.started_at);
  if clock_timestamp() > r.deadline or secs < p_ok * 4 then raise exception 'invalid_result'; end if;
  v_pay := greatest(0, p_ok * r.pay + floor(p_perfect * r.pay * 0.3) - floor(p_hits * r.pay * 0.25))::bigint;
  v_pay := v_pay * gc_job_mult();
  update job_runs set done = true, paid = v_pay where id = r.id;
  if v_pay > 0 then v_bal := apply_tx(u, 'job_driver', 'grant', v_pay, 'job:' || r.id); else v_bal := (select balance from wallets where user_id = u); end if;
  return jsonb_build_object('paid', v_pay, 'balance', v_bal, 'level', gc_level_info(u)->'level');
end $$;

create or replace function fish_finish(p_id uuid, p_color int, p_silver int, p_gold int, p_casts int) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r job_runs; v bigint[]; v_pay bigint; n int; secs numeric;
begin
  select * into r from job_runs where id = p_id and user_id = u and game = 'fisher' for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.done then raise exception 'already_done'; end if;
  n := coalesce(p_color, 0) + coalesce(p_silver, 0) + coalesce(p_gold, 0);
  if least(p_color, p_silver, p_gold) < 0 or p_casts < n or p_casts > (r.secret->>'casts')::int then raise exception 'invalid_result'; end if;
  secs := extract(epoch from clock_timestamp() - r.started_at);
  if clock_timestamp() > r.deadline or secs < p_casts * 0.8 then raise exception 'invalid_result'; end if;
  v := fish_vals(r.level);
  if r.level = 4 then
    v_pay := case when p_gold >= 5 and p_color = 0 and p_silver = 0 then p_gold * v[3] else 0 end;
  else
    v_pay := p_color * v[1] + p_silver * v[2] + p_gold * v[3];
  end if;
  v_pay := v_pay * gc_job_mult();
  update job_runs set done = true, paid = v_pay where id = r.id;
  if v_pay > 0 then perform bank_add(u, 'job', v_pay, 'job:' || r.id); end if;
  return jsonb_build_object('paid', v_pay, 'bank', bank_bal(u), 'level', gc_level_info(u)->'level');
end $$;

create or replace function fiber_finish(p_id uuid, p_ok int) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r job_runs; v_pay bigint; secs numeric;
begin
  select * into r from job_runs where id = p_id and user_id = u and game = 'fiber' for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.done then raise exception 'already_done'; end if;
  if p_ok is null or p_ok < 0 or p_ok > 3 then raise exception 'invalid_result'; end if;
  secs := extract(epoch from clock_timestamp() - r.started_at);
  if clock_timestamp() > r.deadline or secs < p_ok * 6 then raise exception 'invalid_result'; end if;
  v_pay := p_ok * r.pay;
  v_pay := v_pay * gc_job_mult();
  update job_runs set done = true, paid = v_pay where id = r.id;
  if v_pay > 0 then perform bank_add(u, 'job', v_pay, 'job:' || r.id); end if;
  return jsonb_build_object('paid', v_pay, 'bank', bank_bal(u), 'level', gc_level_info(u)->'level');
end $$;
