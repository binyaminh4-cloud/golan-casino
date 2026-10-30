-- Challenges, new economy (owner's decision): season champion ₪1B; every challenge pays 1st ₪100M, 2nd ₪50M, 3rd ₪25M;
-- Binyamin's vault fills at ₪3B of Golan Fortune wins and then pays ₪50M to every member; the jackpot tournament buy-in is ₪1M.
-- Test accounts (test… / בדיקה…) never take part in prizes or rankings.
create or replace function gc_is_test(p_user uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select nickname ~* '^(test|בדיקה)' from profiles where id = p_user), false) $$;
alter table tourneys alter column buyin set default 1000000;
create or replace function ch_settle() returns void language plpgsql security definer set search_path = public as $$
declare s seasons; champ record; best record; res jsonb; k text; v bigint; m record; pl int;
begin
  for s in select * from seasons where not settled and ends_at <= now() order by no for update skip locked loop
    -- unplayed duels: the challenger takes half a win
    update ch_duels set status = 'expired', finished_at = now(), winner = challenger where season = s.no and status in ('waiting', 'playing');
    insert into ch_points (season, user_id, kind, points)
      select season, challenger, 'ido', 15 from ch_duels where season = s.no and status = 'expired' and score_a is not null
      on conflict (season, user_id, kind) do update set points = ch_points.points + 15;
    res := jsonb_build_object('season', s.no);
    select user_id, sum(points) pts into champ from ch_points where season = s.no and not gc_is_test(user_id) group by user_id having sum(points) > 0 order by 2 desc, max(updated_at) limit 1;
    if found then
      perform apply_tx(champ.user_id, 'season', 'grant', 1000000000, 'season:' || s.no || ':champion');
      res := res || jsonb_build_object('champion', champ.user_id, 'champion_points', champ.pts);
    end if;
    foreach k in array array['fisher', 'ido', 'zeus', 'tourney'] loop      -- 1st 100M · 2nd 50M · 3rd 25M in every challenge
      pl := 0;
      for best in select user_id, points from ch_points where season = s.no and kind = k and points > 0 and not gc_is_test(user_id) order by points desc, updated_at limit 3 loop
        pl := pl + 1;
        perform apply_tx(best.user_id, 'season', 'grant', (array[100000000, 50000000, 25000000])[pl], 'season:' || s.no || ':' || k || ':' || pl);
        res := res || jsonb_build_object(k || '_' || pl, best.user_id);
      end loop;
    end loop;
    v := ch_vault(s.no);
    res := res || jsonb_build_object('vault', v, 'vault_hit', v >= 3000000000);
    if v >= 3000000000 then
      for m in select id from profiles where not gc_is_test(id) loop
        perform apply_tx(m.id, 'season', 'grant', 50000000, 'season:' || s.no || ':vault:' || m.id);
      end loop;
    end if;
    update seasons set settled = true, results = res where no = s.no;
    perform chat_sys('lobby', '🏆 עונה ' || s.no || ' הסתיימה! ' || coalesce('האלוף: ' || (select nickname from profiles where id = champ.user_id) || ' (₪1,000,000,000)', 'אין אלוף הפעם') ||
      case when v >= 3000000000 then ' · 💼 הכספת התמלאה: ₪50,000,000 לכל אחד!' else '' end);
  end loop;
end $$;

-- the vault meter on the page fills toward ₪3B
create or replace function ch_state() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s seasons; out jsonb;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if not gc_on('challenges') then return jsonb_build_object('paused', true); end if;
  s := ch_season();
  out := jsonb_build_object('season', s.no, 'ends_at', s.ends_at, 'me', u,
    'vault', ch_vault(s.no), 'vault_target', 3000000000,
    'board', (select coalesce(jsonb_agg(x order by (x->>'total')::int desc), '[]') from (
        select jsonb_build_object('id', p.id, 'name', p.nickname,
          'fisher', coalesce(sum(cp.points) filter (where cp.kind = 'fisher'), 0),
          'ido', coalesce(sum(cp.points) filter (where cp.kind = 'ido'), 0),
          'zeus', coalesce(sum(cp.points) filter (where cp.kind = 'zeus'), 0),
          'tourney', coalesce(sum(cp.points) filter (where cp.kind = 'tourney'), 0),
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
    'tourney', (select jsonb_build_object('id', id, 'status', status, 'players', (select jsonb_agg(p.nickname) from profiles p where p.id = any(t.players)),
                 'prize', prize, 'table', table_id) from tourneys t where u = any(players) and status in ('registering', 'running') order by created_at desc limit 1),
    'tourney_open', (select count(*) from tourneys where status = 'registering'),
    'last_results', (select results from seasons where settled order by no desc limit 1),
    'members', (select jsonb_agg(jsonb_build_object('id', id, 'name', nickname) order by nickname) from profiles where id <> u));
  return out;
end $$;
