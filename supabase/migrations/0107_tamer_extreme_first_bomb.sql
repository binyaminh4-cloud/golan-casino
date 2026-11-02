-- Extreme lion tamer: any bomb means failure and zero pay, even after five rare catches.
-- Levels 1-3 retain their three ordinary-bomb lives and earned-pay rules.
begin;
do $guard$ begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.tamer_finish(uuid,integer,integer,integer,integer,integer,integer)') and md5(replace(prosrc,chr(13),'')) in ('8359667d0fb32659427a61e6590eb137','049f14fd141677d0df2a03eb3188a2b6')) then raise exception 'unexpected_installed_tamer_finish';end if;
end $guard$;

create or replace function tamer_finish(p_id uuid, p_plain int, p_engraved int, p_rare int, p_drops int, p_bombs int, p_spiky int) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r job_runs; v bigint[]; v_pay bigint; n int; secs numeric;
begin
  select * into r from job_runs where id = p_id and user_id = u and game = 'tamer' for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.done then raise exception 'already_done'; end if;
  n := coalesce(p_plain, 0) + coalesce(p_engraved, 0) + coalesce(p_rare, 0);
  if num_nulls(p_plain,p_engraved,p_rare,p_drops,p_bombs,p_spiky)>0 or least(p_plain, p_engraved, p_rare, p_bombs, p_spiky) < 0 or p_drops < n or p_drops > (r.secret->>'drops')::int
     or p_bombs > 3 or p_spiky > 1 then raise exception 'invalid_result'; end if;
  secs := extract(epoch from clock_timestamp() - r.started_at);
  if clock_timestamp() > r.deadline or secs < p_drops * 0.8 then raise exception 'invalid_result'; end if;
  v := fish_vals(r.level);
  if p_spiky > 0 or (r.level = 4 and p_bombs > 0) then v_pay := 0;
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
commit;
