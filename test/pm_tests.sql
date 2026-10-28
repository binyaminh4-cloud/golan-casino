\set ON_ERROR_STOP on
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000b', false);
update wallets set balance = 10000000 where user_id = '00000000-0000-0000-0000-00000000000b';
do $$ declare v jsonb; i int; st bigint := 0; pd bigint := 0; rk int; md text; begin
  for i in 1..1500 loop
    md := (array['easy','normal','extreme'])[1 + i % 3];
    v := pm_start(100, md, 'pm' || i); st := st + 100;
    perform t_assert(not exists (select 1 from jsonb_array_elements(v->'rocks') x where x ? 'bomb'), 'secrets hidden');
    while v->>'phase' in ('playing','checkpoint') loop
      if v->>'phase' = 'checkpoint' then v := pm_next((v->>'id')::uuid, random() < .4);
      else select (x->>'id')::int into rk from jsonb_array_elements(v->'rocks') x where (x->>'layer')::int = (v->>'layer')::int and not (x->>'taken')::boolean order by random() limit 1;
        v := pm_collect((v->>'id')::uuid, rk); end if;
    end loop;
    pd := pd + (v->>'paid')::bigint;
  end loop;
  raise notice 'PM RTP %', round(pd::numeric / st, 4);
  perform t_assert((select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000b') = 10000000 - st + pd, 'ledger matches');
end $$;
\echo PM TESTS DONE
