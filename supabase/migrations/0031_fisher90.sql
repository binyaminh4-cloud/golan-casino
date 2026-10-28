-- פישר בדקה ה־90: up to five decisions, each safer or riskier; a miss loses the pot, "take and go" after any success.
-- Exact ratios (num/den) are kept on the server; payment rounds half up to whole shekels. Expected value 36/37 like roulette.
create table if not exists f90_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade, ref text not null unique,
  stake bigint not null, num bigint not null default 1, den bigint not null default 1, stage int not null default 0,
  status text not null default 'active' check (status in ('active','lost','won','cashed')), paid bigint not null default 0,
  history jsonb not null default '[]', created_at timestamptz not null default now(), finished_at timestamptz);
create unique index if not exists f90_one_active on f90_runs(user_id) where status = 'active';
alter table f90_runs enable row level security; revoke all on f90_runs from anon, authenticated;

-- action table: stage, id, factor num/den, chance num/den, terminal
create or replace function f90_action(p_stage int, p_id text) returns jsonb language sql immutable as $$
  select a from jsonb_array_elements('[
    {"s":0,"id":"pass","fn":7,"fd":5,"pn":180,"pd":259},{"s":0,"id":"dribble","fn":2,"fd":1,"pn":18,"pd":37},
    {"s":1,"id":"wing","fn":5,"fd":4,"pn":4,"pd":5},{"s":1,"id":"through","fn":2,"fd":1,"pn":1,"pd":2},
    {"s":2,"id":"longshot","fn":2,"fd":1,"pn":1,"pd":2,"t":true},{"s":2,"id":"enter","fn":5,"fd":4,"pn":4,"pd":5},
    {"s":3,"id":"side","fn":5,"fd":4,"pn":4,"pd":5},{"s":3,"id":"burst","fn":2,"fd":1,"pn":1,"pd":2},
    {"s":4,"id":"normal","fn":3,"fd":2,"pn":2,"pd":3,"t":true},{"s":4,"id":"corner","fn":3,"fd":1,"pn":1,"pd":3,"t":true}]'::jsonb) a
  where (a->>'s')::int = p_stage and a->>'id' = p_id $$;
create or replace function f90_amount(p_stake bigint, n bigint, d bigint) returns bigint language sql immutable as $$
  select ((p_stake * n * 2 + d) / (2 * d))::bigint $$;
create or replace function f90_view(r f90_runs) returns jsonb language sql stable as $$
  select jsonb_build_object('id', r.id, 'stake', r.stake, 'num', r.num, 'den', r.den, 'stage', r.stage, 'status', r.status,
    'pot', case when r.status = 'lost' then 0 else f90_amount(r.stake, r.num, r.den) end, 'paid', r.paid, 'history', r.history,
    'balance', (select balance from wallets where user_id = r.user_id)) $$;

create or replace function f90_start(p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r f90_runs;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into r from f90_runs where ref = p_ref and user_id = u; if found then return f90_view(r); end if;
  if exists (select 1 from f90_runs where user_id = u and status = 'active') then raise exception 'run_in_progress'; end if;
  if p_stake is null or p_stake < 1 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'fisher90', 'stake', -p_stake, 'f90stake:' || p_ref);
  insert into f90_runs (user_id, ref, stake) values (u, p_ref, p_stake) returning * into r;
  return f90_view(r);
end $$;

create or replace function f90_act(p_run uuid, p_action text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r f90_runs; a jsonb; ok boolean; n bigint; d bigint; g bigint;
begin
  select * into r from f90_runs where id = p_run and user_id = u for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.status <> 'active' then return f90_view(r); end if;
  a := f90_action(r.stage, p_action); if a is null then raise exception 'illegal_action'; end if;
  ok := rl_randint((a->>'pd')::int) < (a->>'pn')::int;
  r.history := r.history || jsonb_build_object('stage', r.stage, 'id', p_action, 'ok', ok);
  if not ok then
    update f90_runs set status = 'lost', history = r.history, finished_at = now() where id = r.id returning * into r;
  else
    n := r.num * (a->>'fn')::bigint; d := r.den * (a->>'fd')::bigint; g := gcd(n, d); n := n / g; d := d / g;
    if coalesce((a->>'t')::boolean, false) or r.stage = 4 then
      update f90_runs set num = n, den = d, status = 'won', paid = f90_amount(r.stake, n, d), history = r.history, finished_at = now() where id = r.id returning * into r;
      perform apply_tx(u, 'fisher90', 'payout', r.paid, 'f90pay:' || r.id);
    else
      update f90_runs set num = n, den = d, stage = r.stage + 1, history = r.history where id = r.id returning * into r;
    end if;
  end if;
  return f90_view(r);
end $$;

create or replace function f90_cash(p_run uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r f90_runs;
begin
  select * into r from f90_runs where id = p_run and user_id = u for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.status <> 'active' or r.stage = 0 then return f90_view(r); end if;
  update f90_runs set status = 'cashed', paid = f90_amount(r.stake, r.num, r.den), finished_at = now() where id = r.id returning * into r;
  perform apply_tx(u, 'fisher90', 'payout', r.paid, 'f90pay:' || r.id);
  return f90_view(r);
end $$;

create or replace function f90_current() returns jsonb language sql security definer set search_path = public as $$
  select f90_view(r) from f90_runs r where user_id = auth.uid() and status = 'active' limit 1 $$;

revoke all on function f90_action(int, text), f90_amount(bigint, bigint, bigint), f90_view(f90_runs) from public, anon, authenticated;
revoke all on function f90_start(bigint, text), f90_act(uuid, text), f90_cash(uuid), f90_current() from public, anon;
grant execute on function f90_start(bigint, text), f90_act(uuid, text), f90_cash(uuid), f90_current() to authenticated;
