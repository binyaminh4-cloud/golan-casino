-- Temporarily restrict Reservist to the verified owner's account only.
begin;
create table if not exists rv_private.access_control(
 id boolean primary key default true check(id),
 owner_id uuid not null references public.profiles(id),
 owner_only boolean not null default true
);
alter table rv_private.access_control enable row level security;
revoke all on rv_private.access_control from public,anon,authenticated;
do $$ begin
 if (select count(*) from auth.users where lower(email)='binyaminh4@gmail.com')<>1 then
  raise exception 'reservist_owner_account_not_unique';
 end if;
end $$;
insert into rv_private.access_control(id,owner_id,owner_only)
 select true,id,true from auth.users where lower(email)='binyaminh4@gmail.com'
 on conflict(id) do update set owner_id=excluded.owner_id,owner_only=true;

create or replace function public.rv_access() returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select auth.uid() is not null and exists(
  select 1 from rv_private.access_control where id and (not owner_only or owner_id=auth.uid())
 )
$$;
revoke all on function public.rv_access() from public,anon;
grant execute on function public.rv_access() to authenticated;

create or replace function rv_private.require_owner() returns void
language plpgsql stable set search_path=pg_catalog as $$
begin
 if not public.rv_access() then raise exception 'reservist_owner_only';end if;
end $$;
revoke all on function rv_private.require_owner() from public,anon,authenticated;

create or replace function public.rv_state() returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u uuid:=auth.uid();r rv_private.runs;cool timestamptz;
begin
 if u is null then raise exception 'not_signed_in';end if;
 perform rv_private.require_owner();
 select * into r from rv_private.runs where user_id=u and not done order by started_at desc limit 1;
 -- A run from before an economy reset must never restore an old claim.
 if r.id is not null and exists(select 1 from gc_economy.control where id=1 and reset_at>r.started_at) then
  update rv_private.runs set done=true,finished_at=clock_timestamp() where id=r.id;r.id:=null;
 end if;
 select max(finished_at)+interval '15 seconds' into cool from rv_private.runs where user_id=u;
 return jsonb_build_object('config',rv_private.config(),'run',case when r.id is not null then rv_private.payload(r) end,
 'cooldown',greatest(0,extract(epoch from cool-clock_timestamp())),'bank',public.bank_bal(u));
end $$;

create or replace function public.rv_start(p_mode text,p_ref uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u uuid:=auth.uid();r rv_private.runs;a jsonb:='[]';cfg jsonb;at_ float8:=.5;dur float8;i int;x float8;y float8;
begin
 if u is null then raise exception 'not_signed_in';end if;
 perform rv_private.require_owner();
 if p_ref is null or p_mode is null or p_mode not in('range','gate','base','sniper') then raise exception 'invalid_request';end if;
 perform pg_advisory_xact_lock(hashtextextended('reservist:'||u,0));
 select * into r from rv_private.runs where user_id=u and ref=p_ref;
 if found then return rv_private.payload(r);end if;
 select * into r from rv_private.runs where user_id=u and not done;
 if found then return rv_private.payload(r);end if;
 if exists(select 1 from rv_private.runs where user_id=u and finished_at>clock_timestamp()-interval '15 seconds') then raise exception 'cooldown';end if;
 cfg:=rv_private.config()->p_mode;
 if p_mode='range' then
  for i in 0..9 loop
   dur:=1+random();x:=(array[.16,.335,.505,.68,.84])[1+floor(random()*5)::int];
   y:=case when random()<.5 then .41 else .533 end;
   a:=a||jsonb_build_array(jsonb_build_object('id',i::text,'at',at_,'dur',dur,'x',x,'y',y));at_:=at_+dur+.45;
  end loop;
 elsif p_mode='gate' then
  for i in 0..4 loop a:=a||jsonb_build_array(jsonb_build_object('attacker',floor(random()*3)::int));end loop;
 elsif p_mode='base' then
  a:='[{"x":0.25,"y":0.48},{"x":0.76,"y":0.60},{"x":0.52,"y":0.44},{"x":0.35,"y":0.70},{"x":0.82,"y":0.43}]';
 else
  for i in 0..6 loop
   x:=case when i=2 then .192 else .14+i*.128 end;y:=case when i=2 then .406 else .78+random()*.08 end;
   a:=a||jsonb_build_array(jsonb_build_object('id',case when i<3 then 'target-'||i else 'npc-'||i end,
    'asset',case i when 0 then 'target_olive_v2' when 1 then 'target_blue_v2' when 2 then 'target_red_v2' when 3 then 'civilian_walk_sheet' when 4 then 'civilian_elder' when 5 then 'civilian_woman' else 'hostile' end,
    'x',x,'y',y,'window',i=2));
  end loop;
 end if;
 insert into rv_private.runs(user_id,ref,mode,scene,seconds,unit,mult)values(u,p_ref,p_mode,a,case when p_mode='range' then ceil(at_-.45)::int else (cfg->>'seconds')::int end,(cfg->>'unit')::bigint,public.gc_job_mult())returning * into r;
 return rv_private.payload(r);
end $$;

create or replace function public.rv_shot(p_run uuid,p_ref uuid,p_x numeric,p_y numeric,p_t integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare u uuid:=auth.uid();r rv_private.runs;old jsonb;a jsonb;hit jsonb;earned_ bigint;tag text:='miss';elapsed_ float8;t float8;response_ jsonb;center_ boolean;
begin
 if u is null then raise exception 'not_signed_in';end if;
 perform rv_private.require_owner();
 select * into r from rv_private.runs where id=p_run and user_id=u for update;
 if not found then raise exception 'invalid_run';end if;
 select response into old from rv_private.shots where run_id=p_run and ref=p_ref;
 if found then return old;end if;
 if r.done then raise exception 'already_finished';end if;
 if exists(select 1 from gc_economy.control where id=1 and reset_at>r.started_at) then raise exception 'run_expired';end if;
 elapsed_:=extract(epoch from clock_timestamp()-r.started_at);t:=p_t/1000.0;
 if p_ref is null or p_x is null or p_y is null or p_t is null or p_x not between 0 and 1 or p_y not between 0 and 1
  or t<0 or t>r.seconds or abs(elapsed_-t)>1.5 or elapsed_>r.seconds+1.5 then raise exception 'invalid_shot';end if;
 if r.shots>=120 or r.last_shot>clock_timestamp()-interval '200 milliseconds' then raise exception 'slow_down';end if;
 for a in select value from jsonb_array_elements(rv_private.world(r.mode,r.scene,t)) loop
  if p_x between (a->>'x')::numeric-(a->>'w')::numeric/2 and (a->>'x')::numeric+(a->>'w')::numeric/2
   and p_y between (a->>'y')::numeric-(a->>'h')::numeric and (a->>'y')::numeric then hit:=a;end if;
 end loop;
 earned_:=r.earned;
 if hit is not null and not r.hits ? (hit->>'id') then
  if (hit->>'good')::boolean then
   if r.mode='range' then
    center_:=power((p_x-(hit->>'x')::numeric)/.035,2)+power((p_y-((hit->>'y')::numeric-(hit->>'h')::numeric*(.135/.26)))/.04,2)<=1;
    earned_:=earned_+case when center_ then r.unit else r.unit/10 end;tag:=case when center_ then 'center' else 'hit' end;
   else earned_:=earned_+r.unit;tag:='hit';end if;
   r.hits:=r.hits||jsonb_build_array(hit->>'id');
  elsif r.mode in('gate','sniper') then earned_:=floor(earned_*.75);tag:='wrong';end if;
 end if;
 update rv_private.runs set earned=earned_,hits=r.hits,shots=shots+1,last_shot=clock_timestamp()where id=r.id returning * into r;
 response_:=jsonb_build_object('tag',tag,'run',rv_private.payload(r));
 insert into rv_private.shots values(r.id,p_ref,response_);
 return response_;
end $$;

create or replace function public.rv_finish(p_run uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u uuid:=auth.uid();r rv_private.runs;amount_ bigint;
begin
 if u is null then raise exception 'not_signed_in';end if;
 perform rv_private.require_owner();
 select * into r from rv_private.runs where id=p_run and user_id=u for update;
 if not found then raise exception 'invalid_run';end if;
 if not r.done then
  if exists(select 1 from gc_economy.control where id=1 and reset_at>r.started_at) then raise exception 'run_expired';end if;
  amount_:=r.earned*r.mult;
  if amount_>0 then perform public.bank_add(u,'job',amount_,'job:reservist:'||r.id);end if;
  update rv_private.runs set done=true,paid=amount_,finished_at=clock_timestamp()where id=r.id returning * into r;
 end if;
 return jsonb_build_object('paid',r.paid,'bank',public.bank_bal(u),'run',rv_private.payload(r),'cooldown',greatest(0,15-extract(epoch from clock_timestamp()-r.finished_at)));
end $$;
commit;
