-- poker: every seat shows its last action on this street (check / call / raise / all-in / fold)
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
  -- what this player just did, shown at the table until the street ends
  p := jsonb_set(p, array[p_seat::text, 'last'], to_jsonb(case when p_action = 'raise' and h.current_bet > 0 and (p -> p_seat::text ->> 'bet')::bigint >= h.current_bet
         and (select count(*) from jsonb_each(p) e where (e.value->>'bet')::bigint > 0) = 1 then 'bet' else p_action end));
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
      p := jsonb_set(p, array[k], (p -> k) || '{"bet":0,"acted":false,"last":null}');
    end loop;
    h.street := nxt;
    exit when ph_count(p, 'act') >= 2;                     -- somebody can still bet
  end loop;
  update poker_hands set street = h.street, board = h.board, pos = h.pos, players = p, current_bet = 0, min_raise = t.big_blind,
    to_act = ph_next(p, h.dealer, 'act'), deadline = now() + interval '25 seconds', updated_at = now() where table_id = p_table;
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
           'last', h.players -> s.seat_index::text ->> 'last',
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
