-- Protein miner: increasing exact bomb counts by mode and layer.
-- At least four food targets per layer; Yoav tags remain safe.
-- Reward amounts, minimum completion returns and existing runs are preserved.
begin;
do $guard$ begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.pm_make(text)') and md5(replace(prosrc,chr(13),'')) in ('1085f69b91496c36930723f421de5139','a4019f3c1127b1422d4b7108c887c6e3')) then raise exception 'unexpected_installed_pm_make';end if;
end $guard$;

create or replace function pm_make(p_mode text) returns jsonb language plpgsql volatile as $$
declare c jsonb := pm_cfg(); m jsonb := pm_cfg()->'modes'->'normal'; rocks jsonb := '[]'; band jsonb; L int; s int; i int; tagged boolean; boost int; bomb boolean; reward numeric; raw numeric;
  bomb_counts int[] := case p_mode when 'easy' then array[3,4,5,6] when 'normal' then array[4,5,6,7] when 'extreme' then array[5,6,7,8] end; n int; j int; r jsonb; w numeric;
begin
  if bomb_counts is null then raise exception 'invalid_mode'; end if;
  for L in 0..3 loop
    band := '[]';
    for s in 0..3 loop
      for i in 1 .. (c->'layers'->L->>s)::int loop
        tagged := i <= (c->'tags'->L->>s)::int;
        boost := case when tagged then (c->'tagValues'->>pm_choose(c->'tagWeights'))::int else 1 end;
        bomb := false; -- bombs are assigned below; tags remain safe
        reward := (m->'rewards'->s->>pm_choose(m->'weights'))::numeric;
        raw := round(reward * 100 * (c->'depthFactors'->>L)::numeric * boost);
        band := band || jsonb_build_object('layer', L, 'size', s, 'tagged', tagged, 'boost', boost, 'bomb', bomb,
          'units', floor(raw * (m->>'scale')::numeric)::bigint, 'food', case when random() < .45 then 'mushroom' else 'chicken' end, 'skin', floor(random() * 3)::int);
      end loop;
    end loop;
    select jsonb_agg(x order by random()) into band from jsonb_array_elements(band) x;   -- shuffle within the layer
    -- Select an exact, mode/layer-specific count from untagged targets.
    -- 12 targets minus at most 8 bombs leaves at least 4 reachable foods.
    n := bomb_counts[L + 1];
    if jsonb_array_length(band) <> 12 or n > 8 or
      (select count(*) from jsonb_array_elements(band) x where not (x->>'tagged')::boolean) < n
      then raise exception 'invalid_protein_layout'; end if;
    for j in select ord::int - 1 from jsonb_array_elements(band) with ordinality a(x,ord)
      where not (x->>'tagged')::boolean order by random() limit n
    loop band := jsonb_set(band,array[j::text,'bomb'],'true'); end loop;
    n := jsonb_array_length(band);
    for j in 0 .. n - 1 loop
      r := band->j; w := 54 * (c->'sizeRatios'->>(r->>'size')::int)::numeric;
      rocks := rocks || (r || jsonb_build_object('id', jsonb_array_length(rocks), 'x', round((110 + j * 153 + (random() - .5) * 22)::numeric, 1),
        'y', round((385 + L * 155 + case when j % 2 = 1 then 21 else -21 end + (random() - .5) * 12)::numeric, 1), 'w', w, 'taken', false));
    end loop;
  end loop;
  return rocks;
end $$;
commit;
