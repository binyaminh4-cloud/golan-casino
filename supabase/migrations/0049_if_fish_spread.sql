-- Ido's fishing: bonus fish values spread out (the minimum used to come up ~80-98% of the time); same average return.
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
    fm := case c when 'blue' then if_pick(array[5,8,10,12,15,20,30,50,100], array[24,22,18,14,10,7,4,2,1])
                 when 'orange' then if_pick(array[10,15,20,25,30,40,60,100,200], array[27,20,17,13,10,7,5,3,1])
                 else if_pick(array[20,30,40,50,60,80,100,200,500], array[27,20,17,13,10,8,6,3,1]) end;
    tm := fm * m;
  end if;
  insert into if_rounds (round_no, start_at, dur, seg, cat, boost_seg, boost_mult, bonus_boost_cat, bonus_boost_mult, fish_mult, total_mult, boost_list)
    values (p_round, p_start, 22 + if_bonus_secs(tm), s, c, (lst->0->>'seg')::int, (lst->0->>'mult')::int, null, 1, fm, tm, lst)
    on conflict (round_no) do nothing;
  select * into r from if_rounds where round_no = p_round;
  return r;
end $$;
