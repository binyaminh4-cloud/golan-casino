-- bot poker: opening the table without choosing blinds (e.g. from the slideshow) keeps the current blinds
drop function if exists poker_bot_table(bigint);
create or replace function poker_bot_table(p_bb bigint default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); tb uuid; h poker_hands; names text[]; i int; bid uuid; imgs int[] := array[1, 2, 3, 4];
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_bb is not null and not p_bb = any(pb_blinds()) then p_bb := 20000; end if;
  select id into tb from poker_tables where bots_owner = u;
  if found then
    if p_bb is null then return jsonb_build_object('table', tb, 'bb', (select big_blind from poker_tables where id = tb)); end if;   -- no choice: keep the table as it is
    -- new blinds only while I'm not sitting there (a seated player keeps his table as it is)
    select * into h from poker_hands where table_id = tb for update;
    if not exists (select 1 from poker_seats where table_id = tb and not pb_is_bot(user_id)) and h.street in ('idle', 'done')
       and (select big_blind from poker_tables where id = tb) <> p_bb then
      update poker_tables set small_blind = p_bb / 2, big_blind = p_bb, min_buyin = p_bb * 20, max_buyin = p_bb * 100 where id = tb;
      update poker_seats set stack = p_bb * 100 where table_id = tb;
      update poker_hands set street = 'idle', players = '{}', board = '{}', to_act = null, deadline = null, result = null where table_id = tb;
    end if;
    return jsonb_build_object('table', tb, 'bb', (select big_blind from poker_tables where id = tb));
  end if;
  p_bb := coalesce(p_bb, 20000);
  insert into poker_tables (name, max_seats, small_blind, big_blind, min_buyin, max_buyin, bots_owner)
    values ('שולחן הבוטים', 6, p_bb / 2, p_bb, p_bb * 20, p_bb * 100, u) returning id into tb;
  insert into poker_hands (table_id) values (tb);
  select array_agg(n order by random()) into names from (
    select distinct 'בוט ' || nullif(regexp_replace(split_part(btrim(nickname), ' ', 1), '[^א-תA-Za-z]', '', 'g'), '') n
      from profiles where id <> u and not gc_is_test(id)) x where n is not null;
  names := coalesce(names, '{}') || array['בוט בנימין', 'בוט עידו', 'בוט פישר'];
  select array_agg(x order by random()) into imgs from unnest(imgs) x;
  for i in 1..3 loop
    insert into poker_bots (table_id, name, img, style) values (tb, names[i], imgs[i], i) returning id into bid;
    insert into poker_seats (table_id, seat_index, user_id, stack) values (tb, i * 2 - 1, bid, p_bb * 100);
  end loop;
  return jsonb_build_object('table', tb, 'bb', p_bb);
end $$;
revoke all on function poker_bot_table(bigint) from public, anon;
grant execute on function poker_bot_table(bigint) to authenticated;
