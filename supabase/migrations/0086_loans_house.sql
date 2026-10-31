-- Loans (bank tracks + between players) and the house's bank.
-- * Interest is one-time: you take X, you owe X × (1 + rate).
-- * Enforcement ("garnishment"): half of every income that reaches the bank (salaries, job pay, gifts, level-up grants)
--   pays debts first: loans from friends before the bank's, oldest first. Repaying early is always allowed.
-- * Late (past the due date): a one-time 10% penalty on the principal, no new loans, no withdrawals from the bank.
-- * The rich list shows wallet + bank − debts (+ money lent out), so a broke borrower shows in the minus.
-- * The lender takes the risk: if a friend never pays, nobody covers it.

alter table bank_tx drop constraint if exists bank_tx_kind_check;
alter table bank_tx add constraint bank_tx_kind_check check (kind in ('salary_weekly', 'salary_monthly', 'gift', 'deposit', 'withdraw', 'job', 'levelup',
  'loan_in', 'loan_repay', 'loan_out', 'loan_back', 'loan_cancel'));

create table if not exists loans (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('bank', 'p2p')),
  lender uuid references profiles(id) on delete cascade,          -- null = the bank
  borrower uuid references profiles(id) on delete cascade,        -- null while it is an open offer
  target uuid references profiles(id) on delete cascade,          -- an offer to one friend only (null = to everyone)
  principal bigint not null check (principal > 0),
  rate int not null check (rate between 0 and 100),
  days int not null,
  track text,
  due_total bigint not null default 0,
  repaid bigint not null default 0,
  penalty boolean not null default false,
  status text not null check (status in ('offer', 'active', 'late', 'paid', 'cancelled')),
  created_at timestamptz not null default now(), started_at timestamptz, due_at timestamptz, paid_at timestamptz);
create index if not exists loans_borrower on loans (borrower, status);
create index if not exists loans_lender on loans (lender, status);
alter table loans enable row level security;
revoke all on loans from anon, authenticated;

create or replace function loan_tracks() returns jsonb language sql immutable as $$
  select '[{"id":"fast","name":"מהיר","days":7,"rate":8},{"id":"normal","name":"רגיל","days":30,"rate":15},{"id":"long","name":"ארוך","days":90,"rate":25}]'::jsonb $$;

-- loans past their due date become late, with the 10% penalty once
create or replace function loan_tick() returns void language sql security definer set search_path = public as $$
  update loans set status = 'late', due_total = due_total + principal / 10, penalty = true where status = 'active' and due_at < now() $$;

create or replace function loan_debt(p_user uuid) returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(due_total - repaid), 0) from loans where borrower = p_user and status in ('active', 'late') $$;
create or replace function loan_lent(p_user uuid) returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when status = 'offer' then principal else due_total - repaid end), 0) from loans
   where lender = p_user and kind = 'p2p' and status in ('offer', 'active', 'late') $$;

-- put x toward one loan (the money already left the borrower); a friend's share goes to his bank
create or replace function loan_apply(p_loan uuid, p_amount bigint, p_ref text) returns bigint language plpgsql security definer set search_path = public as $$
declare l loans; x bigint;
begin
  select * into l from loans where id = p_loan for update;
  if not found or l.status not in ('active', 'late') or p_amount <= 0 then return 0; end if;
  x := least(p_amount, l.due_total - l.repaid);
  update loans set repaid = repaid + x, status = case when repaid + x >= due_total then 'paid' else status end,
         paid_at = case when repaid + x >= due_total then now() end where id = l.id;
  if l.kind = 'p2p' then perform bank_add(l.lender, 'loan_back', x, p_ref || ':back:' || l.id); end if;
  if l.repaid + x >= l.due_total then
    perform chat_sys('lobby', '✅ ' || (select nickname from profiles where id = l.borrower) || ' סגר את ההלוואה ' ||
      case when l.kind = 'p2p' then 'מ' || (select nickname from profiles where id = l.lender) else 'מהבנק' end || '.');
  end if;
  return x;
end $$;

-- spread an amount over all of a borrower's debts: friends first, then the bank, oldest first
create or replace function loan_pay_all(p_user uuid, p_amount bigint, p_ref text) returns bigint language plpgsql security definer set search_path = public as $$
declare l record; left_ bigint := p_amount;
begin
  for l in select id from loans where borrower = p_user and status in ('active', 'late') order by (kind = 'bank'), started_at loop
    exit when left_ <= 0;
    left_ := left_ - loan_apply(l.id, left_, p_ref);
  end loop;
  return p_amount - left_;
end $$;

-- bank_add now garnishes half of every income while the player owes money
create or replace function bank_add(p_user uuid, p_kind text, p_amount bigint, p_ref text) returns bigint language plpgsql security definer set search_path = public as $$
declare b bigint; g bigint; used bigint;
begin
  insert into bank_tx (user_id, kind, amount, ref) values (p_user, p_kind, p_amount, p_ref);
  insert into bank_accounts (user_id, balance) values (p_user, greatest(0, p_amount))
    on conflict (user_id) do update set balance = bank_accounts.balance + p_amount returning balance into b;
  if b < 0 then raise exception 'insufficient_bank'; end if;
  if p_amount > 0 and p_kind in ('salary_weekly', 'salary_monthly', 'job', 'gift', 'levelup') then
    perform loan_tick();
    g := least(p_amount / 2, loan_debt(p_user));
    if g > 0 then
      used := loan_pay_all(p_user, g, p_ref || ':garnish');
      if used > 0 then
        insert into bank_tx (user_id, kind, amount, ref) values (p_user, 'loan_repay', -used, p_ref || ':garnish');
        update bank_accounts set balance = balance - used where user_id = p_user returning balance into b;
      end if;
    end if;
  end if;
  return b;
end $$;
revoke all on function bank_add(uuid, text, bigint, text) from public, anon, authenticated;

-- no withdrawals while a loan is late
create or replace function bank_move(p_amount bigint, p_dir text, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); bb bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_amount is null or p_amount < 1 then raise exception 'invalid_amount'; end if;
  if p_dir not in ('deposit', 'withdraw') then raise exception 'invalid_dir'; end if;
  perform pg_advisory_xact_lock(hashtext('bank:' || u));
  if p_dir = 'deposit' then
    perform apply_tx(u, 'bank', 'buyin', -p_amount, 'bankdep:' || u || ':' || p_ref);
    bb := bank_add(u, 'deposit', p_amount, 'bankdep:' || u || ':' || p_ref);
  else
    perform loan_tick();
    if exists (select 1 from loans where borrower = u and status = 'late') then raise exception 'loan_late'; end if;
    if coalesce((select balance from bank_accounts where user_id = u), 0) < p_amount then raise exception 'insufficient_bank'; end if;
    bb := bank_add(u, 'withdraw', -p_amount, 'bankwd:' || u || ':' || p_ref);
    perform apply_tx(u, 'bank', 'cashout', p_amount, 'bankwd:' || u || ':' || p_ref);
  end if;
  return bank_state();
end $$;

-- ---------- player RPCs ----------
create or replace function loan_bank_take(p_track text, p_amount bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); tr jsonb; lv int; id_ uuid;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  perform pg_advisory_xact_lock(hashtext('loan:' || u));
  perform loan_tick();
  select x into tr from jsonb_array_elements(loan_tracks()) x where x->>'id' = p_track;
  if tr is null then raise exception 'invalid_track'; end if;
  if exists (select 1 from loans where borrower = u and status = 'late') then raise exception 'loan_late'; end if;
  if (select count(*) from loans where borrower = u and kind = 'bank' and status in ('active', 'late')) >= 3 then raise exception 'too_many_loans'; end if;
  lv := (gc_level_info(u)->>'level')::int;
  if p_amount is null or p_amount < 1000000 or p_amount > 100000000::bigint * lv then raise exception 'invalid_amount'; end if;
  insert into loans (kind, borrower, principal, rate, days, track, due_total, status, started_at, due_at)
    values ('bank', u, p_amount, (tr->>'rate')::int, (tr->>'days')::int, p_track, p_amount + p_amount * (tr->>'rate')::int / 100, 'active', now(),
            now() + make_interval(days => (tr->>'days')::int)) returning id into id_;
  perform bank_add(u, 'loan_in', p_amount, 'loan:' || id_);
  return loans_state();
end $$;

create or replace function loan_offer(p_amount bigint, p_rate int, p_days int, p_to uuid default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); id_ uuid; nm text := (select nickname from profiles where id = auth.uid());
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_rate is null or p_rate < 5 or p_rate > 25 then raise exception 'invalid_rate'; end if;
  if p_days not in (7, 14, 30) then raise exception 'invalid_days'; end if;
  if p_amount is null or p_amount < 1000000 then raise exception 'invalid_amount'; end if;
  if p_to = u or (p_to is not null and not exists (select 1 from profiles where id = p_to)) then raise exception 'invalid_target'; end if;
  perform pg_advisory_xact_lock(hashtext('bank:' || u));
  insert into loans (kind, lender, target, principal, rate, days, status) values ('p2p', u, p_to, p_amount, p_rate, p_days, 'offer') returning id into id_;
  perform bank_add(u, 'loan_out', -p_amount, 'loanoff:' || id_);            -- the money waits in escrow (fails if the bank is short)
  perform chat_sys('lobby', '💸 ' || nm || ' מציע הלוואה של ₪' || to_char(p_amount, 'FM999,999,999,999,999') || ' ב־' || p_rate || '% ל־' || p_days || ' ימים' ||
    coalesce(' ל' || (select nickname from profiles where id = p_to), ' לכל מי שרוצה') || '. בבנק → הלוואות.');
  return loans_state();
end $$;

create or replace function loan_cancel(p_loan uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); l loans;
begin
  select * into l from loans where id = p_loan and lender = u and status = 'offer' for update;
  if not found then raise exception 'loan_closed'; end if;
  update loans set status = 'cancelled' where id = l.id;
  perform bank_add(u, 'loan_cancel', l.principal, 'loancancel:' || l.id);
  return loans_state();
end $$;

create or replace function loan_accept(p_loan uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); l loans;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  perform loan_tick();
  if exists (select 1 from loans where borrower = u and status = 'late') then raise exception 'loan_late'; end if;
  select * into l from loans where id = p_loan and status = 'offer' for update;
  if not found or l.lender = u or (l.target is not null and l.target <> u) then raise exception 'loan_closed'; end if;
  update loans set status = 'active', borrower = u, started_at = now(), due_at = now() + make_interval(days => l.days),
         due_total = l.principal + l.principal * l.rate / 100 where id = l.id;
  perform bank_add(u, 'loan_in', l.principal, 'loan:' || l.id);
  perform chat_sys('lobby', '🤝 ' || (select nickname from profiles where id = l.lender) || ' הלווה ל' || (select nickname from profiles where id = u) ||
    ' ₪' || to_char(l.principal, 'FM999,999,999,999,999') || ' ב־' || l.rate || '%. להחזיר תוך ' || l.days || ' ימים.');
  return loans_state();
end $$;

create or replace function loan_repay(p_loan uuid, p_amount bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); l loans; x bigint; ref text := 'repay:' || p_loan || ':' || extract(epoch from clock_timestamp())::text;
begin
  perform pg_advisory_xact_lock(hashtext('bank:' || u));
  select * into l from loans where id = p_loan and borrower = u and status in ('active', 'late');
  if not found then raise exception 'loan_closed'; end if;
  x := least(coalesce(p_amount, 0), l.due_total - l.repaid, bank_bal(u));
  if x < 1 then raise exception 'insufficient_bank'; end if;
  perform bank_add(u, 'loan_repay', -x, ref);
  perform loan_apply(l.id, x, ref);
  return loans_state();
end $$;

create or replace function loans_state() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); lv int;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  perform loan_tick();
  lv := (gc_level_info(u)->>'level')::int;
  return jsonb_build_object(
    'bank', bank_bal(u), 'level', lv, 'max', 100000000::bigint * lv, 'tracks', loan_tracks(),
    'bank_loans', (select count(*) from loans where borrower = u and kind = 'bank' and status in ('active', 'late')),
    'late', exists (select 1 from loans where borrower = u and status = 'late'),
    'debt', loan_debt(u),
    'mine', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'from', coalesce(p.nickname, 'הבנק'), 'principal', l.principal, 'rate', l.rate,
              'owed', l.due_total - l.repaid, 'total', l.due_total, 'due', l.due_at, 'status', l.status) order by l.status = 'paid', l.started_at desc)
              from loans l left join profiles p on p.id = l.lender where l.borrower = u and (l.status in ('active', 'late') or l.paid_at > now() - interval '7 days')), '[]'),
    'given', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'to', coalesce(p.nickname, t.nickname), 'open', l.status = 'offer', 'principal', l.principal, 'rate', l.rate,
              'days', l.days, 'owed', l.due_total - l.repaid, 'due', l.due_at, 'status', l.status) order by l.created_at desc)
              from loans l left join profiles p on p.id = l.borrower left join profiles t on t.id = l.target
              where l.lender = u and (l.status in ('offer', 'active', 'late') or l.paid_at > now() - interval '7 days')), '[]'),
    'offers', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'from', p.nickname, 'principal', l.principal, 'rate', l.rate, 'days', l.days,
              'total', l.principal + l.principal * l.rate / 100, 'personal', l.target is not null) order by l.created_at desc)
              from loans l join profiles p on p.id = l.lender where l.status = 'offer' and l.lender <> u and (l.target is null or l.target = u)), '[]'),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', nickname) order by nickname) from profiles where id <> u and not gc_is_test(id)), '[]'));
end $$;
revoke all on function loan_bank_take(text, bigint), loan_offer(bigint, int, int, uuid), loan_cancel(uuid), loan_accept(uuid), loan_repay(uuid, bigint), loans_state() from public, anon;
grant execute on function loan_bank_take(text, bigint), loan_offer(bigint, int, int, uuid), loan_cancel(uuid), loan_accept(uuid), loan_repay(uuid, bigint), loans_state() to authenticated;
revoke all on function loan_tick(), loan_apply(uuid, bigint, text), loan_pay_all(uuid, bigint, text) from public, anon, authenticated;

-- rich list: wallet + bank (+ poker chips) − debts + money lent out; who is late
create or replace view leaderboard with (security_invoker = true) as
  select p.id, p.nickname, p.avatar_url, p.character_key,
         w.balance + bank_bal(p.id)
           + coalesce((select sum(s.stack) from poker_seats s join poker_tables t on t.id = s.table_id where s.user_id = p.id and t.tourney is null), 0)
           - loan_debt(p.id) + loan_lent(p.id) as wealth,
         loan_debt(p.id) as debt,
         exists (select 1 from loans l where l.borrower = p.id and (l.status = 'late' or (l.status = 'active' and l.due_at < now()))) as late
  from profiles p join wallets w on w.user_id = p.id;
grant execute on function loan_debt(uuid), loan_lent(uuid) to authenticated;

-- ---------- the house's bank: what the casino won (bets lost − wins paid), cached for 5 minutes ----------
create table if not exists house_stats (id int primary key default 1, total bigint, games jsonb, at timestamptz);
alter table house_stats enable row level security;
revoke all on house_stats from anon, authenticated;
create or replace function house_stats() returns jsonb language plpgsql security definer set search_path = public as $$
declare h house_stats; g jsonb;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into h from house_stats where id = 1;
  if found and h.at > now() - interval '5 minutes' then return jsonb_build_object('total', h.total, 'games', h.games, 'at', h.at); end if;
  perform pg_advisory_xact_lock(hashtext('house_stats'));
  select coalesce(jsonb_object_agg(game, net), '{}') into g from (
    select game, -sum(amount) net from wallet_transactions where kind in ('stake', 'payout') group by game
    union all
    select 'poker_bots', -coalesce(sum(w.amount), 0) from wallet_transactions w
      where w.game = 'poker' and exists (select 1 from poker_tables t where (t.bots_owner is not null or t.bots_shared is not null) and w.settlement_ref like '%' || t.id::text || '%')
    union all
    select 'bank_loans', coalesce(sum(greatest(0, repaid - principal)), 0) from loans where kind = 'bank') x;
  insert into house_stats values (1, (select coalesce(sum(value::text::bigint), 0) from jsonb_each(g)), g, now())
    on conflict (id) do update set total = excluded.total, games = excluded.games, at = excluded.at returning * into h;
  return jsonb_build_object('total', h.total, 'games', h.games, 'at', h.at);
end $$;
revoke all on function house_stats() from public, anon;
grant execute on function house_stats() to authenticated;
