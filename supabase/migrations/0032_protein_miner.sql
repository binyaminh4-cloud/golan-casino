-- שולה החלבון: pick rocks with the claw. Contents (bomb / prize) are drawn on the server when the run starts and never sent
-- to the browser before the rock is pulled. 4 layers × 12 rocks; every 3 catches: take the pot or open the next layer.
-- A bomb ends the run with nothing. Prize units are hundredths of the stake (150 = ×1.50). Config from the art kit (candidate math).
create table if not exists pm_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade, ref text not null unique,
  stake bigint not null, mode text not null, rocks jsonb not null, layer int not null default 0, successes int not null default 0,
  bank_units bigint not null default 0, phase text not null default 'playing' check (phase in ('playing','checkpoint','busted','cashed','finished')),
  paid bigint not null default 0, created_at timestamptz not null default now(), finished_at timestamptz);
create unique index if not exists pm_one_open on pm_runs(user_id) where phase in ('playing','checkpoint');
alter table pm_runs enable row level security; revoke all on pm_runs from anon, authenticated;

create or replace function pm_cfg() returns jsonb language sql immutable as $$ select '{
 "layers":[[9,3,0,0],[7,3,2,0],[5,3,3,1],[3,3,3,3]], "tags":[[1,0,0,0],[1,1,0,0],[0,1,1,1],[0,1,2,1]],
 "sizeRatios":[1,1.3,1.6,2], "depthFactors":[1,1.3,1.7,2.3], "tagBomb":[0.68,0.76,0.84,0.92], "tagValues":[2,3,5,10], "tagWeights":[50,25,20,5],
 "modes":{
  "easy":{"bomb":[0.1,0.18,0.28,0.4],"rewards":[[0.2,0.5,1,10],[0.5,1,2,3],[1,2,4,6],[2,4,8,12]],"weights":[0.8,0.17,0.029,0.001],"scale":0.47107238384315814},
  "normal":{"bomb":[0.15,0.25,0.38,0.5],"rewards":[[0.2,0.6,2,25],[0.5,1,3,5],[1,3,7,12],[2,6,15,25]],"weights":[0.78,0.18,0.039,0.001],"scale":0.7347611185555625},
  "extreme":{"bomb":[0.22,0.35,0.5,0.65],"rewards":[[0.2,1,3,50],[0.5,2,5,10],[1,5,12,25],[2,10,25,50]],"weights":[0.75,0.2,0.048,0.002],"scale":0.8442410816802163}}}'::jsonb $$;

create or replace function pm_choose(w jsonb) returns int language plpgsql volatile as $$
declare tot numeric := 0; x numeric; i int;
begin
  for i in 0 .. jsonb_array_length(w) - 1 loop tot := tot + (w->>i)::numeric; end loop;
  x := random() * tot;
  for i in 0 .. jsonb_array_length(w) - 1 loop x := x - (w->>i)::numeric; if x < 0 then return i; end if; end loop;
  return jsonb_array_length(w) - 1;
end $$;

create or replace function pm_make(p_mode text) returns jsonb language plpgsql volatile as $$
declare c jsonb := pm_cfg(); m jsonb := pm_cfg()->'modes'->p_mode; rocks jsonb := '[]'; band jsonb; L int; s int; i int; tagged boolean; boost int; bomb boolean; reward numeric; raw numeric; n int; j int; r jsonb; w numeric;
begin
  for L in 0..3 loop
    band := '[]';
    for s in 0..3 loop
      for i in 1 .. (c->'layers'->L->>s)::int loop
        tagged := i <= (c->'tags'->L->>s)::int;
        boost := case when tagged then (c->'tagValues'->>pm_choose(c->'tagWeights'))::int else 1 end;
        bomb := random() < case when tagged then (c->'tagBomb'->>s)::numeric else (m->'bomb'->>s)::numeric end;
        reward := (m->'rewards'->s->>pm_choose(m->'weights'))::numeric;
        raw := round(reward * 100 * (c->'depthFactors'->>L)::numeric * boost);
        band := band || jsonb_build_object('layer', L, 'size', s, 'tagged', tagged, 'boost', boost, 'bomb', bomb,
          'units', floor(raw * (m->>'scale')::numeric)::bigint, 'food', case when random() < .45 then 'mushroom' else 'chicken' end, 'skin', floor(random() * 3)::int);
      end loop;
    end loop;
    select jsonb_agg(x order by random()) into band from jsonb_array_elements(band) x;   -- shuffle within the layer
    n := jsonb_array_length(band);
    for j in 0 .. n - 1 loop
      r := band->j; w := 54 * (c->'sizeRatios'->>(r->>'size')::int)::numeric;
      rocks := rocks || (r || jsonb_build_object('id', jsonb_array_length(rocks), 'x', round((110 + j * 153 + (random() - .5) * 22)::numeric, 1),
        'y', round((385 + L * 155 + case when j % 2 = 1 then 21 else -21 end + (random() - .5) * 12)::numeric, 1), 'w', w, 'taken', false));
    end loop;
  end loop;
  return rocks;
end $$;

-- what the browser may see: positions, sizes, skins and Yoav's tags; never bombs or prizes of rocks still in the ground
create or replace function pm_view(r pm_runs) returns jsonb language sql stable as $$
  select jsonb_build_object('id', r.id, 'stake', r.stake, 'mode', r.mode, 'layer', r.layer, 'successes', r.successes, 'bank_units', r.bank_units,
    'phase', r.phase, 'paid', r.paid, 'balance', (select balance from wallets where user_id = r.user_id),
    'rocks', (select jsonb_agg(case when (x->>'taken')::boolean or r.phase in ('busted','cashed','finished') then x
                                    else x - 'bomb' - 'units' - 'food' end) from jsonb_array_elements(r.rocks) x)) $$;

create or replace function pm_start(p_stake bigint, p_mode text, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r pm_runs;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into r from pm_runs where ref = p_ref and user_id = u; if found then return pm_view(r); end if;
  if p_mode not in ('easy', 'normal', 'extreme') then raise exception 'invalid_mode'; end if;
  if exists (select 1 from pm_runs where user_id = u and phase in ('playing','checkpoint')) then raise exception 'run_in_progress'; end if;
  if p_stake is null or p_stake < 1 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'protein_miner', 'stake', -p_stake, 'pmstake:' || p_ref);
  insert into pm_runs (user_id, ref, stake, mode, rocks) values (u, p_ref, p_stake, p_mode, pm_make(p_mode)) returning * into r;
  return pm_view(r);
end $$;

create or replace function pm_collect(p_run uuid, p_rock int) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r pm_runs; k jsonb; v jsonb;
begin
  select * into r from pm_runs where id = p_run and user_id = u for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.phase <> 'playing' then raise exception 'not_playing'; end if;
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

create or replace function pm_next(p_run uuid, p_cash boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r pm_runs;
begin
  select * into r from pm_runs where id = p_run and user_id = u for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.phase <> 'checkpoint' then return pm_view(r); end if;
  if p_cash or r.layer >= 3 then
    update pm_runs set phase = 'cashed', paid = floor(r.stake * r.bank_units / 100.0)::bigint, finished_at = now() where id = r.id returning * into r;
    if r.paid > 0 then perform apply_tx(u, 'protein_miner', 'payout', r.paid, 'pmpay:' || r.id); end if;
  else
    update pm_runs set phase = 'playing', layer = r.layer + 1 where id = r.id returning * into r;
  end if;
  return pm_view(r);
end $$;

create or replace function pm_current() returns jsonb language sql security definer set search_path = public as $$
  select pm_view(r) from pm_runs r where user_id = auth.uid() and phase in ('playing','checkpoint') limit 1 $$;

revoke all on function pm_cfg(), pm_choose(jsonb), pm_make(text), pm_view(pm_runs) from public, anon, authenticated;
revoke all on function pm_start(bigint, text, text), pm_collect(uuid, int), pm_next(uuid, boolean), pm_current() from public, anon;
grant execute on function pm_start(bigint, text, text), pm_collect(uuid, int), pm_next(uuid, boolean), pm_current() to authenticated;
