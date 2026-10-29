-- For the lobby's top-3 list: each member's most played game (most bets placed), from the wallet ledger.
create or replace function gc_fav_games() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(user_id, game), '{}') from (
    select distinct on (user_id) user_id, game from wallet_transactions
     where kind in ('stake', 'bet') and amount < 0 and game not in ('admin','salary','season','signup','tourney') and game not like 'job%'
     group by user_id, game order by user_id, count(*) desc) q
  where auth.uid() is not null $$;
revoke all on function gc_fav_games() from public, anon; grant execute on function gc_fav_games() to authenticated;
