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
