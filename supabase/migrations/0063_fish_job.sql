-- Job "דייג": up to 20 casts (extreme: 10 casts, gold fish only, at least 5 needed). The total is paid into the BANK at the end.
alter table job_runs drop constraint if exists job_runs_game_check;
alter table job_runs add constraint job_runs_game_check check (game in ('dealer', 'driver', 'fisher'));
alter table bank_tx drop constraint if exists bank_tx_kind_check;
alter table bank_tx add constraint bank_tx_kind_check check (kind in ('salary_weekly', 'salary_monthly', 'gift', 'deposit', 'withdraw', 'job'));
create or replace function fish_vals(p_level int) returns bigint[] language sql immutable as $$
  select case p_level when 1 then array[30000,120000,600000] when 2 then array[45000,180000,900000] when 3 then array[60000,240000,1200000] else array[0,0,2500000] end::bigint[] $$;
create or replace function fish_start(p_level int) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r job_runs;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_level not between 1 and 4 then raise exception 'invalid_level'; end if;
  insert into job_runs (user_id, game, level, puzzle, secret, pay, deadline)
    values (u, 'fisher', p_level, '{}'::jsonb, jsonb_build_object('casts', case when p_level = 4 then 10 else 20 end), 0, clock_timestamp() + interval '15 minutes')
    returning * into r;
  return jsonb_build_object('id', r.id, 'casts', r.secret->'casts');
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
  update job_runs set done = true, paid = v_pay where id = r.id;
  if v_pay > 0 then perform bank_add(u, 'job', v_pay, 'job:' || r.id); end if;
  return jsonb_build_object('paid', v_pay, 'bank', bank_bal(u), 'level', gc_level_info(u)->'level');
end $$;
revoke all on function fish_vals(int) from public, anon, authenticated;
revoke all on function fish_start(int), fish_finish(uuid, int, int, int, int) from public, anon;
grant execute on function fish_start(int), fish_finish(uuid, int, int, int, int) to authenticated;
