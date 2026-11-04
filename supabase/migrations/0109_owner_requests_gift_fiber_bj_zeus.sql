-- 0109 · Owner requests 2026-11-04:
--  1. טכנאי סיבים, extreme: ₪100M for a full shift (3 cabinets × ₪33,333,334).
--  2. Lightning ("הכפולות") blackjack fee 50% -> 20% of the main bet, normal table and the Fisher challenge (same function).
--     Multipliers left as they are, by the owner's choice (return to player is above 100% now).
--  3. Zeus duel: 5 live rounds instead of 10.
--  4. Daily login gift: personal streak. Day n (1..6) = n × ₪50M to the wallet; day 7 = ₪500M to the bank + ₪250M free chips
--     that can only be bet in זמן למטווח (spent before the wallet; winnings, stake included, go to the wallet).
--     A missed day restarts at day 1; after day 7 the next day is day 1 again. Days follow Israel time.
-- Re-runnable.
begin;
create or replace function fiber_rate(p_level int) returns bigint language sql immutable as $$ select (array[250000, 400000, 550000, 33333334])[p_level]::bigint $$;

create or replace function bj_deal(p_main bigint, p_pp bigint, p_t3 bigint, p_ll bigint, p_bust bigint, p_ref text, p_mode text default 'classic', p_run uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); cr ch_runs; v_id uuid; p text[]; d text[]; total bigint; up int; v_side jsonb := '{}'; v_fee bigint := 0; v_boost int := 0; v_cap bigint := 0;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select id into v_id from bj_rounds where ref = p_ref and user_id = u;
  if found then return bj_view(v_id); end if;                -- duplicate request
  if exists (select 1 from bj_rounds where user_id = u and status <> 'done') then raise exception 'round_in_progress'; end if;
  if p_main is null or p_main < 10 or p_main > gc_max_bet(u) then raise exception 'invalid_main_bet'; end if;
  if least(coalesce(p_pp,0), coalesce(p_t3,0), coalesce(p_ll,0), coalesce(p_bust,0)) < 0
     or greatest(coalesce(p_pp,0), coalesce(p_t3,0), coalesce(p_ll,0), coalesce(p_bust,0)) > p_main then raise exception 'invalid_side_bet'; end if;
  if p_mode not in ('classic', 'lightning') then raise exception 'invalid_mode'; end if;
  if p_mode = 'lightning' then
    if coalesce(p_pp,0) + coalesce(p_t3,0) + coalesce(p_ll,0) + coalesce(p_bust,0) > 0 then raise exception 'invalid_side_bet'; end if;
    v_fee := (p_main + 4) / 5;                                            -- Lightning fee = 20% of the main bet (owner, 2026-11)
  end if;
  if p_run is not null then                                 -- a challenge hand: chips come from the run, never the wallet
    select * into cr from ch_runs where id = p_run and user_id = u for update;
    if not found or cr.status <> 'playing' or cr.kind not in ('fisher', 'ido') then raise exception 'challenge_closed'; end if;
    if (cr.kind = 'fisher') <> (p_mode = 'lightning') then raise exception 'invalid_mode'; end if;
    if coalesce(p_pp,0) + coalesce(p_t3,0) + coalesce(p_ll,0) + coalesce(p_bust,0) > 0 then raise exception 'invalid_side_bet'; end if;
    perform set_config('gc.ch_run', p_run::text, true);
  end if;
  total := p_main + coalesce(p_pp,0) + coalesce(p_t3,0) + coalesce(p_ll,0) + coalesce(p_bust,0) + v_fee;
  perform bj_tx(u, case p_mode when 'lightning' then 'lightning_blackjack' else 'blackjack' end, 'stake', -total, 'bjstake:' || p_ref);

  if coalesce(p_pp,0) > 0 then v_side := v_side || jsonb_build_object('pp', p_pp); end if;
  if coalesce(p_t3,0) > 0 then v_side := v_side || jsonb_build_object('t3', p_t3); end if;
  if coalesce(p_ll,0) > 0 then v_side := v_side || jsonb_build_object('ll', p_ll); end if;
  if coalesce(p_bust,0) > 0 then v_side := v_side || jsonb_build_object('bust', p_bust); end if;

  p := array[bj_draw(u)]; d := array[bj_draw(u)]; p := p || bj_draw(u); d := d || bj_draw(u);
  insert into bj_rounds (user_id, ref, status, main_bet, side, hands, dealer, total_staked, mode, fee, strikes, ch_run)
    values (u, p_ref, 'playing', p_main, v_side,
            jsonb_build_array(jsonb_build_object('cards', to_jsonb(p), 'cards0', to_jsonb(p), 'bet', p_main,
              'done', bj_is_bj(p), 'surrendered', false, 'aces', false, 'split', false)),
            d, total, p_mode, v_fee, case when p_mode = 'lightning' then bj_strikes() else '{}'::jsonb end, p_run)
    returning id into v_id;

  up := bj_val(d[1]);
  if up = 11 and not bj_is_bj(p) then
    update bj_rounds set status = 'insurance' where id = v_id;
  elsif bj_is_bj(p) or ((up = 10 or up = 11) and bj_is_bj(d)) then
    perform bj_finish(v_id);                                  -- blackjack or dealer peek
  end if;
  return bj_view(v_id);
end $$;

create or replace function zeus_rounds() returns int language sql immutable as $$ select 5 $$;

-- ---------- free chips for זמן למטווח ----------
create table if not exists zlm_private.free_chips(user_id uuid primary key references auth.users(id) on delete cascade, amount bigint not null default 0 check(amount>=0));
alter table zlm_private.free_chips enable row level security;
revoke all on zlm_private.free_chips from public,anon,authenticated;
alter table zlm_private.bets add column if not exists free_amount bigint not null default 0;

create or replace function zlm_state() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); r zlm_private.rounds; p zlm_private.players; mine jsonb; bonus jsonb:='{}';
 targets jsonb:='[]'; obj jsonb; i int; opened boolean; deck int[]; ball jsonb; last_result jsonb;
begin
 if u is null then raise exception 'not_signed_in'; end if;
 perform zlm_private.tick(true);
 select r1.* into r from zlm_private.rounds r1 join zlm_private.control c on c.round_id=r1.id where c.id=1;
 select * into p from zlm_private.players where round_id=r.id and user_id=u;
 select coalesce(jsonb_object_agg(spot,amount::text),'{}') into mine from zlm_private.bets where round_id=r.id and user_id=u and amount>0;
 if r.phase not in ('betting','spin') then
  bonus:=jsonb_build_object('picks',coalesce(p.picks,'{}'::int[]),'extra',p.extra,'eligible',p.user_id is not null,'profit',coalesce(p.profit,0));
  if r.spot='yoav' and r.phase<>'choice' then bonus:=bonus||jsonb_build_object('cups',r.secret->'cups'); end if;
  if r.spot in ('range','vip') then
   for i in 0..4 loop
    opened:=r.phase='summary' or (i=any(p.picks) and r.phase in ('extra','extra_reveal','settle')) or (i=p.extra and r.phase='settle');
    obj:=jsonb_build_object('index',i,'open',coalesce(opened,false));
    if opened then obj:=obj||jsonb_build_object('person',r.secret->'people'->i,'value',r.secret->'values'->i); end if;
    targets:=targets||jsonb_build_array(obj);
   end loop;
   bonus:=bonus||jsonb_build_object('targets',targets);
  end if;
  if r.spot='balls' then
   select coalesce(array_agg(x::int order by ord),'{}') into deck from jsonb_array_elements_text(r.secret->'deck') with ordinality a(x,ord) where ord<=r.draws;
   ball:=zlm_private.balls_result(deck,cardinality(deck));
   bonus:=bonus||ball||jsonb_build_object('events',coalesce(to_jsonb(deck),'[]'),'next_event',r.draws+1);
  end if;
 end if;
 select jsonb_build_object('round',b.round_id,'stake',sum(b.amount)::text,'payout',sum(b.payout)::text) into last_result
 from zlm_private.bets b join zlm_private.rounds h on h.id=b.round_id
 where b.user_id=u and h.phase='summary' group by b.round_id,h.created_at order by h.created_at desc limit 1;
 return jsonb_build_object('id',r.id,'phase',r.phase,'phase_at',r.phase_at,'deadline',r.deadline,'server_time',clock_timestamp(),
  'cell',case when r.phase<>'betting' then r.cell end,
  'spot',case when r.phase<>'betting' then r.spot end,
  'boosts',case when r.phase<>'betting' then r.boosts else '{}'::jsonb end,
  'bets',mine,'balance',(select balance::text from public.wallets where user_id=u),'free_chips',coalesce((select amount from zlm_private.free_chips where user_id=u),0)::text,'bonus',bonus,
  'players',(select count(*) from zlm_private.players where round_id=r.id),'draws',r.draws,'last_result',last_result);
end $$;

create or replace function zlm_bet(p_round uuid,p_spot text,p_amount bigint,p_request uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); r zlm_private.rounds; b zlm_private.bets; v_balance bigint; reserved numeric; v_free bigint:=0; f bigint:=0;
begin
 if u is null then raise exception 'not_signed_in'; end if;
 perform zlm_private.tick(false);
 perform 1 from zlm_private.control where id=1 for update;
 if exists(select 1 from zlm_private.requests where user_id=u and request_id=p_request) then return zlm_state(); end if;
 select * into r from zlm_private.rounds where id=p_round;
 if not found or r.id<>(select round_id from zlm_private.control where id=1) or r.phase<>'betting' or clock_timestamp()>=r.deadline then raise exception 'betting_closed'; end if;
 if p_amount is null or p_request is null or p_spot is null or p_amount<0 or not (p_spot=any(zlm_private.spots()) or (p_spot='all' and p_amount=0)) then raise exception 'invalid_bet'; end if;
 -- A 50,001x total is possible. Reject only values that cannot be represented by the existing bigint wallet.
 select balance into v_balance from public.wallets where user_id=u for update;
 select coalesce(sum(amount),0) into reserved from zlm_private.bets where round_id=r.id and user_id=u;
 select coalesce(amount,0) into v_free from zlm_private.free_chips where user_id=u for update; v_free:=coalesce(v_free,0);
 if p_amount>0 and (p_amount>v_balance+v_free or (v_balance::numeric+(reserved+p_amount)*50001)>9223372036854775807) then raise exception 'invalid_amount'; end if;
 insert into zlm_private.requests values(u,p_request,p_round);
 if p_amount=0 then
  for b in select * from zlm_private.bets where round_id=r.id and user_id=u and amount>0 and (spot=p_spot or p_spot='all') loop
   -- free chips go back to the free-chip balance, the rest to the wallet
   if b.amount-b.free_amount>0 then perform public.apply_tx(u,'zman_lamatvach','payout',b.amount-b.free_amount,'zlmcancel:'||u||':'||p_request||':'||b.spot); end if;
   if b.free_amount>0 then update zlm_private.free_chips set amount=amount+b.free_amount where user_id=u; end if;
   update zlm_private.bets set amount=0,free_amount=0 where round_id=r.id and user_id=u and spot=b.spot;
  end loop;
 else
  -- free chips (daily-gift streak) are spent first, then the wallet
  f:=least(v_free,p_amount);
  if f>0 then update zlm_private.free_chips set amount=amount-f where user_id=u; end if;
  if p_amount-f>0 then perform public.apply_tx(u,'zman_lamatvach','stake',-(p_amount-f),'zlmstake:'||u||':'||p_request); end if;
  insert into zlm_private.bets(round_id,user_id,spot,amount,free_amount) values(r.id,u,p_spot,p_amount,f)
   on conflict(round_id,user_id,spot) do update set amount=zlm_private.bets.amount+excluded.amount,free_amount=zlm_private.bets.free_amount+excluded.free_amount;
 end if;
 return zlm_state();
end $$;

create or replace function zlm_bet_batch(p_round uuid,p_layout jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); r zlm_private.rounds; x record; total numeric:=0;
 v_balance bigint; reserved numeric; n bigint; v_free bigint:=0; f bigint:=0; left_ numeric;
begin
 if u is null then raise exception 'not_signed_in'; end if;
 perform zlm_private.tick(false);
 perform 1 from zlm_private.control where id=1 for update;
 if exists(select 1 from zlm_private.requests where user_id=u and request_id=p_request) then return zlm_state(); end if;
 select * into r from zlm_private.rounds where id=p_round;
 if not found or r.id<>(select round_id from zlm_private.control where id=1) or r.phase<>'betting' or clock_timestamp()>=r.deadline then raise exception 'betting_closed'; end if;
 if p_request is null or p_layout is null or jsonb_typeof(p_layout)<>'object' or p_layout='{}'::jsonb then raise exception 'invalid_bet'; end if;
 for x in select * from jsonb_each_text(p_layout) loop
  if not x.key=any(zlm_private.spots()) or x.value is null or x.value!~'^[1-9][0-9]{0,18}$' then raise exception 'invalid_bet'; end if;
  total:=total+x.value::numeric;
 end loop;
 select balance into v_balance from public.wallets where user_id=u for update;
 if not found then raise exception 'wallet_not_found'; end if;
 select coalesce(sum(amount),0) into reserved from zlm_private.bets where round_id=r.id and user_id=u;
 select coalesce(amount,0) into v_free from zlm_private.free_chips where user_id=u for update; v_free:=coalesce(v_free,0);
 if total>v_balance+v_free or v_balance::numeric+(reserved+total)*50001>9223372036854775807 then raise exception 'invalid_amount'; end if;
 insert into zlm_private.requests values(u,p_request,p_round);
 -- free chips (daily-gift streak) are spent first, then the wallet
 left_:=least(v_free::numeric,total);
 if left_>0 then update zlm_private.free_chips set amount=amount-left_::bigint where user_id=u; end if;
 if total-left_>0 then perform public.apply_tx(u,'zman_lamatvach','stake',-(total-left_)::bigint,'zlmbatch:'||u||':'||p_request); end if;
 for x in select * from jsonb_each_text(p_layout) loop
  n:=x.value::bigint; f:=least(left_,n::numeric)::bigint; left_:=left_-f;
  insert into zlm_private.bets(round_id,user_id,spot,amount,free_amount) values(r.id,u,x.key,n,f)
   on conflict(round_id,user_id,spot) do update set amount=zlm_private.bets.amount+excluded.amount,free_amount=zlm_private.bets.free_amount+excluded.free_amount;
 end loop;
 return zlm_state();
end $$;

-- ---------- daily login gift ----------
create table if not exists public.gc_daily_gift(user_id uuid primary key references auth.users(id) on delete cascade, streak int not null default 0, last_day date);
alter table public.gc_daily_gift enable row level security;
revoke all on public.gc_daily_gift from public,anon,authenticated;

create or replace function gc_gift_state() returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); g gc_daily_gift; today date:=(now() at time zone 'Asia/Jerusalem')::date; nxt int;
begin
 if u is null then raise exception 'not_signed_in'; end if;
 select * into g from gc_daily_gift where user_id=u;
 nxt:=case when g.last_day=today then g.streak when g.last_day=today-1 and g.streak<7 then g.streak+1 else 1 end;
 return jsonb_build_object('claimable',coalesce(g.last_day,date '2000-01-01')<today,'day',nxt,'streak',coalesce(g.streak,0),
  'wallet',case when nxt<7 then nxt*50000000 else 0 end,'bank',case when nxt=7 then 500000000 else 0 end,'zman_chips',case when nxt=7 then 250000000 else 0 end);
end $$;

create or replace function gc_gift_claim() returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); g gc_daily_gift; today date:=(now() at time zone 'Asia/Jerusalem')::date; d int; ref text;
begin
 if u is null then raise exception 'not_signed_in'; end if;
 insert into gc_daily_gift(user_id) values(u) on conflict do nothing;
 select * into g from gc_daily_gift where user_id=u for update;
 if g.last_day=today then raise exception 'already_claimed'; end if;
 d:=case when g.last_day=today-1 and g.streak<7 then g.streak+1 else 1 end;
 ref:='gift:'||u||':'||today;
 if d<7 then perform apply_tx(u,'daily_gift','grant',d*50000000::bigint,ref);
 else
  perform bank_add(u,'gift',500000000,ref||':bank');
  insert into zlm_private.free_chips(user_id,amount) values(u,250000000) on conflict(user_id) do update set amount=zlm_private.free_chips.amount+250000000;
 end if;
 update gc_daily_gift set streak=d,last_day=today where user_id=u;
 return jsonb_build_object('day',d,'wallet',case when d<7 then d*50000000 else 0 end,'bank',case when d=7 then 500000000 else 0 end,'zman_chips',case when d=7 then 250000000 else 0 end,
  'balance',(select balance from wallets where user_id=u));
end $$;
revoke all on function gc_gift_state(),gc_gift_claim() from public,anon;
grant execute on function gc_gift_state(),gc_gift_claim() to authenticated;
commit;
