-- Poker against the bots: choose the blinds before sitting down (big blind ₪20K … ₪2T). Buy-in 20–100 big blinds, bots sit with 100.
create or replace function pb_blinds() returns bigint[] language sql immutable as $$
  select array[20000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000, 25000000, 50000000, 100000000, 250000000, 500000000,
               1000000000, 2500000000, 5000000000, 10000000000, 25000000000, 50000000000, 100000000000, 250000000000, 500000000000, 1000000000000, 2000000000000]::bigint[] $$;
drop function if exists poker_bot_table();
create or replace function poker_bot_table(p_bb bigint default 20000) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); tb uuid; h poker_hands; names text[]; i int; bid uuid; imgs int[] := array[1, 2, 3, 4];
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_bb is null or not p_bb = any(pb_blinds()) then p_bb := 20000; end if;
  select id into tb from poker_tables where bots_owner = u;
  if found then
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

create or replace function poker_tick(p_table uuid) returns void language plpgsql security definer set search_path = public as $$
declare h poker_hands; x jsonb; s record; tn tourneys; bt boolean := exists (select 1 from poker_tables where id = p_table and bots_owner is not null);
begin
  select * into h from poker_hands where table_id = p_table for update;
  -- bot table: the bot to act thinks for a moment, then plays
  if bt and h.street in ('preflop', 'flop', 'turn', 'river') and pb_is_bot((h.players -> h.to_act::text ->> 'user')::uuid)
     and now() >= h.updated_at + make_interval(secs => 1.1 + random() * 1.2) then
    perform pb_act(p_table);
    select * into h from poker_hands where table_id = p_table;
  end if;
  if h.street in ('preflop', 'flop', 'turn', 'river') and h.deadline < now() then
    x := h.players -> h.to_act::text;
    update poker_seats set missed = missed + 1 where table_id = p_table and seat_index = h.to_act;
    perform ph_apply(p_table, h.to_act, case when (x->>'bet')::bigint >= h.current_bet then 'check' else 'fold' end, 0);
    select * into h from poker_hands where table_id = p_table;
  end if;
  -- tournament: a player away for 15 s (after the game began) is out; the others don't wait for him
  select * into tn from tourneys where table_id = p_table and status = 'running';
  if found and h.hand_no > 0 then
    update poker_seats set leaving = true where table_id = p_table and not leaving and last_seen < now() - interval '15 seconds';
    while h.street in ('preflop', 'flop', 'turn', 'river') and exists (select 1 from poker_seats where table_id = p_table and seat_index = h.to_act and leaving) loop
      perform ph_apply(p_table, h.to_act, 'fold', 0);
      select * into h from poker_hands where table_id = p_table;
    end loop;
  end if;
  -- tournament start: everyone has 5 minutes to sit down; it starts the moment all 3 are in
  if found and h.hand_no = 0 then
    if exists (select 1 from poker_seats where table_id = p_table and last_seen < now() - interval '15 seconds') then
      if now() < tn.started_at + interval '5 minutes' then return; end if;
      update poker_seats set leaving = true where table_id = p_table and last_seen < now() - interval '15 seconds';
    end if;
    update poker_hands set next_at = least(next_at, now()) where table_id = p_table;
    select * into h from poker_hands where table_id = p_table;
  end if;
  if h.street in ('idle', 'done') and h.next_at <= now() and (select tourney from poker_tables where id = p_table) is not null then
    perform tn_between_hands(p_table);
    select * into h from poker_hands where table_id = p_table;
    if h.street in ('idle', 'done') and (select status from tourneys where table_id = p_table) = 'running' then perform ph_start(p_table); end if;
    return;
  end if;
  if h.street in ('idle', 'done') and h.next_at <= now() then
    -- between hands: players who left, went quiet, missed 3 turns in a row or have no chips go back to the wallet
    if bt then
      update poker_seats ps set stack = t2.big_blind * 100, last_seen = now(), missed = 0 from poker_tables t2
        where t2.id = p_table and ps.table_id = p_table and pb_is_bot(ps.user_id) and ps.stack < t2.big_blind * 10;
      update poker_seats ps set last_seen = now() where ps.table_id = p_table and pb_is_bot(ps.user_id);
    end if;
    for s in select * from poker_seats where table_id = p_table and not pb_is_bot(user_id) and (leaving or stack = 0 or missed >= 3 or last_seen < now() - interval '2 minutes') loop
      perform poker_cashout(p_table, s.user_id, 'pkout:' || p_table || ':' || s.user_id || ':' || h.hand_no || ':' || extract(epoch from now())::bigint);
    end loop;
    if bt and not exists (select 1 from poker_seats where table_id = p_table and not pb_is_bot(user_id)) then
      update poker_hands set street = 'idle', players = '{}', board = '{}', to_act = null, deadline = null where table_id = p_table; return;
    end if;
    perform ph_start(p_table);
  end if;
end $$;
