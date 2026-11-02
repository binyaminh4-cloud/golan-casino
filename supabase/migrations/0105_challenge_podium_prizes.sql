-- Approved seasonal podium PER challenge: 1B / 500M / 250M play shekels.
-- The overall champion remains 15B. No retroactive credits to settled seasons.
-- Apply after 0104. Installing this file does not settle a season or move money.
begin;
do $guard$ begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.ch_settle()') and md5(replace(prosrc,chr(13),'')) in ('be2c3ae23c1fd7c30479d483ca535cee','bf7e57fcfcb8d3c2017a6821c8f198eb')) then raise exception 'unexpected_installed_ch_settle_install_0104_first';end if;
end $guard$;

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
      perform apply_tx(champ.user_id, 'season', 'grant', 15000000000, 'season:' || s.no || ':champion');
      res := res || jsonb_build_object('champion', champ.user_id, 'champion_points', champ.pts);
    end if;
    foreach k in array array['fisher', 'ido', 'zeus', 'tourney'] loop      -- 1st 1B · 2nd 500M · 3rd 250M in every challenge
      pl := 0;
      for best in select user_id, points from ch_points where season = s.no and kind = k and points > 0 and not gc_is_test(user_id) order by points desc, updated_at limit 3 loop
        pl := pl + 1;
        perform apply_tx(best.user_id, 'season', 'grant', (array[1000000000, 500000000, 250000000])[pl], 'season:' || s.no || ':' || k || ':' || pl);
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
    perform chat_sys('lobby', '🏆 עונה ' || s.no || ' הסתיימה! ' || coalesce('האלוף: ' || (select nickname from profiles where id = champ.user_id) || ' (₪15,000,000,000)', 'אין אלוף הפעם') ||
      case when v >= 3000000000 then ' · 💼 הכספת התמלאה: ₪50,000,000 לכל אחד!' else '' end);
  end loop;
end $$;
commit;
