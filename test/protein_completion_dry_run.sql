-- Minimum TOTAL return after all 12 successful pulls: easy x2, normal x5, extreme x10.
-- Early cash-out and bombs keep their existing behavior. Past runs are not changed.
begin;
create or replace function pm_reward_units(p_mode text, p_successes int, p_units bigint)
returns bigint language sql immutable set search_path = public as $$
  select case when p_successes = 12 then greatest(p_units,
    case p_mode when 'easy' then 200 when 'normal' then 500 when 'extreme' then 1000 else p_units end)
    else p_units end
$$;

create or replace function pm_collect(p_run uuid, p_rock int) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r pm_runs; k jsonb; v jsonb;
begin
  select * into r from pm_runs where id = p_run and user_id = u for update;
  if not found then raise exception 'run_not_found'; end if;
  if r.phase <> 'playing' then raise exception 'not_playing'; end if;
  if p_rock = -1 then   -- empty claw: nothing happens, shoot again
    return pm_view(r) || jsonb_build_object('got', jsonb_build_object('miss', true));
  end if;
  k := r.rocks->p_rock;
  if k is null or (k->>'taken')::boolean or (k->>'layer')::int <> r.layer then raise exception 'rock_unavailable'; end if;
  r.rocks := jsonb_set(r.rocks, array[p_rock::text, 'taken'], 'true');
  if (k->>'bomb')::boolean then
    update pm_runs set rocks = r.rocks, bank_units = 0, phase = 'busted', finished_at = now() where id = r.id returning * into r;
  else
    r.bank_units := r.bank_units + (k->>'units')::bigint; r.successes := r.successes + 1;
    r.bank_units := pm_reward_units(r.mode, r.successes, r.bank_units);
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

-- Pure calculations only: no game rows or balances are created or modified.
do $$
declare mode text; multiple int; units bigint; successes int; stake bigint; got bigint;
begin
  foreach mode in array array['easy','normal','extreme'] loop
    multiple := case mode when 'easy' then 2 when 'normal' then 5 else 10 end;
    foreach units in array array[0,1,92,199,200,499,500,999,1000,2500]::bigint[] loop
      for successes in 0..12 loop
        got := pm_reward_units(mode, successes, units);
        if successes < 12 and got <> units then raise exception 'early_cashout_changed'; end if;
        if successes = 12 and got <> greatest(units, multiple * 100) then raise exception 'completion_floor'; end if;
        foreach stake in array array[1,3,99,100,100000000]::bigint[] loop
          if successes = 12 and floor(stake::numeric * got / 100) < stake * multiple then
            raise exception 'payout_below_minimum';
          end if;
        end loop;
      end loop;
    end loop;
  end loop;
end $$;
select mode, floor(100 * pm_reward_units(mode, 12, 92) / 100.0)::bigint as total_return_for_100
from unnest(array['easy','normal','extreme']) as mode;

rollback;

