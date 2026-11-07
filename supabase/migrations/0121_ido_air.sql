-- עידו באוויר (Ido in the air): a crash-style flight. The player only bets and launches; the server draws the whole flight.
-- Outcome first: draw a landing bucket [lo, 2·lo) with lo = 0.1·2^i (i = 0..16, top bucket capped at ×10000), then build a
-- random flight: coins (+1 +2 +5 +10 ×stake), multipliers (×2 ×3 ×5 ×10) and rockets (÷2), and finally as many rockets as it
-- takes to bring the value into the bucket. 70% of flights land and pay the value; 30% crash and pay nothing.
-- Bonus = buy a flight for 10× the bet: it always lands, from its own (expensive, mostly losing) bucket table.
-- The page only animates the path it gets back. Paid at once; one launch per 2.5 s per player.
create table if not exists ia_flights (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade, ref text not null unique,
  stake bigint not null, bonus boolean not null default false, cost bigint not null, landed boolean not null, mult numeric not null,
  path jsonb not null, paid bigint not null default 0, created_at timestamptz not null default now());
create index if not exists ia_flights_user on ia_flights(user_id, created_at desc);
alter table ia_flights enable row level security; revoke all on ia_flights from anon, authenticated;

-- weights per 10,000,000 for buckets i = 0..16
create or replace function ia_land_w() returns int[] language sql immutable as $$
  select array[3565860,2100000,1600000,1000000,700000,650000,300000,60000,15000,5000,2500,1000,400,150,60,20,10] $$;
create or replace function ia_bonus_w() returns int[] language sql immutable as $$
  select array[0,0,0,3000000,4500000,6000000,4300000,1700000,650000,230000,90000,35000,13000,5500,1800,600,250] $$;

create or replace function ia_coin() returns int language sql volatile as $$
  select tw_pick(array[40,30,20,10], array[1,2,5,10]) $$;
create or replace function ia_mul() returns int language sql volatile as $$
  select tw_pick(array[55,28,12,5], array[2,3,5,10]) $$;

-- build a flight that ends inside bucket i. Returns {events:[{t:'c'|'m'|'r', v, a}], final}. a = value after the event.
create or replace function ia_build(i int) returns jsonb language plpgsql volatile as $$
declare lo numeric := case when i = 16 then 5000 else 0.1 * power(2::numeric, i) end; hi numeric; v numeric := 1; ev jsonb := '[]'; n int := 6 + rl_randint(11); k int; r int; x int; guard int := 0;
begin
  hi := case when i = 16 then 10001 else lo * 2 end;   -- top bucket: ×5000..×10000
  for k in 1..n loop
    r := rl_randint(100);
    if r < 30 then v := v / 2; ev := ev || jsonb_build_object('t','r','v',2,'a',v);
    elsif r < 80 then x := ia_coin(); v := least(v + x, 10000); ev := ev || jsonb_build_object('t','c','v',x,'a',v);
    else x := ia_mul(); v := least(v * x, 10000); ev := ev || jsonb_build_object('t','m','v',x,'a',v); end if;
  end loop;
  while v < lo and guard < 200 loop
    guard := guard + 1;
    if rl_randint(10) < 6 then x := ia_coin(); v := least(v + x, 10000); ev := ev || jsonb_build_object('t','c','v',x,'a',v);
    else x := ia_mul(); v := least(v * x, 10000); ev := ev || jsonb_build_object('t','m','v',x,'a',v); end if;
  end loop;
  while v >= hi loop v := v / 2; ev := ev || jsonb_build_object('t','r','v',2,'a',v); end loop;
  return jsonb_build_object('events', ev, 'final', v);
end $$;

create or replace function ia_launch(p_stake bigint, p_bonus boolean, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); f ia_flights; cost bigint; i int; b jsonb; landed boolean; paid bigint; bal bigint; idx int[] := array[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16];
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into f from ia_flights where ref = p_ref and user_id = u;
  if found then
    return jsonb_build_object('id', f.id, 'stake', f.stake, 'bonus', f.bonus, 'cost', f.cost, 'landed', f.landed, 'mult', f.mult, 'path', f.path, 'paid', f.paid,
      'balance', (select balance from wallets where user_id = u)); end if;
  if p_stake is null or p_stake < 10 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  if exists (select 1 from ia_flights where user_id = u and created_at > now() - interval '2.5 seconds') then raise exception 'too_fast'; end if;
  cost := case when coalesce(p_bonus, false) then p_stake * 10 else p_stake end;
  perform apply_tx(u, 'ido_air', 'stake', -cost, 'iastake:' || p_ref);
  i := tw_pick(case when p_bonus then ia_bonus_w() else ia_land_w() end, idx);
  b := ia_build(i);
  landed := coalesce(p_bonus, false) or rl_randint(100) < 70;
  paid := case when landed then floor(p_stake * (b->>'final')::numeric)::bigint else 0 end;
  insert into ia_flights (user_id, ref, stake, bonus, cost, landed, mult, path, paid)
    values (u, p_ref, p_stake, coalesce(p_bonus, false), cost, landed, (b->>'final')::numeric, b->'events', paid) returning * into f;
  if paid > 0 then bal := apply_tx(u, 'ido_air', 'payout', paid, 'iapay:' || f.id); end if;
  if paid >= p_stake * 200 and paid >= 20000 then
    perform chat_sys('lobby', '✈️ ' || (select nickname from profiles where id = u) || ' טס עם עידו באוויר ונחת עם ₪' || to_char(paid, 'FM999,999,999,999,999,999') || '!'); end if;
  return jsonb_build_object('id', f.id, 'stake', f.stake, 'bonus', f.bonus, 'cost', f.cost, 'landed', f.landed, 'mult', f.mult, 'path', f.path, 'paid', f.paid,
    'balance', (select balance from wallets where user_id = u));
end $$;

revoke all on function ia_land_w(), ia_bonus_w(), ia_coin(), ia_mul(), ia_build(int) from public, anon, authenticated;
revoke all on function ia_launch(bigint, boolean, text) from public, anon;
grant execute on function ia_launch(bigint, boolean, text) to authenticated;
