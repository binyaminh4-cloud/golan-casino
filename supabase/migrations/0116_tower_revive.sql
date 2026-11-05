-- מגדל הכסף: extra life. When a guard catches you on floors 1–6, you may buy one extra life per round and carry on from
-- that same room with your loot. Price = the expected value of carrying on from that room with that loot, ÷ 0.95
-- (so buying is never better than fair for the player). Values from a full calculation over all rooms ahead:
-- K[p] = chance the loot is eventually paid (×1000), F[p] = expected future winnings from room p with no loot (×100 of the bet).
alter table tw_runs add column if not exists revived boolean not null default false;

create or replace function tw_revive_price(r tw_runs) returns bigint language sql immutable as $$
  select case when r.status = 'lost' and not r.revived and not r.bought and r.pos between 1 and 36 then
    ceil(r.stake * (r.loot / 100.0 * (array[12,13,14,14,16,17,19,21,24,26,30,33,36,39,48,52,57,63,70,79,84,98,114,133,162,197,238,283,332,384,508,623,729,826,917,1000])[r.pos] / 1000.0
      + (array[139,144,152,162,174,188,209,232,261,292,325,362,394,431,524,567,622,689,758,849,910,1056,1229,1430,1731,2099,2527,3008,3536,4106,5305,6473,7611,8725,9815,10884])[r.pos] / 100.0) / 0.95)::bigint
  else null end $$;

create or replace function tw_view(r tw_runs) returns jsonb language sql stable as $$
  select jsonb_build_object('id', r.id, 'stake', r.stake, 'layout', r.layout, 'pos', r.pos, 'loot', r.loot, 'bonus', r.bonus,
    'rolls', r.rolls, 'shoot', r.shoot, 'hits', r.hits, 'bought', r.bought, 'status', r.status, 'paid', r.paid,
    'revive', case when r.finished_at > now() - interval '10 minutes' then tw_revive_price(r) end,
    'balance', (select balance from wallets where user_id = r.user_id)) $$;

create or replace function tw_revive(p_run uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r tw_runs; price bigint;
begin
  select * into r from tw_runs where id = p_run and user_id = u for update;
  if not found then raise exception 'run_not_found'; end if;
  if exists (select 1 from tw_runs where user_id = u and status in ('active','choice','bonus','shoot')) then raise exception 'run_in_progress'; end if;
  price := tw_revive_price(r);
  if price is null or r.finished_at < now() - interval '10 minutes' then return tw_view(r); end if;
  perform apply_tx(u, 'tower', 'stake', -price, 'twlife:' || r.id);
  update tw_runs set status = 'active', revived = true, finished_at = null where id = r.id returning * into r;
  return tw_view(r);
end $$;

revoke all on function tw_revive_price(tw_runs) from public, anon, authenticated;
revoke all on function tw_view(tw_runs) from public, anon, authenticated;
revoke all on function tw_revive(uuid) from public, anon;
grant execute on function tw_revive(uuid) to authenticated;
