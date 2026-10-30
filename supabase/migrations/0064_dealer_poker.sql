-- Poker against the dealer: Three Card Poker (tcp), Ultimate Texas Hold'em (uth), Caribbean Stud (csp).
-- Every hand belongs to a dp_rounds row. Private table = t_no 0 (one player, moves on at once);
-- live table = t_no 1 (friends together, timed phases that move forward lazily whenever anyone polls, like the blackjack table).
-- Phases:  tcp/csp: betting → d1 (play or fold) → done      uth: betting → d1 (preflop) → d2 (flop) → d3 (river) → done

create table if not exists dp_rounds (
  id uuid primary key default gen_random_uuid(), game text not null check (game in ('tcp', 'uth', 'csp')),
  t_no int not null default 0, owner uuid references profiles(id) on delete cascade, round_no bigint not null default 0,
  phase text not null default 'betting' check (phase in ('betting', 'd1', 'd2', 'd3', 'done')),
  until numeric, deck text[], pos int not null default 0, dealer text[], board text[], done_at numeric,
  created_at timestamptz not null default clock_timestamp());
create index if not exists dp_rounds_table on dp_rounds (game, t_no, round_no desc);
create index if not exists dp_rounds_owner on dp_rounds (owner, created_at desc);
create table if not exists dp_hands (
  id uuid primary key default gen_random_uuid(), round_id uuid not null references dp_rounds(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade, seat int not null default 1,
  cards text[], ante bigint not null, blind bigint not null default 0, side bigint not null default 0, play bigint not null default 0,
  status text not null default 'act' check (status in ('act', 'wait', 'fold', 'done')), acted text, result jsonb, ref text not null unique,
  unique (round_id, user_id));
create table if not exists dp_presence (user_id uuid not null references profiles(id) on delete cascade, game text not null, seen numeric not null, primary key (user_id, game));
alter table dp_rounds enable row level security; alter table dp_hands enable row level security; alter table dp_presence enable row level security;
revoke all on dp_rounds, dp_hands, dp_presence from anon, authenticated;

-- ---------- cards ----------
create or replace function dp_rank(c text) returns int language sql immutable as $$
  select position(left(c, 1) in '23456789TJQKA') + 1 $$;
create or replace function dp_deck() returns text[] language sql volatile as $$
  select array_agg(r || s order by random()) from unnest(string_to_array('2,3,4,5,6,7,8,9,T,J,Q,K,A', ',')) r, unnest(array['S','H','D','C']) s $$;

-- 5-card score: category * 15^5 + kickers. Categories: 0 high, 1 pair, 2 two pair, 3 trips, 4 straight, 5 flush, 6 full house, 7 quads, 8 straight flush
create or replace function dp_eval5(c text[]) returns bigint language plpgsql immutable as $$
declare r int[]; cnt int[]; g int[]; flush boolean; straight boolean := false; hi int; cat int; k bigint := 0; x int; i int;
begin
  select array_agg(dp_rank(v) order by dp_rank(v) desc) into r from unnest(c) v;
  flush := (select count(distinct right(v, 1)) from unnest(c) v) = 1;
  if (select count(distinct x2) from unnest(r) x2) = 5 then
    if r[1] - r[5] = 4 then straight := true; hi := r[1];
    elsif r[1] = 14 and r[2] = 5 then straight := true; hi := 5; end if;
  end if;
  -- ranks ordered by (count desc, rank desc)
  select array_agg(rk order by n desc, rk desc), array_agg(n order by n desc, rk desc) into g, cnt
    from (select x3 rk, count(*) n from unnest(r) x3 group by x3) q;
  if straight and flush then cat := 8; g := array[hi];
  elsif cnt[1] = 4 then cat := 7;
  elsif cnt[1] = 3 and cnt[2] = 2 then cat := 6;
  elsif flush then cat := 5;
  elsif straight then cat := 4; g := array[hi];
  elsif cnt[1] = 3 then cat := 3;
  elsif cnt[1] = 2 and cnt[2] = 2 then cat := 2;
  elsif cnt[1] = 2 then cat := 1;
  else cat := 0; end if;
  for i in 1..5 loop k := k * 15 + coalesce(g[i], 0); end loop;
  return cat * 759375 + k;          -- 15^5 = 759375
end $$;
create or replace function dp_cat(score bigint) returns int language sql immutable as $$ select (score / 759375)::int $$;
create or replace function dp_best7(c text[]) returns bigint language plpgsql immutable as $$
declare best bigint := -1; s bigint; a int; b int; n int := array_length(c, 1); pick text[];
begin
  if n <= 5 then return dp_eval5(c); end if;
  for a in 1..n - 1 loop for b in a + 1..n loop
    select array_agg(c[i] order by i) into pick from generate_series(1, n) i where i <> a and i <> b;
    if n = 7 then s := dp_eval5(pick); else s := dp_best7(pick); end if;
    if s > best then best := s; end if;
  end loop; end loop;
  return best;
end $$;
-- 3-card score (Three Card Poker order): 0 high, 1 pair, 2 flush, 3 straight, 4 trips, 5 straight flush
create or replace function dp_eval3(c text[]) returns bigint language plpgsql immutable as $$
declare r int[]; flush boolean; straight boolean := false; hi int; cat int; g int[];
begin
  select array_agg(dp_rank(v) order by dp_rank(v) desc) into r from unnest(c) v;
  flush := (select count(distinct right(v, 1)) from unnest(c) v) = 1;
  if r[1] <> r[2] and r[2] <> r[3] then
    if r[1] - r[3] = 2 then straight := true; hi := r[1]; elsif r[1] = 14 and r[2] = 3 and r[3] = 2 then straight := true; hi := 3; end if;
  end if;
  g := r;
  if straight and flush then cat := 5; g := array[hi, 0, 0];
  elsif r[1] = r[3] then cat := 4;
  elsif straight then cat := 3; g := array[hi, 0, 0];
  elsif flush then cat := 2;
  elsif r[1] = r[2] then cat := 1; g := array[r[1], r[3], 0];
  elsif r[2] = r[3] then cat := 1; g := array[r[2], r[1], 0];
  else cat := 0; end if;
  return cat * 3375 + g[1] * 225 + g[2] * 15 + g[3];
end $$;

create or replace function dp_draw(p_round uuid, n int) returns text[] language plpgsql security definer set search_path = public as $$
declare d text[]; p int;
begin
  update dp_rounds set pos = pos + n where id = p_round returning deck, pos - n into d, p;
  return d[p + 1 : p + n];
end $$;

-- ---------- settling one hand ----------
create or replace function dp_settle(p_hand uuid) returns void language plpgsql security definer set search_path = public as $$
declare h dp_hands; r dp_rounds; pay bigint := 0; ps bigint; ds bigint; pc int; dq boolean; win int; m numeric; side_pay bigint := 0; bonus bigint := 0; staked bigint; v_game text;
begin
  select * into h from dp_hands where id = p_hand for update; if h.status = 'done' then return; end if;
  select * into r from dp_rounds where id = h.round_id;
  staked := h.ante + h.blind + h.side + h.play;
  if r.game = 'tcp' then
    ps := dp_eval3(h.cards); ds := dp_eval3(r.dealer[1:3]); pc := (ps / 3375)::int;
    m := case pc when 1 then 1 when 2 then 4 when 3 then 6 when 4 then 30 when 5 then 40 else 0 end;   -- pair plus
    if h.side > 0 and m > 0 then side_pay := h.side * (m + 1); end if;
    if h.status <> 'fold' then
      bonus := h.ante * (case pc when 3 then 1 when 4 then 4 when 5 then 5 else 0 end);              -- ante bonus
      dq := ds >= 12 * 225;                                                                       -- queen high or better
      win := sign(ps - ds);
      if not dq then pay := h.ante * 2 + h.play;
      elsif win > 0 then pay := (h.ante + h.play) * 2; elsif win = 0 then pay := h.ante + h.play; end if;
    end if;
  elsif r.game = 'csp' then
    ps := dp_eval5(h.cards); ds := dp_eval5(r.dealer[1:5]); pc := dp_cat(ps);
    if h.status <> 'fold' then
      dq := dp_cat(ds) >= 1 or (ds % 759375) / 50625 = 14 and (ds % 50625) / 3375 = 13;           -- ace-king or better
      win := sign(ps - ds);
      m := case pc when 1 then 1 when 2 then 2 when 3 then 3 when 4 then 4 when 5 then 5 when 6 then 7 when 7 then 20
                   when 8 then case when ps % 759375 / 50625 = 14 then 100 else 50 end else 1 end;
      if not dq then pay := h.ante * 2 + h.play;
      elsif win > 0 then pay := h.ante * 2 + floor(h.play * (1 + m)); elsif win = 0 then pay := h.ante + h.play; end if;
    end if;
  else  -- uth
    ps := dp_best7(h.cards || r.board); ds := dp_best7(r.dealer || r.board); pc := dp_cat(ps);
    m := case pc when 3 then 3 when 4 then 4 when 5 then 7 when 6 then 8 when 7 then 30
                 when 8 then case when ps % 759375 / 50625 = 14 then 50 else 40 end else 0 end;       -- trips side bet
    if h.side > 0 and m > 0 then side_pay := h.side * (m + 1); end if;
    if h.status <> 'fold' then
      dq := dp_cat(ds) >= 1; win := sign(ps - ds);
      if win > 0 then
        pay := h.play * 2 + case when dq then h.ante * 2 else h.ante end
             + floor(h.blind * (1 + case pc when 4 then 1 when 5 then 1.5 when 6 then 3 when 7 then 10
                                          when 8 then case when ps % 759375 / 50625 = 14 then 500 else 50 end else 0 end));
      elsif win = 0 then pay := h.ante + h.blind + h.play;
      else pay := case when dq then 0 else h.ante end; end if;
    end if;
  end if;
  pay := pay + side_pay + bonus;
  v_game := case r.game when 'tcp' then 'three_card_poker' when 'uth' then 'uth_poker' else 'caribbean_stud' end;
  if pay > 0 then perform apply_tx(h.user_id, v_game, 'payout', pay, 'dppay:' || h.id); end if;
  update dp_hands set status = 'done', result = jsonb_build_object('pay', pay, 'net', pay - staked, 'side_pay', side_pay, 'bonus', bonus,
      'win', coalesce(win, -1), 'dq', dq, 'cat', pc, 'dcat', case when r.game = 'tcp' then (ds / 3375)::int else dp_cat(ds) end, 'folded', h.status = 'fold')
    where id = h.id;
  if pay - staked >= greatest(staked, 1) * 200 then
    perform chat_sys('lobby', '🃏 ' || (select nickname from profiles where id = h.user_id) || ' זכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') || ' בפוקר מול הדילר!');
  end if;
end $$;

-- ---------- moving a round forward ----------
create or replace function dp_deal(p_round uuid) returns void language plpgsql security definer set search_path = public as $$
declare r dp_rounds; h dp_hands; n int; d text[]; b text[];
begin
  select * into r from dp_rounds where id = p_round for update;
  n := case r.game when 'tcp' then 3 when 'uth' then 2 else 5 end;
  for h in select * from dp_hands where round_id = r.id order by seat loop
    d := dp_draw(r.id, n); update dp_hands set cards = d where id = h.id; end loop;
  d := dp_draw(r.id, n); if r.game = 'uth' then b := dp_draw(r.id, 5); end if;
  update dp_rounds set dealer = d, board = b, phase = 'd1', until = rl_live_now() + case when r.t_no = 0 then 100000 else 18 end where id = r.id;
end $$;
create or replace function dp_next(p_round uuid) returns void language plpgsql security definer set search_path = public as $$
declare r dp_rounds; h dp_hands; nxt text;
begin
  select * into r from dp_rounds where id = p_round for update;
  if r.phase not in ('d1', 'd2', 'd3') then return; end if;
  -- whoever didn't decide in time: fold (river / one-decision games) or check (earlier hold'em streets)
  update dp_hands set status = case when r.game = 'uth' and r.phase <> 'd3' then status else 'fold' end, acted = r.phase
   where round_id = r.id and status = 'act' and coalesce(acted, '') <> r.phase;
  nxt := case when r.game = 'uth' and r.phase = 'd1' then 'd2' when r.game = 'uth' and r.phase = 'd2' then 'd3' else 'done' end;
  if nxt = 'done' or not exists (select 1 from dp_hands where round_id = r.id and status = 'act') then
    for h in select * from dp_hands where round_id = r.id loop perform dp_settle(h.id); end loop;
    update dp_rounds set phase = 'done', done_at = least(rl_live_now(), r.until) where id = r.id;
  else    -- a lazy catch-up keeps the real timeline: the next street starts when the last one ended
    update dp_rounds set phase = nxt, until = least(rl_live_now(), r.until) + case when r.t_no = 0 then 100000 else 15 end where id = r.id;
  end if;
end $$;
create or replace function dp_tick(p_game text) returns dp_rounds language plpgsql security definer set search_path = public as $$
declare r dp_rounds; t numeric := rl_live_now();
begin
  select * into r from dp_rounds where game = p_game and t_no = 1 order by round_no desc limit 1 for update;
  if not found then insert into dp_rounds (game, t_no, round_no, deck) values (p_game, 1, 1, dp_deck()) returning * into r; end if;
  if r.phase = 'betting' and r.until is not null and (t >= r.until or not exists (
       select 1 from dp_presence pr where pr.game = p_game and pr.seen > t - 12
         and not exists (select 1 from dp_hands hh where hh.round_id = r.id and hh.user_id = pr.user_id))) then
    perform dp_deal(r.id); select * into r from dp_rounds where id = r.id;
  end if;
  while r.phase in ('d1', 'd2', 'd3') and (t >= r.until or not exists (
       select 1 from dp_hands where round_id = r.id and status = 'act' and coalesce(acted, '') <> r.phase)) loop
    perform dp_next(r.id); select * into r from dp_rounds where id = r.id;
  end loop;
  if r.phase = 'done' and t >= r.done_at + 8 then
    insert into dp_rounds (game, t_no, round_no, deck) values (p_game, 1, r.round_no + 1, dp_deck()) returning * into r;
  end if;
  return r;
end $$;

-- ---------- what a player may see ----------
create or replace function dp_view(p_round uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r dp_rounds; nb int; v_hands jsonb; t numeric := rl_live_now();
begin
  select * into r from dp_rounds where id = p_round;
  nb := case when r.game <> 'uth' or r.phase in ('betting', 'd1') then 0 when r.phase = 'd2' then 3 else 5 end;
  select coalesce(jsonb_agg(jsonb_build_object('id', h.user_id, 'me', h.user_id = u, 'name', p.nickname, 'char', p.character_key, 'seat', h.seat,
      'cards', case when h.user_id = u or r.phase = 'done' then to_jsonb(h.cards) when h.cards is null then null else to_jsonb(array_fill('??'::text, array[array_length(h.cards, 1)])) end,
      'ante', h.ante, 'blind', h.blind, 'side', h.side, 'play', h.play, 'status', h.status, 'acted', h.acted, 'result', h.result,
      'best', case when (h.user_id = u or r.phase = 'done') and h.cards is not null then
                case when r.game = 'tcp' then (dp_eval3(h.cards) / 3375)::int
                     when r.game = 'csp' then dp_cat(dp_eval5(h.cards))
                     else dp_cat(dp_best7(h.cards || coalesce(r.board[1:nb], '{}'))) end end) order by h.seat), '[]')
    into v_hands from dp_hands h join profiles p on p.id = h.user_id where h.round_id = r.id;
  return jsonb_build_object('id', r.id, 'game', r.game, 't', r.t_no, 'round', r.round_no, 'phase', r.phase, 'now', round(t * 1000),
    'until', case when r.until < t + 50000 then round(r.until * 1000) end, 'next_at', round((r.done_at + 8) * 1000),
    'dealer', case when r.dealer is null then '[]'::jsonb when r.phase = 'done' then to_jsonb(r.dealer)
                   when r.game = 'csp' then to_jsonb(array[r.dealer[1]] || array_fill('??'::text, array[4]))
                   else to_jsonb(array_fill('??'::text, array[array_length(r.dealer, 1)])) end,
    'dcat', case when r.phase = 'done' then case when r.game = 'tcp' then (dp_eval3(r.dealer) / 3375)::int when r.game = 'csp' then dp_cat(dp_eval5(r.dealer))
                                                else dp_cat(dp_best7(r.dealer || r.board)) end end,
    'board', case when nb = 0 then '[]'::jsonb else to_jsonb(r.board[1:nb]) end,
    'hands', v_hands, 'balance', (select balance from wallets where user_id = u));
end $$;

create or replace function dp_state(p_game text, p_t int) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r dp_rounds; t numeric := rl_live_now(); pres jsonb;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_game not in ('tcp', 'uth', 'csp') or p_t not in (0, 1) then raise exception 'invalid_table'; end if;
  if p_t = 0 then
    select * into r from dp_rounds where owner = u and game = p_game and t_no = 0 order by created_at desc limit 1;
    if not found or (r.phase = 'done' and r.done_at < t - 600) then
      return jsonb_build_object('game', p_game, 't', 0, 'phase', 'idle', 'balance', (select balance from wallets where user_id = u), 'max_bet', gc_max_bet(u));
    end if;
    return dp_view(r.id) || jsonb_build_object('max_bet', gc_max_bet(u));
  end if;
  insert into dp_presence values (u, p_game, t) on conflict (user_id, game) do update set seen = excluded.seen;
  update profiles set where_now = p_game || '_live', last_seen = now() where id = u and (where_now is distinct from p_game || '_live' or last_seen < now() - interval '10 seconds');
  r := dp_tick(p_game);
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.nickname, 'char', p.character_key) order by p.nickname), '[]') into pres
    from dp_presence pr join profiles p on p.id = pr.user_id where pr.game = p_game and pr.seen > t - 12;
  return dp_view(r.id) || jsonb_build_object('present', pres, 'bet_until', case when r.phase = 'betting' and r.until is not null then round(r.until * 1000) end,
    'max_bet', gc_max_bet(u));
end $$;

-- ---------- placing the bet (ante [+ side]); the wallet must also cover the biggest raise of the hand ----------
create or replace function dp_bet(p_game text, p_t int, p_ante bigint, p_side bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r dp_rounds; v_seat int; stake bigint; maxraise bigint; v_game text; bal bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_game not in ('tcp', 'uth', 'csp') or p_t not in (0, 1) then raise exception 'invalid_table'; end if;
  if exists (select 1 from dp_hands where ref = p_ref and user_id = u) then return dp_state(p_game, p_t); end if;
  if p_ante is null or p_ante < 10 or p_ante > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  p_side := coalesce(p_side, 0); if p_side < 0 or p_side > p_ante or (p_game = 'csp' and p_side > 0) then raise exception 'invalid_side_bet'; end if;
  stake := p_ante * case when p_game = 'uth' then 2 else 1 end + p_side;
  maxraise := p_ante * case p_game when 'tcp' then 1 when 'csp' then 2 else 4 end;
  select balance into bal from wallets where user_id = u;
  if bal < stake + maxraise then raise exception 'insufficient_funds'; end if;
  v_game := case p_game when 'tcp' then 'three_card_poker' when 'uth' then 'uth_poker' else 'caribbean_stud' end;
  if p_t = 0 then
    if exists (select 1 from dp_rounds x where x.owner = u and x.game = p_game and x.t_no = 0 and x.phase <> 'done') then raise exception 'round_in_progress'; end if;
    insert into dp_rounds (game, t_no, owner, deck) values (p_game, 0, u, dp_deck()) returning * into r;
    v_seat := 1;
  else
    r := dp_tick(p_game);
    select * into r from dp_rounds where id = r.id for update;
    if r.phase <> 'betting' then raise exception 'betting_closed'; end if;
    if exists (select 1 from dp_hands where round_id = r.id and user_id = u) then raise exception 'already_bet'; end if;
    select coalesce(max(seat), 0) + 1 into v_seat from dp_hands where round_id = r.id;
    if v_seat > 6 then raise exception 'table_full'; end if;
  end if;
  perform apply_tx(u, v_game, 'stake', -stake, 'dpstake:' || u || ':' || p_ref);
  insert into dp_hands (round_id, user_id, seat, ante, blind, side, ref)
    values (r.id, u, v_seat, p_ante, case when p_game = 'uth' then p_ante else 0 end, p_side, p_ref);
  if p_t = 0 then perform dp_deal(r.id); return dp_view(r.id) || jsonb_build_object('max_bet', gc_max_bet(u)); end if;
  if r.until is null then update dp_rounds set until = rl_live_now() + 15 where id = r.id; end if;
  return dp_state(p_game, p_t);
end $$;

-- ---------- a decision: play / fold (tcp, csp) · check / raise4 / raise3 (preflop) · check / raise2 (flop) · raise1 / fold (river) ----------
create or replace function dp_act(p_round uuid, p_action text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r dp_rounds; h dp_hands; mult int := 0; v_game text;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into r from dp_rounds where id = p_round for update;
  if not found then raise exception 'round_not_found'; end if;
  if r.t_no = 1 then perform dp_tick(r.game); select * into r from dp_rounds where id = p_round for update; end if;
  select * into h from dp_hands where round_id = r.id and user_id = u for update;
  if not found or h.status <> 'act' or coalesce(h.acted, '') = r.phase or r.phase not in ('d1', 'd2', 'd3') then raise exception 'not_your_turn'; end if;
  if p_action = 'fold' and (r.game <> 'uth' or r.phase = 'd3') then
    update dp_hands set status = 'fold', acted = r.phase where id = h.id;
  elsif p_action = 'check' and r.game = 'uth' and r.phase in ('d1', 'd2') then
    update dp_hands set acted = r.phase where id = h.id;
  else
    mult := case
      when r.game = 'tcp' and p_action = 'play' then 1
      when r.game = 'csp' and p_action = 'play' then 2
      when r.game = 'uth' and r.phase = 'd1' and p_action = 'raise4' then 4
      when r.game = 'uth' and r.phase = 'd1' and p_action = 'raise3' then 3
      when r.game = 'uth' and r.phase = 'd2' and p_action = 'raise2' then 2
      when r.game = 'uth' and r.phase = 'd3' and p_action = 'raise1' then 1 else 0 end;
    if mult = 0 then raise exception 'invalid_action'; end if;
    v_game := case r.game when 'tcp' then 'three_card_poker' when 'uth' then 'uth_poker' else 'caribbean_stud' end;
    perform apply_tx(u, v_game, 'stake', -(h.ante * mult), 'dpplay:' || h.id);
    update dp_hands set play = h.ante * mult, status = 'wait', acted = r.phase where id = h.id;
  end if;
  -- private table: move on at once; live table: when everyone has decided (or the clock runs out)
  if r.t_no = 0 then
    while (select phase from dp_rounds where id = r.id) in ('d1', 'd2', 'd3')
          and not exists (select 1 from dp_hands where round_id = r.id and status = 'act' and coalesce(acted, '') <> (select phase from dp_rounds where id = r.id)) loop
      perform dp_next(r.id);
    end loop;
    return dp_view(r.id) || jsonb_build_object('max_bet', gc_max_bet(u));
  end if;
  perform dp_tick(r.game);
  return dp_state(r.game, 1);
end $$;

revoke all on function dp_rank(text), dp_deck(), dp_eval5(text[]), dp_cat(bigint), dp_best7(text[]), dp_eval3(text[]), dp_draw(uuid, int),
  dp_settle(uuid), dp_deal(uuid), dp_next(uuid), dp_tick(text), dp_view(uuid) from public, anon, authenticated;
revoke all on function dp_state(text, int), dp_bet(text, int, bigint, bigint, text), dp_act(uuid, text) from public, anon;
grant execute on function dp_state(text, int), dp_bet(text, int, bigint, bigint, text), dp_act(uuid, text) to authenticated;
