-- Read-only daily highlights. Existing settlement/ledger records remain the source
-- of truth. Only cash poker needs a small archive; no cards or private choices.
begin;
create schema if not exists gc_highlights;
revoke all on schema gc_highlights from public,anon,authenticated;
create table if not exists gc_highlights.poker_results(
 ref text primary key,user_id uuid not null,stake numeric not null,payout numeric not null,
 at timestamptz not null,check(stake>=0 and payout>=0)
);
alter table gc_highlights.poker_results enable row level security;
revoke all on gc_highlights.poker_results from public,anon,authenticated;
create index if not exists highlights_poker_user_day on gc_highlights.poker_results(user_id,at);
create index if not exists highlights_settlements_user_day on gx.settlements(user_id,at);
create index if not exists highlights_bank_user_day on public.bank_tx(user_id,created_at);
create index if not exists highlights_exchange_user_day on gx.positions(user_id,credited_at) where status='closed';

create or replace function gc_highlights.poker_capture() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,gc_highlights as $$
begin
 if new.street<>'done' or new.result is null then return new;end if;
 if tg_op='UPDATE' then
  if old.street='done' and old.hand_no=new.hand_no then return new;end if;
 end if;
 if exists(select 1 from public.poker_tables where id=new.table_id and tourney is not null) then return new;end if;
 insert into gc_highlights.poker_results(ref,user_id,stake,payout,at)
 select new.table_id||':'||new.hand_no||':'||p.id,p.id,
 coalesce((v.value->>'committed')::numeric,0),coalesce((new.result->'won'->>v.key)::numeric,0),clock_timestamp()
 from jsonb_each(new.players) v join public.profiles p on p.id::text=v.value->>'user'
 where not public.gc_is_test(p.id)
 on conflict(ref) do nothing;
 return new;
end $$;
revoke all on function gc_highlights.poker_capture() from public,anon,authenticated;
drop trigger if exists gc_highlights_poker on public.poker_hands;
create trigger gc_highlights_poker after insert or update on public.poker_hands
 for each row execute function gc_highlights.poker_capture();

-- Historical bot hands are already archived. Identical keys prevent double count.
insert into gc_highlights.poker_results(ref,user_id,stake,payout,at)
 select ref,user_id,stake,payout,at from gx.settlements where source='poker_bots'
 on conflict(ref) do nothing;

create or replace function public.gc_daily_highlights(p_user uuid) returns jsonb
language plpgsql stable security definer
set search_path=pg_catalog,public,gx,gc_highlights as $$
declare start_ timestamptz;end_ timestamptz;out_ jsonb;
begin
 if auth.uid() is null then raise exception 'not_signed_in';end if;
 if not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'not_a_member';end if;
 if p_user is null or not exists(select 1 from public.profiles where id=p_user and not public.gc_is_test(id)) then raise exception 'invalid_player';end if;
 start_:=(date_trunc('day',now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem');
 end_:=((date_trunc('day',now() at time zone 'Asia/Jerusalem')+interval '1 day') at time zone 'Asia/Jerusalem');
 -- Never display money from before an economy restart, including today's reset.
 start_:=greatest(start_,coalesce((select reset_at from gc_economy.control where id=1),start_));
 with s as materialized (
  select * from gx.settlements where user_id=p_user and at>=start_ and at<end_
 ), singles as (
  select s.source||':'||s.ref as key,'game'::text as kind,
   case s.source
    when 'public.rl_spins' then case r.mode when 'lightning' then 'רולטת הברק המחומש' when 'xxx' then 'רולטת XXX' else 'רולטה' end
    when 'public.sl_spins' then case sl.machine when 'fortune' then 'מכונת האטרף' else 'מכונות מזל' end
    when 'public.pc_spins' then 'מכונת השירותים' when 'public.kin_spins' then 'על האש בכינרת'
    when 'public.ww_spins' then 'המערב הפרוע' when 'public.dg_spins' then 'דרקוני הגולן'
    when 'public.pm_runs' then 'שולה החלבון' when 'public.ck_runs' then 'עידו חוצה את הכביש'
    when 'public.f90_runs' then 'פישר בדקה ה־90'
    when 'public.bj_rounds' then case bj.mode when 'lightning' then 'בלאק ג׳ק ברקים' else 'בלאק ג׳ק' end
    when 'public.dp_hands' then case dr.game when 'tcp' then 'פוקר שלושה קלפים' when 'uth' then 'הולדם מול הדילר' else 'פוקר קריבי' end
   end as label,s.payout-s.stake as profit,s.at
  from s
  left join public.rl_spins r on r.id=case when s.source='public.rl_spins' then s.ref::uuid end
  left join public.sl_spins sl on sl.id=case when s.source='public.sl_spins' then s.ref::uuid end
  left join public.bj_rounds bj on bj.id=case when s.source='public.bj_rounds' then s.ref::uuid end
  left join public.dp_hands dh on dh.id=case when s.source='public.dp_hands' then s.ref::uuid end
  left join public.dp_rounds dr on dr.id=dh.round_id
  where s.source in('public.rl_spins','public.sl_spins','public.pc_spins','public.kin_spins','public.ww_spins','public.dg_spins','public.pm_runs','public.ck_runs','public.f90_runs','public.bj_rounds','public.dp_hands')
   and (s.source<>'public.bj_rounds' or bj.ch_run is null)
 ), live_keys as (
  select distinct b.round_no,b.mode from s join public.rl_live_bets b on b.id=case when s.source='public.rl_live_bets' then s.ref::uuid end where s.source='public.rl_live_bets'
 ), live as (
  select 'rl:'||k.round_no||':'||k.mode as key,'game'::text as kind,
   case k.mode when 'lightning' then 'רולטת הברק המחומש' when 'xxx' then 'רולטת XXX' else 'רולטה' end as label,
   sum(b.payout::numeric-b.total::numeric) as profit,max(g.at) as at
  from live_keys k join public.rl_live_bets b on b.round_no=k.round_no and b.mode=k.mode and b.user_id=p_user
  left join gx.settlements g on g.source='public.rl_live_bets' and g.ref=b.id::text
  group by k.round_no,k.mode having bool_and(b.settled) and bool_and(g.ref is not null)
 ), fish_keys as (
  select distinct b.round_no from s join public.if_bets b on b.id=case when s.source='public.if_bets' then s.ref::bigint end where s.source='public.if_bets'
 ), fish as (
  select 'fish:'||k.round_no as key,'game'::text as kind,'גלגל הדגים של עידו'::text as label,
   sum(b.payout::numeric-b.total::numeric) as profit,max(g.at) as at
  from fish_keys k join public.if_bets b on b.round_no=k.round_no and b.user_id=p_user
  left join gx.settlements g on g.source='public.if_bets' and g.ref=b.id::text
  group by k.round_no having bool_and(b.settled) and bool_and(g.ref is not null)
 ), zlm_keys as (
  select distinct split_part(ref,':',1)::uuid as round_id from s where source='zlm_private.bets'
 ), zlm as (
  select 'zlm:'||k.round_id as key,'game'::text as kind,'זמן למטווח'::text as label,
   sum(b.payout::numeric-b.amount::numeric) as profit,max(g.at) as at
  from zlm_keys k join zlm_private.bets b on b.round_id=k.round_id and b.user_id=p_user
  left join gx.settlements g on g.source='zlm_private.bets' and g.ref=b.round_id||':'||b.user_id||':'||b.spot
  group by k.round_id having bool_and(b.settled) and bool_and(g.ref is not null)
 ), bank_day as materialized (
  select * from public.bank_tx where user_id=p_user and created_at>=start_ and created_at<end_
 ), wallet_day as materialized (
  select * from public.wallet_transactions where user_id=p_user and created_at>=start_ and created_at<end_
 ), jobs as (
  select 'jobs' as key,'jobs' as kind,'הכנסות מעבודות' as label,sum(amount::numeric) as profit,max(created_at) as at from (
   select amount,created_at from bank_day where kind='job'
   union all select amount,created_at from wallet_day where kind='grant' and game in('job_driver','job_dealer','job_fisher','job_fiber','job_tamer')
  ) j where amount>0
 ), prizes as (
  select 'prize:'||id as key,'prize' as kind,case when settlement_ref like '%:champion' then 'פרס אלוף העונה' else 'פרס אתגר עונתי' end as label,amount::numeric as profit,created_at as at
  from wallet_day where game='season' and kind='grant' and settlement_ref like 'season:%'
  union all
  select 'tourney:'||w.id,'prize','פרס טורניר פוקר',w.amount::numeric-t.buyin::numeric,w.created_at
  from wallet_day w join public.tourneys t on w.settlement_ref='tnpay:'||t.id
  where w.game='tourney' and w.kind='payout'
  union all select 'level:'||id,'prize','בונוס עליית רמה',amount::numeric,created_at from bank_day where kind='levelup'
 ), exchange as (
  select 'exchange:'||p.id as key,'exchange' as kind,'בורסה · '||m.name as label,p.payout-p.stake::numeric as profit,p.credited_at as at
  from gx.positions p join gx.markets m on m.code=p.code where p.user_id=p_user and p.status='closed' and p.credited_at>=start_ and p.credited_at<end_
 ), loan_keys as (
  select distinct l.id,l.principal from bank_day b join public.loans l on right(b.ref,36)=l.id::text
  where b.kind='loan_back' and l.kind='p2p' and l.lender=p_user
 ), interest as (
  -- Principal-first recognition: only receipts above principal are earnings.
  select 'loan:'||l.id as key,'interest' as kind,'ריבית מהלוואה' as label,
   greatest(sum(b.amount::numeric)-l.principal,0)-greatest(coalesce(sum(b.amount::numeric) filter(where b.created_at<start_),0)-l.principal,0) as profit,
   max(b.created_at) filter(where b.created_at>=start_) as at
  from loan_keys l join public.bank_tx b on b.user_id=p_user and b.kind='loan_back' and right(b.ref,36)=l.id::text and b.created_at<end_
  group by l.id,l.principal
 ), candidates as (
  select * from singles union all select * from live union all select * from fish union all select * from zlm
  union all select ref,'game','פוקר',payout-stake,at from gc_highlights.poker_results where user_id=p_user and at>=start_ and at<end_
  union all select * from jobs union all select * from prizes union all select * from exchange union all select * from interest
 ), top5 as (
  select * from candidates where profit>0 and label is not null and at>=start_ and at<end_ order by profit desc,at desc,key limit 5
 )
 select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'label',label,'profit',profit::text,'at',at) order by profit desc,at desc,key),'[]'::jsonb) into out_ from top5;
 return jsonb_build_object('day',(now() at time zone 'Asia/Jerusalem')::date,'items',out_);
end $$;
revoke all on function public.gc_daily_highlights(uuid) from public,anon;
grant execute on function public.gc_daily_highlights(uuid) to authenticated;
commit;
