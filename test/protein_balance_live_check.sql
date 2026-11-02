-- Generates temporary board values only. No users, games or money are changed.
do $check$
declare mode text;expected int[];board jsonb;l int;i int;b int;safe int;tagged_bombs int;
begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.pm_make(text)') and md5(replace(prosrc,chr(13),''))='a4019f3c1127b1422d4b7108c887c6e3') then raise exception 'protein_definition_mismatch';end if;
 foreach mode in array array['easy','normal','extreme'] loop
  expected:=case mode when 'easy' then array[3,4,5,6] when 'normal' then array[4,5,6,7] else array[5,6,7,8] end;
  for i in 1..100 loop
   board:=public.pm_make(mode);
   if jsonb_array_length(board)<>48 then raise exception 'wrong_board_size';end if;
   for l in 0..3 loop
    select count(*)filter(where (x->>'bomb')::boolean),count(*)filter(where not (x->>'bomb')::boolean),
     count(*)filter(where (x->>'bomb')::boolean and (x->>'tagged')::boolean)
    into b,safe,tagged_bombs from jsonb_array_elements(board)x where (x->>'layer')::int=l;
    if b<>expected[l+1] or safe<4 or tagged_bombs<>0 then raise exception 'unplayable_protein_board';end if;
   end loop;
  end loop;
 end loop;
end $check$;
select 'PASS: 300 boards; correct bombs by difficulty/layer; at least 4 foods; safe tags' as validation;
