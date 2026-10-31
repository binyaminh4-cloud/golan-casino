-- Zeus duel: ends as soon as a player has no chips left
create or replace function zeus_settle(p_duel uuid) returns void language plpgsql security definer set search_path = public as $$
declare d zeus_duels; zb_r record; v_pay bigint; v_closed bigint; na text; nb text;
begin
  select * into d from zeus_duels where id = p_duel for update;
  if not found or d.status <> 'active' then return; end if;
  v_closed := floor((rl_live_now() - rl_live_window()) / rl_live_cycle());
  for zb_r in select zb.*, r.result, r.lucky_l from zeus_bets zb join rl_live_rounds r using (round_no)
           where zb.duel = p_duel and not zb.settled and zb.round_no <= v_closed loop
    v_pay := rl_pay2(zb_r.bets, zb_r.result, 'lightning', zb_r.lucky_l) * case when zb_r.round_no = d.start_round + zeus_rounds() - 1 then 2 else 1 end;
    update zeus_bets set payout = v_pay, settled = true where id = zb_r.id;
    if zb_r.user_id = d.a then update zeus_duels set a_chips = a_chips + v_pay where id = p_duel;
    else update zeus_duels set b_chips = b_chips + v_pay where id = p_duel; end if;
  end loop;
  select * into d from zeus_duels where id = p_duel;
  -- a player who is out of chips (and has no bet still waiting for a result) ends the duel right away
  if v_closed >= d.start_round + zeus_rounds() - 1
     or (d.a_chips < 5 and not exists (select 1 from zeus_bets where duel = p_duel and user_id = d.a and not settled))
     or (d.b_chips < 5 and not exists (select 1 from zeus_bets where duel = p_duel and user_id = d.b and not settled)) then
    update zeus_duels set status = 'done', finished_at = now(),
      winner = case when a_chips > b_chips then a when b_chips > a_chips then b end where id = p_duel returning * into d;
    na := (select nickname from profiles where id = d.a); nb := (select nickname from profiles where id = d.b);
    if d.winner is null then
      perform ch_add_points(d.season, d.a, 'zeus', 10); perform ch_add_points(d.season, d.b, 'zeus', 10);
      perform chat_sys('lobby', '⚡ תיקו בדו־קרב של זאוס בין ' || na || ' ל' || nb || '. זאוס לא מרוצה.');
    else
      perform ch_add_points(d.season, d.winner, 'zeus', 30);
      perform chat_sys('lobby', '⚡ ' || case when d.winner = d.a then na else nb end || ' ניצח בדו־קרב של זאוס: ' ||
        to_char(greatest(d.a_chips, d.b_chips), 'FM999,999,999,999,999,999') || ' מול ' || to_char(least(d.a_chips, d.b_chips), 'FM999,999,999,999,999,999') || '.');
    end if;
  end if;
end $$;
