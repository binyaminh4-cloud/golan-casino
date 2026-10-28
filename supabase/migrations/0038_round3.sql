-- Admin can grant up to ₪100M at once.
create or replace function admin_grant(p_user uuid, p_amount bigint) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_batch text := gen_random_uuid()::text;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then raise exception 'not_admin'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000000 then raise exception 'invalid_amount'; end if;
  for r in select id from profiles where p_user is null or id = p_user loop
    perform apply_tx(r.id, 'admin', 'grant', p_amount, 'admin-grant-' || v_batch || ':' || r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- רולטת הברק המחומש: every lightning round strikes exactly 5 numbers with ×50..×500 (weighted low; ≈97.2% on a straight bet).
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
      if p_mode = 'xxx' and rl_randint(1000) < 171 then m := rl_pick('double'); end if;   -- double strike: up to 2000x
    end if;
    out := out || jsonb_build_object(n::text, m);
  end loop;
  return out;
end $$;
