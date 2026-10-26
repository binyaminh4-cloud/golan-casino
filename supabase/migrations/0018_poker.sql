-- Golan Casino · Texas Hold'em, open tables (no-limit, 6 seats). Server-authoritative, advanced lazily:
-- every poker_state / poker_act call first runs poker_tick (timeouts, next hand), so no cron is needed.
-- Five tables from cheap to expensive; 25 seconds per turn (a timeout checks when possible, otherwise folds).
-- Chips at the table are a reservation from the wallet (poker_buyin / poker_cashout from 0001), so the
-- leaderboard already counts them. Hole cards live only in poker_hands, which clients cannot read.

alter table poker_tables add column if not exists level int;
alter table poker_tables add column if not exists min_buyin bigint;
alter table poker_tables add column if not exists max_buyin bigint;
alter table poker_seats add column if not exists leaving boolean not null default false;
alter table poker_seats add column if not exists missed int not null default 0;
create unique index if not exists poker_tables_level on poker_tables (level);
insert into poker_tables (name, max_seats, small_blind, big_blind, level, min_buyin, max_buyin) values
  ('מתחילים', 6, 10, 20, 1, 1000, 4000),
  ('חבר׳ה', 6, 50, 100, 2, 5000, 20000),
  ('רציני', 6, 250, 500, 3, 25000, 100000),
  ('היי־רולר', 6, 1000, 2000, 4, 100000, 400000),
  ('השולחן של זאוס', 6, 5000, 10000, 5, 500000, 2000000)
on conflict (level) do nothing;

create table if not exists poker_hands (
  table_id uuid primary key references poker_tables(id) on delete cascade,
  hand_no bigint not null default 0,
  deck text[],
  pos int not null default 0,
  board text[] not null default '{}',
  dealer int,
  street text not null default 'idle' check (street in ('idle', 'preflop', 'flop', 'turn', 'river', 'done')),
  to_act int,
  deadline timestamptz,
  current_bet bigint not null default 0,
  min_raise bigint not null default 0,
  players jsonb not null default '{}',     -- seat -> {user, hole, stack, bet, committed, folded, allin, acted}
  result jsonb,
  next_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table poker_hands enable row level security;
revoke all on poker_hands from anon, authenticated;
insert into poker_hands (table_id) select id from poker_tables on conflict do nothing;

-- ---------- hand evaluation: a comparable score for the best 5 of up to 7 cards ----------
create or replace function ph_rank(c text) returns int language sql immutable as $$
  select position(left(c, 1) in '23456789TJQKA') + 1 $$;

create or replace function ph_eval5(c text[]) returns bigint language plpgsql immutable as $$
declare r int[]; s text[]; flush boolean; straight int := 0; grp int[][]; i int; cat int; tb int[] := '{}'; v bigint := 0;
        cnt record; u int[];
begin
  select array_agg(ph_rank(x) order by ph_rank(x) desc) into r from unnest(c) x;
  flush := (select count(distinct right(x, 1)) from unnest(c) x) = 1;
  select array_agg(distinct y order by y desc) into u from unnest(r) y;
  if array_length(u, 1) = 5 then
    if u[1] - u[5] = 4 then straight := u[1];
    elsif u = array[14, 5, 4, 3, 2] then straight := 5; end if;
  end if;
  -- groups ordered by count desc, rank desc
  for cnt in select y, count(*) n from unnest(r) y group by y order by count(*) desc, y desc loop
    tb := tb || cnt.y::int;
  end loop;
  select array_agg(n order by n desc, y desc) into u from (select y, count(*)::int n from unnest(r) y group by y) q;
  if straight > 0 and flush then cat := 8; tb := array[straight];
  elsif u[1] = 4 then cat := 7;
  elsif u[1] = 3 and u[2] = 2 then cat := 6;
  elsif flush then cat := 5; tb := r;
  elsif straight > 0 then cat := 4; tb := array[straight];
  elsif u[1] = 3 then cat := 3;
  elsif u[1] = 2 and u[2] = 2 then cat := 2;
  elsif u[1] = 2 then cat := 1;
  else cat := 0; tb := r; end if;
  v := cat;
  for i in 1..5 loop v := v * 15 + coalesce(tb[i], 0); end loop;
  return v;
end $$;

create or replace function ph_best(c text[]) returns bigint language plpgsql immutable as $$
declare n int := array_length(c, 1); a int; b int; d int; e int; f int; best bigint := 0; v bigint;
begin
  if n < 5 then return 0; end if;
  for a in 1..n-4 loop for b in a+1..n-3 loop for d in b+1..n-2 loop for e in d+1..n-1 loop for f in e+1..n loop
    v := ph_eval5(array[c[a], c[b], c[d], c[e], c[f]]); if v > best then best := v; end if;
  end loop; end loop; end loop; end loop; end loop;
  return best;
end $$;

create or replace function ph_cat_name(v bigint) returns text language sql immutable as $$
  select (array['קלף גבוה','זוג','שני זוגות','שלישייה','רצף','צבע','פול האוס','רביעייה','סטרייט פלאש'])[(v / 759375)::int + 1] $$;   -- 15^5

-- ---------- helpers on the players map ----------
create or replace function ph_seats(p jsonb) returns int[] language sql immutable as $$
  select coalesce(array_agg(k::int order by k::int), '{}') from jsonb_object_keys(p) k $$;
-- next seat after p_from (circular) that satisfies: 'any' in the hand, 'live' not folded, 'act' not folded and not all-in
create or replace function ph_next(p jsonb, p_from int, p_kind text) returns int language plpgsql immutable as $$
declare s int[] := ph_seats(p); i int; k int; n int := array_length(s, 1); x jsonb;
begin
  if n is null then return null; end if;
  for i in 1..6 loop
    k := (p_from + i) % 6;
    x := p -> k::text;
    if x is not null and (p_kind = 'any' or (p_kind = 'live' and not (x->>'folded')::boolean)
        or (p_kind = 'act' and not (x->>'folded')::boolean and not (x->>'allin')::boolean)) then return k; end if;
  end loop;
  return null;
end $$;
create or replace function ph_count(p jsonb, p_kind text) returns int language sql immutable as $$
  select count(*)::int from jsonb_each(p) e where
    case p_kind when 'live' then not (e.value->>'folded')::boolean
                when 'act' then not (e.value->>'folded')::boolean and not (e.value->>'allin')::boolean else true end $$;

-- put chips in for a seat (capped at its stack); returns the new map
create or replace function ph_put(p jsonb, p_seat int, p_amt bigint) returns jsonb language plpgsql immutable as $$
declare x jsonb := p -> p_seat::text; a bigint;
begin
  a := least(p_amt, (x->>'stack')::bigint);
  x := x || jsonb_build_object('stack', (x->>'stack')::bigint - a, 'bet', (x->>'bet')::bigint + a, 'committed', (x->>'committed')::bigint + a);
  if (x->>'stack')::bigint = 0 then x := x || '{"allin":true}'; end if;
  return jsonb_set(p, array[p_seat::text], x);
end $$;

-- ---------- hand flow ----------
create or replace function ph_start(p_table uuid) returns void language plpgsql security definer set search_path = public as $$
declare h poker_hands; t poker_tables; p jsonb := '{}'; s record; d int; sb int; bb int; i int; k int;
begin
  select * into h from poker_hands where table_id = p_table for update;
  select * into t from poker_tables where id = p_table;
  for s in select * from poker_seats where table_id = p_table and stack > 0 and not leaving order by seat_index loop
    p := p || jsonb_build_object(s.seat_index::text, jsonb_build_object('user', s.user_id, 'stack', s.stack, 'bet', 0, 'committed', 0,
           'folded', false, 'allin', false, 'acted', false, 'hole', '[]'::jsonb));
  end loop;
  if ph_count(p, 'any') < 2 then
    update poker_hands set street = 'idle', players = '{}', board = '{}', to_act = null, deadline = null where table_id = p_table; return;
  end if;
  d := ph_next(p, coalesce(h.dealer, -1), 'any');
  if ph_count(p, 'any') = 2 then sb := d; else sb := ph_next(p, d, 'any'); end if;
  bb := ph_next(p, sb, 'any');
  h.deck := (select array_agg(r || su order by gen_random_uuid()) from unnest(string_to_array('A,2,3,4,5,6,7,8,9,T,J,Q,K', ',')) r, unnest(string_to_array('S,H,D,C', ',')) su);
  h.pos := 0;
  for i in 1..2 loop
    k := d;
    loop
      k := ph_next(p, k, 'any');
      h.pos := h.pos + 1;
      p := jsonb_set(p, array[k::text, 'hole'], (p -> k::text -> 'hole') || to_jsonb(h.deck[h.pos]));
      exit when k = d;
    end loop;
  end loop;
  p := ph_put(p, sb, t.small_blind); p := ph_put(p, bb, t.big_blind);
  update poker_hands set hand_no = hand_no + 1, deck = h.deck, pos = h.pos, board = '{}', dealer = d, street = 'preflop',
    current_bet = t.big_blind, min_raise = t.big_blind, players = p, result = null,
    to_act = ph_next(p, bb, 'act'), deadline = now() + interval '25 seconds', updated_at = now() where table_id = p_table;
  -- everyone all-in from the blinds: run it out
  if ph_count(p, 'act') <= 1 and ((p -> ph_next(p, bb, 'act')::text ->> 'bet')::bigint >= t.big_blind or ph_count(p, 'act') = 0) then perform ph_advance(p_table); end if;
end $$;

-- the betting round is over: next street, or showdown
create or replace function ph_advance(p_table uuid) returns void language plpgsql security definer set search_path = public as $$
declare h poker_hands; t poker_tables; p jsonb; k text; nxt text; n int;
begin
  select * into h from poker_hands where table_id = p_table for update;
  select * into t from poker_tables where id = p_table;
  p := h.players;
  if ph_count(p, 'live') = 1 then perform ph_showdown(p_table); return; end if;
  loop
    nxt := case h.street when 'preflop' then 'flop' when 'flop' then 'turn' when 'turn' then 'river' else 'showdown' end;
    if nxt = 'showdown' then
      update poker_hands set players = p, board = h.board where table_id = p_table;
      perform ph_showdown(p_table); return;
    end if;
    n := case nxt when 'flop' then 3 else 1 end;
    h.pos := h.pos + 1;                                    -- burn
    for i in 1..n loop h.pos := h.pos + 1; h.board := h.board || h.deck[h.pos]; end loop;
    for k in select jsonb_object_keys(p) loop
      p := jsonb_set(p, array[k], (p -> k) || '{"bet":0,"acted":false}');
    end loop;
    h.street := nxt;
    exit when ph_count(p, 'act') >= 2;                     -- somebody can still bet
  end loop;
  update poker_hands set street = h.street, board = h.board, pos = h.pos, players = p, current_bet = 0, min_raise = t.big_blind,
    to_act = ph_next(p, h.dealer, 'act'), deadline = now() + interval '25 seconds', updated_at = now() where table_id = p_table;
end $$;

-- award the pots (side pots by commitment level) and write stacks back to the seats
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
  -- big pots in the chat
  for k in select jsonb_object_keys(won) loop
    if (won->>k)::bigint >= 20 * (select big_blind from poker_tables where id = p_table) and live > 1 then
      nm := (select nickname from profiles where id = (p -> k ->> 'user')::uuid);
      perform chat_sys('lobby', '♠️ ' || nm || ' לקח קופה של ₪' || to_char((won->>k)::bigint, 'FM999,999,999') || ' עם ' || ph_cat_name((sc->>k)::bigint) || '.');
    end if;
  end loop;
end $$;

-- apply one action for the seat to act (also used for timeouts)
create or replace function ph_apply(p_table uuid, p_seat int, p_action text, p_amount bigint) returns void language plpgsql security definer set search_path = public as $$
declare h poker_hands; p jsonb; x jsonb; bet bigint; stack bigint; tgt bigint; k text; t poker_tables; done boolean;
begin
  select * into h from poker_hands where table_id = p_table for update;
  select * into t from poker_tables where id = p_table;
  p := h.players; x := p -> p_seat::text; bet := (x->>'bet')::bigint; stack := (x->>'stack')::bigint;
  if p_action = 'fold' then
    p := jsonb_set(p, array[p_seat::text, 'folded'], 'true');
  elsif p_action = 'check' then
    if bet < h.current_bet then raise exception 'illegal_action'; end if;
  elsif p_action = 'call' then
    if bet >= h.current_bet then raise exception 'illegal_action'; end if;
    p := ph_put(p, p_seat, h.current_bet - bet);
  elsif p_action in ('raise', 'allin') then
    tgt := case when p_action = 'allin' then bet + stack else p_amount end;
    if tgt > bet + stack then raise exception 'not_enough_chips'; end if;
    if tgt <= h.current_bet then
      if p_action = 'allin' then p := ph_put(p, p_seat, stack);     -- an all-in call for less
      else raise exception 'raise_too_small'; end if;
    else
      if tgt < h.current_bet + h.min_raise and tgt < bet + stack then raise exception 'raise_too_small'; end if;
      p := ph_put(p, p_seat, tgt - bet);
      if tgt - h.current_bet >= h.min_raise then h.min_raise := tgt - h.current_bet; end if;
      h.current_bet := tgt;
      for k in select jsonb_object_keys(p) loop                     -- everyone else must act again
        if k <> p_seat::text then p := jsonb_set(p, array[k, 'acted'], 'false'); end if;
      end loop;
    end if;
  else raise exception 'illegal_action'; end if;
  p := jsonb_set(p, array[p_seat::text, 'acted'], 'true');
  update poker_hands set players = p, current_bet = h.current_bet, min_raise = h.min_raise, updated_at = now() where table_id = p_table;
  if ph_count(p, 'live') = 1 then perform ph_showdown(p_table); return; end if;
  -- round over when every player who can act has acted and matched the bet
  select bool_and((value->>'acted')::boolean and (value->>'bet')::bigint >= h.current_bet) into done
    from jsonb_each(p) where not (value->>'folded')::boolean and not (value->>'allin')::boolean;
  if coalesce(done, true) then
    perform ph_advance(p_table);
  else
    update poker_hands set to_act = ph_next(p, p_seat, 'act'), deadline = now() + interval '25 seconds' where table_id = p_table;
  end if;
end $$;

-- timeouts, leaving players, next hand
create or replace function poker_tick(p_table uuid) returns void language plpgsql security definer set search_path = public as $$
declare h poker_hands; x jsonb; s record;
begin
  select * into h from poker_hands where table_id = p_table for update;
  if h.street in ('preflop', 'flop', 'turn', 'river') and h.deadline < now() then
    x := h.players -> h.to_act::text;
    update poker_seats set missed = missed + 1 where table_id = p_table and seat_index = h.to_act;
    perform ph_apply(p_table, h.to_act, case when (x->>'bet')::bigint >= h.current_bet then 'check' else 'fold' end, 0);
    select * into h from poker_hands where table_id = p_table;
  end if;
  if h.street in ('idle', 'done') and h.next_at <= now() then
    -- between hands: players who left, went quiet, missed 3 turns in a row or have no chips go back to the wallet
    for s in select * from poker_seats where table_id = p_table and (leaving or stack = 0 or missed >= 3 or last_seen < now() - interval '2 minutes') loop
      perform poker_cashout(p_table, s.user_id, 'pkout:' || p_table || ':' || s.user_id || ':' || h.hand_no || ':' || extract(epoch from now())::bigint);
    end loop;
    perform ph_start(p_table);
  end if;
end $$;

-- ---------- client RPCs ----------
create or replace function poker_tables_list() returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'level', t.level, 'sb', t.small_blind, 'bb', t.big_blind,
    'min', t.min_buyin, 'max', t.max_buyin, 'seats', t.max_seats,
    'players', (select coalesce(jsonb_agg(p.nickname order by s.seat_index), '[]') from poker_seats s join profiles p on p.id = s.user_id where s.table_id = t.id))
    order by t.level), '[]')
  from poker_tables t where t.level is not null and auth.uid() is not null $$;

create or replace function poker_sit(p_table uuid, p_seat int, p_amount bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); t poker_tables;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into t from poker_tables where id = p_table and level is not null;
  if not found then raise exception 'invalid_table'; end if;
  if p_seat not between 0 and 5 then raise exception 'invalid_seat'; end if;
  if p_amount < t.min_buyin or p_amount > t.max_buyin then raise exception 'invalid_amount'; end if;
  if exists (select 1 from poker_seats where user_id = u) then raise exception 'already_seated'; end if;
  if exists (select 1 from poker_seats where table_id = p_table and seat_index = p_seat) then raise exception 'seat_taken'; end if;
  perform poker_buyin(u, p_table, p_seat, p_amount, 'pkin:' || p_table || ':' || u || ':' || extract(epoch from clock_timestamp())::text);
  return poker_state(p_table);
end $$;

create or replace function poker_leave(p_table uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); h poker_hands; s poker_seats;
begin
  select * into s from poker_seats where table_id = p_table and user_id = u;
  if not found then return null; end if;
  select * into h from poker_hands where table_id = p_table for update;
  if h.street in ('preflop', 'flop', 'turn', 'river') and h.players ? s.seat_index::text then
    update poker_seats set leaving = true where table_id = p_table and user_id = u;
    if h.to_act = s.seat_index then perform ph_apply(p_table, s.seat_index, 'fold', 0);
    elsif not (h.players -> s.seat_index::text ->> 'folded')::boolean then
      update poker_hands set players = jsonb_set(players, array[s.seat_index::text, 'folded'], 'true') where table_id = p_table;
      if ph_count((select players from poker_hands where table_id = p_table), 'live') = 1 then perform ph_showdown(p_table); end if;
    end if;
  else
    perform poker_cashout(p_table, u, 'pkout:' || p_table || ':' || u || ':' || h.hand_no || ':' || extract(epoch from clock_timestamp())::bigint);
  end if;
  return jsonb_build_object('left', true, 'balance', (select balance from wallets where user_id = u));
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
  select coalesce(jsonb_object_agg(s.seat_index::text, jsonb_build_object('user', s.user_id, 'name', p.nickname, 'stack',
           coalesce((h.players -> s.seat_index::text ->> 'stack')::bigint, s.stack), 'leaving', s.leaving,
           'in_hand', h.players ? s.seat_index::text,
           'bet', coalesce((h.players -> s.seat_index::text ->> 'bet')::bigint, 0),
           'folded', coalesce((h.players -> s.seat_index::text ->> 'folded')::boolean, false),
           'allin', coalesce((h.players -> s.seat_index::text ->> 'allin')::boolean, false),
           'hole', case when s.user_id = u then h.players -> s.seat_index::text -> 'hole'
                        when h.street = 'done' then h.result -> 'shown' -> s.seat_index::text -> 'hole' end)), '{}')
    into seats from poker_seats s join profiles p on p.id = s.user_id where s.table_id = p_table;
  return jsonb_build_object('table', jsonb_build_object('id', t.id, 'name', t.name, 'sb', t.small_blind, 'bb', t.big_blind, 'min', t.min_buyin, 'max', t.max_buyin),
    'hand_no', h.hand_no, 'street', h.street, 'board', to_jsonb(h.board), 'dealer', h.dealer, 'to_act', h.to_act,
    'deadline', h.deadline, 'now', now(), 'current_bet', h.current_bet, 'min_raise', h.min_raise,
    'pot', (select coalesce(sum((value->>'committed')::bigint), 0) from jsonb_each(h.players)),
    'seats', seats, 'me', myseat, 'result', case when h.street = 'done' then h.result - 'shown' ||
      jsonb_build_object('hands', (select jsonb_object_agg(key, value->'hand') from jsonb_each(coalesce(h.result->'shown', '{}')))) end,
    'balance', (select balance from wallets where user_id = u));
end $$;

create or replace function poker_act(p_table uuid, p_action text, p_amount bigint default 0, p_hand bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); h poker_hands; s poker_seats;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  perform poker_tick(p_table);
  select * into s from poker_seats where table_id = p_table and user_id = u;
  if not found then raise exception 'not_seated'; end if;
  select * into h from poker_hands where table_id = p_table for update;
  if h.street not in ('preflop', 'flop', 'turn', 'river') or h.to_act <> s.seat_index or (p_hand is not null and p_hand <> h.hand_no) then raise exception 'not_your_turn'; end if;
  update poker_seats set missed = 0 where table_id = p_table and user_id = u;
  perform ph_apply(p_table, s.seat_index, p_action, coalesce(p_amount, 0));
  return poker_state(p_table);
end $$;

revoke all on function ph_rank, ph_eval5, ph_best, ph_cat_name, ph_seats, ph_next, ph_count, ph_put, ph_start, ph_advance, ph_showdown, ph_apply, poker_tick from public, anon, authenticated;
revoke all on function poker_tables_list(), poker_sit(uuid, int, bigint), poker_leave(uuid), poker_state(uuid), poker_act(uuid, text, bigint, bigint) from public, anon;
grant execute on function poker_tables_list(), poker_sit(uuid, int, bigint), poker_leave(uuid), poker_state(uuid), poker_act(uuid, text, bigint, bigint) to authenticated;
