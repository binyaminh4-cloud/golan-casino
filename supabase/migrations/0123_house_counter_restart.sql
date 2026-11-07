-- Casino box (bank page) counts again from now, at the owner's request (7.11): the protein-miner exploit losses after the
-- 2.11 reset made it show −₪12.48T. Only the counter moves; no wallet or bank balance is touched.
alter table house_stats add column if not exists since_tx bigint, add column if not exists since_at timestamptz;
insert into house_stats (id, total, games, at, since_tx, since_at) values (1, 0, '{}', now() - interval '1 hour', (select max(id) from wallet_transactions), now())
  on conflict (id) do update set since_tx = excluded.since_tx, since_at = excluded.since_at, at = now() - interval '1 hour';
create or replace function house_stats() returns jsonb language plpgsql security definer set search_path = public as $$
declare h house_stats; g jsonb; cutoff bigint; reset_at_ timestamptz;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select wallet_cutoff,reset_at into cutoff,reset_at_ from gc_economy.control where id=1;
  select greatest(coalesce(cutoff,0), coalesce(since_tx,0)), greatest(reset_at_, since_at) into cutoff, reset_at_ from house_stats where id = 1;
  select * into h from house_stats where id = 1;
  if found and h.at > now() - interval '5 minutes' then return jsonb_build_object('total', h.total, 'games', h.games, 'at', h.at); end if;
  perform pg_advisory_xact_lock(hashtext('house_stats'));
  select coalesce(jsonb_object_agg(game, net), '{}') into g from (
    select game, -sum(amount) net from wallet_transactions where id>coalesce(cutoff,0) and kind in ('stake', 'payout') group by game
    union all
    select 'poker_bots', -coalesce(sum(w.amount), 0) from wallet_transactions w
      where w.id>coalesce(cutoff,0) and w.game = 'poker' and exists (select 1 from poker_tables t where (t.bots_owner is not null or t.bots_shared is not null) and w.settlement_ref like '%' || t.id::text || '%')
    union all
    select 'bank_loans', coalesce(sum(greatest(0, repaid - principal)), 0) from loans where kind = 'bank' and (reset_at_ is null or created_at>=reset_at_)) x;
  insert into house_stats (id, total, games, at) values (1, (select coalesce(sum(value::text::bigint), 0) from jsonb_each(g)), g, now())
    on conflict (id) do update set total = excluded.total, games = excluded.games, at = excluded.at returning * into h;
  return jsonb_build_object('total', h.total, 'games', h.games, 'at', h.at);
end $$;
