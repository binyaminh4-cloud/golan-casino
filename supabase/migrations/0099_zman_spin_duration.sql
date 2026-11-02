-- Extend the shared spin phase; preserve the existing state machine.
create or replace function zlm_private.tick(wake boolean default false) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare ctl zlm_private.control; r zlm_private.rounds; t timestamptz:=clock_timestamp();
 k int; i int; j int; n int; v int; chosen int[]; arr int[]; vals int[]; deck int[];
 v_boosts jsonb; v_secret jsonb; pl zlm_private.players; b zlm_private.bets;
 wm int; v_profit int; pay bigint; ps text[]:=zlm_private.spots(); ball jsonb;
begin
 select * into ctl from zlm_private.control where id=1 for update;
 if wake then
  if ctl.viewed_at<t-interval '10 seconds' then update zlm_private.control set viewed_at=t where id=1; end if;
  ctl.viewed_at:=t;
 end if;
 if ctl.round_id is null then
  if not wake then return; end if;
  insert into zlm_private.rounds default values returning * into r;
  update zlm_private.control set round_id=r.id where id=1; return;
 end if;
 select * into r from zlm_private.rounds where id=ctl.round_id;
 for k in 1..12 loop
  if r.deadline>t then return; end if;
  case r.phase
  when 'betting' then
   v_boosts:='{}'; arr:=zlm_private.shuffle(array(select generate_series(1,54)));
   n:=3+public.rl_randint(8);
   for i in 1..n loop
    v:=zlm_private.weighted(array[2,3,5,10,20,50],array[35,25,18,12,7,3]);
    v_boosts:=v_boosts||jsonb_build_object(arr[i]::text,v);
   end loop;
   i:=1+public.rl_randint(54);
   -- Expose the landing cell only after bets are irrevocably locked, for a precise server-timed animation.
   update zlm_private.rounds set phase='spin',phase_at=r.deadline,deadline=r.deadline+interval '9 seconds',
    cell=i,spot=ps[i],boosts=v_boosts where id=r.id;
  when 'spin' then
   v_secret:='{}';
   insert into zlm_private.players(round_id,user_id)
    select r.id,user_id from zlm_private.bets where round_id=r.id and spot=r.spot and amount>0 on conflict do nothing;
   if r.spot='yoav' then
    vals:='{}';
    v:=zlm_private.weighted(array[2,3,4,5,6,8],array[45,25,15,8,5,2]); vals:=array[v];
    v:=zlm_private.weighted(array[4,5,6,7,8,9,10],array[35,25,15,10,8,4,3],vals); vals:=vals||v;
    v:=zlm_private.weighted(array[10,12,15,20,25,30,40,50],array[100,40,24,16,10,6,3,1],vals);
    v_secret:=jsonb_build_object('cups',zlm_private.shuffle(vals||v)); n:=15;
   elsif r.spot in ('range','vip') then
    -- Person index 1 is Binyamin and always pays 100. Only positions are shuffled.
    arr:=zlm_private.shuffle(array[0,1,2,3,4]);
    vals:=case when r.spot='range' then array[10,100,25,30,50] else array[10,100,20,25,50] end;
    chosen:='{}'; for i in 1..5 loop chosen:=chosen||vals[arr[i]+1]; end loop;
    v_secret:=jsonb_build_object('people',arr,'values',chosen); n:=case when r.spot='vip' then 15 else 10 end;
   elsif r.spot='balls' then
    deck:=array_fill(0,array[20]);
    for i in 1..3 loop deck:=deck||array_fill(i,array[27])||array_fill(i+3,array[3]); end loop;
    deck:=zlm_private.shuffle(deck); j:=0;
    for i in 1..110 loop if deck[i]=0 then j:=j+1; end if; n:=i; exit when j=4; end loop;
    v_secret:=jsonb_build_object('deck',deck[1:n]); n:=10;
   else n:=0;
   end if;
   update zlm_private.rounds set phase=case when n>0 then 'choice' else 'settle' end,
    phase_at=r.deadline,deadline=r.deadline+make_interval(secs=>n),secret=v_secret where id=r.id;
  when 'choice' then
   for pl in select * from zlm_private.players where round_id=r.id loop
    n:=case when r.spot='vip' then 3 else 1 end;
    arr:=zlm_private.shuffle(case when r.spot in ('range','vip') then array[0,1,2,3,4] else array[0,1,2] end);
    chosen:=pl.picks;
    foreach i in array arr loop
     exit when cardinality(chosen)>=n;
     if not i=any(chosen) then chosen:=chosen||i; end if;
    end loop;
    update zlm_private.players set picks=chosen where round_id=r.id and user_id=pl.user_id;
   end loop;
   if r.spot='balls' then
    update zlm_private.rounds set phase='balls',phase_at=r.deadline,deadline=r.deadline+interval '3 seconds' where id=r.id;
   else
    n:=case when r.spot='yoav' then (select max(x::int) from jsonb_array_elements_text(r.secret->'cups') x)/5.0*1000 else 1500 end;
    update zlm_private.rounds set phase='reveal',phase_at=r.deadline,deadline=r.deadline+n*interval '1 millisecond' where id=r.id;
   end if;
  when 'reveal' then
   for pl in select * from zlm_private.players where round_id=r.id loop
    v_profit:=0;
    foreach i in array pl.picks loop v_profit:=v_profit+(r.secret->(case when r.spot='yoav' then 'cups' else 'values' end)->>i)::int; end loop;
    update zlm_private.players set profit=v_profit where round_id=r.id and user_id=pl.user_id;
   end loop;
   if r.spot='range' and exists(select 1 from zlm_private.players where round_id=r.id and profit=30) then
    update zlm_private.rounds set phase='extra',phase_at=r.deadline,deadline=r.deadline+interval '5 seconds' where id=r.id;
   else update zlm_private.rounds set phase='settle',phase_at=r.deadline,deadline=r.deadline where id=r.id; end if;
  when 'extra' then
   for pl in select * from zlm_private.players where round_id=r.id and profit=30 loop
    i:=pl.extra;
    if i is null then
     arr:=zlm_private.shuffle(array[0,1,2,3,4]);
     foreach j in array arr loop if not j=any(pl.picks) then i:=j; exit; end if; end loop;
    end if;
    update zlm_private.players set extra=i where round_id=r.id and user_id=pl.user_id;
   end loop;
   update zlm_private.rounds set phase='extra_reveal',phase_at=r.deadline,deadline=r.deadline+interval '1.5 seconds' where id=r.id;
  when 'extra_reveal' then
   update zlm_private.players set profit=profit+(r.secret->'values'->>extra)::int where round_id=r.id and extra is not null;
   update zlm_private.rounds set phase='settle',phase_at=r.deadline,deadline=r.deadline where id=r.id;
  when 'balls' then
   select array_agg(x::int order by ord) into deck from jsonb_array_elements_text(r.secret->'deck') with ordinality a(x,ord);
   n:=least(cardinality(deck),floor(extract(epoch from t-r.phase_at)/3)::int);
   ball:=zlm_private.balls_result(deck,n);
   if n=cardinality(deck) then
    update zlm_private.players set profit=(ball->'values'->>picks[1])::int where round_id=r.id;
    update zlm_private.rounds set draws=n,phase='settle',deadline=r.phase_at+make_interval(secs=>3*n) where id=r.id;
   else update zlm_private.rounds set draws=n,deadline=r.phase_at+make_interval(secs=>3*(n+1)) where id=r.id; end if;
  when 'settle' then
   wm:=coalesce((r.boosts->>r.cell::text)::int,1);
   for b in select * from zlm_private.bets where round_id=r.id and not settled order by user_id,spot loop
    v_profit:=0;
    if b.spot=r.spot and b.amount>0 then
     if r.spot='one' then v_profit:=1;
     elsif left(r.spot,1) in ('f','i','b') and length(r.spot)=2 then v_profit:=case when left(r.spot,1)='b' then 42 else 25 end;
     else select p.profit into v_profit from zlm_private.players p where p.round_id=r.id and p.user_id=b.user_id; end if;
     pay:=b.amount*(1+v_profit::bigint*wm);
    else pay:=0; end if;
    if pay>0 then perform public.apply_tx(b.user_id,'zman_lamatvach','payout',pay,'zlmpay:'||r.id||':'||b.user_id||':'||b.spot); end if;
    update zlm_private.bets set payout=pay,settled=true where round_id=r.id and user_id=b.user_id and spot=b.spot;
   end loop;
   update zlm_private.rounds set phase='summary',phase_at=r.deadline,deadline=r.deadline+interval '8 seconds' where id=r.id;
  when 'summary' then
   if ctl.viewed_at<t-interval '60 seconds' then return; end if;
   insert into zlm_private.rounds default values returning * into r;
   update zlm_private.control set round_id=r.id where id=1; return;
  else raise exception 'invalid_phase';
  end case;
  select * into r from zlm_private.rounds where id=ctl.round_id;
 end loop;
end $$;
revoke all on function zlm_private.tick(boolean) from public,anon,authenticated;
select case when pg_get_functiondef('zlm_private.tick(boolean)'::regprocedure) like '%9 seconds%' then 'PASS: shared spin is 9 seconds' else 'FAIL' end as validation;
