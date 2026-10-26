-- Live roulette: who is sitting at the table (seen in the last 15 seconds), so members see each other even before betting.
create table if not exists rl_presence (user_id uuid primary key references profiles(id) on delete cascade, mode text not null, seen_at timestamptz not null default now(), since timestamptz not null default now());
alter table rl_presence enable row level security;
revoke all on rl_presence from anon, authenticated;

create or replace function rl_live_state(p_mode text default 'classic') returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); t numeric; n bigint; c int := rl_live_cycle(); w int := rl_live_window();
        r rl_live_rounds; open boolean; v_mine jsonb; v_pay bigint; v_players jsonb; v_hist jsonb;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_mode not in ('classic', 'lightning', 'xxx') then raise exception 'invalid_mode'; end if;
  perform rl_live_settle();
  insert into rl_presence (user_id, mode, seen_at) values (u, p_mode, now()) on conflict (user_id) do update set mode = excluded.mode, seen_at = now();
  t := rl_live_now(); n := floor(t / c);
  perform rl_live_ensure(n);
  select * into r from rl_live_rounds where round_no = n;
  open := t < n * c + w;
  select coalesce(jsonb_agg(x), '[]'), case when bool_and(settled) then sum(payout) end
    into v_mine, v_pay
    from (select jsonb_array_elements(bets) x, settled, payout from rl_live_bets where round_no = n and user_id = u and mode = p_mode) q;
  select coalesce(sum(payout), null) into v_pay from rl_live_bets where round_no = n and user_id = u and mode = p_mode and settled;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.nickname, 'total', s.tot, 'nums', s.nums) order by s.tot desc), '[]')
    into v_players
    from (select user_id, sum(total) tot,
                 (select jsonb_agg(distinct e->'nums') from rl_live_bets b2, jsonb_array_elements(b2.bets) e
                   where b2.round_no = n and b2.mode = p_mode and b2.user_id = lb.user_id) nums
          from rl_live_bets lb where round_no = n and mode = p_mode group by user_id) s
    join profiles p on p.id = s.user_id;
  select coalesce(jsonb_agg(result order by round_no desc), '[]') into v_hist
    from (select round_no, result from rl_live_rounds where round_no < n or (round_no = n and not open)
          order by round_no desc limit 18) h;
  return jsonb_build_object(
    'now', round(t * 1000), 'round', n,
    'start', n * c * 1000, 'close', (n * c + w) * 1000, 'end', (n + 1) * c * 1000,
    'open', open,
    'result', case when open then null else r.result end,
    'lucky', case when open or p_mode = 'classic' then '{}'::jsonb when p_mode = 'lightning' then r.lucky_l else r.lucky_x end,
    'mine', v_mine, 'payout', v_pay,
    'players', v_players, 'history', v_hist,
    'present', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.nickname) order by pr.since), '[]')
                from rl_presence pr join profiles p on p.id = pr.user_id where pr.mode = p_mode and pr.seen_at > now() - interval '15 seconds'),
    'balance', (select balance from wallets where user_id = u));
end $$;
