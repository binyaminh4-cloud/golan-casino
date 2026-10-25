\set ON_ERROR_STOP on
create or replace function t_as(u uuid) returns void language sql as $$ select set_config('request.jwt.sub', coalesce(u::text,''), false) $$;
select t_as((select id from profiles where is_admin limit 1));
select t_assert((select username from profiles where is_admin limit 1) = 'בנימין', 'owner got username');
select t_assert(length(admin_issue_code('Dani')) = 6, 'admin issues 6-digit code');
select t_as(null);
select t_assert(t_raises($$select admin_issue_code('x1')$$, 'not_admin'), 'non-admin cannot issue codes');
-- brute force: wrong codes counted, locked after 8
do $$ declare i int; begin
  for i in 1..8 loop perform t_assert(redeem_code('dani', 'zzzzzz', 'secret1') is null, 'wrong code refused'); end loop; end $$;
select t_assert(t_raises($$select redeem_code('dani','000000','secret1')$$, 'code_locked'), 'locked after 8 wrong tries');
-- fresh code, redeem
select t_as((select id from profiles where is_admin limit 1));
create temp table k as select admin_issue_code(' DANI ') c;
select t_as(null);
select t_assert(t_raises(format($$select redeem_code('dani',%L,'123')$$,(select c from k)), 'weak_password'), 'short password refused');
create temp table e as select redeem_code('Dani', (select c from k), 'secret1') em;
select t_assert((select em from e) like 'm%@members.golan-casino.app', 'account created with placeholder address');
select t_assert((select encrypted_password = extensions.crypt('secret1', encrypted_password) from auth.users where email=(select em from e)), 'password stored as bcrypt');
select t_assert((select count(*) from auth.identities i join auth.users u on u.id=i.user_id where u.email=(select em from e)) = 1, 'identity row created');
select t_assert((select username='dani' and nickname='dani' from profiles p join auth.users u on u.id=p.id where u.email=(select em from e)), 'profile with username');
select t_assert((select w.balance from wallets w join auth.users u on u.id=w.user_id where u.email=(select em from e)) = (select starting_balance from app_settings), 'starting balance granted');
select t_assert(login_email('DANI') = (select em from e), 'login by username finds address');
select t_assert(t_raises(format($$select redeem_code('dani',%L,'secret2')$$,(select c from k)), 'bad_code'), 'code is single use');
-- reset for existing member
select t_as((select id from profiles where is_admin limit 1));
create temp table k2 as select admin_issue_code('dani') c;
select t_as(null);
select t_assert(redeem_code('dani',(select c from k2),'newpass9') = (select em from e), 'reset keeps same account');
select t_assert((select encrypted_password = extensions.crypt('newpass9', encrypted_password) from auth.users where email=(select em from e)), 'password changed');
select t_assert((select count(*) from profiles where username='dani')=1, 'no duplicate profile');
-- client signUp without invite still blocked
select t_assert(t_raises($$insert into auth.users(email, raw_app_meta_data) values ('x@y.com','{}')$$, 'not_invited'), 'uninvited signup still blocked');
\echo LOGIN TESTS DONE
