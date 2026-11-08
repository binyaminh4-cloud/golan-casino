-- Lightning roulette (owner request 8.11): more lightning, smaller multipliers, same return (~97.2% on a straight bet).
-- 8 numbers per round instead of 5; ×25 55% · ×50 27% · ×100 11% · ×200 4.5% · ×300 1.5% · ×500 1% (avg ×56.75, was ×73).
-- XXXtreme is unchanged. Base: 0038.
create or replace function rl_strike(p_mode text) returns jsonb language plpgsql volatile as $$
declare k int; nums int[] := '{}'; n int; out jsonb := '{}'; m int; x int;
begin
  if p_mode = 'lightning' then k := 8; else
    k := rl_pick('count');
    if p_mode = 'xxx' and rl_randint(100) < 12 then k := k + 1 + rl_randint(5); end if;   -- chain lightning: up to 10
  end if;
  while coalesce(array_length(nums, 1), 0) < k loop
    n := rl_randint(37); if not n = any(nums) then nums := nums || n; end if;
  end loop;
  foreach n in array nums loop
    if p_mode = 'lightning' then
      x := rl_randint(1000); m := case when x < 550 then 25 when x < 820 then 50 when x < 930 then 100 when x < 975 then 200 when x < 990 then 300 else 500 end;
    else
      m := rl_pick('mult');
      if p_mode = 'xxx' and rl_randint(1000) < 171 then m := rl_pick('double'); end if;   -- double strike: up to 2000x
    end if;
    out := out || jsonb_build_object(n::text, m);
  end loop;
  return out;
end $$;
