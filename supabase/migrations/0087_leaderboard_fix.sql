-- the rich list view runs as the member, who can't read the loans table: ask through definer functions only
create or replace function loan_late(p_user uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from loans l where l.borrower = p_user and (l.status = 'late' or (l.status = 'active' and l.due_at < now()))) $$;
grant execute on function loan_late(uuid) to authenticated;
create or replace view leaderboard with (security_invoker = true) as
  select p.id, p.nickname, p.avatar_url, p.character_key,
         w.balance + bank_bal(p.id)
           + coalesce((select sum(s.stack) from poker_seats s join poker_tables t on t.id = s.table_id where s.user_id = p.id and t.tourney is null), 0)
           - loan_debt(p.id) + loan_lent(p.id) as wealth,
         loan_debt(p.id) as debt,
         loan_late(p.id) as late
  from profiles p join wallets w on w.user_id = p.id;
