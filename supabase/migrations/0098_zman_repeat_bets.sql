-- Atomic repeat/automatic layout: either every chip is placed, or nothing is charged.
begin;
create or replace function zlm_bet_batch(p_round uuid,p_layout jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); r zlm_private.rounds; x record; total numeric:=0;
 v_balance bigint; reserved numeric; n bigint;
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
 if total>v_balance or v_balance::numeric+(reserved+total)*50001>9223372036854775807 then raise exception 'invalid_amount'; end if;
 insert into zlm_private.requests values(u,p_request,p_round);
 perform public.apply_tx(u,'zman_lamatvach','stake',-total::bigint,'zlmbatch:'||u||':'||p_request);
 for x in select * from jsonb_each_text(p_layout) loop
  n:=x.value::bigint;
  insert into zlm_private.bets(round_id,user_id,spot,amount) values(r.id,u,x.key,n)
   on conflict(round_id,user_id,spot) do update set amount=zlm_private.bets.amount+excluded.amount;
 end loop;
 return zlm_state();
end $$;
revoke all on function zlm_bet_batch(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function zlm_bet_batch(uuid,jsonb,uuid) to authenticated;
create or replace function zlm_repeat_ready() returns int language plpgsql security definer set search_path=public,pg_temp as $$
begin if auth.uid() is null then raise exception 'not_signed_in'; end if; return 1; end $$;
revoke all on function zlm_repeat_ready() from public,anon,authenticated;
grant execute on function zlm_repeat_ready() to authenticated;
commit;
select case when has_function_privilege('authenticated','zlm_bet_batch(uuid,jsonb,uuid)','execute')
 and not has_function_privilege('anon','zlm_bet_batch(uuid,jsonb,uuid)','execute')
 and not has_function_privilege('anon','zlm_repeat_ready()','execute')
 then 'PASS: atomic repeat bets installed' else 'FAIL: repeat bets unavailable' end as validation;
