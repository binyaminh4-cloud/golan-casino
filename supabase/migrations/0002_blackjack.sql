-- Golan Casino blackjack engine. Server-authoritative: the shoe and the dealer's hole card
-- never leave the database until the hand is over. All money moves through apply_tx().
-- Rules: 6 decks, reshuffle at 75%, dealer stands on soft 17, peeks on A/10,
-- BJ pays 3:2, double on any first two cards, double after split, split up to 4 hands,
-- split aces receive one card, late surrender, insurance 2:1.
-- Side bets (house edge measured by 5M-hand simulation, see sim/results.txt):
--   Perfect Pairs 25/12/6 · 21+3 100/40/30/10/5 · Lucky Ladies 1000/200/25/10/4 ·
--   Buster Blackjack (dealer bust by card count) 3:1x 4:2x 5:9x 6:50x 7:100x 8+:250x

create table bj_shoes (
  user_id uuid primary key references profiles(id) on delete cascade,
  cards text[] not null,
  pos int not null default 0
);
alter table bj_shoes enable row level security;  -- no policies: invisible to clients
revoke all on bj_shoes from anon, authenticated;

create table bj_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  ref text not null unique,
  status text not null check (status in ('insurance','playing','done')),
  main_bet bigint not null check (main_bet > 0),
  side jsonb not null default '{}',          -- {"pp":n,"t3":n,"ll":n,"bust":n}
  hands jsonb not null,                      -- [{cards:[], bet:n, done:bool, surrendered:bool, aces:bool}]
  active int not null default 0,
  dealer text[] not null,
  insurance bigint not null default 0,
  result jsonb,
  total_staked bigint not null default 0,
  payout bigint,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index bj_one_open_round on bj_rounds(user_id) where status <> 'done';
alter table bj_rounds enable row level security;
revoke all on bj_rounds from anon, authenticated;   -- clients read rounds only through bj_view()

-- ---------- card helpers ----------
create or replace function bj_val(c text) returns int language sql immutable as $$
  select case left(c,1) when 'A' then 11 when 'T' then 10 when 'J' then 10 when 'Q' then 10 when 'K' then 10
         else left(c,1)::int end $$;

create or replace function bj_total(cards text[]) returns int language plpgsql immutable as $$
declare t int := 0; aces int := 0; c text;
begin
  foreach c in array coalesce(cards, '{}') loop t := t + bj_val(c); if left(c,1) = 'A' then aces := aces + 1; end if; end loop;
  while t > 21 and aces > 0 loop t := t - 10; aces := aces - 1; end loop;
  return t;
end $$;

create or replace function bj_is_bj(cards text[]) returns boolean language sql immutable as
  $$ select coalesce(array_length(cards,1),0) = 2 and bj_total(cards) = 21 $$;

create or replace function bj_jcards(j jsonb) returns text[] language sql immutable as
  $$ select coalesce(array_agg(x order by o), '{}') from jsonb_array_elements_text(j) with ordinality t(x,o) $$;

-- Draw one card from the player's shoe, reshuffling 6 decks when 75% is used.
create or replace function bj_draw(p_user uuid) returns text language plpgsql security definer set search_path = public as $$
declare s bj_shoes; c text;
begin
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

-- ---------- side bet evaluation ----------
create or replace function bj_pp(a text, b text) returns int language sql immutable as $$
  select case when left(a,1) <> left(b,1) then 0
              when right(a,1) = right(b,1) then 25
              when (right(a,1) in ('H','D')) = (right(b,1) in ('H','D')) then 12
              else 6 end $$;

create or replace function bj_t3(a text, b text, c text) returns int language plpgsql immutable as $$
declare o int[]; fl boolean; tr boolean; st boolean;
begin
  o := array(select position(left(x,1) in 'A23456789TJQK') from unnest(array[a,b,c]) x order by 1);
  fl := right(a,1) = right(b,1) and right(b,1) = right(c,1);
  tr := left(a,1) = left(b,1) and left(b,1) = left(c,1);
  st := (o[1] <> o[2] and o[2] <> o[3] and o[3] - o[1] = 2) or o = array[1,12,13];
  return case when tr and fl then 100 when st and fl then 40 when tr then 30 when st then 10 when fl then 5 else 0 end;
end $$;

create or replace function bj_ll(a text, b text, dealer_bj boolean) returns int language sql immutable as $$
  select case when bj_val(a) + bj_val(b) <> 20 or (left(a,1)='A' and left(b,1)='A') then 0
              when a = 'QH' and b = 'QH' then case when dealer_bj then 1000 else 200 end
              when a = b then 25
              when right(a,1) = right(b,1) then 10
              else 4 end $$;

create or replace function bj_bust_mult(n int) returns int language sql immutable as $$
  select case when n <= 2 then 0 when n = 3 then 1 when n = 4 then 2 when n = 5 then 9
              when n = 6 then 50 when n = 7 then 100 else 250 end $$;

-- ---------- client view (hides hole card and shoe while the hand is live) ----------
create or replace function bj_view(p_round uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare r bj_rounds; v_hands jsonb; i int; h jsonb; acts text[];
begin
  select * into r from bj_rounds where id = p_round and user_id = auth.uid();
  if not found then return null; end if;
  if r.status = 'done' then
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
    'id', r.id, 'status', r.status, 'main_bet', r.main_bet, 'side', r.side, 'insurance', r.insurance,
    'hands', v_hands, 'active', r.active, 'actions', to_jsonb(acts),
    'dealer', case when r.status = 'done' then to_jsonb(r.dealer) else jsonb_build_array(r.dealer[1], '??') end,
    'dealer_total', case when r.status = 'done' then bj_total(r.dealer) else bj_val(r.dealer[1]) end,
    'result', r.result, 'payout', r.payout, 'staked', r.total_staked,
    'balance', (select balance from wallets where user_id = r.user_id));
end $$;

-- ---------- settlement (runs exactly once per round) ----------
create or replace function bj_finish(p_round uuid) returns void language plpgsql security definer set search_path = public as $$
declare r bj_rounds; d text[]; dt int; dbj boolean; pay bigint := 0; h jsonb; pc text[]; pt int; res jsonb := '[]'; m int; v_side jsonb := '{}';
        any_live boolean := false; single boolean;
begin
  select * into r from bj_rounds where id = p_round for update;
  if r.status = 'done' then return; end if;
  d := r.dealer; dbj := bj_is_bj(d);
  single := jsonb_array_length(r.hands) = 1;
  -- Dealer always completes the hand unless it already has blackjack (Buster bet needs the full hand).
  if not dbj then
    while bj_total(d) < 17 loop d := d || bj_draw(r.user_id); end loop;
  end if;
  dt := bj_total(d);

  for h in select * from jsonb_array_elements(r.hands) loop
    pc := bj_jcards(h->'cards'); pt := bj_total(pc);
    if (h->>'surrendered')::boolean then
      pay := pay + (h->>'bet')::bigint / 2; res := res || jsonb_build_object('outcome','surrender');
    elsif single and bj_is_bj(pc) and not dbj and not (h->>'split')::boolean then
      pay := pay + (h->>'bet')::bigint * 5 / 2; res := res || jsonb_build_object('outcome','blackjack');
    elsif dbj then
      if single and bj_is_bj(pc) then pay := pay + (h->>'bet')::bigint; res := res || jsonb_build_object('outcome','push');
      else res := res || jsonb_build_object('outcome','lose'); end if;
    elsif pt > 21 then res := res || jsonb_build_object('outcome','bust');
    elsif dt > 21 or pt > dt then pay := pay + (h->>'bet')::bigint * 2; res := res || jsonb_build_object('outcome','win');
    elsif pt = dt then pay := pay + (h->>'bet')::bigint; res := res || jsonb_build_object('outcome','push');
    else res := res || jsonb_build_object('outcome','lose'); end if;
  end loop;

  -- Insurance pays 2:1 (returns 3x stake) when dealer has blackjack.
  if r.insurance > 0 and dbj then pay := pay + r.insurance * 3; v_side := v_side || '{"insurance":"win"}'; end if;

  -- Side bets resolved on the initial cards.
  pc := bj_jcards(r.hands->0->'cards0');
  if coalesce((r.side->>'pp')::bigint,0) > 0 then m := bj_pp(pc[1], pc[2]);
     pay := pay + case when m > 0 then (r.side->>'pp')::bigint * (m+1) else 0 end; v_side := v_side || jsonb_build_object('pp', m); end if;
  if coalesce((r.side->>'t3')::bigint,0) > 0 then m := bj_t3(pc[1], pc[2], d[1]);
     pay := pay + case when m > 0 then (r.side->>'t3')::bigint * (m+1) else 0 end; v_side := v_side || jsonb_build_object('t3', m); end if;
  if coalesce((r.side->>'ll')::bigint,0) > 0 then m := bj_ll(pc[1], pc[2], dbj);
     pay := pay + case when m > 0 then (r.side->>'ll')::bigint * (m+1) else 0 end; v_side := v_side || jsonb_build_object('ll', m); end if;
  if coalesce((r.side->>'bust')::bigint,0) > 0 then m := case when dt > 21 then bj_bust_mult(array_length(d,1)) else 0 end;
     pay := pay + case when m > 0 then (r.side->>'bust')::bigint * (m+1) else 0 end; v_side := v_side || jsonb_build_object('bust', m); end if;

  update bj_rounds set status = 'done', dealer = d, payout = pay, finished_at = now(),
         result = jsonb_build_object('hands', res, 'side', v_side, 'dealer_blackjack', dbj, 'net', pay - r.total_staked)
   where id = p_round;
  if pay > 0 then perform apply_tx(r.user_id, 'blackjack', 'payout', pay, 'bjpay:' || p_round); end if;
end $$;

-- Advance to the next unfinished hand, or finish the round.
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
  perform bj_finish(p_round);
end $$;

-- ---------- public API ----------
create or replace function bj_deal(p_main bigint, p_pp bigint, p_t3 bigint, p_ll bigint, p_bust bigint, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); v_id uuid; p text[]; d text[]; total bigint; up int; v_side jsonb := '{}';
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select id into v_id from bj_rounds where ref = p_ref and user_id = u;
  if found then return bj_view(v_id); end if;                -- duplicate request
  if exists (select 1 from bj_rounds where user_id = u and status <> 'done') then raise exception 'round_in_progress'; end if;
  if p_main is null or p_main < 10 or p_main > 50000 then raise exception 'invalid_main_bet'; end if;
  if least(coalesce(p_pp,0), coalesce(p_t3,0), coalesce(p_ll,0), coalesce(p_bust,0)) < 0
     or greatest(coalesce(p_pp,0), coalesce(p_t3,0), coalesce(p_ll,0), coalesce(p_bust,0)) > p_main then raise exception 'invalid_side_bet'; end if;
  total := p_main + coalesce(p_pp,0) + coalesce(p_t3,0) + coalesce(p_ll,0) + coalesce(p_bust,0);
  perform apply_tx(u, 'blackjack', 'stake', -total, 'bjstake:' || p_ref);   -- raises insufficient_funds

  if coalesce(p_pp,0) > 0 then v_side := v_side || jsonb_build_object('pp', p_pp); end if;
  if coalesce(p_t3,0) > 0 then v_side := v_side || jsonb_build_object('t3', p_t3); end if;
  if coalesce(p_ll,0) > 0 then v_side := v_side || jsonb_build_object('ll', p_ll); end if;
  if coalesce(p_bust,0) > 0 then v_side := v_side || jsonb_build_object('bust', p_bust); end if;

  p := array[bj_draw(u)]; d := array[bj_draw(u)]; p := p || bj_draw(u); d := d || bj_draw(u);
  insert into bj_rounds (user_id, ref, status, main_bet, side, hands, dealer, total_staked)
    values (u, p_ref, 'playing', p_main, v_side,
            jsonb_build_array(jsonb_build_object('cards', to_jsonb(p), 'cards0', to_jsonb(p), 'bet', p_main,
              'done', bj_is_bj(p), 'surrendered', false, 'aces', false, 'split', false)),
            d, total)
    returning id into v_id;

  up := bj_val(d[1]);
  if up = 11 and not bj_is_bj(p) then
    update bj_rounds set status = 'insurance' where id = v_id;
  elsif bj_is_bj(p) or ((up = 10 or up = 11) and bj_is_bj(d)) then
    perform bj_finish(v_id);                                  -- blackjack or dealer peek
  end if;
  return bj_view(v_id);
end $$;

create or replace function bj_action(p_round uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r bj_rounds; h jsonb; i int; c text[]; extra bigint;
begin
  select * into r from bj_rounds where id = p_round and user_id = u for update;
  if not found then raise exception 'round_not_found'; end if;
  if r.status = 'done' then return bj_view(p_round); end if;
  if not (bj_view(p_round)->'actions') ? p_action then raise exception 'illegal_action'; end if;
  i := r.active; h := r.hands -> i;

  if p_action in ('insurance','no_insurance') then
    if p_action = 'insurance' then
      extra := r.main_bet / 2;
      perform apply_tx(u, 'blackjack', 'stake', -extra, 'bjins:' || p_round);
      update bj_rounds set insurance = extra, total_staked = total_staked + extra where id = p_round;
    end if;
    if bj_is_bj(r.dealer) then perform bj_finish(p_round);
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
    perform apply_tx(u, 'blackjack', 'stake', -extra, 'bjdbl:' || p_round || ':' || i);
    update bj_rounds set total_staked = total_staked + extra where id = p_round;
    h := jsonb_set(h, '{cards}', (h->'cards') || to_jsonb(bj_draw(u)));
    h := h || jsonb_build_object('bet', extra * 2, 'done', true, 'doubled', true);
  elsif p_action = 'surrender' then
    h := h || '{"done":true,"surrendered":true}';
  elsif p_action = 'split' then
    extra := (h->>'bet')::bigint;
    perform apply_tx(u, 'blackjack', 'stake', -extra, 'bjsplit:' || p_round || ':' || jsonb_array_length(r.hands));
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

-- Current open round (to resume after refresh) and recent history.
create or replace function bj_current() returns jsonb language sql security definer set search_path = public as $$
  select bj_view(id) from bj_rounds where user_id = auth.uid() and status <> 'done' limit 1 $$;

revoke all on function bj_draw, bj_finish, bj_advance from public, anon, authenticated;
revoke all on function bj_deal, bj_action, bj_view, bj_current from public, anon;
grant execute on function bj_deal, bj_action, bj_view, bj_current to authenticated;
