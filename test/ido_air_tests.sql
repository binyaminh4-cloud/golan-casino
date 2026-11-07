-- עידו באוויר: landing return ≈ 96.6%, bonus return ≈ 95%, path ends in its bucket, launch charges/pays, rate limit
do $$ declare e numeric; b numeric; i int; k int; r jsonb; v numeric; lo numeric; u uuid; bal0 bigint; bal1 bigint; ok boolean;
begin
  for i in 0..16 loop lo := case when i = 16 then 5000 else 0.1 * power(2::numeric, i) end;
    for k in 1..40 loop r := ia_build(i); v := (r->>'final')::numeric;
      if v < lo or v >= (case when i = 16 then 10001 else lo * 2 end) then raise exception 'bucket % value %', i, v; end if;
      if ((r->'events'->(jsonb_array_length(r->'events') - 1))->>'a')::numeric <> v then raise exception 'path end mismatch'; end if;
    end loop; end loop;
  select avg_mv into e from (select 0.7 * sum(mv * (ia_land_w())[j + 1]) / 1e7 avg_mv from
    (select j, avg((ia_build(j)->>'final')::numeric) mv from generate_series(0, 16) j, generate_series(1, 800) g group by j) m) x;
  select sum(mv * (ia_bonus_w())[j + 1]) / sum((ia_bonus_w())[j + 1]) / 10 into b from
    (select j, avg((ia_build(j)->>'final')::numeric) mv from generate_series(3, 16) j, generate_series(1, 800) g group by j) m;
  if e < 0.92 or e > 0.995 then raise exception 'land rtp %', e; end if;
  if b < 0.88 or b > 0.995 then raise exception 'bonus rtp %', b; end if;
  select user_id into u from wallets order by balance desc limit 1;
  perform set_config('request.jwt.sub', u::text, true);
  select balance into bal0 from wallets where user_id = u;
  r := ia_launch(100, false, 'iatest-' || gen_random_uuid());
  select balance into bal1 from wallets where user_id = u;
  if bal1 <> bal0 - 100 + (r->>'paid')::bigint then raise exception 'money % % %', bal0, bal1, r->>'paid'; end if;
  ok := false; begin perform ia_launch(100, false, 'iatest-' || gen_random_uuid()); exception when others then ok := sqlerrm = 'too_fast'; end;
  if not ok then raise exception 'rate limit'; end if;
  raise notice 'IDO AIR TESTS DONE land % bonus %', round(e, 3), round(b, 3);
end $$;
