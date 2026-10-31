-- Poker against the bots: a private table per player with 3 bots ("בוט <first name>" of the friends, test users excluded).
-- Bots sit with ₪2M, rebuy when short, act on their own after a short "thinking" pause, and never touch a wallet.
alter table poker_seats drop constraint if exists poker_seats_user_id_fkey;
alter table poker_tables add column if not exists bots_owner uuid;
create table if not exists poker_bots (
  id uuid primary key default gen_random_uuid(),
  table_id uuid references poker_tables(id) on delete cascade,
  name text not null, img int not null default 1, style int not null default 2   -- 1 tight, 2 normal, 3 loose-aggressive
);
alter table poker_bots enable row level security;
revoke all on poker_bots from anon, authenticated;
create or replace function pb_is_bot(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from poker_bots where id = p) $$;

create or replace function poker_bot_table() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); tb uuid; names text[]; i int; bid uuid; imgs int[] := array[1, 2, 3, 4];
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select id into tb from poker_tables where bots_owner = u;
  if found then return jsonb_build_object('table', tb); end if;
  insert into poker_tables (name, max_seats, small_blind, big_blind, min_buyin, max_buyin, bots_owner)
    values ('שולחן הבוטים', 6, 10000, 20000, 400000, 2000000, u) returning id into tb;
  insert into poker_hands (table_id) values (tb);
  select array_agg(n order by random()) into names from (
    select distinct 'בוט ' || nullif(regexp_replace(split_part(btrim(nickname), ' ', 1), '[^א-תA-Za-z]', '', 'g'), '') n
      from profiles where id <> u and not gc_is_test(id)) x where n is not null;
  names := coalesce(names, '{}') || array['בוט בנימין', 'בוט עידו', 'בוט פישר'];
  select array_agg(x order by random()) into imgs from unnest(imgs) x;
  for i in 1..3 loop
    insert into poker_bots (table_id, name, img, style) values (tb, names[i], imgs[i], i) returning id into bid;
    insert into poker_seats (table_id, seat_index, user_id, stack) values (tb, i * 2 - 1, bid, 2000000);
  end loop;
  return jsonb_build_object('table', tb);
end $$;
revoke all on function poker_bot_table() from public, anon;
grant execute on function poker_bot_table() to authenticated;

-- how good the bot's hand is, 0..1
create or replace function pb_strength(hole text[], board text[]) returns numeric language plpgsql immutable as $$
declare a int := ph_rank(hole[1]); b int := ph_rank(hole[2]); c int; bc int;
begin
  if coalesce(array_length(board, 1), 0) = 0 then
    if a = b then return 0.55 + a / 40.0; end if;
    return (greatest(a, b) + least(a, b)) / 30.0 + case when right(hole[1], 1) = right(hole[2], 1) then 0.06 else 0 end
           + case when abs(a - b) = 1 then 0.04 else 0 end;
  end if;
  c := (ph_best(hole || board) / 759375)::int;
  if array_length(board, 1) = 5 then bc := (ph_best(board) / 759375)::int; if bc >= c then return 0.2; end if; end if;
  return (array[0.18, 0.45, 0.64, 0.76, 0.83, 0.87, 0.93, 0.97, 0.99])[c + 1];
end $$;

create or replace function pb_act(p_table uuid) returns void language plpgsql security definer set search_path = public as $$
declare h poker_hands; t poker_tables; x jsonb; seat int; bet bigint; stack bigint; tocall bigint; pot bigint; st int;
        s numeric; rnd numeric := random(); adj numeric; bluff numeric; tgt bigint; act text;
begin
  select * into h from poker_hands where table_id = p_table;
  select * into t from poker_tables where id = p_table;
  seat := h.to_act; x := h.players -> seat::text;
  bet := (x->>'bet')::bigint; stack := (x->>'stack')::bigint; tocall := greatest(0, h.current_bet - bet);
  select coalesce(sum((value->>'committed')::bigint), 0) into pot from jsonb_each(h.players);
  select style into st from poker_bots where id = (x->>'user')::uuid;
  adj := case st when 1 then 0.08 when 3 then -0.08 else 0 end; bluff := case st when 1 then 0.04 when 3 then 0.15 else 0.08 end;
  s := pb_strength(array(select jsonb_array_elements_text(x -> 'hole')), h.board) + (random() - 0.5) * 0.12;
  if bet = 0 and ((s >= 0.72 + adj and rnd < 0.75) or (tocall = 0 and rnd < bluff)) then
    tgt := h.current_bet + greatest(h.min_raise, t.big_blind * round(pot * (0.5 + random() * 0.6) / t.big_blind));
    act := case when tgt >= bet + stack then 'allin' else 'raise' end;
  elsif tocall = 0 then act := 'check';
  elsif s >= tocall::numeric / greatest(1, pot + tocall) * 0.9 + 0.12 + adj or (tocall <= t.big_blind and s >= 0.3 + adj) then
    act := case when tocall >= stack then 'allin' else 'call' end;
  else act := 'fold'; end if;
  begin
    perform ph_apply(p_table, seat, act, tgt);
  exception when others then
    perform ph_apply(p_table, seat, case when tocall = 0 then 'check' when tocall >= stack then 'allin' else 'call' end, 0);
  end;
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
  if exists (select 1 from poker_tables where id = p_table and bots_owner is not null) then return; end if;
  for k in select jsonb_object_keys(won) loop
    if (won->>k)::bigint >= 20 * (select big_blind from poker_tables where id = p_table) and live > 1 then
      nm := (select nickname from profiles where id = (p -> k ->> 'user')::uuid);
      perform chat_sys('lobby', '♠️ ' || nm || ' לקח קופה של ₪' || to_char((won->>k)::bigint, 'FM999,999,999,999,999,999') || ' עם ' || ph_cat_name((sc->>k)::bigint) || '.');
    end if;
  end loop;
end $$;

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
      update poker_seats ps set stack = 2000000, last_seen = now(), missed = 0 where ps.table_id = p_table and pb_is_bot(ps.user_id) and ps.stack < 200000;
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

create or replace function poker_state(p_table uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); h poker_hands; t poker_tables; myseat int; seats jsonb;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  update poker_seats set last_seen = now() where table_id = p_table and user_id = u;
  perform poker_tick(p_table);
  select * into h from poker_hands where table_id = p_table;
  select * into t from poker_tables where id = p_table;
  select seat_index into myseat from poker_seats where table_id = p_table and user_id = u;
  select coalesce(jsonb_object_agg(s.seat_index::text, jsonb_build_object('user', s.user_id, 'name', coalesce(p.nickname, b.name), 'bot', b.img, 'stack',
           coalesce((h.players -> s.seat_index::text ->> 'stack')::bigint, s.stack), 'leaving', s.leaving, 'away', s.last_seen < now() - interval '15 seconds',
           'in_hand', h.players ? s.seat_index::text,
           'bet', coalesce((h.players -> s.seat_index::text ->> 'bet')::bigint, 0),
           'folded', coalesce((h.players -> s.seat_index::text ->> 'folded')::boolean, false),
           'allin', coalesce((h.players -> s.seat_index::text ->> 'allin')::boolean, false),
           'hole', case when s.user_id = u then h.players -> s.seat_index::text -> 'hole'
                        when h.street = 'done' then h.result -> 'shown' -> s.seat_index::text -> 'hole' end)), '{}')
    into seats from poker_seats s left join profiles p on p.id = s.user_id left join poker_bots b on b.id = s.user_id where s.table_id = p_table;
  return jsonb_build_object('table', jsonb_build_object('id', t.id, 'name', t.name, 'sb', t.small_blind, 'bb', t.big_blind, 'min', t.min_buyin, 'max', t.max_buyin),
    'hand_no', h.hand_no, 'street', h.street, 'board', to_jsonb(h.board), 'dealer', h.dealer, 'to_act', h.to_act,
    'deadline', h.deadline, 'now', now(), 'current_bet', h.current_bet, 'min_raise', h.min_raise,
    'pot', (select coalesce(sum((value->>'committed')::bigint), 0) from jsonb_each(h.players)),
    'seats', seats, 'me', myseat, 'result', case when h.street = 'done' then h.result - 'shown' ||
      jsonb_build_object('hands', (select jsonb_object_agg(key, value->'hand') from jsonb_each(coalesce(h.result->'shown', '{}')))) end,
    'balance', (select balance from wallets where user_id = u),
    'tourney', (select jsonb_build_object('id', tn.id, 'prize', tn.prize, 'mult', tn.mult, 'status', tn.status, 'places', tn.places,
                 'left', (select count(*) from poker_seats where table_id = p_table), 'join_until', tn.started_at + interval '5 minutes') from tourneys tn where tn.table_id = p_table));
end $$;

create or replace function poker_sit(p_table uuid, p_seat int, p_amount bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); t poker_tables;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into t from poker_tables where id = p_table and (level is not null or bots_owner = u);
  if not found then raise exception 'invalid_table'; end if;
  if p_seat not between 0 and 5 then raise exception 'invalid_seat'; end if;
  if p_amount < t.min_buyin or p_amount > t.max_buyin then raise exception 'invalid_amount'; end if;
  if exists (select 1 from poker_seats where user_id = u) then raise exception 'already_seated'; end if;
  if exists (select 1 from poker_seats where table_id = p_table and seat_index = p_seat) then raise exception 'seat_taken'; end if;
  perform poker_buyin(u, p_table, p_seat, p_amount, 'pkin:' || p_table || ':' || u || ':' || extract(epoch from clock_timestamp())::text);
  return poker_state(p_table);
end $$;
revoke all on function pb_strength(text[], text[]), pb_act(uuid) from public, anon, authenticated;
