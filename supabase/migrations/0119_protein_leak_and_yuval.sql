-- 1) שולה החלבון leak: pm_view sent every rock with its 'bomb' flag, so the browser (dev tools) showed where the bombs were and
--    a player could pick only safe rocks by index (×5 every round). Now an untaken rock carries no 'bomb' and no 'units' while
--    the run is open; the page gets only the number of bombs left per layer (bombs_left), which is what it shows.
create or replace function pm_view(r pm_runs) returns jsonb language sql stable as $$
  select jsonb_build_object('id', r.id, 'stake', r.stake, 'mode', r.mode, 'layer', r.layer, 'successes', r.successes, 'bank_units', r.bank_units,
    'phase', r.phase, 'paid', r.paid, 'balance', (select balance from wallets where user_id = r.user_id),
    'rocks', (select jsonb_agg(case when (x->>'taken')::boolean or r.phase in ('busted','cashed','finished') then x
                                    else x - 'units' - 'bomb' end) from jsonb_array_elements(r.rocks) x),
    'bombs_left', (select jsonb_object_agg(l, n) from (select (x->>'layer') l, count(*) filter (where (x->>'bomb')::boolean and not coalesce((x->>'taken')::boolean, false)) n
                    from jsonb_array_elements(r.rocks) x group by 1) q)) $$;
revoke all on function pm_view(pm_runs) from public, anon, authenticated;

-- 2) a one-time message to a member, shown as a popup the next time they open the lobby
create table if not exists gc_notices (id bigserial primary key, user_id uuid not null references profiles(id) on delete cascade,
  title text not null, body text not null, created_at timestamptz not null default now(), seen_at timestamptz);
alter table gc_notices enable row level security; revoke all on gc_notices from anon, authenticated;
create or replace function gc_my_notice() returns jsonb language plpgsql security definer set search_path = public as $$
declare n gc_notices;
begin
  select * into n from gc_notices where user_id = auth.uid() and seen_at is null order by id limit 1;
  if not found then return null; end if;
  update gc_notices set seen_at = now() where id = n.id;
  return jsonb_build_object('title', n.title, 'body', n.body);
end $$;
revoke all on function gc_my_notice() from public, anon; grant execute on function gc_my_notice() to authenticated;

-- 3) the owner's ruling (5.11): יובל הנווד — everything confiscated, 500M left in the bank, blacklist message. Runs once.
do $$ declare u uuid := '3e379f61-8daa-453a-903b-565ad122ce9a'; w bigint; b bigint;
begin
  if exists (select 1 from bank_tx where ref = 'owner_reset_yuval_bank') or not exists (select 1 from profiles where id = u) then return; end if;
  update pm_runs set phase = 'busted', bank_units = 0, finished_at = now() where user_id = u and phase in ('playing','checkpoint');
  update tw_runs set status = 'lost', finished_at = now() where user_id = u and status in ('active','choice','bonus','shoot');
  update gx.positions set status = 'closed', payout = 0, reason = 'owner_reset', closed_at = now(), credited_at = now() where user_id = u and status = 'open';
  delete from gx.funds where user_id = u;
  select balance into w from wallets where user_id = u;
  if coalesce(w, 0) > 0 then perform apply_tx(u, 'admin', 'penalty', -w, 'owner_reset_yuval_wallet'); end if;
  select coalesce(balance, 0) into b from bank_accounts where user_id = u;
  perform bank_add(u, 'penalty', 500000000 - coalesce(b, 0), 'owner_reset_yuval_bank');
  insert into gc_notices (user_id, title, body) values (u, '🚨 נתפסת על חם גונב מבנימין!',
    'המצלמות של הקזינו ראו הכול: חלבת את שולה החלבון כמו פרה. כל הכסף הוחרם, השארנו לך 500 מיליון בבנק בשביל לחם וחלב, ומהיום אתה ברשימה השחורה של גולן קזינו. עוד תרגיל אחד כזה, ושולה מביאה את החברים מהמאפיה. 🕶️');
  perform chat_sys('lobby', '🚨 הודעת אבטחה: יובל הנווד נתפס על חם חולב את שולה החלבון. הכסף הוחרם, נשארו לו 500 מיליון בבנק, והוא ברשימה השחורה של הקזינו. הפרצה נסגרה. מי שמנסה שוב, שולה מביאה את המאפיה. 🕶️');
end $$;
