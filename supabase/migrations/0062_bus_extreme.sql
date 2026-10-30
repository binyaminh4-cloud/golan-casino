-- Minibus driver: an "extreme" level 4 (×25 the easy pay per passenger; missing a stop ends the shift with no pay).
alter table job_runs drop constraint if exists job_runs_level_check;
alter table job_runs add constraint job_runs_level_check check (level between 1 and 4);
create or replace function bus_rate(p_level int) returns bigint language sql immutable as $$ select (array[70000, 105000, 140000, 1750000])[p_level]::bigint $$;
revoke all on function bus_rate(int) from public, anon, authenticated;
create or replace function bus_start(p_level int) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r job_runs; seed int := floor(random() * 2000000000)::int;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_level not between 1 and 4 then raise exception 'invalid_level'; end if;
  insert into job_runs (user_id, game, level, puzzle, secret, pay, deadline)
    values (u, 'driver', p_level, jsonb_build_object('seed', seed, 'stops', 8), jsonb_build_object('stops', 8), bus_rate(p_level), clock_timestamp() + interval '10 minutes')
    returning * into r;
  return jsonb_build_object('id', r.id, 'seed', seed, 'stops', 8, 'rate', r.pay, 'level', p_level);
end $$;
revoke all on function bus_start(int), bus_finish(uuid, int, int, int) from public, anon;
grant execute on function bus_start(int), bus_finish(uuid, int, int, int) to authenticated;
