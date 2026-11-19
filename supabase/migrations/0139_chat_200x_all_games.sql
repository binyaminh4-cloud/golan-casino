-- Lobby chat announcement for every win of ×200 the bet or more (bonus buy: ×3 the price), in the games that missed it:
--   roulette (private, also roulette 3D private / lightning / XXX)  rl_spin
--   blackjack (2D, 3D, table, lightning; not inside challenges)    bj_finish
--   time for the kitchen wheel                                      zlm_private.tick
--   fisher at the 90th minute                                       f90_act, f90_cash
--   Shula the protein miner                                         pm_next, pm_collect
--   fortune slots (paid spins ×200; bought free spins ×3 the price) fo_spin, fo_buy (+ table fo_buy_track)
-- How: each function is read from the server as it is now, one statement is inserted before a known line,
-- and the function is re-created. Nothing else in it changes. If the known line is not found exactly once, the
-- whole file stops with an error (nothing applied). Safe to run twice: an already patched function is skipped.
--
-- UNDO (paste into the SQL editor):
--   do $u$ declare f record; d text; begin
--     for f in select p.oid from pg_proc p where prosrc like '%/*gc200*/%' loop
--       d := pg_get_functiondef(f.oid);
--       d := regexp_replace(d, '/\*gc200\*/.*?/\*gc200end\*/', '', 'g');
--       execute d;
--     end loop; end $u$;
--   drop table if exists public.fo_buy_track;

create table if not exists public.fo_buy_track (user_id uuid primary key, cost bigint not null, won bigint not null default 0);
alter table public.fo_buy_track enable row level security;   -- server only, no client access

create or replace function pg_temp.gc_patch(p_fn regprocedure, p_anchor text, p_add text) returns text language plpgsql as $p$
declare d text; n int;
begin
  d := pg_get_functiondef(p_fn);
  if position('/*gc200*/' in d) > 0 then return p_fn::text || ': already done'; end if;
  n := (length(d) - length(replace(d, p_anchor, ''))) / length(p_anchor);
  if n <> 1 then raise exception 'gc200: % - the line to patch was found % times (expected 1). Nothing applied.', p_fn, n; end if;
  execute replace(d, p_anchor, '/*gc200*/ ' || p_add || ' /*gc200end*/ ' || p_anchor);
  return p_fn::text || ': patched';
end $p$;

do $m$
declare r text;
begin
  -- roulette (private): same rule and wording as the live roulette (0130): ×200 of the total, or a lightning of ×200+ on a hit single number
  r := pg_temp.gc_patch('public.rl_spin(jsonb,text,text)',
    'if v_pay > 0 then v_bal := apply_tx(u, v_game, ''payout'', v_pay, ''rlpay:'' || s.id);',
    $a$perform chat_sys('lobby', '⚡ ' || (select nickname from profiles where id = u) || ' זכה ב־₪' || to_char(v_pay, 'FM999,999,999,999,999,999') ||
        ' על ' || v_res || case when q.hit > 0 then ' ⚡ ' || q.hit || 'x' else '' end ||
        case p_mode when 'lightning' then ' ברולטת ברקים X!' when 'xxx' then ' ברולטת XXX!' else ' ברולטה!' end)
      from (select case when p_mode <> 'classic' and v_lucky ? v_res::text
                         and exists (select 1 from jsonb_array_elements(v_clean) x where jsonb_array_length(x->'nums') = 1 and (x->'nums') @> to_jsonb(v_res))
                        then (v_lucky->>v_res::text)::int else 0 end as hit) q
      where v_pay > 0 and (q.hit >= 200 or v_pay >= v_total * 200);$a$);
  raise notice '%', r;

  -- blackjack: whole round (all hands and side bets) against everything staked; challenge chips are not money, so not there
  r := pg_temp.gc_patch('public.bj_finish(uuid)',
    'if r.ch_run is not null then perform ch_hand_done(r.ch_run); end if;',
    $a$if r.ch_run is null and r.total_staked > 0 and pay >= r.total_staked * 200 then
      perform chat_sys('lobby', '🃏 ' || (select nickname from profiles where id = r.user_id) || ' זכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') ||
        case r.mode when 'lightning' then ' בבלאק ג׳ק ברקים!' else ' בבלאק ג׳ק!' end);
    end if;$a$);
  raise notice '%', r;

  -- time for the kitchen: each player's round total against what they bet in that round
  r := pg_temp.gc_patch('zlm_private.tick(boolean)',
    'update zlm_private.rounds set phase=''summary'',phase_at=r.deadline,deadline=r.deadline+interval ''8 seconds'' where id=r.id;',
    $a$perform public.chat_sys('lobby', '🍳 ' || (select nickname from public.profiles where id = q.user_id) || ' זכה ב־₪' || to_char(q.p, 'FM999,999,999,999,999,999') || ' בזמן למטבח!')
      from (select z.user_id, sum(z.amount) a, sum(z.payout) p from zlm_private.bets z where z.round_id = r.id group by z.user_id) q
      where q.a > 0 and q.p >= q.a * 200;$a$);
  raise notice '%', r;

  -- fisher at the 90th minute: the run's payout against its stake (cash-out and full win)
  r := pg_temp.gc_patch('public.f90_act(uuid,text)', 'perform apply_tx(u, ''fisher90'', ''payout'', r.paid, ''f90pay:'' || r.id);',
    $a$if r.stake > 0 and r.paid >= r.stake * 200 then perform chat_sys('lobby', '⚽ ' || (select nickname from profiles where id = u) || ' לקח ₪' || to_char(r.paid, 'FM999,999,999,999,999,999') || ' בפישר בדקה ה־90!'); end if;$a$);
  raise notice '%', r;
  r := pg_temp.gc_patch('public.f90_cash(uuid)', 'perform apply_tx(u, ''fisher90'', ''payout'', r.paid, ''f90pay:'' || r.id);',
    $a$if r.stake > 0 and r.paid >= r.stake * 200 then perform chat_sys('lobby', '⚽ ' || (select nickname from profiles where id = u) || ' לקח ₪' || to_char(r.paid, 'FM999,999,999,999,999,999') || ' בפישר בדקה ה־90!'); end if;$a$);
  raise notice '%', r;

  -- Shula the protein miner: cash-out at a checkpoint and the full run
  r := pg_temp.gc_patch('public.pm_next(uuid,boolean)', 'if r.paid > 0 then perform apply_tx(u, ''protein_miner'', ''payout'', r.paid, ''pmpay:'' || r.id); end if;',
    $a$if r.stake > 0 and r.paid >= r.stake * 200 then perform chat_sys('lobby', '💪 ' || (select nickname from profiles where id = u) || ' כרה ₪' || to_char(r.paid, 'FM999,999,999,999,999,999') || ' אצל שולה החלבון!'); end if;$a$);
  raise notice '%', r;
  r := pg_temp.gc_patch('public.pm_collect(uuid,integer)', 'if r.phase = ''finished'' and r.paid > 0 then perform apply_tx(u, ''protein_miner'', ''payout'', r.paid, ''pmpay:'' || r.id); end if;',
    $a$if r.phase = 'finished' and r.stake > 0 and r.paid >= r.stake * 200 then perform chat_sys('lobby', '💪 ' || (select nickname from profiles where id = u) || ' כרה ₪' || to_char(r.paid, 'FM999,999,999,999,999,999') || ' אצל שולה החלבון!'); end if;$a$);
  raise notice '%', r;

  -- fortune slots: a bought bonus is remembered so its 10 free spins can be summed against ×3 the price
  r := pg_temp.gc_patch('public.fo_buy(bigint,text)', 'return jsonb_build_object(''free_left'', 10, ''cost'', cost,',
    $a$insert into fo_buy_track (user_id, cost, won) values (u, cost, 0) on conflict (user_id) do update set cost = excluded.cost, won = 0;$a$);
  raise notice '%', r;
  r := pg_temp.gc_patch('public.fo_spin(bigint,text)', 'if v_pay > 0 then v_bal := apply_tx(u, ''fortune_slots'', ''payout'', v_pay, ''fopay:'' || s.id);',
    $a$if v_free and exists (select 1 from fo_buy_track where user_id = u) then
      update fo_buy_track set won = won + v_pay where user_id = u;
      if coalesce((select left_spins from sl_free where user_id = u), 0) = 0 then
        perform chat_sys('lobby', '🎁 ' || nm || ' קנה בונוס במכונת האטרף וזכה ב־₪' || to_char(t.won, 'FM999,999,999,999,999,999') || '!')
          from fo_buy_track t where t.user_id = u and t.won >= t.cost * 3;
        delete from fo_buy_track where user_id = u;
      end if;
    elsif v_pay >= p_line_bet * 5 * 200 then
      perform chat_sys('lobby', '🎰 ' || nm || ' זכה ב־₪' || to_char(v_pay, 'FM999,999,999,999,999,999') || ' במכונת האטרף!');
    end if;$a$);
  raise notice '%', r;
end $m$;
