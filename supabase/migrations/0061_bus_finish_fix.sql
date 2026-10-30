-- fix: the local variable "pay" clashed with the job_runs.pay column
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
  update job_runs set done = true, paid = v_pay where id = r.id;
  if v_pay > 0 then v_bal := apply_tx(u, 'job_driver', 'grant', v_pay, 'job:' || r.id); else v_bal := (select balance from wallets where user_id = u); end if;
  return jsonb_build_object('paid', v_pay, 'balance', v_bal, 'level', gc_level_info(u)->'level');
end $$;
