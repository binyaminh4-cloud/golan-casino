// writes supabase/migrations/0045_dragons.sql: 30,000 pre-played spins + 4,000 bought bonuses, and the game functions
const E = require("../docs/vendor/dg_engine.js"), fs = require("fs");
// the table is a sample: draw tables until its mean lands near the engine's long-run return (~0.97)
let s = 987654321; const R = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0);
let rows = [], buys = [], m = 0, mb = 0;
for (let tries = 0; ; tries++) { rows = []; m = 0;
  for (let i = 0; i < 30000; i++) { const seed = R() >>> 1, t = E.play(seed).total; rows.push(`(${i},${seed},${t})`); m += t; }
  if (Math.abs(m / 30000 - 0.968) < 0.012) break; }
for (let i = 0; i < 4000; i++) { const seed = R() >>> 1, t = E.play(seed, { buy: 1 }).total; buys.push(`('dragons','hw',${i},${seed},${t})`); mb += t; }
const price = Math.round(mb / 4000 / 0.96);
console.log("table mean", (m / 30000).toFixed(4), "buy mean", (mb / 4000).toFixed(2), "price", price, "buy rtp", (mb / 4000 / price).toFixed(3));
fs.writeFileSync(__dirname + "/../supabase/migrations/0045_dragons.sql", `-- דרקוני הגולן LINK: ${rows.length} pre-played spins (engine docs/vendor/dg_engine.js); mean ${(m / 30000).toFixed(4)} = the return.
-- Bought Hold & Win: ${buys.length} seeds, price ${price} stakes (return ${(mb / 4000 / price).toFixed(3)}).
create table if not exists dg_seeds (id int primary key, seed bigint not null, total numeric not null);
alter table dg_seeds enable row level security; revoke all on dg_seeds from anon, authenticated;
truncate dg_seeds;
insert into dg_seeds (id, seed, total) values ${rows.join(",")};
delete from buy_seeds where game = 'dragons';
insert into buy_seeds (game, kind, id, seed, total) values ${buys.join(",")};
insert into buy_prices values ('dragons','hw',${price}) on conflict (game, kind) do update set price = excluded.price;
create table if not exists dg_spins (
  id bigint generated always as identity primary key, user_id uuid not null references profiles(id) on delete cascade, ref text not null,
  stake bigint not null, seed bigint not null, total numeric not null, payout bigint not null, created_at timestamptz not null default now(), unique (user_id, ref));
alter table dg_spins enable row level security; revoke all on dg_spins from anon, authenticated;
create or replace function dg_spin(p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); old dg_spins; k dg_seeds; n int; pick int; pay bigint; bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into old from dg_spins where user_id = u and ref = p_ref;
  if found then return jsonb_build_object('seed', old.seed, 'total', old.total, 'payout', old.payout, 'stake', old.stake, 'balance', (select balance from wallets where user_id = u)); end if;
  if p_stake is null or p_stake < 25 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'dragons', 'stake', -p_stake, 'dgstake:' || u || ':' || p_ref);
  select count(*) into n from dg_seeds;
  pick := rl_randint(n); select * into k from dg_seeds where id = pick;
  pay := floor(p_stake * k.total)::bigint;
  insert into dg_spins (user_id, ref, stake, seed, total, payout) values (u, p_ref, p_stake, k.seed, k.total, pay);
  if pay > 0 then bal := apply_tx(u, 'dragons', 'payout', pay, 'dgpay:' || u || ':' || p_ref); else bal := (select balance from wallets where user_id = u); end if;
  if k.total >= 100 then perform chat_sys('lobby', '🐉 ' || (select nickname from profiles where id = u) || ' זכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') || ' בדרקוני הגולן!'); end if;
  return jsonb_build_object('seed', k.seed, 'total', k.total, 'payout', pay, 'stake', p_stake, 'balance', bal);
end $$;
create or replace function dg_buy(p_stake bigint, p_ref text) returns jsonb language sql security definer set search_path = public as $$ select seed_buy('dragons', 'hw', p_stake, p_ref) $$;
revoke all on function dg_spin(bigint, text), dg_buy(bigint, text) from public, anon; grant execute on function dg_spin(bigint, text), dg_buy(bigint, text) to authenticated;
`);
