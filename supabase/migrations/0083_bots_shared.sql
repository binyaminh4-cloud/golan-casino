-- Poker against the bots, together: shared tables per blind level, 3 bots (seats 1, 3, 5) and room for 3 players (0, 2, 4).
alter table poker_tables add column if not exists bots_shared bigint;
create or replace function poker_bot_shared(p_bb bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); tb uuid; names text[]; i int; bid uuid; imgs int[] := array[1, 2, 3, 4];
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_bb is null or not p_bb = any(pb_blinds()) then p_bb := 20000; end if;
  -- the table I already sit at, else one with a free seat, else a new one
  select s.table_id into tb from poker_seats s join poker_tables t on t.id = s.table_id where s.user_id = u and t.bots_shared = p_bb;
  if found then return jsonb_build_object('table', tb, 'bb', p_bb); end if;
  select t.id into tb from poker_tables t where t.bots_shared = p_bb
     and (select count(*) from poker_seats s where s.table_id = t.id) < 6 order by (select count(*) from poker_seats s where s.table_id = t.id) desc limit 1;
  if found then return jsonb_build_object('table', tb, 'bb', p_bb); end if;
  insert into poker_tables (name, max_seats, small_blind, big_blind, min_buyin, max_buyin, bots_shared)
    values ('החבר׳ה נגד הבוטים', 6, p_bb / 2, p_bb, p_bb * 20, p_bb * 100, p_bb) returning id into tb;
  insert into poker_hands (table_id) values (tb);
  select array_agg(n order by random()) into names from (
    select distinct 'בוט ' || nullif(regexp_replace(split_part(btrim(nickname), ' ', 1), '[^א-תA-Za-z]', '', 'g'), '') n
      from profiles where not gc_is_test(id)) x where n is not null;
  names := coalesce(names, '{}') || array['בוט בנימין', 'בוט עידו', 'בוט פישר'];
  select array_agg(x order by random()) into imgs from unnest(imgs) x;
  for i in 1..3 loop
    insert into poker_bots (table_id, name, img, style) values (tb, names[i], imgs[i], i) returning id into bid;
    insert into poker_seats (table_id, seat_index, user_id, stack) values (tb, i * 2 - 1, bid, p_bb * 100);
  end loop;
  return jsonb_build_object('table', tb, 'bb', p_bb);
end $$;
revoke all on function poker_bot_shared(bigint) from public, anon;
grant execute on function poker_bot_shared(bigint) to authenticated;

create or replace function poker_tick(p_table uuid) returns void language plpgsql security definer set search_path = public as $$
declare h poker_hands; x jsonb; s record; tn tourneys; bt boolean := exists (select 1 from poker_tables where id = p_table and (bots_owner is not null or bots_shared is not null));
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

create or replace function ph_showdown(p_table uuid) returns void language plpgsql security definer set search_path = public as $$
declare h poker_hands; p jsonb; levels bigint[]; lv bigint; prev bigint := 0; pot bigint; elig text[]; best bigint; winners text[];
        k text; sc jsonb := '{}'; v bigint; share bigint; rest bigint; res jsonb := '[]'; won jsonb := '{}'; nm text; live int;
begin
  select * into h from poker_hands where table_id = p_table for update;
  p := h.players; live := ph_count(p, 'live');
  for k in select key from jsonb_each(p) where not (value->>'folded')::boolean loop
    v := case when live > 1 then ph_best(array(select jsonb_array_elements_text(p -> k -> 'hole')) || h.board) else 0 end;
    sc := sc || jsonb_build_object(k, v);
  end loop;
  select array_agg(distinct (value->>'committed')::bigint order by (value->>'committed')::bigint) into levels from jsonb_each(p) where (value->>'committed')::bigint > 0;
  foreach lv in array coalesce(levels, '{}') loop
    select coalesce(sum(least((value->>'committed')::bigint, lv) - least((value->>'committed')::bigint, prev)), 0) into pot from jsonb_each(p);
    select array_agg(key order by key::int) into elig from jsonb_each(p) where not (value->>'folded')::boolean and (value->>'committed')::bigint >= lv;
    if pot > 0 and elig is not null then
      select max((sc->>e)::bigint) into best from unnest(elig) e;
      select array_agg(e order by ((e::int - h.dealer + 5) % 6)) into winners from unnest(elig) e where (sc->>e)::bigint = best;
      share := pot / array_length(winners, 1); rest := pot - share * array_length(winners, 1);
      foreach k in array winners loop
        won := won || jsonb_build_object(k, coalesce((won->>k)::bigint, 0) + share + case when rest > 0 then 1 else 0 end);
        if rest > 0 then rest := rest - 1; end if;
      end loop;
      res := res || jsonb_build_object('pot', pot, 'winners', to_jsonb(winners));
    elsif pot > 0 then                                    -- uncalled chips: back to their owner
      select array_agg(key) into elig from jsonb_each(p) where (value->>'committed')::bigint >= lv;
      won := won || jsonb_build_object(elig[1], coalesce((won->>elig[1])::bigint, 0) + pot);
    end if;
    prev := lv;
  end loop;
  for k in select jsonb_object_keys(won) loop
    p := jsonb_set(p, array[k, 'stack'], to_jsonb((p -> k ->> 'stack')::bigint + (won->>k)::bigint));
  end loop;
  -- write back
  update poker_seats ps set stack = (p -> ps.seat_index::text ->> 'stack')::bigint
    where ps.table_id = p_table and p ? ps.seat_index::text;
  update poker_hands set street = 'done', players = p, to_act = null, deadline = null, next_at = now() + interval '6 seconds',
    result = jsonb_build_object('pots', res, 'won', won, 'live', live,
      'shown', case when live > 1 then (select jsonb_object_agg(key, jsonb_build_object('hole', value->'hole', 'hand', ph_cat_name((sc->>key)::bigint)))
                                         from jsonb_each(p) where not (value->>'folded')::boolean) else '{}'::jsonb end),
    updated_at = now() where table_id = p_table;
  -- big pots in the chat (not from the private bot tables)
  if exists (select 1 from poker_tables where id = p_table and (bots_owner is not null or bots_shared is not null)) then return; end if;
  for k in select jsonb_object_keys(won) loop
    if (won->>k)::bigint >= 20 * (select big_blind from poker_tables where id = p_table) and live > 1 then
      nm := (select nickname from profiles where id = (p -> k ->> 'user')::uuid);
      perform chat_sys('lobby', '♠️ ' || nm || ' לקח קופה של ₪' || to_char((won->>k)::bigint, 'FM999,999,999,999,999,999') || ' עם ' || ph_cat_name((sc->>k)::bigint) || '.');
    end if;
  end loop;
end $$;

create or replace function poker_sit(p_table uuid, p_seat int, p_amount bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); t poker_tables; s record;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into t from poker_tables where id = p_table and (level is not null or bots_owner = u or bots_shared is not null);
  if not found then raise exception 'invalid_table'; end if;
  if p_seat not between 0 and 5 then raise exception 'invalid_seat'; end if;
  if p_amount < t.min_buyin or p_amount > t.max_buyin then raise exception 'invalid_amount'; end if;
  -- still sitting at another table (left the page without standing up)? if no hand is running there for me, stand up automatically
  for s in select ps.* from poker_seats ps join poker_hands h on h.table_id = ps.table_id join poker_tables pt on pt.id = ps.table_id
           where ps.user_id = u and ps.table_id <> p_table and pt.tourney is null
             and (h.street in ('idle', 'done') or not h.players ? ps.seat_index::text or (h.players -> ps.seat_index::text ->> 'folded')::boolean) loop
    perform poker_cashout(s.table_id, u, 'pkout:' || s.table_id || ':' || u || ':auto:' || extract(epoch from clock_timestamp())::bigint);
  end loop;
  if exists (select 1 from poker_seats where user_id = u) then raise exception 'already_seated'; end if;
  if exists (select 1 from poker_seats where table_id = p_table and seat_index = p_seat) then raise exception 'seat_taken'; end if;
  perform poker_buyin(u, p_table, p_seat, p_amount, 'pkin:' || p_table || ':' || u || ':' || extract(epoch from clock_timestamp())::text);
  return poker_state(p_table);
end $$;
