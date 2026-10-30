-- poker against the dealer: hand evaluators, payouts, private + live flow, and long-run return (simulated optimal-ish play)
do $$ begin
  -- 5-card categories
  if dp_cat(dp_eval5(array['AS','KS','QS','JS','TS'])) <> 8 then raise exception 'fail royal'; end if;
  if dp_cat(dp_eval5(array['AS','2D','3C','4H','5S'])) <> 4 then raise exception 'fail wheel'; end if;
  if dp_cat(dp_eval5(array['9S','9D','9C','4H','4S'])) <> 6 then raise exception 'fail fh'; end if;
  if dp_cat(dp_eval5(array['9S','9D','5C','4H','4S'])) <> 2 then raise exception 'fail 2p'; end if;
  if dp_eval5(array['AS','AD','5C','4H','3S']) <= dp_eval5(array['KS','KD','QC','JH','9S']) then raise exception 'fail pair order'; end if;
  if dp_cat(dp_best7(array['AS','KS','2D','3C','QS','JS','TS'])) <> 8 then raise exception 'fail best7'; end if;
  -- 3-card: straight beats flush
  if dp_eval3(array['5S','6D','7C']) <= dp_eval3(array['2H','9H','KH']) then raise exception 'fail tcp order'; end if;
  if (dp_eval3(array['AS','2D','3C']) / 3375) <> 3 then raise exception 'fail tcp wheel'; end if;
  raise notice 'DP EVAL TESTS DONE';
end $$;
-- private flow for all three games
select set_config('request.jwt.sub','00000000-0000-0000-0000-00000000000a',false);
update wallets set balance = 10000000 where user_id = '00000000-0000-0000-0000-00000000000a';
do $$ declare s jsonb; g text; a text; b0 bigint; b1 bigint; begin
  foreach g in array array['tcp','csp','uth'] loop
    b0 := (select balance from wallets where user_id = auth.uid());
    s := dp_bet(g, 0, 1000, case when g = 'csp' then 0 else 100 end, 'x' || g);
    if s->>'phase' <> 'd1' then raise exception 'fail deal % %', g, s->>'phase'; end if;
    a := case g when 'uth' then 'check' else 'play' end;
    s := dp_act((s->>'id')::uuid, a);
    if g = 'uth' then s := dp_act((s->>'id')::uuid, 'check'); s := dp_act((s->>'id')::uuid, 'raise1'); end if;
    if s->>'phase' <> 'done' then raise exception 'fail finish %', g; end if;
    b1 := (select balance from wallets where user_id = auth.uid());
    if b1 - b0 <> ((s->'hands'->0->'result'->>'net')::bigint) then raise exception 'fail ledger % % %', g, b1 - b0, s->'hands'->0->'result'; end if;
  end loop;
  raise notice 'DP FLOW TESTS DONE';
end $$;
-- live table: two players, timeouts fold/check, all hands settle
do $$ declare s jsonb; r dp_rounds; begin
  update wallets set balance = 10000000 where user_id in ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b');
  perform set_config('gc.test_now', '1000000', false);
  perform set_config('request.jwt.sub','00000000-0000-0000-0000-00000000000b',false); s := dp_state('uth', 1);
  perform set_config('request.jwt.sub','00000000-0000-0000-0000-00000000000a',false); s := dp_state('uth', 1); s := dp_bet('uth', 1, 500, 0, 'L1');
  if s->>'phase' <> 'betting' then raise exception 'fail live wait %', s->>'phase'; end if;
  perform set_config('request.jwt.sub','00000000-0000-0000-0000-00000000000b',false); s := dp_bet('uth', 1, 500, 50, 'L2');
  if s->>'phase' not in ('betting','d1') then raise exception 'fail live bet %', s->>'phase'; end if;
  perform set_config('gc.test_now', '1000005', false); s := dp_state('uth', 1);
  if s->>'phase' <> 'd1' then raise exception 'fail live deal %', s->>'phase'; end if;
  s := dp_act((s->>'id')::uuid, 'raise4');
  perform set_config('gc.test_now', '1000100', false); s := dp_state('uth', 1);
  select * into r from dp_rounds where game = 'uth' and t_no = 1 and round_no = 1;
  if r.phase <> 'done' then raise exception 'fail live done %', r.phase; end if;
  if exists (select 1 from dp_hands where round_id = r.id and status <> 'done') then raise exception 'fail live settle'; end if;
  raise notice 'DP LIVE TESTS DONE';
end $$;
-- return to player with a simple strategy (tcp: play Q-6-4+, csp: raise AK+, uth: raise4 with pair/ace, else check, raise1 on river with pair+)
do $$ declare g text; n int := 6000; dbg text; i int; s jsonb; stake bigint; back bigint; c text[]; a text; begin
  update wallets set balance = 1000000000 where user_id = '00000000-0000-0000-0000-00000000000a';
  perform set_config('request.jwt.sub','00000000-0000-0000-0000-00000000000a',false);
  foreach g in array array['tcp','csp','uth'] loop stake := 0; back := 0;
    for i in 1..n loop
      s := dp_bet(g, 0, 100, case when g = 'csp' then 0 else 0 end, 'rtp' || g || i);
      select cards into c from dp_hands where round_id = (s->>'id')::uuid;
      if g = 'tcp' then a := case when dp_eval3(c) >= 12*225 + 6*15 + 4 then 'play' else 'fold' end; s := dp_act((s->>'id')::uuid, a);
      elsif g = 'csp' then a := case when dp_cat(dp_eval5(c)) >= 1 or (dp_eval5(c) % 759375) / 50625 = 14 and (dp_eval5(c) % 50625) / 3375 = 13 then 'play' else 'fold' end; s := dp_act((s->>'id')::uuid, a);
      else
        a := case when dp_rank(c[1]) = dp_rank(c[2]) or greatest(dp_rank(c[1]), dp_rank(c[2])) = 14 then 'raise4' else 'check' end; s := dp_act((s->>'id')::uuid, a);
        if s->>'phase' <> 'done' then s := dp_act((s->>'id')::uuid, case when dp_cat(dp_best7(c || (select board[1:3] from dp_rounds where id = (s->>'id')::uuid))) >= 2 then 'raise2' else 'check' end); end if;
        if s->>'phase' <> 'done' then s := dp_act((s->>'id')::uuid, case when dp_cat(dp_best7(c || (select board from dp_rounds where id = (s->>'id')::uuid))) >= 1 then 'raise1' else 'fold' end); end if;
      end if;
      dbg := g;
      select stake + ante + blind + side + play, back + (result->>'pay')::bigint into stake, back from dp_hands where round_id = (s->>'id')::uuid;
    end loop;
    raise notice 'DONE RTP % = %', g, round(back::numeric / stake, 4);
  end loop;
end $$;
