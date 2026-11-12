-- Live roulette: the wait after the ball lands is down to about a second (cycle 42 s, betting window stays 25 s).
-- floor(t/42) sits far above every earlier round-number range (48/50/55/70-second clocks), so nothing collides. Open bets on the old clock are paid first.
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
create or replace function rl_live_cycle() returns int language sql immutable as $$ select 42 $$;
create or replace function rl_live_window() returns int language sql immutable as $$ select 25 $$;

