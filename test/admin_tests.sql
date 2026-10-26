\set ON_ERROR_STOP on
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
update profiles set is_admin = (id = '00000000-0000-0000-0000-00000000000a');
update gc_settings set value = 'false' where key = 'challenges';
select t_assert((ch_state()->>'paused')::boolean, 'challenges paused');
select t_assert(t_raises($$select ch_start_fisher()$$, 'challenges_paused'), 'no runs while paused');
select t_assert(t_raises($$select tourney_join()$$, 'challenges_paused'), 'no tournaments while paused');
select admin_set('challenges', 'true');
select t_assert((ch_state()->>'season')::int >= 1, 'challenges on');
select admin_set('games', '{"poker":false}');
select t_assert((gc_public()->'games'->>'poker')::boolean = false and (gc_public()->'games'->>'slots')::boolean, 'game toggle');
select admin_set('salary_weekly', '7000');
select t_assert(gc_num('salary_weekly') = 7000, 'salary setting');
select t_assert(jsonb_array_length(admin_members()) >= 2, 'members list');
do $$ declare s1 int; s2 int; begin
  s1 := (ch_state()->>'season')::int; perform admin_season_restart(); s2 := (ch_state()->>'season')::int;
  perform t_assert(s2 = s1 + 1, 'season restarted (' || s1 || ' -> ' || s2 || ')');
end $$;
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000b', false);
select t_assert(t_raises($$select admin_set('challenges','false')$$, 'not_admin'), 'members cannot change settings');
select t_assert(t_raises($$select admin_members()$$, 'not_admin'), 'members cannot list members');
\echo ADMIN TESTS DONE
