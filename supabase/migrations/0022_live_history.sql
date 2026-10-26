-- Live roulette history: the wheel turns every 48 seconds whether anyone is watching or not.
-- Rounds nobody looked at are filled in when someone asks for the history (same random draw, same strikes).
create or replace function rl_live_recent(p_mode text default 'classic', p_limit int default 500) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n bigint; k int := least(greatest(coalesce(p_limit, 500), 1), 500); t numeric := rl_live_now();
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if p_mode not in ('classic', 'lightning', 'xxx') then raise exception 'invalid_mode'; end if;
  n := floor(t / rl_live_cycle());
  if t < n * rl_live_cycle() + rl_live_window() then n := n - 1; end if;      -- the newest round whose ball has been thrown
  insert into rl_live_rounds (round_no, result, lucky_l, lucky_x)
    select g, rl_rand37(), rl_strike('lightning'), rl_strike('xxx') from generate_series(n - k + 1, n) g
    where not exists (select 1 from rl_live_rounds r where r.round_no = g)
    on conflict (round_no) do nothing;
  return (select coalesce(jsonb_agg(jsonb_build_object('n', result,
            'x', case p_mode when 'lightning' then (lucky_l ->> result::text)::int when 'xxx' then (lucky_x ->> result::text)::int end) order by round_no desc), '[]')
          from rl_live_rounds where round_no between n - k + 1 and n);
end $$;
revoke all on function rl_live_recent(text, int) from public, anon;
grant execute on function rl_live_recent(text, int) to authenticated;
