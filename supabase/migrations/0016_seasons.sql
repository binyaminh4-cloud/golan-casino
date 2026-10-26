-- Golan Casino · Seasons and challenges (season 1, 2, ...). Two weeks per season.
-- Points accumulate separately per challenge; prizes are paid only when the season ends (lazily, by the first call after the end):
--   overall champion (sum of all challenge points) 500,000 · best of each personal challenge (fisher, ido, zeus) 100,000
--   Binyamin's vault: everyone's winnings on Golan Fortune in the season; at 3,000,000 every member gets 50,000.
-- Challenge hands run on the real blackjack engine with challenge chips (ch_runs), never the wallet.
--   fisher = "Fisher's set": solo, 15 hands of Fisher's lightning blackjack from 10,000 chips; points = profit / 100 (best 3 runs a day count).
--   ido    = "Ido's deck": head-to-head by invitation, 20 hands of classic blackjack, both players get the same deck; win 30, tie 10.

create table if not exists seasons (
  no int primary key,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  settled boolean not null default false,
  results jsonb
);
create table if not exists ch_runs (
  id uuid primary key default gen_random_uuid(),
  season int not null references seasons(no),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('fisher', 'ido')),
  duel uuid,
  deck text[] not null,
  pos int not null default 0,
  chips bigint not null default 10000,
  hands int not null default 0,
  max_hands int not null,
  status text not null default 'playing' check (status in ('playing', 'done')),
  points int not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists ch_runs_user on ch_runs (user_id, season);
create table if not exists ch_duels (
  id uuid primary key default gen_random_uuid(),
  season int not null references seasons(no),
  challenger uuid not null references profiles(id) on delete cascade,
  opponent uuid not null references profiles(id) on delete cascade,
  deck text[] not null,
  run_a uuid, run_b uuid,
  score_a bigint, score_b bigint,
  status text not null default 'challenger' check (status in ('challenger', 'waiting', 'playing', 'done', 'expired')),
  winner uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create table if not exists ch_points (
  season int not null references seasons(no),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('fisher', 'ido', 'zeus')),
  points int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (season, user_id, kind)
);
alter table seasons enable row level security; alter table ch_runs enable row level security;
alter table ch_duels enable row level security; alter table ch_points enable row level security;
revoke all on seasons, ch_runs, ch_duels, ch_points from anon, authenticated;
alter table bj_rounds add column if not exists ch_run uuid references ch_runs(id);

create or replace function ch_new_deck() returns text[] language sql volatile as $$
  select array_agg(r || su order by gen_random_uuid())
  from unnest(string_to_array('A,2,3,4,5,6,7,8,9,T,J,Q,K', ',')) r, unnest(string_to_array('S,H,D,C', ',')) su, generate_series(1, 6) d $$;

create or replace function ch_add_points(p_season int, p_user uuid, p_kind text, p_pts int) returns void language sql as $$
  insert into ch_points (season, user_id, kind, points) values (p_season, p_user, p_kind, p_pts)
  on conflict (season, user_id, kind) do update set points = ch_points.points + excluded.points, updated_at = now() $$;

-- money for a blackjack step: challenge chips when a challenge hand is running, the wallet otherwise
create or replace function bj_tx(p_user uuid, p_game text, p_kind text, p_amount bigint, p_ref text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_run uuid := nullif(current_setting('gc.ch_run', true), '')::uuid; v bigint;
begin
  if v_run is null then return apply_tx(p_user, p_game, p_kind, p_amount, p_ref); end if;
  update ch_runs set chips = chips + p_amount where id = v_run and user_id = p_user returning chips into v;
  if v is null then raise exception 'challenge_closed'; end if;
  if v < 0 then raise exception 'insufficient_funds'; end if;
  return (select balance from wallets where user_id = p_user);
end $$;

-- season clock: settle every ended season, open the current one
create or replace function ch_season() returns seasons language plpgsql security definer set search_path = public as $$
declare s seasons; d date;
begin
  perform ch_settle();
  select * into s from seasons where now() >= starts_at and now() < ends_at;
  if found then return s; end if;
  select * into s from seasons order by no desc limit 1;
  d := (now() at time zone 'Asia/Jerusalem')::date;
  insert into seasons (no, starts_at, ends_at)
    values (coalesce(s.no, 0) + 1, coalesce(s.ends_at, now()),
            greatest(coalesce(s.ends_at, now()), ((d + 14)::timestamp at time zone 'Asia/Jerusalem')))
    on conflict (no) do nothing;
  select * into s from seasons where now() >= starts_at and now() < ends_at order by no desc limit 1;
  return s;
end $$;

create or replace function ch_vault(p_season int) returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(sp.payout), 0)::bigint from sl_spins sp, seasons s
  where s.no = p_season and sp.machine = 'fortune' and sp.created_at >= s.starts_at and sp.created_at < s.ends_at $$;

create or replace function ch_settle() returns void language plpgsql security definer set search_path = public as $$
declare s seasons; champ record; best record; res jsonb; k text; v bigint; m record;
begin
  for s in select * from seasons where not settled and ends_at <= now() order by no for update skip locked loop
    -- unplayed duels: the challenger takes half a win
    update ch_duels set status = 'expired', finished_at = now(), winner = challenger where season = s.no and status in ('waiting', 'playing');
    insert into ch_points (season, user_id, kind, points)
      select season, challenger, 'ido', 15 from ch_duels where season = s.no and status = 'expired' and score_a is not null
      on conflict (season, user_id, kind) do update set points = ch_points.points + 15;
    res := jsonb_build_object('season', s.no);
    select user_id, sum(points) pts into champ from ch_points where season = s.no group by user_id having sum(points) > 0 order by 2 desc, max(updated_at) limit 1;
    if found then
      perform apply_tx(champ.user_id, 'season', 'grant', 500000, 'season:' || s.no || ':champion');
      res := res || jsonb_build_object('champion', champ.user_id, 'champion_points', champ.pts);
    end if;
    foreach k in array array['fisher', 'ido', 'zeus'] loop
      select user_id, points into best from ch_points where season = s.no and kind = k and points > 0 order by points desc, updated_at limit 1;
      if found then
        perform apply_tx(best.user_id, 'season', 'grant', 100000, 'season:' || s.no || ':' || k);
        res := res || jsonb_build_object('best_' || k, best.user_id);
      end if;
    end loop;
    v := ch_vault(s.no);
    res := res || jsonb_build_object('vault', v, 'vault_hit', v >= 3000000);
    if v >= 3000000 then
      for m in select id from profiles loop
        perform apply_tx(m.id, 'season', 'grant', 50000, 'season:' || s.no || ':vault:' || m.id);
      end loop;
    end if;
    update seasons set settled = true, results = res where no = s.no;
    perform chat_sys('lobby', '🏆 עונה ' || s.no || ' הסתיימה! ' || coalesce('האלוף: ' || (select nickname from profiles where id = champ.user_id) || ' (₪500,000)', 'אין אלוף הפעם') ||
      case when v >= 3000000 then ' · 💼 הכספת התמלאה: ₪50,000 לכל אחד!' else '' end);
  end loop;
end $$;

-- a challenge hand finished: count it, close the run at the hand limit or when chips run out
create or replace function ch_hand_done(p_run uuid) returns void language plpgsql security definer set search_path = public as $$
declare c ch_runs;
begin
  update ch_runs set hands = hands + 1 where id = p_run returning * into c;
  if c.hands >= c.max_hands or c.chips < 10 then perform ch_finish_run(p_run); end if;
end $$;

create or replace function ch_finish_run(p_run uuid) returns void language plpgsql security definer set search_path = public as $$
declare c ch_runs; d ch_duels; pts int := 0; nm text; nb text; today int;
begin
  update ch_runs set status = 'done', finished_at = now() where id = p_run and status = 'playing' returning * into c;
  if not found then return; end if;
  nm := (select nickname from profiles where id = c.user_id);
  if c.kind = 'fisher' then
    select count(*) into today from ch_runs where user_id = c.user_id and kind = 'fisher' and status = 'done' and points > 0
      and (finished_at at time zone 'Asia/Jerusalem')::date = (now() at time zone 'Asia/Jerusalem')::date and id <> c.id;
    pts := case when today < 3 then greatest(0, (c.chips - 10000) / 100)::int else 0 end;
    update ch_runs set points = pts where id = c.id;
    if pts > 0 then perform ch_add_points(c.season, c.user_id, 'fisher', pts); end if;
    if c.chips >= 30000 then perform chat_sys('lobby', '🎧 ' || nm || ' סיים את הסט של פישר עם ' || to_char(c.chips, 'FM999,999') || ' צ׳יפים!'); end if;
    if c.chips <= 10000 and not exists (select 1 from bj_rounds where ch_run = c.id and (result->'side'->>'strike_extra')::bigint > 0) then
      perform chat_sys('lobby', '🎧 פישר מקדיש שיר עצוב ל' || nm || ': סט שלם בלי אף ברק 🎻');
    end if;
  elsif c.kind = 'ido' then
    select * into d from ch_duels where id = c.duel for update;
    if c.id = d.run_a then
      update ch_duels set score_a = c.chips, status = 'waiting' where id = d.id;
      perform chat_sys('lobby', '🃏 ' || nm || ' סיים את החפיסה של עידו עם ' || to_char(c.chips, 'FM999,999') || '. ' ||
        (select nickname from profiles where id = d.opponent) || ', תורך!');
    else
      d.score_b := c.chips; d.score_a := coalesce(d.score_a, 0);
      update ch_duels set score_b = c.chips, status = 'done', finished_at = now(),
        winner = case when d.score_a > d.score_b then d.challenger when d.score_b > d.score_a then d.opponent end where id = d.id;
      nb := (select nickname from profiles where id = d.challenger);
      if d.score_a = d.score_b then
        perform ch_add_points(d.season, d.challenger, 'ido', 10); perform ch_add_points(d.season, d.opponent, 'ido', 10);
        perform chat_sys('lobby', '🃏 תיקו בחפיסה של עידו: ' || nb || ' ו' || nm || ' (' || to_char(d.score_a, 'FM999,999') || '). עידו טוען שזה בגללו.');
      else
        perform ch_add_points(d.season, case when d.score_a > d.score_b then d.challenger else d.opponent end, 'ido', 30);
        perform chat_sys('lobby', '🃏 ' || case when d.score_a > d.score_b then nb else nm end || ' ניצח בחפיסה של עידו, ' ||
          to_char(greatest(d.score_a, d.score_b), 'FM999,999') || ' מול ' || to_char(least(d.score_a, d.score_b), 'FM999,999') || '.');
      end if;
    end if;
  end if;
end $$;

-- ---------- client RPCs ----------
create or replace function ch_state() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s seasons; out jsonb;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  s := ch_season();
  out := jsonb_build_object('season', s.no, 'ends_at', s.ends_at, 'me', u,
    'vault', ch_vault(s.no), 'vault_target', 3000000,
    'board', (select coalesce(jsonb_agg(x order by (x->>'total')::int desc), '[]') from (
        select jsonb_build_object('id', p.id, 'name', p.nickname,
          'fisher', coalesce(sum(cp.points) filter (where cp.kind = 'fisher'), 0),
          'ido', coalesce(sum(cp.points) filter (where cp.kind = 'ido'), 0),
          'zeus', coalesce(sum(cp.points) filter (where cp.kind = 'zeus'), 0),
          'total', coalesce(sum(cp.points), 0)) x
        from profiles p left join ch_points cp on cp.user_id = p.id and cp.season = s.no group by p.id, p.nickname) t),
    'my_run', (select jsonb_build_object('id', id, 'kind', kind, 'hands', hands, 'max', max_hands, 'chips', chips) from ch_runs
               where user_id = u and status = 'playing' order by created_at desc limit 1),
    'fisher_best', (select max(chips) from ch_runs where user_id = u and season = s.no and kind = 'fisher' and status = 'done'),
    'duels', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'status', d.status,
                 'challenger', d.challenger, 'challenger_name', pa.nickname, 'opponent', d.opponent, 'opponent_name', pb.nickname,
                 'score_a', case when d.status in ('waiting', 'playing', 'done', 'expired') then d.score_a end,
                 'score_b', case when d.status = 'done' then d.score_b end, 'winner', d.winner, 'created_at', d.created_at)
               order by d.created_at desc), '[]')
              from ch_duels d join profiles pa on pa.id = d.challenger join profiles pb on pb.id = d.opponent
              where d.season = s.no and (d.challenger = u or d.opponent = u)),
    'last_results', (select results from seasons where settled order by no desc limit 1),
    'members', (select jsonb_agg(jsonb_build_object('id', id, 'name', nickname) order by nickname) from profiles where id <> u));
  return out;
end $$;

create or replace function ch_start_fisher() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s seasons; r ch_runs;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  s := ch_season();
  select * into r from ch_runs where user_id = u and status = 'playing' limit 1;
  if found then return jsonb_build_object('run', r.id, 'kind', r.kind); end if;
  insert into ch_runs (season, user_id, kind, deck, max_hands) values (s.no, u, 'fisher', ch_new_deck(), 15) returning * into r;
  return jsonb_build_object('run', r.id, 'kind', 'fisher');
end $$;

create or replace function ch_challenge_ido(p_opponent uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s seasons; d ch_duels; r ch_runs;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_opponent is null or p_opponent = u or not exists (select 1 from profiles where id = p_opponent) then raise exception 'invalid_opponent'; end if;
  if exists (select 1 from ch_runs where user_id = u and status = 'playing') then raise exception 'challenge_in_progress'; end if;
  if (select count(*) from ch_duels where challenger = u and opponent = p_opponent and created_at > now() - interval '1 day') >= 2 then raise exception 'slow_down'; end if;
  s := ch_season();
  insert into ch_duels (season, challenger, opponent, deck) values (s.no, u, p_opponent, ch_new_deck()) returning * into d;
  insert into ch_runs (season, user_id, kind, duel, deck, max_hands) values (s.no, u, 'ido', d.id, d.deck, 20) returning * into r;
  update ch_duels set run_a = r.id where id = d.id;
  return jsonb_build_object('run', r.id, 'kind', 'ido', 'duel', d.id);
end $$;

create or replace function ch_accept_ido(p_duel uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); d ch_duels; r ch_runs;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into d from ch_duels where id = p_duel and opponent = u for update;
  if not found or d.status not in ('waiting', 'playing') then raise exception 'challenge_closed'; end if;
  if d.run_b is not null then return jsonb_build_object('run', d.run_b, 'kind', 'ido', 'target', d.score_a); end if;
  if exists (select 1 from ch_runs where user_id = u and status = 'playing') then raise exception 'challenge_in_progress'; end if;
  insert into ch_runs (season, user_id, kind, duel, deck, max_hands) values (d.season, u, 'ido', d.id, d.deck, 20) returning * into r;
  update ch_duels set run_b = r.id, status = 'playing' where id = d.id;
  return jsonb_build_object('run', r.id, 'kind', 'ido', 'target', d.score_a);
end $$;

-- the run a blackjack page was opened for (title, chips, hands, the score to beat)
create or replace function ch_run_info(p_run uuid) returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'kind', c.kind, 'chips', c.chips, 'hands', c.hands, 'max', c.max_hands, 'status', c.status, 'points', c.points,
    'target', case when d.run_b = c.id then d.score_a end,
    'opponent', (select nickname from profiles where id = case when d.run_a = c.id then d.opponent else d.challenger end))
  from ch_runs c left join ch_duels d on d.id = c.duel where c.id = p_run and c.user_id = auth.uid() $$;
create or replace function bj_draw(p_user uuid) returns text language plpgsql security definer set search_path = public as $$
declare s bj_shoes; c text; v_run uuid := nullif(current_setting('gc.ch_run', true), '')::uuid; v_pos int;
begin
  if v_run is not null then                                  -- a challenge hand: draw from the run's fixed deck
    update ch_runs set pos = pos + 1 where id = v_run returning pos, deck[pos] into v_pos, c;
    return c;
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

create or replace function bj_action(p_round uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r bj_rounds; h jsonb; i int; c text[]; extra bigint;
begin
  select * into r from bj_rounds where id = p_round and user_id = u for update;
  if not found then raise exception 'round_not_found'; end if;
  if r.ch_run is not null then perform set_config('gc.ch_run', r.ch_run::text, true); end if;
  if r.status = 'done' then return bj_view(p_round); end if;
  if not (bj_view(p_round)->'actions') ? p_action then raise exception 'illegal_action'; end if;
  i := r.active; h := r.hands -> i;

  if p_action in ('insurance','no_insurance') then
    if p_action = 'insurance' then
      extra := r.main_bet / 2;
      perform bj_tx(u, 'blackjack', 'stake', -extra, 'bjins:' || p_round);
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

create or replace function bj_deal(p_main bigint, p_pp bigint, p_t3 bigint, p_ll bigint, p_bust bigint, p_ref text, p_mode text default 'classic', p_run uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); cr ch_runs; v_id uuid; p text[]; d text[]; total bigint; up int; v_side jsonb := '{}'; v_fee bigint := 0; v_boost int := 0; v_cap bigint := 0;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select id into v_id from bj_rounds where ref = p_ref and user_id = u;
  if found then return bj_view(v_id); end if;                -- duplicate request
  if exists (select 1 from bj_rounds where user_id = u and status <> 'done') then raise exception 'round_in_progress'; end if;
  if p_main is null or p_main < 10 or p_main > 50000 then raise exception 'invalid_main_bet'; end if;
  if least(coalesce(p_pp,0), coalesce(p_t3,0), coalesce(p_ll,0), coalesce(p_bust,0)) < 0
     or greatest(coalesce(p_pp,0), coalesce(p_t3,0), coalesce(p_ll,0), coalesce(p_bust,0)) > p_main then raise exception 'invalid_side_bet'; end if;
  if p_mode not in ('classic', 'lightning') then raise exception 'invalid_mode'; end if;
  if p_mode = 'lightning' then
    if coalesce(p_pp,0) + coalesce(p_t3,0) + coalesce(p_ll,0) + coalesce(p_bust,0) > 0 then raise exception 'invalid_side_bet'; end if;
    v_fee := (p_main + 1) / 2;                                            -- Lightning fee = 50% of the main bet
  end if;
  if p_run is not null then                                 -- a challenge hand: chips come from the run, never the wallet
    select * into cr from ch_runs where id = p_run and user_id = u for update;
    if not found or cr.status <> 'playing' or cr.kind not in ('fisher', 'ido') then raise exception 'challenge_closed'; end if;
    if (cr.kind = 'fisher') <> (p_mode = 'lightning') then raise exception 'invalid_mode'; end if;
    if coalesce(p_pp,0) + coalesce(p_t3,0) + coalesce(p_ll,0) + coalesce(p_bust,0) > 0 then raise exception 'invalid_side_bet'; end if;
    perform set_config('gc.ch_run', p_run::text, true);
  end if;
  total := p_main + coalesce(p_pp,0) + coalesce(p_t3,0) + coalesce(p_ll,0) + coalesce(p_bust,0) + v_fee;
  perform bj_tx(u, case p_mode when 'lightning' then 'lightning_blackjack' else 'blackjack' end, 'stake', -total, 'bjstake:' || p_ref);

  if coalesce(p_pp,0) > 0 then v_side := v_side || jsonb_build_object('pp', p_pp); end if;
  if coalesce(p_t3,0) > 0 then v_side := v_side || jsonb_build_object('t3', p_t3); end if;
  if coalesce(p_ll,0) > 0 then v_side := v_side || jsonb_build_object('ll', p_ll); end if;
  if coalesce(p_bust,0) > 0 then v_side := v_side || jsonb_build_object('bust', p_bust); end if;

  p := array[bj_draw(u)]; d := array[bj_draw(u)]; p := p || bj_draw(u); d := d || bj_draw(u);
  insert into bj_rounds (user_id, ref, status, main_bet, side, hands, dealer, total_staked, mode, fee, strikes, ch_run)
    values (u, p_ref, 'playing', p_main, v_side,
            jsonb_build_array(jsonb_build_object('cards', to_jsonb(p), 'cards0', to_jsonb(p), 'bet', p_main,
              'done', bj_is_bj(p), 'surrendered', false, 'aces', false, 'split', false)),
            d, total, p_mode, v_fee, case when p_mode = 'lightning' then bj_strikes() else '{}'::jsonb end, p_run)
    returning id into v_id;

  up := bj_val(d[1]);
  if up = 11 and not bj_is_bj(p) then
    update bj_rounds set status = 'insurance' where id = v_id;
  elsif bj_is_bj(p) or ((up = 10 or up = 11) and bj_is_bj(d)) then
    perform bj_finish(v_id);                                  -- blackjack or dealer peek
  end if;
  return bj_view(v_id);
end $$;

create or replace function bj_finish(p_round uuid) returns void language plpgsql security definer set search_path = public as $$
declare r bj_rounds; d text[]; dt int; dbj boolean; pay bigint := 0; h jsonb; pc text[]; pt int; res jsonb := '[]'; m int; v_side jsonb := '{}';
        any_live boolean := false; single boolean; v_extra bigint := 0; v_earn int; v_tier text; fh jsonb;
begin
  select * into r from bj_rounds where id = p_round for update;
  if r.status = 'done' then return; end if;
  if r.ch_run is not null then perform set_config('gc.ch_run', r.ch_run::text, true); end if;
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

  -- Lightning: a winning hand holding a struck rank has its profit multiplied by the highest struck multiplier in it.
  if r.mode = 'lightning' then
    select coalesce(sum(case x.oo->>'outcome' when 'blackjack' then (x.hh->>'bet')::bigint * 3 / 2 when 'win' then (x.hh->>'bet')::bigint else 0 end
                        * (bj_hand_mult(x.hh->'cards', r.strikes) - 1)), 0),
           coalesce(jsonb_agg(bj_hand_mult(x.hh->'cards', r.strikes) order by x.ia), '[]')
      into v_extra, fh
      from (select a.hh, a.ia, b.oo from jsonb_array_elements(r.hands) with ordinality a(hh, ia) join jsonb_array_elements(res) with ordinality b(oo, ib) on a.ia = b.ib) x;
    pay := pay + v_extra;
    v_side := v_side || jsonb_build_object('strike_extra', v_extra, 'hand_mults', fh);
  end if;

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
  if pay > 0 then perform bj_tx(r.user_id, case r.mode when 'lightning' then 'lightning_blackjack' else 'blackjack' end, 'payout', pay, 'bjpay:' || p_round); end if;
  if r.ch_run is not null then perform ch_hand_done(r.ch_run); end if;
end $$;

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
    'id', r.id, 'mode', r.mode, 'fee', r.fee, 'strikes', r.strikes, 'status', r.status, 'main_bet', r.main_bet, 'side', r.side, 'insurance', r.insurance,
    'hands', v_hands, 'active', r.active, 'actions', to_jsonb(acts),
    'dealer', case when r.status = 'done' then to_jsonb(r.dealer) else jsonb_build_array(r.dealer[1], '??') end,
    'dealer_total', case when r.status = 'done' then bj_total(r.dealer) else bj_val(r.dealer[1]) end,
    'result', r.result, 'payout', r.payout, 'staked', r.total_staked,
    'balance', (select balance from wallets where user_id = r.user_id),
    'ch', case when r.ch_run is null then null else (select jsonb_build_object('id', c.id, 'kind', c.kind, 'chips', c.chips, 'hands', c.hands, 'max', c.max_hands, 'status', c.status) from ch_runs c where c.id = r.ch_run) end);
end $$;
drop function if exists bj_deal(bigint, bigint, bigint, bigint, bigint, text, text);
revoke all on function ch_new_deck, ch_add_points, bj_tx, ch_season, ch_vault, ch_settle, ch_hand_done, ch_finish_run from public, anon, authenticated;
revoke all on function bj_deal(bigint, bigint, bigint, bigint, bigint, text, text, uuid), ch_state(), ch_start_fisher(), ch_challenge_ido(uuid), ch_accept_ido(uuid), ch_run_info(uuid) from public, anon;
grant execute on function bj_deal(bigint, bigint, bigint, bigint, bigint, text, text, uuid), ch_state(), ch_start_fisher(), ch_challenge_ido(uuid), ch_accept_ido(uuid), ch_run_info(uuid) to authenticated;
