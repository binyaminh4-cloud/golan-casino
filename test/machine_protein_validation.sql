-- Run after the new definitions in a transaction, then ROLLBACK.
-- Generates boards only: does not create games, users or wallet transactions.
do $$
declare mode text; board jsonb; layer_no int; safe_count int; i int;
begin
  foreach mode in array array['easy','normal','extreme'] loop
    for i in 1..500 loop
      board := pm_make(mode);
      if jsonb_array_length(board) <> 48 then raise exception 'board_size'; end if;
      for layer_no in 0..3 loop
        select count(*) into safe_count from jsonb_array_elements(board) x
          where (x->>'layer')::int = layer_no and not (x->>'bomb')::boolean;
        if safe_count < 3 then raise exception 'not_enough_safe_targets'; end if;
      end loop;
    end loop;
  end loop;
end $$;
select 'PASS: 1500 boards, four playable layers each; rollback follows' as validation;
