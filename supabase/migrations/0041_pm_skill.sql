-- שולה החלבון becomes a skill game: bombs and prizes are visible (only prize amounts stay hidden), the claw can come back empty
-- (that still uses a pull), and prize scales are cut so a decent aimer (~65% on target, 15% empty) lands near 96%.
create or replace function pm_cfg() returns jsonb language sql immutable as $$ select '{
 "layers":[[9,3,0,0],[7,3,2,0],[5,3,3,1],[3,3,3,3]], "tags":[[1,0,0,0],[1,1,0,0],[0,1,1,1],[0,1,2,1]],
 "sizeRatios":[1,1.3,1.6,2], "depthFactors":[1,1.3,1.7,2.3], "tagBomb":[0.68,0.76,0.84,0.92], "tagValues":[2,3,5,10], "tagWeights":[50,25,20,5],
 "modes":{
  "easy":{"bomb":[0.1,0.18,0.28,0.4],"rewards":[[0.2,0.5,1,10],[0.5,1,2,3],[1,2,4,6],[2,4,8,12]],"weights":[0.8,0.17,0.029,0.001],"scale":0.086336},
  "normal":{"bomb":[0.15,0.25,0.38,0.5],"rewards":[[0.2,0.6,2,25],[0.5,1,3,5],[1,3,7,12],[2,6,15,25]],"weights":[0.78,0.18,0.039,0.001],"scale":0.083873},
  "extreme":{"bomb":[0.22,0.35,0.5,0.65],"rewards":[[0.2,1,3,50],[0.5,2,5,10],[1,5,12,25],[2,10,25,50]],"weights":[0.75,0.2,0.048,0.002],"scale":0.072422}}}'::jsonb $$;

create or replace function pm_view(r pm_runs) returns jsonb language sql stable as $$
  select jsonb_build_object('id', r.id, 'stake', r.stake, 'mode', r.mode, 'layer', r.layer, 'successes', r.successes, 'bank_units', r.bank_units,
    'phase', r.phase, 'paid', r.paid, 'balance', (select balance from wallets where user_id = r.user_id),
    'rocks', (select jsonb_agg(case when (x->>'taken')::boolean or r.phase in ('busted','cashed','finished') then x
                                    else x - 'units' end) from jsonb_array_elements(r.rocks) x)) $$;

create or replace function pm_collect(p_run uuid, p_rock int) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r pm_runs; k jsonb; v jsonb;
begin
  select * into r from pm_runs where id = p_run and user_id = u for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.phase <> 'playing' then raise exception 'not_playing'; end if;
  if p_rock = -1 then   -- the claw came back empty: the pull still counts, adds nothing
    r.successes := r.successes + 1;
    update pm_runs set successes = r.successes,
      phase = case when r.successes = 12 then 'finished' when r.successes % 3 = 0 then 'checkpoint' else 'playing' end,
      paid = case when r.successes = 12 then floor(r.stake * r.bank_units / 100.0)::bigint else 0 end,
      finished_at = case when r.successes = 12 then now() end where id = r.id returning * into r;
    if r.phase = 'finished' and r.paid > 0 then perform apply_tx(u, 'protein_miner', 'payout', r.paid, 'pmpay:' || r.id); end if;
    return pm_view(r) || jsonb_build_object('got', jsonb_build_object('miss', true));
  end if;
  k := r.rocks->p_rock;
  if k is null or (k->>'taken')::boolean or (k->>'layer')::int <> r.layer then raise exception 'rock_unavailable'; end if;
  r.rocks := jsonb_set(r.rocks, array[p_rock::text, 'taken'], 'true');
  if (k->>'bomb')::boolean then
    update pm_runs set rocks = r.rocks, bank_units = 0, phase = 'busted', finished_at = now() where id = r.id returning * into r;
  else
    r.bank_units := r.bank_units + (k->>'units')::bigint; r.successes := r.successes + 1;
    update pm_runs set rocks = r.rocks, bank_units = r.bank_units, successes = r.successes,
      phase = case when r.successes = 12 then 'finished' when r.successes % 3 = 0 then 'checkpoint' else 'playing' end,
      paid = case when r.successes = 12 then floor(r.stake * r.bank_units / 100.0)::bigint else 0 end,
      finished_at = case when r.successes = 12 then now() end
     where id = r.id returning * into r;
    if r.phase = 'finished' and r.paid > 0 then perform apply_tx(u, 'protein_miner', 'payout', r.paid, 'pmpay:' || r.id); end if;
  end if;
  v := pm_view(r);
  return v || jsonb_build_object('got', k || jsonb_build_object('taken', true));
end $$;
