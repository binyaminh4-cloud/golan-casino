-- Live roulette pace: 70-second rounds. 40 s to bet, then 3 s "No more bets", 5 s of lightning, the spin, the result.
-- Round numbers restart on the new clock (floor(t / 70) is far below the old floor(t / 48) numbers, so nothing collides).
-- Every bet still open on the old clock is paid out first.
do $$ declare b record; v_pay bigint; v_game text; begin
  for b in select lb.*, r.result, case lb.mode when 'lightning' then r.lucky_l when 'xxx' then r.lucky_x else '{}'::jsonb end as lucky
           from rl_live_bets lb join rl_live_rounds r using (round_no) where not lb.settled for update of lb loop
    v_pay := rl_pay2(b.bets, b.result, b.mode, b.lucky);
    v_game := case b.mode when 'classic' then 'roulette' when 'lightning' then 'lightning_roulette' else 'xxx_roulette' end;
    if v_pay > 0 then perform apply_tx(b.user_id, v_game, 'payout', v_pay, 'rllpay:' || b.id); end if;
    update rl_live_bets set payout = v_pay, settled = true where id = b.id;
  end loop;
end $$;
update zeus_duels set status = 'expired', finished_at = now() where status in ('invited', 'active');
create or replace function rl_live_cycle() returns int language sql immutable as $$ select 70 $$;
create or replace function rl_live_window() returns int language sql immutable as $$ select 40 $$;
