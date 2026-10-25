-- European single-zero roulette. The server picks the number and settles; the client only animates.
-- A bet is {"nums":[sorted numbers covered], "amt":n}. Only the 157 standard bets are accepted
-- (table rl_legal). Every bet returns amt*36/k (k = numbers covered), so house edge = 1/37 = 2.70%.

create table rl_legal (nums int[] primary key, kind text not null);

insert into rl_legal
  select array[n], 'straight' from generate_series(0,36) n
  union all select array[n, n+1], 'split' from generate_series(1,35) n where n % 3 <> 0
  union all select array[n, n+3], 'split' from generate_series(1,33) n
  union all select v, 'split' from (values (array[0,1]), (array[0,2]), (array[0,3])) t(v)
  union all select array[n, n+1, n+2], 'street' from generate_series(1,34,3) n
  union all select v, 'trio' from (values (array[0,1,2]), (array[0,2,3])) t(v)
  union all select array[n, n+1, n+3, n+4], 'corner' from generate_series(1,32) n where n % 3 <> 0
  union all select array[0,1,2,3], 'first_four'
  union all select array(select generate_series(n, n+5)), 'line' from generate_series(1,31,3) n
  union all select array(select generate_series(d*12-11, d*12)), 'dozen' from generate_series(1,3) d
  union all select array(select x from generate_series(1,36) x where x % 3 = c % 3), 'column' from generate_series(1,3) c
  union all select array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36], 'red'
  union all select array(select x from generate_series(1,36) x where x <> all(array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36])), 'black'
  union all select array(select generate_series(2,36,2)), 'even'
  union all select array(select generate_series(1,35,2)), 'odd'
  union all select array(select generate_series(1,18)), 'low'
  union all select array(select generate_series(19,36)), 'high';

create table rl_spins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  ref text not null,
  bets jsonb not null,
  total bigint not null,
  result int not null check (result between 0 and 36),
  payout bigint not null,
  created_at timestamptz not null default now(),
  unique (user_id, ref)
);
alter table rl_spins enable row level security;
create policy own_spins on rl_spins for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on rl_legal, rl_spins from anon, authenticated;
grant select on rl_legal to authenticated;

-- Uniform 0..36 from the random bits of a v4 UUID, with rejection sampling (no modulo bias).
create or replace function rl_rand37() returns int language plpgsql volatile as $$
declare v bigint;
begin
  loop
    v := ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint;
    if v < 4294967295 - (4294967296 % 37) then return (v % 37)::int; end if;
  end loop;
end $$;

-- Pure settlement: total returned (stake included) for these bets on this result.
create or replace function rl_pay(p_bets jsonb, p_result int) returns bigint language sql immutable as $$
  select coalesce(sum(((b->>'amt')::bigint * 36) / jsonb_array_length(b->'nums')), 0)::bigint
  from jsonb_array_elements(p_bets) b
  where (b->'nums') @> to_jsonb(p_result) $$;

create or replace function rl_spin(p_bets jsonb, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s rl_spins; b jsonb; v_total bigint := 0; v_res int; v_pay bigint; v_bal bigint; v_nums int[]; v_clean jsonb := '[]';
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_ref is null or length(p_ref) > 80 then raise exception 'invalid_ref'; end if;
  select * into s from rl_spins where user_id = u and ref = p_ref;
  if found then                                                -- duplicate request: same answer, no new charge
    return jsonb_build_object('id', s.id, 'result', s.result, 'total', s.total, 'payout', s.payout,
      'balance', (select balance from wallets where user_id = u));
  end if;
  if jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) not between 1 and 300 then raise exception 'invalid_bets'; end if;
  for b in select * from jsonb_array_elements(p_bets) loop
    if jsonb_typeof(b->'amt') <> 'number' or (b->>'amt')::numeric <> floor((b->>'amt')::numeric)
       or (b->>'amt')::bigint < 1 or (b->>'amt')::bigint > 50000 then raise exception 'invalid_amount'; end if;
    select array_agg(x::int order by x::int) into v_nums from jsonb_array_elements_text(b->'nums') x;
    if not exists (select 1 from rl_legal where nums = v_nums) then raise exception 'invalid_bet'; end if;
    v_total := v_total + (b->>'amt')::bigint;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('nums', to_jsonb(v_nums), 'amt', (b->>'amt')::bigint));
  end loop;
  if v_total > 100000 then raise exception 'table_limit'; end if;

  perform apply_tx(u, 'roulette', 'stake', -v_total, 'rlstake:' || u || ':' || p_ref);   -- raises insufficient_funds
  v_res := rl_rand37();
  v_pay := rl_pay(v_clean, v_res);
  insert into rl_spins (user_id, ref, bets, total, result, payout) values (u, p_ref, v_clean, v_total, v_res, v_pay)
    returning * into s;
  if v_pay > 0 then v_bal := apply_tx(u, 'roulette', 'payout', v_pay, 'rlpay:' || s.id);
  else v_bal := (select balance from wallets where user_id = u); end if;
  return jsonb_build_object('id', s.id, 'result', v_res, 'total', v_total, 'payout', v_pay, 'balance', v_bal);
end $$;

create or replace function rl_history() returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(result order by created_at desc), '[]') from
    (select result, created_at from rl_spins where user_id = auth.uid() order by created_at desc limit 18) t $$;

revoke all on function rl_rand37, rl_pay from public, anon, authenticated;
revoke all on function rl_spin, rl_history from public, anon;
grant execute on function rl_spin, rl_history to authenticated;
