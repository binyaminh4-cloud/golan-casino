-- Shared blackjack table: friends play together against one dealer.
-- Each player's hand is a normal bj_rounds row (same rules, side bets, insurance and payouts as the solo game);
-- the shoe and the dealer's cards belong to the table round. Rounds move forward lazily whenever anyone polls.
--   betting  : the window opens with the first bet and lasts 15s (deals at once when everyone at the table has bet)
--   playing  : everyone plays their own hand at the same time; 30s, then unfinished hands stand
--   done     : the dealer plays, every hand is paid, results stay on screen 7s
alter table bj_rounds add column if not exists t_no int, add column if not exists t_round bigint;
alter table bj_rounds drop constraint if exists bj_rounds_status_check;
alter table bj_rounds add constraint bj_rounds_status_check check (status in ('insurance','playing','waiting','done'));

create table if not exists bjt_rounds (
  t_no int not null, round_no bigint not null, phase text not null default 'betting' check (phase in ('betting','playing','done')),
  bet_until numeric, play_until numeric, done_at numeric, dealer text[], primary key (t_no, round_no));
create table if not exists bjt_shoes (t_no int primary key, cards text[] not null, pos int not null default 0);
create table if not exists bjt_bets (
  t_no int not null, round_no bigint not null, user_id uuid not null references profiles(id) on delete cascade,
  seat int not null, main bigint not null, side jsonb not null default '{}', total bigint not null, ref text not null unique, bj_round uuid,
  primary key (t_no, round_no, user_id));
create table if not exists bjt_presence (user_id uuid primary key references profiles(id) on delete cascade, t_no int not null, seen numeric not null);
alter table bjt_rounds enable row level security; alter table bjt_shoes enable row level security;
alter table bjt_bets enable row level security; alter table bjt_presence enable row level security;
revoke all on bjt_rounds, bjt_shoes, bjt_bets, bjt_presence from anon, authenticated;

-- ---------- the shoe: a table hand draws from the table's shoe ----------
create or replace function bj_draw(p_user uuid) returns text language plpgsql security definer set search_path = public as $$
declare s bj_shoes; ts bjt_shoes; c text; v_run uuid := nullif(current_setting('gc.ch_run', true), '')::uuid; v_pos int;
        v_t int := nullif(current_setting('gc.bj_table', true), '')::int;
begin
  if v_run is not null then                                  -- a challenge hand: draw from the run's fixed deck
    update ch_runs set pos = pos + 1 where id = v_run returning pos, deck[pos] into v_pos, c;
    return c;
  end if;
  if v_t is not null then                                    -- a shared-table hand: the table's own 6-deck shoe
    select * into ts from bjt_shoes where t_no = v_t for update;
    if not found or ts.pos >= 234 then
      insert into bjt_shoes(t_no, cards, pos)
        values (v_t, (select array_agg(r||su order by gen_random_uuid())
                      from unnest(string_to_array('A,2,3,4,5,6,7,8,9,T,J,Q,K',',')) r,
                           unnest(string_to_array('S,H,D,C',',')) su, generate_series(1,6) d), 0)
        on conflict (t_no) do update set cards = excluded.cards, pos = 0;
      select * into ts from bjt_shoes where t_no = v_t;
    end if;
    update bjt_shoes set pos = pos + 1 where t_no = v_t;
    return ts.cards[ts.pos + 1];
  end if;
  select * into s from bj_shoes where user_id = p_user for update;
  if not found or s.pos >= 234 then  -- 312 cards * 0.75
    insert into bj_shoes(user_id, cards, pos)
      values (p_user, (select array_agg(r||su order by gen_random_uuid())
                       from unnest(string_to_array('A,2,3,4,5,6,7,8,9,T,J,Q,K',',')) r,
                            unnest(string_to_array('S,H,D,C',',')) su,
                            generate_series(1,6) d), 0)
      on conflict (user_id) do update set cards = excluded.cards, pos = 0;
    select * into s from bj_shoes where user_id = p_user;
  end if;
  c := s.cards[s.pos + 1];
  update bj_shoes set pos = pos + 1 where user_id = p_user;
  return c;
end $$;

-- a finished table hand waits for the dealer instead of being settled alone
create or replace function bj_hold(p_round uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from bj_rounds where id = p_round and t_no is not null) then
    update bj_rounds set status = 'waiting' where id = p_round and status <> 'done';
  else
    perform bj_finish(p_round);
  end if;
end $$;

create or replace function bj_advance(p_round uuid) returns void language plpgsql security definer set search_path = public as $$
declare r bj_rounds; i int; h jsonb;
begin
  select * into r from bj_rounds where id = p_round for update;
  for i in r.active .. jsonb_array_length(r.hands) - 1 loop
    h := r.hands -> i;
    if jsonb_array_length(h->'cards') = 1 then   -- a split hand waiting for its second card
      h := jsonb_set(h, '{cards}', (h->'cards') || to_jsonb(bj_draw(r.user_id)));
      if (h->>'aces')::boolean or bj_total(bj_jcards(h->'cards')) = 21 then h := h || '{"done":true}'; end if;
      r.hands := jsonb_set(r.hands, array[i::text], h);
    end if;
    if not (h->>'done')::boolean then
      update bj_rounds set hands = r.hands, active = i where id = p_round; return;
    end if;
  end loop;
  update bj_rounds set hands = r.hands where id = p_round;
  perform bj_hold(p_round);
end $$;

create or replace function bj_action(p_round uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r bj_rounds; h jsonb; i int; c text[]; extra bigint;
begin
  select * into r from bj_rounds where id = p_round and user_id = u for update;
  if not found then raise exception 'round_not_found'; end if;
  if r.ch_run is not null then perform set_config('gc.ch_run', r.ch_run::text, true); end if;
  if r.t_no is not null then perform set_config('gc.bj_table', r.t_no::text, true); end if;
  if r.status in ('done', 'waiting') then return bj_view(p_round); end if;
  if not (bj_view(p_round)->'actions') ? p_action then raise exception 'illegal_action'; end if;
  i := r.active; h := r.hands -> i;

  if p_action in ('insurance','no_insurance') then
    if p_action = 'insurance' then
      extra := r.main_bet / 2;
      perform bj_tx(u, 'blackjack', 'stake', -extra, 'bjins:' || p_round);
      update bj_rounds set insurance = extra, total_staked = total_staked + extra where id = p_round;
    end if;
    if bj_is_bj(r.dealer) then perform bj_hold(p_round);
    else update bj_rounds set status = 'playing' where id = p_round; end if;
    return bj_view(p_round);
  end if;

  if p_action = 'hit' then
    h := jsonb_set(h, '{cards}', (h->'cards') || to_jsonb(bj_draw(u)));
    if bj_total(bj_jcards(h->'cards')) >= 21 then h := h || '{"done":true}'; end if;
  elsif p_action = 'stand' then
    h := h || '{"done":true}';
  elsif p_action = 'double' then
    extra := (h->>'bet')::bigint;
    perform bj_tx(u, 'blackjack', 'stake', -extra, 'bjdbl:' || p_round || ':' || i);
    update bj_rounds set total_staked = total_staked + extra where id = p_round;
    h := jsonb_set(h, '{cards}', (h->'cards') || to_jsonb(bj_draw(u)));
    h := h || jsonb_build_object('bet', extra * 2, 'done', true, 'doubled', true);
  elsif p_action = 'surrender' then
    h := h || '{"done":true,"surrendered":true}';
  elsif p_action = 'split' then
    extra := (h->>'bet')::bigint;
    perform bj_tx(u, 'blackjack', 'stake', -extra, 'bjsplit:' || p_round || ':' || jsonb_array_length(r.hands));
    update bj_rounds set total_staked = total_staked + extra where id = p_round;
    c := bj_jcards(h->'cards');
    h := h || jsonb_build_object('cards', jsonb_build_array(c[1]), 'split', true, 'aces', left(c[1],1) = 'A');
    r.hands := jsonb_set(r.hands, array[i::text], h);
    r.hands := jsonb_insert(r.hands, array[i::text], jsonb_build_object('cards', jsonb_build_array(c[2]), 'cards0', h->'cards0',
               'bet', extra, 'done', false, 'surrendered', false, 'split', true, 'aces', left(c[2],1) = 'A'), true);
    update bj_rounds set hands = r.hands where id = p_round;
    perform bj_advance(p_round);
    return bj_view(p_round);
  end if;

  r.hands := jsonb_set(r.hands, array[i::text], h);
  update bj_rounds set hands = r.hands where id = p_round;
  perform bj_advance(p_round);
  return bj_view(p_round);
end $$;

create or replace function bj_view(p_round uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare r bj_rounds; v_hands jsonb; h jsonb; acts text[];
begin
  select * into r from bj_rounds where id = p_round and user_id = auth.uid();
  if not found then return null; end if;
  if r.status in ('done', 'waiting') then
    acts := '{}';
  elsif r.status = 'insurance' then
    acts := array['insurance','no_insurance'];
  else
    h := r.hands -> r.active;
    acts := array['hit','stand'];
    if jsonb_array_length(h->'cards') = 2 and not (h->>'aces')::boolean then
      acts := acts || 'double'::text;
      if bj_val(h->'cards'->>0) = bj_val(h->'cards'->>1) and jsonb_array_length(r.hands) < 4 then acts := acts || 'split'::text; end if;
      if jsonb_array_length(r.hands) = 1 then acts := acts || 'surrender'::text; end if;
    end if;
  end if;
  select jsonb_agg(x || jsonb_build_object('total', bj_total(bj_jcards(x->'cards')))) into v_hands from jsonb_array_elements(r.hands) x;
  return jsonb_build_object(
    'id', r.id, 'mode', r.mode, 'fee', r.fee, 'strikes', r.strikes, 'status', r.status, 'main_bet', r.main_bet, 'side', r.side, 'insurance', r.insurance,
    'hands', v_hands, 'active', r.active, 'actions', to_jsonb(acts), 'table', r.t_no,
    'dealer', case when r.status = 'done' then to_jsonb(r.dealer) else jsonb_build_array(r.dealer[1], '??') end,
    'dealer_total', case when r.status = 'done' then bj_total(r.dealer) else bj_val(r.dealer[1]) end,
    'result', r.result, 'payout', r.payout, 'staked', r.total_staked,
    'balance', (select balance from wallets where user_id = r.user_id),
    'ch', case when r.ch_run is null then null else (select jsonb_build_object('id', c.id, 'kind', c.kind, 'chips', c.chips, 'hands', c.hands, 'max', c.max_hands, 'status', c.status) from ch_runs c where c.id = r.ch_run) end);
end $$;

-- the solo page resumes only solo hands
create or replace function bj_current() returns jsonb language sql security definer set search_path = public as $$
  select bj_view(id) from bj_rounds where user_id = auth.uid() and status <> 'done' and t_no is null limit 1 $$;

-- ---------- table rounds ----------
create or replace function bjt_deal(p_t int, p_n bigint) returns void language plpgsql security definer set search_path = public as $$
declare b bjt_bets; pc jsonb := '{}'; d text[]; p text[]; up int; v_id uuid; st text;
begin
  perform set_config('gc.bj_table', p_t::text, true);
  -- a member who opened a solo hand meanwhile gets the table bet back
  for b in select * from bjt_bets where t_no = p_t and round_no = p_n and bj_round is null
             and exists (select 1 from bj_rounds x where x.user_id = bjt_bets.user_id and x.status <> 'done') loop
    perform bj_tx(b.user_id, 'blackjack', 'payout', b.total, 'bjtrefund:' || b.ref);
    delete from bjt_bets where ref = b.ref;
  end loop;
  -- deal like a real table: one card to each player, the dealer, a second card each, the dealer
  for b in select * from bjt_bets where t_no = p_t and round_no = p_n order by seat loop
    pc := pc || jsonb_build_object(b.user_id::text, jsonb_build_array(bj_draw(null))); end loop;
  d := array[bj_draw(null)];
  for b in select * from bjt_bets where t_no = p_t and round_no = p_n order by seat loop
    pc := jsonb_set(pc, array[b.user_id::text], (pc->b.user_id::text) || to_jsonb(bj_draw(null))); end loop;
  d := d || bj_draw(null);
  up := bj_val(d[1]);
  for b in select * from bjt_bets where t_no = p_t and round_no = p_n order by seat loop
    p := bj_jcards(pc->b.user_id::text);
    st := case when bj_is_bj(p) then 'waiting' when up = 11 then 'insurance' when up = 10 and bj_is_bj(d) then 'waiting' else 'playing' end;
    insert into bj_rounds (user_id, ref, status, main_bet, side, hands, dealer, total_staked, mode, fee, strikes, t_no, t_round)
      values (b.user_id, 'bjt:' || b.ref, st, b.main, b.side,
              jsonb_build_array(jsonb_build_object('cards', to_jsonb(p), 'cards0', to_jsonb(p), 'bet', b.main,
                'done', bj_is_bj(p), 'surrendered', false, 'aces', false, 'split', false)),
              d, b.total, 'classic', 0, '{}', p_t, p_n)
      returning id into v_id;
    update bjt_bets set bj_round = v_id where ref = b.ref;
  end loop;
  update bjt_rounds set phase = 'playing', dealer = d, play_until = rl_live_now() + 30 where t_no = p_t and round_no = p_n;
end $$;

create or replace function bjt_resolve(p_t int, p_n bigint) returns void language plpgsql security definer set search_path = public as $$
declare d text[]; v_id uuid;
begin
  perform set_config('gc.bj_table', p_t::text, true);
  select dealer into d from bjt_rounds where t_no = p_t and round_no = p_n for update;
  if d is not null and not bj_is_bj(d) then
    while bj_total(d) < 17 loop d := d || bj_draw(null); end loop;
  end if;
  update bj_rounds set dealer = d where t_no = p_t and t_round = p_n and status <> 'done';
  for v_id in select id from bj_rounds where t_no = p_t and t_round = p_n and status <> 'done' loop
    perform bj_finish(v_id);
  end loop;
  update bjt_rounds set phase = 'done', dealer = d, done_at = rl_live_now() where t_no = p_t and round_no = p_n;
end $$;

create or replace function bjt_tick(p_t int) returns void language plpgsql security definer set search_path = public as $$
declare r bjt_rounds; t numeric := rl_live_now();
begin
  select * into r from bjt_rounds where t_no = p_t order by round_no desc limit 1 for update;
  if not found then insert into bjt_rounds (t_no, round_no) values (p_t, 1) returning * into r; end if;
  if r.phase = 'betting' and r.bet_until is not null and (t >= r.bet_until or not exists (
        select 1 from bjt_presence pr where pr.t_no = p_t and pr.seen > t - 12
          and not exists (select 1 from bjt_bets bb where bb.t_no = p_t and bb.round_no = r.round_no and bb.user_id = pr.user_id))) then
    perform bjt_deal(p_t, r.round_no);
    select * into r from bjt_rounds where t_no = p_t and round_no = r.round_no;
  end if;
  if r.phase = 'playing' then
    if t >= r.play_until then   -- time's up: unfinished hands stand, open insurance questions are declined
      update bj_rounds set status = 'waiting' where t_no = p_t and t_round = r.round_no and status in ('playing', 'insurance');
    end if;
    if not exists (select 1 from bj_rounds where t_no = p_t and t_round = r.round_no and status in ('playing', 'insurance')) then
      perform bjt_resolve(p_t, r.round_no);
      select * into r from bjt_rounds where t_no = p_t and round_no = r.round_no;
    end if;
  end if;
  if r.phase = 'done' and t >= r.done_at + 7 then
    insert into bjt_rounds (t_no, round_no) values (p_t, r.round_no + 1) on conflict do nothing;
  end if;
end $$;

create or replace function bjt_state(p_t int default 1) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); t numeric; r bjt_rounds; v_players jsonb; v_present jsonb; v_me jsonb; v_bet jsonb;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_t not between 1 and 3 then raise exception 'invalid_table'; end if;
  t := rl_live_now();
  insert into bjt_presence (user_id, t_no, seen) values (u, p_t, t) on conflict (user_id) do update set t_no = excluded.t_no, seen = excluded.seen;
  perform bjt_tick(p_t);
  select * into r from bjt_rounds where t_no = p_t order by round_no desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('id', b.user_id, 'name', p.nickname, 'char', p.character_key, 'seat', b.seat,
           'bet', b.main, 'side', b.side, 'status', br.status, 'net', br.result->'net', 'out', br.result->'hands',
           'hands', (select jsonb_agg(jsonb_build_object('cards', x->'cards', 'bet', x->'bet', 'total', bj_total(bj_jcards(x->'cards'))))
                       from jsonb_array_elements(br.hands) x)) order by b.seat), '[]')
    into v_players
    from bjt_bets b join profiles p on p.id = b.user_id left join bj_rounds br on br.id = b.bj_round
   where b.t_no = p_t and b.round_no = r.round_no;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.nickname, 'char', p.character_key) order by p.nickname), '[]') into v_present
    from bjt_presence pr join profiles p on p.id = pr.user_id where pr.t_no = p_t and pr.seen > t - 12;
  select bj_view(b.bj_round), jsonb_build_object('main', b.main, 'side', b.side) into v_me, v_bet
    from bjt_bets b where b.t_no = p_t and b.round_no = r.round_no and b.user_id = u;
  return jsonb_build_object('table', p_t, 'round', r.round_no, 'phase', r.phase, 'now', round(t * 1000),
    'bet_until', round(r.bet_until * 1000), 'play_until', round(r.play_until * 1000), 'next_at', round((r.done_at + 7) * 1000),
    'dealer', case when r.dealer is null then '[]'::jsonb when r.phase = 'done' then to_jsonb(r.dealer) else jsonb_build_array(r.dealer[1], '??') end,
    'dealer_total', case when r.dealer is null then null when r.phase = 'done' then bj_total(r.dealer) else bj_val(r.dealer[1]) end,
    'players', v_players, 'present', v_present, 'me', v_me, 'my_bet', v_bet,
    'balance', (select balance from wallets where user_id = u));
end $$;

create or replace function bjt_bet(p_t int, p_main bigint, p_pp bigint, p_t3 bigint, p_ll bigint, p_bust bigint, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r bjt_rounds; v_side jsonb := '{}'; total bigint; v_seat int;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_t not between 1 and 3 then raise exception 'invalid_table'; end if;
  if exists (select 1 from bjt_bets where ref = p_ref and user_id = u) then return bjt_state(p_t); end if;   -- duplicate request
  if p_main is null or p_main < 10 or p_main > 50000 then raise exception 'invalid_main_bet'; end if;
  if least(coalesce(p_pp,0), coalesce(p_t3,0), coalesce(p_ll,0), coalesce(p_bust,0)) < 0
     or greatest(coalesce(p_pp,0), coalesce(p_t3,0), coalesce(p_ll,0), coalesce(p_bust,0)) > p_main then raise exception 'invalid_side_bet'; end if;
  perform bjt_tick(p_t);
  select * into r from bjt_rounds where t_no = p_t order by round_no desc limit 1 for update;
  if r.phase <> 'betting' then raise exception 'betting_closed'; end if;
  if exists (select 1 from bjt_bets where t_no = p_t and round_no = r.round_no and user_id = u) then raise exception 'already_bet'; end if;
  if exists (select 1 from bj_rounds where user_id = u and status <> 'done') then raise exception 'round_in_progress'; end if;
  select coalesce(max(seat), 0) + 1 into v_seat from bjt_bets where t_no = p_t and round_no = r.round_no;
  if v_seat > 5 then raise exception 'table_full'; end if;
  if coalesce(p_pp,0) > 0 then v_side := v_side || jsonb_build_object('pp', p_pp); end if;
  if coalesce(p_t3,0) > 0 then v_side := v_side || jsonb_build_object('t3', p_t3); end if;
  if coalesce(p_ll,0) > 0 then v_side := v_side || jsonb_build_object('ll', p_ll); end if;
  if coalesce(p_bust,0) > 0 then v_side := v_side || jsonb_build_object('bust', p_bust); end if;
  total := p_main + coalesce(p_pp,0) + coalesce(p_t3,0) + coalesce(p_ll,0) + coalesce(p_bust,0);
  perform bj_tx(u, 'blackjack', 'stake', -total, 'bjstake:' || p_ref);
  insert into bjt_bets (t_no, round_no, user_id, seat, main, side, total, ref) values (p_t, r.round_no, u, v_seat, p_main, v_side, total, p_ref);
  if r.bet_until is null then update bjt_rounds set bet_until = rl_live_now() + 15 where t_no = p_t and round_no = r.round_no; end if;
  return bjt_state(p_t);
end $$;

revoke all on function bj_hold(uuid), bjt_deal(int, bigint), bjt_resolve(int, bigint), bjt_tick(int) from public, anon, authenticated;
revoke all on function bj_draw(uuid), bj_advance(uuid) from public, anon, authenticated;
revoke all on function bjt_state(int), bjt_bet(int, bigint, bigint, bigint, bigint, bigint, text), bj_action(uuid, text), bj_view(uuid), bj_current() from public, anon;
grant execute on function bjt_state(int), bjt_bet(int, bigint, bigint, bigint, bigint, bigint, text), bj_action(uuid, text), bj_view(uuid), bj_current() to authenticated;
