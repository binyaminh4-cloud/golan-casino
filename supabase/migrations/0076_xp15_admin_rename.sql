-- challenge XP: 15 per finished challenge from now on (challenges finished before this keep their 30)
create or replace function gc_level_info(p_user uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare xp bigint; th int[] := array[0, 100, 250, 500, 900, 1500, 2400, 3700, 5500, 8000]; lv int := 1; i int;
begin
  select coalesce((select sum(case level when 1 then 5 when 2 then 8 else 12 end) from job_runs where user_id = p_user and paid > 0), 0)
       + coalesce((select sum(case when finished_at < '2026-10-30T22:13:35Z' then 30 else 15 end) from ch_runs where user_id = p_user and status = 'done' and hands > 0), 0) into xp;
  for i in 1..10 loop if xp >= th[i] then lv := i; end if; end loop;
  return jsonb_build_object('level', lv, 'xp', xp, 'from', th[lv], 'to', case when lv < 10 then th[lv + 1] end,
    'weekly', gc_num('salary_weekly') * lv, 'monthly', gc_num('salary_monthly') * lv);
end $$;
revoke all on function gc_level_info(uuid) from public, anon, authenticated;

-- the owner can change a member's display name
create or replace function admin_rename(p_user uuid, p_name text) returns jsonb language plpgsql security definer set search_path = public as $$
declare n text := btrim(p_name);
begin
  if not gc_is_admin() then raise exception 'not_admin'; end if;
  if n is null or length(n) < 2 or length(n) > 20 then raise exception 'invalid_name'; end if;
  update profiles set nickname = n where id = p_user;
  if not found then raise exception 'no_such_user'; end if;
  return jsonb_build_object('id', p_user, 'name', n);
end $$;
revoke all on function admin_rename(uuid, text) from public, anon;
grant execute on function admin_rename(uuid, text) to authenticated;
