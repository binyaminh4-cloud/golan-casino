-- Live smoke test. Runs entirely inside one transaction that is aborted at the end
-- (the final RAISE), so nothing is saved. The error message carries the results.
do $$
declare v jsonb; n int := 0; a text; uid uuid := '11111111-1111-1111-1111-111111111111'; out jsonb := '[]';
begin
  insert into invitations(email) values ('smoke@test.local');
  insert into auth.users(id, email, instance_id, aud, role) values (uid, 'smoke@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  for n in 1..25 loop
    v := bj_deal(100, 10, 10, 10, 10, 'smoke' || n);
    while v->>'status' <> 'done' loop
      a := case when v->'actions' ? 'no_insurance' then 'no_insurance' when (v->'hands'->(v->>'active')::int->>'total')::int < 17 then 'hit' else 'stand' end;
      v := bj_action((v->>'id')::uuid, a);
    end loop;
    out := out || jsonb_build_object('net', v->'result'->'net', 'hands', v->'result'->'hands', 'dealer', v->'dealer');
  end loop;
  execute 'reset role';
  raise exception 'SMOKE_OK rounds=25 balance=% ledger_ok=% sample=%',
    (select balance from wallets where user_id = uid),
    (select balance = (select sum(amount) from wallet_transactions where user_id = uid) from wallets where user_id = uid),
    out->0;
end $$;
