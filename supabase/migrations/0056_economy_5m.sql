-- New economy (owner's decision): new players start with ₪5,000,000; salaries ₪5,000,000 weekly and ₪25,000,000 monthly;
-- jobs pay about ₪5,000,000 per 10 minutes of work (higher levels pay more for the same time). Existing balances untouched.
update app_settings set starting_balance = 5000000 where id = 1;
insert into gc_settings values ('salary_weekly', '5000000'), ('salary_monthly', '25000000')
  on conflict (key) do update set value = excluded.value;
create or replace function job_pay(p_game text, p_level int) returns bigint language sql immutable as $$
  select case p_game when 'dealer' then (array[170000, 250000, 330000])[p_level] else (array[200000, 300000, 400000])[p_level] end::bigint $$;
revoke all on function job_pay(text, int) from public, anon, authenticated;
