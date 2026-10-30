-- Job "נהג מיניבוס" (skill game played on the phone). The server opens a shift with a route seed and pays at the end:
-- per passenger picked up, +30% for a perfect stop, −25% for each obstacle hit. A shift can't pay faster than real driving allows.
create or replace function bus_rate(p_level int) returns bigint language sql immutable as $$ select (array[70000, 105000, 140000])[p_level]::bigint $$;
create or replace function bus_start(p_level int) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r job_runs; seed int := floor(random() * 2000000000)::int;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_level not between 1 and 3 then raise exception 'invalid_level'; end if;
  insert into job_runs (user_id, game, level, puzzle, secret, pay, deadline)
    values (u, 'driver', p_level, jsonb_build_object('seed', seed, 'stops', 8), jsonb_build_object('stops', 8), bus_rate(p_level), clock_timestamp() + interval '10 minutes')
    returning * into r;
  return jsonb_build_object('id', r.id, 'seed', seed, 'stops', 8, 'rate', r.pay, 'level', p_level);
end $$;
create or replace function bus_finish(p_id uuid, p_ok int, p_perfect int, p_hits int) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r job_runs; pay bigint; secs numeric; v_bal bigint;
begin
  select * into r from job_runs where id = p_id and user_id = u and game = 'driver' for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.done then raise exception 'already_done'; end if;
  if p_ok is null or p_ok < 0 or p_ok > (r.secret->>'stops')::int or p_perfect < 0 or p_perfect > p_ok or p_hits < 0 then raise exception 'invalid_result'; end if;
  secs := extract(epoch from clock_timestamp() - r.started_at);
  if clock_timestamp() > r.deadline or secs < p_ok * 4 then raise exception 'invalid_result'; end if;
  pay := greatest(0, p_ok * r.pay + floor(p_perfect * r.pay * 0.3) - floor(p_hits * r.pay * 0.25))::bigint;
  update job_runs set done = true, paid = pay where id = r.id;
  if pay > 0 then v_bal := apply_tx(u, 'job_driver', 'grant', pay, 'job:' || r.id); else v_bal := (select balance from wallets where user_id = u); end if;
  return jsonb_build_object('paid', pay, 'balance', v_bal, 'level', gc_level_info(u)->'level');
end $$;
revoke all on function bus_rate(int) from public, anon, authenticated;
revoke all on function bus_start(int), bus_finish(uuid, int, int, int) from public, anon;
grant execute on function bus_start(int), bus_finish(uuid, int, int, int) to authenticated;
