-- Job "טכנאי סיבים": 3 cabinets a shift; every cabinet finished in time pays the level's rate. Paid into the BANK at the end.
alter table job_runs drop constraint if exists job_runs_game_check;
alter table job_runs add constraint job_runs_game_check check (game in ('dealer', 'driver', 'fisher', 'fiber'));
create or replace function fiber_rate(p_level int) returns bigint language sql immutable as $$ select (array[250000, 400000, 550000, 6000000])[p_level]::bigint $$;
create or replace function fiber_start(p_level int) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r job_runs;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_level not between 1 and 4 then raise exception 'invalid_level'; end if;
  insert into job_runs (user_id, game, level, puzzle, secret, pay, deadline)
    values (u, 'fiber', p_level, '{}'::jsonb, '{"cabinets":3}'::jsonb, fiber_rate(p_level), clock_timestamp() + interval '10 minutes') returning * into r;
  return jsonb_build_object('id', r.id);
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
  update job_runs set done = true, paid = v_pay where id = r.id;
  if v_pay > 0 then perform bank_add(u, 'job', v_pay, 'job:' || r.id); end if;
  return jsonb_build_object('paid', v_pay, 'bank', bank_bal(u), 'level', gc_level_info(u)->'level');
end $$;
revoke all on function fiber_rate(int) from public, anon, authenticated;
revoke all on function fiber_start(int), fiber_finish(uuid, int) from public, anon;
grant execute on function fiber_start(int), fiber_finish(uuid, int) to authenticated;
