-- Exchange worker stuck since 4.11: a total-loss exchange_return made a fund go below zero, bank_event raised
-- 'exchange_fund_inconsistent', and the daily run (and with it the bank's exchange button) stopped. A fund never goes below zero now.
-- Same function as 0100, one line changed.
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
 if f.wealth+delta<0 then delta:=-f.wealth;end if;   -- floor at zero instead of stopping the whole worker
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
