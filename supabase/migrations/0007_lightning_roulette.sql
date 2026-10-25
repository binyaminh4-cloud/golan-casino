-- Lightning Roulette and XXXtreme Lightning Roulette (modes of the same engine as classic roulette).
-- Before the result, the server strikes 1-5 random "lucky" numbers (XXXtreme: plus chain lightning up to 10)
-- and gives each a multiplier. A straight-up bet on a struck number that wins pays amt*(m+1).
-- Straight-up on any other number pays 29:1 (Lightning) or 19:1 (XXXtreme). All other bets pay as usual.
-- Weights were calibrated so straight-up bets keep a house edge close to 2.7% (see test/lightning_tests.sql).

alter table rl_spins add column if not exists mode text not null default 'classic' check (mode in ('classic', 'lightning', 'xxx'));
alter table rl_spins add column if not exists lucky jsonb not null default '{}';

-- weighted tables (integer weights)
create table if not exists rl_w (kind text, val int, w int, primary key (kind, val));
delete from rl_w;
insert into rl_w (kind, val, w) values
  ('count', 1, 30), ('count', 2, 27), ('count', 3, 21), ('count', 4, 13), ('count', 5, 9),
  ('mult', 50, 1000), ('mult', 100, 593), ('mult', 150, 352), ('mult', 200, 209), ('mult', 250, 124),
  ('mult', 300, 73), ('mult', 350, 43), ('mult', 400, 26), ('mult', 450, 15), ('mult', 500, 9),
  ('double', 600, 40), ('double', 700, 26), ('double', 800, 17), ('double', 900, 11), ('double', 1000, 7),
  ('double', 1200, 4), ('double', 1500, 2), ('double', 2000, 1);
revoke all on rl_w from anon, authenticated;

-- uniform integer in [0, n) from crypto-quality random bits, no modulo bias
create or replace function rl_randint(n int) returns int language plpgsql volatile as $$
declare v bigint;
begin
  loop
    v := ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint;
    if v < 4294967296 - (4294967296 % n) then return (v % n)::int; end if;
  end loop;
end $$;

create or replace function rl_pick(p_kind text) returns int language plpgsql volatile as $$
declare r int; acc int := 0; x record;
begin
  r := rl_randint((select sum(w)::int from rl_w where kind = p_kind));
  for x in select val, w from rl_w where kind = p_kind order by val loop
    acc := acc + x.w; if r < acc then return x.val; end if;
  end loop;
end $$;

-- strike the lucky numbers for one round: {"17": 150, "0": 50, ...}
create or replace function rl_strike(p_mode text) returns jsonb language plpgsql volatile as $$
declare k int; nums int[] := '{}'; n int; out jsonb := '{}'; m int;
begin
  k := rl_pick('count');
  if p_mode = 'xxx' and rl_randint(100) < 12 then k := k + 1 + rl_randint(5); end if;   -- chain lightning: up to 10
  while coalesce(array_length(nums, 1), 0) < k loop
    n := rl_randint(37); if not n = any(nums) then nums := nums || n; end if;
  end loop;
  foreach n in array nums loop
    m := rl_pick('mult');
    if p_mode = 'xxx' and rl_randint(1000) < 171 then m := rl_pick('double'); end if;   -- double strike: up to 2000x
    out := out || jsonb_build_object(n::text, m);
  end loop;
  return out;
end $$;

-- settlement with lightning: straight-ups use the lucky table / reduced base, everything else unchanged
create or replace function rl_pay2(p_bets jsonb, p_result int, p_mode text, p_lucky jsonb) returns bigint language sql immutable as $$
  select coalesce(sum(
    case when jsonb_array_length(b->'nums') = 1 and p_mode <> 'classic' then
           (b->>'amt')::bigint * coalesce((p_lucky->>(p_result::text))::bigint + 1, case p_mode when 'xxx' then 20 else 30 end)
         else ((b->>'amt')::bigint * 36) / jsonb_array_length(b->'nums') end), 0)::bigint
  from jsonb_array_elements(p_bets) b
  where (b->'nums') @> to_jsonb(p_result) $$;

create or replace function rl_spin(p_bets jsonb, p_ref text, p_mode text default 'classic') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s rl_spins; b jsonb; v_total bigint := 0; v_res int; v_pay bigint; v_bal bigint; v_nums int[];
        v_clean jsonb := '[]'; v_lucky jsonb := '{}'; v_game text;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_mode not in ('classic', 'lightning', 'xxx') then raise exception 'invalid_mode'; end if;
  if p_ref is null or length(p_ref) > 80 then raise exception 'invalid_ref'; end if;
  select * into s from rl_spins where user_id = u and ref = p_ref;
  if found then
    return jsonb_build_object('id', s.id, 'result', s.result, 'total', s.total, 'payout', s.payout, 'mode', s.mode, 'lucky', s.lucky,
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

  v_game := case p_mode when 'classic' then 'roulette' when 'lightning' then 'lightning_roulette' else 'xxx_roulette' end;
  perform apply_tx(u, v_game, 'stake', -v_total, 'rlstake:' || u || ':' || p_ref);
  if p_mode <> 'classic' then v_lucky := rl_strike(p_mode); end if;   -- lightning first, then the ball
  v_res := rl_rand37();
  v_pay := rl_pay2(v_clean, v_res, p_mode, v_lucky);
  insert into rl_spins (user_id, ref, bets, total, result, payout, mode, lucky)
    values (u, p_ref, v_clean, v_total, v_res, v_pay, p_mode, v_lucky) returning * into s;
  if v_pay > 0 then v_bal := apply_tx(u, v_game, 'payout', v_pay, 'rlpay:' || s.id);
  else v_bal := (select balance from wallets where user_id = u); end if;
  return jsonb_build_object('id', s.id, 'result', v_res, 'total', v_total, 'payout', v_pay, 'balance', v_bal, 'mode', p_mode, 'lucky', v_lucky);
end $$;
drop function if exists rl_spin(jsonb, text);

create or replace function rl_history(p_mode text default 'classic') returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(result order by created_at desc), '[]') from
    (select result, created_at from rl_spins where user_id = auth.uid() and mode = p_mode order by created_at desc limit 18) t $$;
drop function if exists rl_history();

revoke all on function rl_randint, rl_pick, rl_strike, rl_pay2 from public, anon, authenticated;
revoke all on function rl_spin(jsonb, text, text), rl_history(text) from public, anon;
grant execute on function rl_spin(jsonb, text, text), rl_history(text) to authenticated;
