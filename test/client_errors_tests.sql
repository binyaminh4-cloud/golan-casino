-- Issue #9 tests: run after test/supabase_stub.sql and supabase/migrations/0137_client_errors.sql.  psql -v ON_ERROR_STOP=1 -f this_file
\set ON_ERROR_STOP on
create or replace function t_as(u uuid) returns void language sql as $$ select set_config('request.jwt.sub', coalesce(u::text, ''), false) $$;
create or replace function t_ok(c boolean, name text) returns void language plpgsql as $$ begin if not coalesce(c, false) then raise exception 'FAIL: %', name; end if; raise notice 'ok: %', name; end $$;
create or replace function t_raises(sql text, part text) returns void language plpgsql as $$ begin
  begin execute sql; exception when others then
    if sqlerrm like '%' || part || '%' then raise notice 'ok (raises %): %', part, sql; return; end if;
    raise exception 'FAIL: wrong error "%" for: %', sqlerrm, sql;
  end;
  raise exception 'FAIL: did not raise (%): %', part, sql;
end $$;

-- 1. an error is recorded (signed in), with page cleaned, device from the list, time set
select t_as('00000000-0000-0000-0000-0000000000a1');
select t_ok(log_client_error('/golan-casino/roulette.html?mode=xxx&t=eyJabc#top', 'TypeError: x is not a function', 'iphone'), 'error logged');
select t_ok((select page = 'roulette.html' and message = 'TypeError: x is not a function' and device = 'iphone' and created_at > now() - interval '1 minute' from client_errors order by id desc limit 1), 'page without parameters, device and time kept');
select log_client_error('a.html', 'm2', 'Nokia 3310');
select t_ok((select device = 'other' from client_errors order by id desc limit 1), 'unknown device becomes other');

-- 2. privacy: long message cut to 300, urls / tokens / emails / long secrets removed
select log_client_error('a.html', repeat('x ', 400), 'android');
select t_ok((select length(message) <= 300 from client_errors order by id desc limit 1), 'message cut to 300');
select log_client_error('a.html', 'fetch https://mmoutbadlczgatdgcpvp.supabase.co/rest/v1/rpc/x?apikey=SECRET failed for dan@example.com with eyJhbGciOi.eyJzdWIiOiIx.sig_nature and 0123456789abcdef0123456789abcdef01234567', 'desktop');
select t_ok((select message from client_errors order by id desc limit 1) = 'fetch [url] failed for [email] with [token] and [token]', 'url, email and tokens removed');
select t_ok((select count(*) from client_errors where message ~* 'supabase|SECRET|example|eyJ|0123456789') = 0, 'no secret text anywhere in the log');
select t_ok(not log_client_error('a.html', '   ', 'iphone'), 'empty message is dropped');
select t_ok(not log_client_error('a.html', null, 'iphone'), 'null message is dropped');

-- 3. not signed in is blocked, and the table itself cannot be reached by the browser roles
select t_as(null);
select t_raises($q$ select log_client_error('a.html', 'x', 'iphone') $q$, 'not_signed_in');
select t_ok(not has_function_privilege('anon', 'log_client_error(text,text,text)', 'execute'), 'anon cannot call it');
select t_ok(has_function_privilege('authenticated', 'log_client_error(text,text,text)', 'execute'), 'signed-in role can call it');
select t_ok(not has_table_privilege('authenticated', 'client_errors', 'select,insert,update,delete'), 'signed-in role cannot touch the table');
select t_ok(not has_table_privilege('anon', 'client_errors', 'select,insert,update,delete'), 'anon cannot touch the table');
select t_ok(not has_table_privilege('authenticated', 'client_error_rate', 'select,insert,update,delete'), 'signed-in role cannot touch the rate table');
select t_ok((select relrowsecurity from pg_class where relname = 'client_errors'), 'row level security is on');

-- 4. rate limit: 20 per user per 10 minutes, another user is not affected
truncate client_errors, client_error_rate;
select t_as('00000000-0000-0000-0000-0000000000b1');
select t_ok((select count(*) filter (where log_client_error('a.html', 'spam ' || g, 'iphone')) = 20 from generate_series(1, 30) g), 'only 20 of 30 stored');
select t_ok((select count(*) = 20 from client_errors), '20 rows in the log');
select t_ok(not log_client_error('a.html', 'one more', 'iphone'), 'the 21st is dropped');
select t_as('00000000-0000-0000-0000-0000000000b2');
select t_ok(log_client_error('a.html', 'other user is fine', 'iphone'), 'another user can still log');

-- 5. the log keeps only the latest 5,000 rows (fill it by hand, then write through the function)
truncate client_errors, client_error_rate;
insert into client_errors (page, message, device) select 'a.html', 'old ' || g, 'iphone' from generate_series(1, 5000) g;
select t_ok((select count(*) = 5000 from client_errors), 'filled to 5,000');
select t_as('00000000-0000-0000-0000-0000000000c1');
select log_client_error('a.html', 'newest', 'iphone');
select t_ok((select count(*) = 5000 from client_errors), 'still 5,000 after one more');
select t_ok((select message = 'newest' from client_errors order by id desc limit 1), 'newest is kept');
select t_ok((select count(*) = 0 from client_errors where message = 'old 1'), 'oldest is gone');
select log_client_error('a.html', 'newest 2', 'iphone'); select log_client_error('a.html', 'newest 3', 'iphone');
select t_ok((select count(*) = 5000 from client_errors), 'stays at 5,000');

-- 6. old rate rows are cleaned
insert into client_error_rate values ('00000000-0000-0000-0000-0000000000d1', now() - interval '3 days', 5);
select t_as('00000000-0000-0000-0000-0000000000c2');
select log_client_error('a.html', 'first of this user', 'iphone');
select t_ok((select count(*) = 0 from client_error_rate where win < now() - interval '2 days'), 'old rate rows removed');
\echo ALL CLIENT ERROR TESTS PASSED
