-- Job "מאלף אריות אסייתיים לבקנים": the lion catches falling gold balls and dodges bombs.
-- Pay and difficulty are the same as the fisher job (fish_vals): plain ball = coloured fish, engraved = silver, rare = gold.
-- 20 good balls fall (extreme: 10 rare only, at least 5 needed). Classic bomb: 3 hits end the shift (paid for what was caught).
-- Spiky bomb: one hit ends the shift with no pay. Total goes to the BANK, ×6 on Shabbat.
alter table job_runs drop constraint if exists job_runs_game_check;
alter table job_runs add constraint job_runs_game_check check (game in ('dealer', 'driver', 'fisher', 'fiber', 'tamer'));

create or replace function tamer_start(p_level int) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r job_runs;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_level not between 1 and 4 then raise exception 'invalid_level'; end if;
  insert into job_runs (user_id, game, level, puzzle, secret, pay, deadline)
    values (u, 'tamer', p_level, '{}'::jsonb, jsonb_build_object('drops', case when p_level = 4 then 10 else 20 end), 0, clock_timestamp() + interval '15 minutes')
    returning * into r;
  return jsonb_build_object('id', r.id, 'drops', r.secret->'drops');
end $$;

create or replace function tamer_finish(p_id uuid, p_plain int, p_engraved int, p_rare int, p_drops int, p_bombs int, p_spiky int) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r job_runs; v bigint[]; v_pay bigint; n int; secs numeric;
begin
  select * into r from job_runs where id = p_id and user_id = u and game = 'tamer' for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.done then raise exception 'already_done'; end if;
  n := coalesce(p_plain, 0) + coalesce(p_engraved, 0) + coalesce(p_rare, 0);
  if least(p_plain, p_engraved, p_rare, p_bombs, p_spiky) < 0 or p_drops < n or p_drops > (r.secret->>'drops')::int
     or p_bombs > 3 or p_spiky > 1 then raise exception 'invalid_result'; end if;
  secs := extract(epoch from clock_timestamp() - r.started_at);
  if clock_timestamp() > r.deadline or secs < p_drops * 0.8 then raise exception 'invalid_result'; end if;
  v := fish_vals(r.level);
  if p_spiky > 0 then v_pay := 0;
  elsif r.level = 4 then
    v_pay := case when p_rare >= 5 and p_plain = 0 and p_engraved = 0 then p_rare * v[3] else 0 end;
  else
    v_pay := p_plain * v[1] + p_engraved * v[2] + p_rare * v[3];
  end if;
  v_pay := v_pay * gc_job_mult();
  update job_runs set done = true, paid = v_pay where id = r.id;
  if v_pay > 0 then perform bank_add(u, 'job', v_pay, 'job:' || r.id); end if;
  return jsonb_build_object('paid', v_pay, 'bank', bank_bal(u), 'level', gc_level_info(u)->'level');
end $$;

revoke all on function tamer_start(int), tamer_finish(uuid, int, int, int, int, int, int) from public, anon;
grant execute on function tamer_start(int), tamer_finish(uuid, int, int, int, int, int, int) to authenticated;
