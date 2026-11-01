-- Chat announcement when someone takes 1st place on the rich list (test users excluded).
-- The lobby calls gc_top_check() whenever it refreshes the leaderboard; the last leader is kept in gc_settings.
create or replace function gc_top_check() returns void language plpgsql security definer set search_path = public as $$
declare top record; old uuid;
begin
  if auth.uid() is null then return; end if;
  perform pg_advisory_xact_lock(hashtext('gc_top_check'));
  select p.id, p.nickname into top
  from profiles p join wallets w on w.user_id = p.id
  where not gc_is_test(p.id)
  order by w.balance + bank_bal(p.id)
           + coalesce((select sum(s.stack) from poker_seats s join poker_tables t on t.id = s.table_id where s.user_id = p.id and t.tourney is null), 0)
           - loan_debt(p.id) + loan_lent(p.id) desc
  limit 1;
  if top.id is null then return; end if;
  select (value->>'id')::uuid into old from gc_settings where key = 'rich_top';
  if old is not distinct from top.id then return; end if;
  insert into gc_settings (key, value) values ('rich_top', jsonb_build_object('id', top.id))
    on conflict (key) do update set value = excluded.value;
  if old is not null then
    perform chat_sys('lobby', '👑🏆 ' || top.nickname || ' עקף את ' || coalesce((select nickname from profiles where id = old), 'המוביל הקודם')
      || ' בטבלת העשירים ועלה למקום הראשון! 🎉💰🥇');
  end if;
end $$;
revoke all on function gc_top_check() from public, anon;
grant execute on function gc_top_check() to authenticated;
