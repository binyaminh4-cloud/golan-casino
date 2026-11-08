-- XXXtreme lightning roulette (owner request 8.11): more lightning per round and more ×50/×100 strikes, same return
-- on a straight bet (~97.3%, as before). Lightning per round: 3–5 (was 1–5), plus the same 12% chain (up to +5).
-- ×50 48% · ×100 31% (were 41% / 24%); the ×600–×2000 double strike comes 8.1% of the time (was 17.1%).
-- Plain straight stays 19:1. The regular lightning roulette is unchanged (it does not use these tables).
delete from rl_w where kind in ('count', 'mult');
insert into rl_w (kind, val, w) values
  ('count', 3, 25), ('count', 4, 40), ('count', 5, 35),
  ('mult', 50, 1400), ('mult', 100, 900), ('mult', 150, 300), ('mult', 200, 150), ('mult', 250, 80),
  ('mult', 300, 40), ('mult', 350, 22), ('mult', 400, 12), ('mult', 450, 7), ('mult', 500, 4);
create or replace function rl_strike(p_mode text) returns jsonb language plpgsql volatile as $$
declare k int; nums int[] := '{}'; n int; out jsonb := '{}'; m int; x int;
begin
  if p_mode = 'lightning' then k := 5; else
    k := rl_pick('count');
    if p_mode = 'xxx' and rl_randint(100) < 12 then k := k + 1 + rl_randint(5); end if;   -- chain lightning: up to 10
  end if;
  while coalesce(array_length(nums, 1), 0) < k loop
    n := rl_randint(37); if not n = any(nums) then nums := nums || n; end if;
  end loop;
  foreach n in array nums loop
    if p_mode = 'lightning' then
      x := rl_randint(100); m := case when x < 80 then 50 when x < 92 then 100 when x < 97 then 200 when x < 99 then 300 else 500 end;
    else
      m := rl_pick('mult');
      if p_mode = 'xxx' and rl_randint(1000) < 81 then m := rl_pick('double'); end if;   -- double strike: up to 2000x
    end if;
    out := out || jsonb_build_object(n::text, m);
  end loop;
  return out;
end $$;
