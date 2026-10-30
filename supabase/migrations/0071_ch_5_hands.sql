-- blackjack challenges (Fisher's set, Ido's deck): 5 hands instead of 15 / 20
create or replace function ch_runs_5() returns trigger language plpgsql as $$
begin
  if new.kind in ('fisher', 'ido') then new.max_hands := 5; end if;
  return new;
end $$;
drop trigger if exists ch_runs_5 on ch_runs;
create trigger ch_runs_5 before insert on ch_runs for each row execute function ch_runs_5();
-- runs already in progress with fewer than 5 hands played also end at 5
update ch_runs set max_hands = 5 where kind in ('fisher', 'ido') and status = 'playing' and hands < 5;
