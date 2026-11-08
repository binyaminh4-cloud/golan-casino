-- Lightning roulette (owner request 8.11): more lightning, and more of the ×50/×100 strikes.
-- 6 numbers per round instead of 5; ×50 70% · ×100 22% · ×200 5% · ×300 2% · ×500 1% (avg ×78, was ×73).
-- To keep the return (~98% on a straight bet, was 97.2%) a plain straight now pays 27:1 instead of 29:1.
-- XXXtreme is unchanged. Base: 0038.
create or replace function rl_strike(p_mode text) returns jsonb language plpgsql volatile as $$
declare k int; nums int[] := '{}'; n int; out jsonb := '{}'; m int; x int;
begin
  if p_mode = 'lightning' then k := 6; else
    k := rl_pick('count');
    if p_mode = 'xxx' and rl_randint(100) < 12 then k := k + 1 + rl_randint(5); end if;   -- chain lightning: up to 10
  end if;
  while coalesce(array_length(nums, 1), 0) < k loop
    n := rl_randint(37); if not n = any(nums) then nums := nums || n; end if;
  end loop;
  foreach n in array nums loop
    if p_mode = 'lightning' then
      x := rl_randint(1000); m := case when x < 700 then 50 when x < 920 then 100 when x < 970 then 200 when x < 990 then 300 else 500 end;
    else
      m := rl_pick('mult');
      if p_mode = 'xxx' and rl_randint(1000) < 171 then m := rl_pick('double'); end if;   -- double strike: up to 2000x
    end if;
    out := out || jsonb_build_object(n::text, m);
  end loop;
  return out;
end $$;

create or replace function rl_pay2(p_bets jsonb, p_result int, p_mode text, p_lucky jsonb) returns bigint language sql immutable as $$
  select coalesce(sum(
    case when jsonb_array_length(b->'nums') = 1 and p_mode <> 'classic' then
           (b->>'amt')::bigint * coalesce((p_lucky->>(p_result::text))::bigint + 1, case p_mode when 'xxx' then 20 else 28 end)
         else ((b->>'amt')::bigint * 36) / jsonb_array_length(b->'nums') end), 0)::bigint
  from jsonb_array_elements(p_bets) b
  where (b->'nums') @> to_jsonb(p_result) $$;
