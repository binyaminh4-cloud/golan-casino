-- Protein miner: allow a stake up to the available wallet, like the slot machines.
begin;
create or replace function pm_start(p_stake bigint, p_mode text, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r pm_runs;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into r from pm_runs where ref = p_ref and user_id = u; if found then return pm_view(r); end if;
  if p_mode not in ('easy', 'normal', 'extreme') then raise exception 'invalid_mode'; end if;
  if exists (select 1 from pm_runs where user_id = u and phase in ('playing','checkpoint')) then raise exception 'run_in_progress'; end if;
  if p_stake is null or p_stake < 1 or p_stake > (select greatest(0, balance) from wallets where user_id = u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'protein_miner', 'stake', -p_stake, 'pmstake:' || p_ref);
  insert into pm_runs (user_id, ref, stake, mode, rocks) values (u, p_ref, p_stake, p_mode, pm_make(p_mode)) returning * into r;
  return pm_view(r);
end $$;
commit;
