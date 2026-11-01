-- Play money. New isolated game; no existing game definitions are replaced.
begin;
create schema if not exists zlm_private;
revoke all on schema zlm_private from public, anon, authenticated;
create table if not exists zlm_private.rounds (
 id uuid primary key default gen_random_uuid(),
 phase text not null default 'betting', phase_at timestamptz not null default clock_timestamp(),
 deadline timestamptz not null default clock_timestamp()+interval '20 seconds',
 cell int, spot text, boosts jsonb not null default '{}',
 secret jsonb not null default '{}', draws int not null default 0,
 created_at timestamptz not null default clock_timestamp()
);
create table if not exists zlm_private.control (
 id int primary key check(id=1), round_id uuid references zlm_private.rounds(id),
 viewed_at timestamptz not null default clock_timestamp()
);
insert into zlm_private.control(id) values(1) on conflict do nothing;
create table if not exists zlm_private.bets (
 round_id uuid not null references zlm_private.rounds(id), user_id uuid not null references public.profiles(id),
 spot text not null, amount bigint not null check(amount>=0), payout bigint not null default 0,
 settled boolean not null default false, primary key(round_id,user_id,spot)
);
create index if not exists zlm_bets_user on zlm_private.bets(user_id,round_id);
create table if not exists zlm_private.players (
 round_id uuid not null references zlm_private.rounds(id), user_id uuid not null references public.profiles(id),
 picks int[] not null default '{}', extra int, profit int not null default 0,
 primary key(round_id,user_id)
);
create table if not exists zlm_private.requests (
 user_id uuid not null references public.profiles(id), request_id uuid not null,
 round_id uuid not null references zlm_private.rounds(id), primary key(user_id,request_id)
);
-- Defence in depth, even though this schema is not exposed through the Data API.
alter table zlm_private.rounds enable row level security;
alter table zlm_private.control enable row level security;
alter table zlm_private.bets enable row level security;
alter table zlm_private.players enable row level security;
alter table zlm_private.requests enable row level security;
revoke all on all tables in schema zlm_private from public, anon, authenticated;

create or replace function zlm_private.spots() returns text[] language sql immutable set search_path=pg_catalog as $$
 select array['range','one','one','one','one','yoav','f3','f2','f1','f0','one','vip',
 'one','one','one','one','yoav','i3','i2','i1','i0','one','balls','one','one','one',
 'yoav','b3','b2','b1','b0','one','one','one','range','one','one','yoav',
 'f3','f2','f1','f0','one','one','yoav','i3','i2','i1','i0','one','one','yoav','one','one']::text[]
$$;
create or replace function zlm_private.shuffle(a int[]) returns int[] language plpgsql volatile set search_path=public,pg_temp as $$
declare i int; j int; t int;
begin
 for i in reverse cardinality(a)..2 loop
  j:=1+public.rl_randint(i); t:=a[i]; a[i]:=a[j]; a[j]:=t;
 end loop; return a;
end $$;
create or replace function zlm_private.weighted(vals int[], weights int[], excluded int[] default '{}') returns int
language plpgsql volatile set search_path=public,pg_temp as $$
declare i int; total int:=0; n int;
begin
 for i in 1..cardinality(vals) loop if not vals[i]=any(excluded) then total:=total+weights[i]; end if; end loop;
 n:=public.rl_randint(total);
 for i in 1..cardinality(vals) loop if not vals[i]=any(excluded) then
  n:=n-weights[i]; if n<0 then return vals[i]; end if;
 end if; end loop; raise exception 'invalid_weights';
end $$;
create or replace function zlm_private.balls_result(deck int[], count_drawn int) returns jsonb
language plpgsql immutable set search_path=pg_catalog as $$
declare pos int[]:=array[0,0,0]; ladder int[]:=array[5,10,15,20,30,50,75,100,150,250,500,1000];
 b int:=0; i int; v int; c int;
begin
 if count_drawn>0 then for i in 1..least(count_drawn,cardinality(deck)) loop
  v:=deck[i]; if v=0 then b:=b+1; else c:=(v-1)%3+1; pos[c]:=least(11,pos[c]+case when v>3 then 2 else 1 end); end if;
  if b=4 then exit; end if;
 end loop; end if;
 return jsonb_build_object('black',b,'levels',pos,'values',array[ladder[pos[1]+1],ladder[pos[2]+1],ladder[pos[3]+1]]);
end $$;

-- All mutations take the same control-row lock first: bets cannot race a deadline or settlement.
-- A private tick can be called by cron, including when every participant disconnects.
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
   update zlm_private.rounds set phase='spin',phase_at=r.deadline,deadline=r.deadline+interval '6 seconds',
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

-- Response deliberately whitelists public data. No hidden target, cup or future ball is sent.
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
  'bets',mine,'balance',(select balance::text from public.wallets where user_id=u),'bonus',bonus,
  'players',(select count(*) from zlm_private.players where round_id=r.id),'draws',r.draws,'last_result',last_result);
end $$;

create or replace function zlm_bet(p_round uuid,p_spot text,p_amount bigint,p_request uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); r zlm_private.rounds; b zlm_private.bets; v_balance bigint; reserved numeric;
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
 if p_amount>0 and (p_amount>v_balance or (v_balance::numeric+(reserved+p_amount)*50001)>9223372036854775807) then raise exception 'invalid_amount'; end if;
 insert into zlm_private.requests values(u,p_request,p_round);
 if p_amount=0 then
  for b in select * from zlm_private.bets where round_id=r.id and user_id=u and amount>0 and (spot=p_spot or p_spot='all') loop
   perform public.apply_tx(u,'zman_lamatvach','payout',b.amount,'zlmcancel:'||u||':'||p_request||':'||b.spot);
   update zlm_private.bets set amount=0 where round_id=r.id and user_id=u and spot=b.spot;
  end loop;
 else
  perform public.apply_tx(u,'zman_lamatvach','stake',-p_amount,'zlmstake:'||u||':'||p_request);
  insert into zlm_private.bets(round_id,user_id,spot,amount) values(r.id,u,p_spot,p_amount)
   on conflict(round_id,user_id,spot) do update set amount=zlm_private.bets.amount+excluded.amount;
 end if;
 return zlm_state();
end $$;

create or replace function zlm_choose(p_round uuid,p_pick int) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); r zlm_private.rounds; p zlm_private.players; n int;
begin
 if u is null then raise exception 'not_signed_in'; end if;
 perform zlm_private.tick(false);
 perform 1 from zlm_private.control where id=1 for update;
 select * into r from zlm_private.rounds where id=p_round;
 if not found or r.id<>(select round_id from zlm_private.control where id=1) or r.phase not in ('choice','extra') or clock_timestamp()>=r.deadline then raise exception 'choice_closed'; end if;
 select * into p from zlm_private.players where round_id=r.id and user_id=u;
 if not found then raise exception 'not_participant'; end if;
 n:=case when r.spot in ('range','vip') then 5 else 3 end;
 if p_pick is null or p_pick<0 or p_pick>=n then raise exception 'invalid_pick'; end if;
 if r.phase='extra' then
  if p.profit<>30 or p_pick=any(p.picks) then raise exception 'invalid_pick'; end if;
  if p.extra is null then update zlm_private.players set extra=p_pick where round_id=r.id and user_id=u; end if;
 elsif not p_pick=any(p.picks) and cardinality(p.picks)<(case when r.spot='vip' then 3 else 1 end) then
  update zlm_private.players set picks=picks||p_pick where round_id=r.id and user_id=u;
 end if;
 return zlm_state();
end $$;

create or replace function zlm_ready() returns int language plpgsql security definer set search_path=public,pg_temp as $$
begin if auth.uid() is null then raise exception 'not_signed_in'; end if; return 1; end $$;
revoke all on all functions in schema zlm_private from public,anon,authenticated;
revoke all on function zlm_state(),zlm_bet(uuid,text,bigint,uuid),zlm_choose(uuid,int),zlm_ready() from public,anon,authenticated;
grant execute on function zlm_state(),zlm_bet(uuid,text,bigint,uuid),zlm_choose(uuid,int),zlm_ready() to authenticated;
-- Existing project already uses pg_cron. Named schedule upserts safely on re-run.
select cron.schedule('golan-zman-lamatvach','3 seconds',$job$select zlm_private.tick(false);$job$);
commit;
