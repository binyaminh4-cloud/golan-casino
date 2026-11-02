-- Golan Exchange. Play money. Approved rules are documented in docs/exchange-rules.md.
-- Isolated tables and RPCs; no existing game or bank function is replaced.
begin;
create schema if not exists gx;
revoke all on schema gx from public,anon,authenticated;
create table if not exists gx.control(id int primary key check(id=1),launch_day date not null,last_day date not null,bank_start_id bigint not null,started_at timestamptz not null);
-- A consistent activation snapshot; no bank hooks or existing bank definitions change.
lock table public.bank_tx in share mode;
insert into gx.control values(1,(now() at time zone 'Asia/Jerusalem')::date,(now() at time zone 'Asia/Jerusalem')::date-1,(select coalesce(max(id),0) from public.bank_tx),clock_timestamp()) on conflict do nothing;
create table if not exists gx.markets(
 code text primary key,name text not null,tagline text not null default '',kind text not null check(kind in('daily','long')),
 icon text not null,risk text not null,noise numeric not null default 0,viewed_at timestamptz);
insert into gx.markets(code,name,tagline,kind,icon,risk,noise) values
 ('house','הבנק של הבית','','long','house','נמוכה יחסית',0),
 ('fisher','מדד הבנקים של פישר','','long','fisher','ללא תקרת תנודתיות',0),
 ('fish','חוות הדגים של עידו','','long','fish','גבוהה',0),
 ('protein','אבקות החלבון של אביחי','','long','protein','גבוהה',0),
 ('smoke','המעשנה של רועי','','long','smokehouse','גבוהה',0),
 ('BNYM','בנימין אחזקות','בעל הבית תמיד בפנים','daily','house','גבוהה מאוד',0.00002),
 ('FSHR','פישר בלי סטופ','המשקיע השקט','daily','fisher','גבוהה מאוד',0.00003),
 ('IDO','עידו דגים ונכסים','אין דגים בים','daily','fish','גבוהה מאוד',0.00004),
 ('MASS','אביחי מסה בע״מ','בירידה? זו תקופת חיטוב','daily','protein','גבוהה מאוד',0.00005)
on conflict(code) do nothing;
create table if not exists gx.quotes(
 code text references gx.markets,scope uuid not null default '00000000-0000-0000-0000-000000000000',
 price numeric not null check(price>=0),previous numeric not null check(previous>=0),at timestamptz not null,
 effective_at timestamptz not null,primary key(code,scope));
create table if not exists gx.bars(
 code text not null,scope uuid not null,bucket timestamptz not null,
 open numeric not null,high numeric not null,low numeric not null,close numeric not null,
 samples int not null default 1,primary key(code,scope,bucket));
create table if not exists gx.positions(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),
 request uuid not null,code text not null references gx.markets,scope uuid not null,
 direction int not null check(direction in(-1,1)),stake bigint not null check(stake>0),
 leverage int not null check(leverage between 1 and 1000),days int not null check(days between 1 and 14),
 entry numeric not null check(entry>0),opened_at timestamptz not null,expires_at timestamptz not null,
 status text not null default 'open' check(status in('open','awaiting_credit','closed')),
 exit numeric,payout numeric,reason text,closed_at timestamptz,credited_at timestamptz,
 unique(user_id,request));
create index if not exists gx_open on gx.positions(code,scope,expires_at) where status='open';
create index if not exists gx_owner on gx.positions(user_id,opened_at desc);
create table if not exists gx.settlements(
 source text not null,ref text not null,user_id uuid not null,category text not null,
 stake numeric not null check(stake>=0),payout numeric not null check(payout>=0),
 at timestamptz not null default clock_timestamp(),primary key(source,ref));
create index if not exists gx_settled_day on gx.settlements(at,category);
create table if not exists gx.settlement_days(source text not null,ref text not null,day date not null,primary key(source,ref));
create index if not exists gx_settlement_allocation on gx.settlement_days(day);
-- Unitised member funds: transfers issue/redeem units without changing NAV.
-- Initial notional weighting is fixed; new members only enter paired complete days.
create table if not exists gx.funds(
 user_id uuid primary key,wealth numeric not null,units numeric not null,nav numeric not null,
 basis numeric not null,epoch timestamptz not null,touched timestamptz not null);
create table if not exists gx.fund_days(
 user_id uuid not null,day date not null,area numeric not null default 0,
 epoch timestamptz not null,primary key(user_id,day));
create table if not exists gx.daily_runs(day date primary key,published_at timestamptz not null);
create table if not exists gx.applied_bank(tx_id bigint primary key);

-- Extend the existing closed vocabulary; all movements still go through bank_add.
alter table public.bank_tx drop constraint if exists bank_tx_kind_check;
alter table public.bank_tx add constraint bank_tx_kind_check check(kind in(
 'salary_weekly','salary_monthly','gift','deposit','withdraw','job','levelup',
 'loan_in','loan_repay','loan_out','loan_back','loan_cancel','exchange_lock','exchange_return'));

create or replace function gx.value(stake numeric,lev int,direction int,entry numeric,price numeric)
returns numeric language sql immutable strict set search_path=pg_catalog as $$
 select floor(greatest(0,stake*(1+direction::numeric*lev*(price/entry-1)))) $$;

create or replace function gx.fund_touch(u uuid,t timestamptz) returns void
language plpgsql set search_path=gx,public,pg_temp as $$
declare f gx.funds; a timestamptz; b timestamptz; d date;
begin
 select * into f from gx.funds where user_id=u for update;if not found then return;end if;
 if t<=f.touched then return;end if;
 a:=f.touched;
 while a<t loop
  d:=(a at time zone 'Asia/Jerusalem')::date;
  b:=least(t,((d+1)::timestamp at time zone 'Asia/Jerusalem'));
  insert into gx.fund_days(user_id,day,area,epoch) values(u,d,extract(epoch from b-a)*f.basis*f.nav/100,f.epoch)
  on conflict(user_id,day) do update set area=gx.fund_days.area+excluded.area,epoch=greatest(gx.fund_days.epoch,excluded.epoch);
  a:=b;
 end loop;
 update gx.funds set touched=t where user_id=u;
end $$;

create or replace function gx.bank_event(tx public.bank_tx) returns void
language plpgsql set search_path=gx,public,pg_temp as $$
declare f gx.funds; t timestamptz; delta numeric:=tx.amount; ext boolean; principal numeric;
begin
 if exists(select 1 from gx.applied_bank where tx_id=tx.id) then return;end if;
 insert into gx.funds values(tx.user_id,0,0,100,0,tx.created_at,tx.created_at) on conflict do nothing;
 select * into f from gx.funds where user_id=tx.user_id for update;
 -- Late-committed ledger records affect the next observation, never rewrite a published index.
 t:=greatest(tx.created_at,f.touched);perform gx.fund_touch(tx.user_id,t);
 insert into gx.applied_bank values(tx.id);
 if tx.kind='exchange_lock' then return;end if;
 if tx.kind='exchange_return' then
  select stake into principal from gx.positions where 'gx:return:'||id=tx.ref;
  if principal is null then raise exception 'exchange_return_missing_position';end if;
  delta:=delta-principal;
 end if;
 ext:=tx.kind in('deposit','withdraw','loan_in','loan_out','loan_cancel','loan_repay','loan_back');
 if f.wealth+delta<0 then raise exception 'exchange_fund_inconsistent';end if;
 if f.basis=0 or f.nav=0 and f.wealth+delta>0 then
  f.wealth:=f.wealth+delta;f.nav:=100;f.units:=f.wealth/100;f.basis:=f.wealth;f.epoch:=t;
 elsif ext then
  f.wealth:=f.wealth+delta;f.units:=case when f.nav>0 then f.wealth/f.nav else 0 end;
 else
  f.wealth:=f.wealth+delta;
  if f.units>0 then f.nav:=f.wealth/f.units;
  elsif f.wealth>0 then f.nav:=100;f.units:=f.wealth/100;f.basis:=f.wealth;f.epoch:=t;end if;
 end if;
 update gx.funds set wealth=f.wealth,units=f.units,nav=f.nav,basis=f.basis,epoch=f.epoch where user_id=tx.user_id;
end $$;
insert into gx.funds select user_id,balance,balance::numeric/100,100,balance,clock_timestamp(),clock_timestamp() from public.bank_accounts on conflict do nothing;

-- Only terminal records enter this feed. The unique key prevents double counting.
create or replace function gx.game_feed() returns trigger
language plpgsql security definer set search_path=gx,public,pg_temp as $$
declare j jsonb:=to_jsonb(new);done boolean;stake numeric;pay numeric;ref text;category text:=tg_argv[0];
begin
 done:=case tg_argv[3]
  when 'always' then true when 'settled' then (j->>'settled')::boolean
  when 'bj' then j->>'status'='done' when 'dp' then j->>'status'='done'
  when 'round' then j->>'status'='settled'
  when 'pm' then j->>'phase' in('busted','cashed','finished')
  when 'run' then j->>'status' in('lost','cashed','won') else false end;
 if not coalesce(done,false) then return new;end if;
 if public.gc_is_test((j->>'user_id')::uuid) then return new;end if;
 stake:=case when tg_argv[1]='dp' then (j->>'ante')::numeric+(j->>'blind')::numeric+(j->>'side')::numeric+(j->>'play')::numeric else (j->>tg_argv[1])::numeric end;
 pay:=case when tg_argv[2]='dp' then (j->'result'->>'pay')::numeric else (j->>tg_argv[2])::numeric end;
 ref:=coalesce(j->>'id',(j->>'round_id')||':'||(j->>'user_id')||':'||(j->>'spot'));
 if stake is null or pay is null or ref is null then raise exception 'exchange_invalid_settlement_source: %',tg_table_name;end if;
 insert into gx.settlements(source,ref,user_id,category,stake,payout)
 values(tg_table_schema||'.'||tg_table_name,ref,(j->>'user_id')::uuid,category,stake,pay) on conflict do nothing;
 return new;
end $$;
-- No historical backfill: the index starts at 100, and history grows from activation.
do $setup$
declare c record;table_name text;
begin
 for c in select * from (values
 ('public.rl_spins','smoke','total','payout','always'),('public.rl_live_bets','smoke','total','payout','settled'),
 ('public.if_bets','fish','total','payout','settled'),('public.pm_runs','protein','stake','paid','pm'),
 ('public.bj_rounds','other','total_staked','payout','bj'),('public.dp_hands','other','dp','dp','dp'),
 ('public.sl_spins','other','total','payout','always'),('public.pc_spins','other','stake','payout','always'),
 ('public.kin_spins','other','stake','payout','always'),('public.ww_spins','other','stake','payout','always'),
 ('public.dg_spins','other','stake','payout','always'),('public.ck_runs','other','stake','paid','run'),
 ('public.f90_runs','other','stake','paid','run'),('public.game_rounds','other','stake','payout','round'),
 ('zlm_private.bets','other','amount','payout','settled')
 ) v(tab,category,stake,pay,done) loop
  if to_regclass(c.tab) is null then raise exception 'exchange_missing_source: %',c.tab;end if;
  execute format('drop trigger if exists gx_game_feed on %s',c.tab);
  execute format('create trigger gx_game_feed after insert or update on %s for each row execute function gx.game_feed(%L,%L,%L,%L)',c.tab,c.category,c.stake,c.pay,c.done);
 end loop;
end $setup$;

-- Cash poker against house bots: count finished hands, not buy-in/cash-out transfers.
create or replace function gx.poker_feed() returns trigger language plpgsql security definer set search_path=gx,public,pg_temp as $$
declare p record;u uuid;
begin
 if new.street<>'done' or new.result is null or not exists(select 1 from public.poker_bots where table_id=new.table_id)
 or exists(select 1 from public.poker_tables where id=new.table_id and tourney is not null) then return new;end if;
 for p in select key,value from jsonb_each(new.players) loop
  u:=(p.value->>'user')::uuid;
  if exists(select 1 from public.profiles where id=u) and not public.gc_is_test(u) then
   insert into gx.settlements(source,ref,user_id,category,stake,payout) values('poker_bots',new.table_id||':'||new.hand_no||':'||u,u,'other',
    coalesce((p.value->>'committed')::numeric,0),coalesce((new.result->'won'->>p.key)::numeric,0)) on conflict do nothing;
  end if;
 end loop;return new;
end $$;
drop trigger if exists gx_poker_feed on public.poker_hands;
create trigger gx_poker_feed after insert or update on public.poker_hands for each row execute function gx.poker_feed();

create or replace function gx.credit(p uuid) returns void language plpgsql set search_path=gx,public,pg_temp as $$
declare r gx.positions;b numeric;
begin
 select * into r from gx.positions where id=p for update;
 if r.status<>'awaiting_credit' then return;end if;
 perform pg_advisory_xact_lock(hashtext('bank:'||r.user_id));
 select balance into b from public.bank_accounts where user_id=r.user_id for update;
 if r.payout>9223372036854775807::numeric-coalesce(b,0) then return;end if;
 perform public.bank_add(r.user_id,'exchange_return',r.payout::bigint,'gx:return:'||r.id);
 update gx.positions set status='closed',credited_at=clock_timestamp() where id=p;
end $$;

create or replace function gx.finish(p uuid,price numeric,why text) returns void language plpgsql set search_path=gx,public,pg_temp as $$
declare r gx.positions;
begin
 select * into r from gx.positions where id=p for update;if r.status<>'open' then return;end if;
 update gx.positions set exit=price,payout=gx.value(r.stake,r.leverage,r.direction,r.entry,price),
 reason=why,closed_at=clock_timestamp(),status='awaiting_credit' where id=p;
 perform gx.credit(p);
end $$;

create or replace function gx.publish(c text,u uuid,p numeric,t timestamptz,effective timestamptz) returns void
language plpgsql set search_path=gx,public,pg_temp as $$
declare prev numeric;r record;bar_at timestamptz;
begin
 select price into prev from gx.quotes where code=c and scope=u;
 insert into gx.quotes values(c,u,p,coalesce(prev,p),t,effective)
 on conflict(code,scope) do update set price=excluded.price,previous=excluded.previous,at=excluded.at,effective_at=excluded.effective_at;
 bar_at:=case when (select kind from gx.markets where code=c)='daily' then date_trunc('minute',t) else t end;
 insert into gx.bars values(c,u,bar_at,p,p,p,p,1) on conflict(code,scope,bucket)
 do update set high=greatest(gx.bars.high,p),low=least(gx.bars.low,p),close=p,samples=gx.bars.samples+1;
 for r in select * from gx.positions where code=c and scope=u and status='open' order by user_id,id for update loop
  if 1+r.direction::numeric*r.leverage*(p/r.entry-1)<=0 then perform gx.finish(r.id,p,'liquidated');
  elsif r.expires_at<=effective then perform gx.finish(r.id,p,'expired');end if;
 end loop;
end $$;

create or replace function gx.daily(d date) returns void language plpgsql set search_path=gx,public,pg_temp as $$
declare m record;q record;u record;tx public.bank_tx;stake numeric;pay numeric;factor numeric;den numeric;num numeric;
 t timestamptz:=clock_timestamp();effective timestamptz:=(d+1+time '00:05') at time zone 'Asia/Jerusalem';
 zero uuid:='00000000-0000-0000-0000-000000000000';
begin
 if exists(select 1 from gx.daily_runs where day=d) then return;end if;
 -- A transaction committed after its day's publication contributes to the next
 -- valuation; it is never silently lost or used to rewrite a published price.
 insert into gx.settlement_days select s.source,s.ref,d from gx.settlements s
 where s.at<((d+1)::timestamp at time zone 'Asia/Jerusalem') and not exists(select 1 from gx.settlement_days a where a.source=s.source and a.ref=s.ref) on conflict do nothing;
 for tx in select b.* from public.bank_tx b where b.id>(select bank_start_id from gx.control where id=1)
 and b.created_at<((d+1)::timestamp at time zone 'Asia/Jerusalem') and not exists(select 1 from gx.applied_bank a where a.tx_id=b.id) order by b.created_at,b.id loop
  perform gx.bank_event(tx);
 end loop;
 for u in select user_id from gx.funds order by user_id loop perform gx.fund_touch(u.user_id,((d+1)::timestamp at time zone 'Asia/Jerusalem'));end loop;
 for m in select * from gx.markets where kind='long' and code<>'fisher' loop
  select coalesce(sum(s.stake),0),coalesce(sum(s.payout),0) into stake,pay from gx.settlements s join gx.settlement_days a on a.source=s.source and a.ref=s.ref
   where a.day=d
   and (m.code='house' or s.category=m.code);
  factor:=case when stake+pay=0 then 1 else 1+(case when m.code='house' then .2 else 1 end)*(stake-pay)/(stake+pay) end;
  select * into q from gx.quotes where code=m.code and scope=zero;
  perform gx.publish(m.code,zero,round(q.price*factor,12),t,effective);
 end loop;
 -- Same-member paired daily averages; own account is excluded before aggregation.
 for u in select p.id from public.profiles p where not public.gc_is_test(p.id) order by p.id loop
  select sum(a.area/extract(epoch from ((d+1)::timestamp at time zone 'Asia/Jerusalem')-(d::timestamp at time zone 'Asia/Jerusalem'))),
   sum(b.area/extract(epoch from (d::timestamp at time zone 'Asia/Jerusalem')-((d-1)::timestamp at time zone 'Asia/Jerusalem')))
   into num,den from gx.fund_days a join gx.fund_days b on a.user_id=b.user_id and b.day=d-1
   join public.profiles member on member.id=a.user_id
   where a.day=d and a.user_id<>u.id and not public.gc_is_test(a.user_id)
    and a.epoch=b.epoch and a.epoch<=((d-1)::timestamp at time zone 'Asia/Jerusalem');
  if not exists(select 1 from gx.quotes where code='fisher' and scope=u.id) then
   perform gx.publish('fisher',u.id,100,t,effective);
  else
   select * into q from gx.quotes where code='fisher' and scope=u.id;
   perform gx.publish('fisher',u.id,case when coalesce(den,0)>0 then round(q.price*num/den,12) else q.price end,t,effective);
  end if;
 end loop;
 insert into gx.daily_runs values(d,t);update gx.control set last_day=d where id=1;
end $$;

create or replace function gx.tick() returns void language plpgsql security definer set search_path=gx,public,pg_temp as $$
declare m record;q record;c gx.control;d date;t timestamptz:=clock_timestamp();p numeric;r record;processed int:=0;
 zero uuid:='00000000-0000-0000-0000-000000000000';
begin
 if not pg_try_advisory_xact_lock(hashtext('golan_exchange')) then return;end if;
 select * into c from gx.control where id=1;
 d:=c.last_day+1;
 while ((d+1+time '00:05') at time zone 'Asia/Jerusalem')<=t and processed<7 loop perform gx.daily(d);d:=d+1;processed:=processed+1;end loop;
 for m in select * from gx.markets where kind='daily' and (viewed_at>t-interval '60 seconds' or exists(select 1 from gx.positions p where p.code=gx.markets.code and p.status='open')) order by code loop
  select * into q from gx.quotes where code=m.code and scope=zero for update;
  if date_trunc('second',q.at)>=date_trunc('second',t) then continue;end if;
  -- Independent symmetric increments, chosen once per wall-clock second, never from player positions.
  p:=round(q.price*(1+m.noise*(public.rl_randint(2000001)-1000000)::numeric/1000000),12);
  perform gx.publish(m.code,zero,p,t,t);
 end loop;
 for r in select id from gx.positions where status='awaiting_credit' order by user_id,id loop perform gx.credit(r.id);end loop;
end $$;

-- Shared quotes begin here, with no invented pre-launch candles.
do $$ declare m record;begin
 for m in select code from gx.markets where code<>'fisher' loop
  if not exists(select 1 from gx.quotes where code=m.code) then
   perform gx.publish(m.code,'00000000-0000-0000-0000-000000000000',100,clock_timestamp(),clock_timestamp());
  end if;
 end loop;
end $$;

create or replace function public.exchange_state(p_code text default null,p_hours int default 24) returns jsonb
language plpgsql security definer set search_path=gx,public,pg_temp as $$
declare u uuid:=auth.uid();zero uuid:='00000000-0000-0000-0000-000000000000';out_ jsonb;scope_ uuid;
begin
 if u is null then raise exception 'not_signed_in';end if;
 if p_hours is null or p_hours not between 0 and 336 then raise exception 'invalid_period';end if;
 update gx.markets set viewed_at=clock_timestamp() where kind='daily';perform gx.tick();
 if not exists(select 1 from gx.quotes where code='fisher' and scope=u) then perform gx.publish('fisher',u,100,clock_timestamp(),clock_timestamp());end if;
 select jsonb_build_object('server_time',clock_timestamp(),'bank',coalesce((select balance::text from public.bank_accounts where user_id=u),'0'),
 'markets',(select jsonb_agg(jsonb_build_object('code',m.code,'name',m.name,'tagline',m.tagline,'kind',m.kind,'icon',m.icon,'risk',m.risk,
 'price',q.price::text,'previous',q.previous::text,'at',q.at,
 'history',coalesce((select jsonb_agg(jsonb_build_object('at',b.bucket,'price',b.close::text) order by b.bucket) from (select bucket,close from gx.bars where code=m.code and scope=q.scope and p_hours>0 order by bucket desc limit 32)b),'[]'::jsonb)) order by m.kind desc,m.code)
 from gx.markets m join gx.quotes q on q.code=m.code and q.scope=case when m.code='fisher' then u else zero end),
 'positions',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'code',p.code,'name',m.name,'kind',m.kind,'direction',p.direction,'stake',p.stake::text,
 'leverage',p.leverage,'entry',p.entry::text,'last',q.price::text,'value',gx.value(p.stake,p.leverage,p.direction,p.entry,q.price)::text,
 'opened_at',p.opened_at,'expires_at',p.expires_at,'status',p.status,'exit',p.exit::text,'payout',p.payout::text,'reason',p.reason,'closed_at',p.closed_at) order by p.opened_at desc)
 from gx.positions p join gx.markets m on m.code=p.code join gx.quotes q on q.code=p.code and q.scope=p.scope
 where p.user_id=u and (p.status<>'closed' or p.id in(select h.id from gx.positions h where h.user_id=u and h.status='closed' and h.opened_at>clock_timestamp()-interval '90 days' order by h.opened_at desc,h.id desc limit 50))),'[]'::jsonb),
 'realized',coalesce((select sum(payout-stake)::text from gx.positions where user_id=u and status='closed'),'0')) into out_;
 if p_code is not null then
  if not exists(select 1 from gx.markets where code=p_code) then raise exception 'invalid_market';end if;
  scope_:=case when p_code='fisher' then u else zero end;
  out_:=out_||jsonb_build_object('chart',coalesce((select jsonb_agg(jsonb_build_object('at',b.bucket,'price',b.close::text,'open',b.open::text,'high',b.high::text,'low',b.low::text) order by b.bucket)
  from (select max(bucket) bucket,(array_agg(open order by bucket))[1] open,max(high) high,min(low) low,(array_agg(close order by bucket desc))[1] close
   from gx.bars where code=p_code and scope=scope_ and bucket>=clock_timestamp()-make_interval(hours=>p_hours)
   group by date_bin(make_interval(mins=>greatest(1,ceil(p_hours*60.0/1200)::int)),bucket,'2000-01-01'::timestamptz))b),'[]'::jsonb));
 end if;
 return out_;
end $$;

create or replace function public.exchange_history(p_before timestamptz,p_before_id uuid) returns jsonb
language plpgsql security definer set search_path=gx,public,pg_temp as $$
declare u uuid:=auth.uid();out_ jsonb;
begin
 if u is null then raise exception 'not_signed_in';end if;
 if p_before is null or p_before_id is null then raise exception 'invalid_period';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'code',p.code,'name',m.name,'kind',m.kind,'direction',p.direction,'stake',p.stake::text,
 'leverage',p.leverage,'entry',p.entry::text,'last',p.exit::text,'exit',p.exit::text,'value',p.payout::text,
 'opened_at',p.opened_at,'expires_at',p.expires_at,'status',p.status,'payout',p.payout::text,'reason',p.reason,'closed_at',p.closed_at) order by p.opened_at desc,p.id desc),'[]'::jsonb)
 into out_ from (select * from gx.positions where user_id=u and status='closed' and opened_at>clock_timestamp()-interval '90 days' and (opened_at,id)<(p_before,p_before_id) order by opened_at desc,id desc limit 50)p join gx.markets m on m.code=p.code;
 return out_;
end $$;

create or replace function public.exchange_open(p_code text,p_direction int,p_amount bigint,p_leverage int,p_days int,p_request uuid) returns jsonb
language plpgsql security definer set search_path=gx,public,pg_temp as $$
declare u uuid:=auth.uid();m gx.markets;q gx.quotes;old gx.positions;t timestamptz;scope_ uuid;pid uuid:=gen_random_uuid();available bigint;
begin
 if u is null then raise exception 'not_signed_in';end if;
 if p_request is null or p_amount is null or p_amount<1 or p_direction is null or p_direction not in(-1,1) or p_leverage is null or p_days is null then raise exception 'invalid_order';end if;
 perform pg_advisory_xact_lock(hashtext('golan_exchange'));perform gx.tick();
 select * into old from gx.positions where user_id=u and request=p_request;
 if found then
  if (old.code,old.direction,old.stake,old.leverage,old.days) is distinct from (p_code,p_direction,p_amount,p_leverage,p_days) then raise exception 'request_conflict';end if;
  return public.exchange_state(p_code);
 end if;
 select * into m from gx.markets where code=p_code;if not found then raise exception 'invalid_market';end if;
 if p_leverage<1 or p_leverage>(case when m.kind='daily' then 1000 else 50 end) or p_days not between 1 and 14 or m.kind='daily' and p_days<>1 then raise exception 'invalid_order';end if;
 perform public.exchange_state(p_code);scope_:=case when p_code='fisher' then u else '00000000-0000-0000-0000-000000000000'::uuid end;
 select * into q from gx.quotes where code=p_code and scope=scope_;
 if q.price<=0 or (m.kind='daily' and q.at<clock_timestamp()-interval '5 seconds') then raise exception 'price_unavailable';end if;
 if m.kind='long' and exists(select 1 from gx.control where ((last_day+2+time '00:05') at time zone 'Asia/Jerusalem')<=clock_timestamp()) then raise exception 'price_unavailable';end if;
 perform pg_advisory_xact_lock(hashtext('bank:'||u));perform public.loan_tick();
 if exists(select 1 from public.loans where borrower=u and status='late') then raise exception 'loan_late';end if;
 select balance into available from public.bank_accounts where user_id=u for update;
 if coalesce(available,0)<p_amount then raise exception 'insufficient_bank';end if;
 t:=clock_timestamp();
 insert into gx.positions(id,user_id,request,code,scope,direction,stake,leverage,days,entry,opened_at,expires_at)
 values(pid,u,p_request,p_code,scope_,p_direction,p_amount,p_leverage,p_days,q.price,t,t+p_days*interval '24 hours');
 perform public.bank_add(u,'exchange_lock',-p_amount,'gx:lock:'||pid);
 return public.exchange_state(p_code);
end $$;

create or replace function public.exchange_close(p_position uuid) returns jsonb
language plpgsql security definer set search_path=gx,public,pg_temp as $$
declare u uuid:=auth.uid();r gx.positions;q gx.quotes;
begin
 if u is null then raise exception 'not_signed_in';end if;
 perform pg_advisory_xact_lock(hashtext('golan_exchange'));perform gx.tick();
 select * into r from gx.positions where id=p_position and user_id=u for update;if not found then raise exception 'position_not_found';end if;
 if r.status='open' then
  if (select kind from gx.markets where code=r.code)<>'daily' then raise exception 'locked_position';end if;
  select * into q from gx.quotes where code=r.code and scope=r.scope;
  if q.at<clock_timestamp()-interval '5 seconds' then raise exception 'price_unavailable';end if;
  perform gx.finish(r.id,q.price,'manual');
 end if;
 return public.exchange_state(r.code);
end $$;

create or replace function public.exchange_ready() returns int language plpgsql security definer set search_path=gx,public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'not_signed_in';end if;
 return case when exists(select 1 from cron.job where jobname='golan-exchange' and active) then 1 else 0 end;
end $$;

-- Preserve wealth when principal moves from the bank into escrow. Only the total
-- already represented by the public leaderboard is returned, never positions.
create or replace function public.exchange_wealth(p_user uuid) returns numeric language plpgsql stable security definer set search_path=gx,public,pg_temp as $$
declare result numeric;
begin
 if auth.uid() is null then raise exception 'not_signed_in';end if;
 select w.balance::numeric+public.bank_bal(p_user)
  +coalesce((select sum(s.stack) from public.poker_seats s join public.poker_tables t on t.id=s.table_id where s.user_id=p_user and t.tourney is null),0)
  -public.loan_debt(p_user)+public.loan_lent(p_user)
  +coalesce((select sum(case when status='open' then stake::numeric else payout end) from gx.positions where user_id=p_user and status<>'closed'),0)
 into result from public.wallets w where w.user_id=p_user;
 return coalesce(result,0);
end $$;
create or replace view public.leaderboard with(security_invoker=true) as
 select p.id,p.nickname,p.avatar_url,p.character_key,public.exchange_wealth(p.id) as wealth,
 public.loan_debt(p.id) as debt,public.loan_late(p.id) as late
 from public.profiles p join public.wallets w on w.user_id=p.id;

-- Tables are private even on projects with broad default table grants.
do $$declare t record;begin for t in select tablename from pg_tables where schemaname='gx' loop execute format('alter table gx.%I enable row level security',t.tablename);end loop;end $$;
revoke all on all tables in schema gx from public,anon,authenticated;
revoke all on all functions in schema gx from public,anon,authenticated;
revoke all on function public.exchange_history(timestamptz,uuid),public.exchange_wealth(uuid),public.exchange_ready(),public.exchange_state(text,int),public.exchange_open(text,int,bigint,int,int,uuid),public.exchange_close(uuid) from public,anon,authenticated;
grant execute on function public.exchange_history(timestamptz,uuid),public.exchange_wealth(uuid),public.exchange_ready(),public.exchange_state(text,int),public.exchange_open(text,int,bigint,int,int,uuid),public.exchange_close(uuid) to authenticated;
select cron.schedule('golan-exchange','1 second','select gx.tick();');
commit;
