-- Admin can grant up to ₪100M at once.
create or replace function admin_grant(p_user uuid, p_amount bigint) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_batch text := gen_random_uuid()::text;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then raise exception 'not_admin'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000000 then raise exception 'invalid_amount'; end if;
  for r in select id from profiles where p_user is null or id = p_user loop
    perform apply_tx(r.id, 'admin', 'grant', p_amount, 'admin-grant-' || v_batch || ':' || r.id);
    n := n + 1;
  end loop;
  return n;
end $$;
