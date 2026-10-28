-- Ido's fishing wheel: ~10x more boosts. Every round 8 friend-fish segments get ×2 (sometimes ×3/×5), and in 40% of rounds one
-- bonus-fish segment gets ×2..×5 on its catch. Replaces the single boost and the rare whole-colour boost.
-- Friend-fish bets now return ~104% and bonus bets ~96–98% (the owner is fine with the room being slightly generous).
alter table if_rounds add column if not exists boost_list jsonb not null default '[]';

create or replace function if_make(p_round bigint, p_start numeric) returns if_rounds language plpgsql volatile as $$
declare L text[] := if_layout(); s int; c text; fm int := null; tm int := null; ords int[]; bons int[]; lst jsonb := '[]'; picked int[] := '{}'; k int; g int; m int; r if_rounds;
begin
  s := rl_randint(53); c := L[s + 1];
  select array_agg(i - 1) into ords from generate_subscripts(L, 1) i where L[i] in ('dark', 'light');
  select array_agg(i - 1) into bons from generate_subscripts(L, 1) i where L[i] in ('blue', 'orange', 'red');
  while coalesce(array_length(picked, 1), 0) < 8 loop
    g := ords[rl_randint(46) + 1];
    if not g = any(picked) then picked := picked || g; lst := lst || jsonb_build_object('seg', g, 'mult', if_pick(array[2,3,5], array[92,6,2])); end if;
  end loop;
  if rl_randint(100) < 40 then
    g := bons[rl_randint(7) + 1]; lst := lst || jsonb_build_object('seg', g, 'mult', if_pick(array[2,3,5], array[80,15,5]));
  end if;
  select coalesce(max((x->>'mult')::int), 1) into m from jsonb_array_elements(lst) x where (x->>'seg')::int = s;
  if c in ('blue', 'orange', 'red') then
    fm := case c when 'blue' then if_pick(array[12,16,25,50,100], array[9850,100,40,8,2])
                 when 'orange' then if_pick(array[16,20,40,100,200], array[700,100,145,50,5])
                 else if_pick(array[40,60,100,200,500], array[800,110,65,24,1]) end;
    tm := fm * m;
  end if;
  insert into if_rounds (round_no, start_at, dur, seg, cat, boost_seg, boost_mult, bonus_boost_cat, bonus_boost_mult, fish_mult, total_mult, boost_list)
    values (p_round, p_start, 22 + if_bonus_secs(tm), s, c, (lst->0->>'seg')::int, (lst->0->>'mult')::int, null, 1, fm, tm, lst)
    on conflict (round_no) do nothing;
  select * into r from if_rounds where round_no = p_round;
  return r;
end $$;

create or replace function if_segmult(r if_rounds) returns int language sql immutable as $$
  select coalesce(max((x->>'mult')::int), 1) from jsonb_array_elements(r.boost_list) x where (x->>'seg')::int = r.seg $$;

create or replace function if_gross(p_bets jsonb, r if_rounds) returns bigint language sql immutable as $$
  select case
    when r.cat in ('dark', 'light') then coalesce((p_bets->>r.cat)::bigint, 0) * 2 *
      (case when jsonb_array_length(r.boost_list) > 0 then if_segmult(r) when r.seg = r.boost_seg then r.boost_mult else 1 end)
    else coalesce((p_bets->>r.cat)::bigint, 0) * coalesce(r.total_mult, 0) end $$;

create or replace function if_state() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); t numeric; r if_rounds; e numeric; v_mine jsonb; v_pay bigint; v_players jsonb; v_hist jsonb;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  r := if_current(); perform if_settle();
  t := rl_live_now(); e := t - r.start_at;
  select coalesce(jsonb_object_agg(k, s), '{}') into v_mine from (select k, sum(v::bigint) s from if_bets ib, jsonb_each_text(ib.bets) x(k, v)
     where ib.round_no = r.round_no and ib.user_id = u group by k) q;
  select sum(payout) into v_pay from if_bets where round_no = r.round_no and user_id = u and settled;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.nickname, 'total', s.tot, 'payout', case when e >= 20 then s.pay end) order by s.tot desc), '[]')
    into v_players from (select user_id, sum(total) tot, sum(payout) pay from if_bets where round_no = r.round_no group by user_id) s join profiles p on p.id = s.user_id;
  select coalesce(jsonb_agg(jsonb_build_object('cat', cat, 'x', case when cat in ('dark','light') then 2 * (case when jsonb_array_length(boost_list) > 0 then (select coalesce(max((x->>'mult')::int), 1) from jsonb_array_elements(h.boost_list) x where (x->>'seg')::int = h.seg) when seg = boost_seg then boost_mult else 1 end) else total_mult end) order by round_no desc), '[]')
    into v_hist from (select * from if_rounds where round_no < r.round_no order by round_no desc limit 12) h;
  return jsonb_build_object('now', round(t * 1000), 'round', r.round_no, 'start', round(r.start_at * 1000), 'dur', r.dur,
    'open', e < 10,
    'boosts', case when e >= 10 then jsonb_build_object('seg', r.boost_seg, 'mult', r.boost_mult, 'cat', r.bonus_boost_cat, 'cat_mult', r.bonus_boost_mult, 'list', r.boost_list) end,
    'stop', case when e >= 13 then r.seg end, 'cat', case when e >= 20 then r.cat end,
    'total_mult', case when e >= 20 then r.total_mult end,
    'mine', v_mine, 'payout', v_pay, 'players', v_players, 'history', v_hist,
    'max_bet', gc_max_bet(u), 'balance', (select balance from wallets where user_id = u));
end $$;
