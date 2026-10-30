-- Live roulette: 5 more seconds to bet (window 25 s, cycle 55 s). floor(t/55) is far from every earlier round-number range
-- (48/50/70-second clocks), so nothing collides. Every bet still open on the old clock is paid out first.
do $$ declare b record; v_pay bigint; v_game text; begin
  for b in select lb.*, r.result, case lb.mode when 'lightning' then r.lucky_l when 'xxx' then r.lucky_x else '{}'::jsonb end as lucky
           from rl_live_bets lb join rl_live_rounds r using (round_no) where not lb.settled and r.result is not null for update of lb loop
    v_pay := rl_pay2(b.bets, b.result, b.mode, b.lucky);
    v_game := case b.mode when 'classic' then 'roulette' when 'lightning' then 'lightning_roulette' else 'xxx_roulette' end;
    if v_pay > 0 then perform apply_tx(b.user_id, v_game, 'payout', v_pay, 'rllpay:' || b.id); end if;
    update rl_live_bets set payout = v_pay, settled = true where id = b.id;
  end loop;
end $$;
update zeus_duels set status = 'expired', finished_at = now() where status in ('invited', 'active');
create or replace function rl_live_cycle() returns int language sql immutable as $$ select 55 $$;
create or replace function rl_live_window() returns int language sql immutable as $$ select 25 $$;

-- chat: after the first load, send the OLDEST 40 after the cursor, so a burst of more than 40 is never skipped
create or replace function chat_since(p_room text, p_after bigint default 0, p_where text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  update profiles set last_seen = now(), where_now = coalesce(left(p_where, 80), where_now)
   where id = auth.uid() and (last_seen is null or last_seen < now() - interval '10 seconds' or where_now is distinct from coalesce(left(p_where, 80), where_now));
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'body', m.body, 'at', m.created_at,
           'uid', m.user_id, 'name', p.nickname) order by m.id), '[]') into v
  from (select * from (select * from chat_messages where room = p_room and id > coalesce(p_after, 0)
          order by case when coalesce(p_after, 0) = 0 then -id else id end limit 40) q) m
  left join profiles p on p.id = m.user_id;
  return v;
end $$;
