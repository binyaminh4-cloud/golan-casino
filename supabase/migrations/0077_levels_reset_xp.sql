-- levels: XP resets after each level-up; each level needs its own amount (100, 250, 500 … 8000)
create or replace function gc_level_info(p_user uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare xp bigint; th int[] := array[0, 100, 250, 500, 900, 1500, 2400, 3700, 5500, 8000]; lv int := 1; i int; need int;
begin
  select coalesce((select sum(case level when 1 then 5 when 2 then 8 else 12 end) from job_runs where user_id = p_user and paid > 0), 0)
       + coalesce((select sum(case when finished_at < '2026-10-30T22:13:35Z' then 30 else 15 end) from ch_runs where user_id = p_user and status = 'done' and hands > 0), 0) into xp;
  -- each level costs th[lv + 1] points, and the counter starts again from 0 after every level-up
  while lv < 10 loop need := th[lv + 1]; exit when xp < need; xp := xp - need; lv := lv + 1; end loop;
  if lv = 10 then xp := 0; end if;
  return jsonb_build_object('level', lv, 'xp', xp, 'from', 0, 'to', case when lv < 10 then th[lv + 1] end,
    'weekly', gc_num('salary_weekly') * lv, 'monthly', gc_num('salary_monthly') * lv);
end $$;
revoke all on function gc_level_info(uuid) from public, anon, authenticated;
