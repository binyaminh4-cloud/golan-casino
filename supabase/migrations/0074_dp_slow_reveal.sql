-- dealer poker: longer 'done' pause so the dealer's cards can be revealed one by one
create or replace function dp_tick(p_game text) returns dp_rounds language plpgsql security definer set search_path = public as $$
declare r dp_rounds; t numeric := rl_live_now();
begin
  select * into r from dp_rounds where game = p_game and t_no = 1 order by round_no desc limit 1 for update;
  if not found then insert into dp_rounds (game, t_no, round_no, deck) values (p_game, 1, 1, dp_deck()) returning * into r; end if;
  if r.phase = 'betting' and r.until is not null and (t >= r.until or not exists (
       select 1 from dp_presence pr where pr.game = p_game and pr.seen > t - 12
         and not exists (select 1 from dp_hands hh where hh.round_id = r.id and hh.user_id = pr.user_id))) then
    perform dp_deal(r.id); select * into r from dp_rounds where id = r.id;
  end if;
  while r.phase in ('d1', 'd2', 'd3') and (t >= r.until or not exists (
       select 1 from dp_hands where round_id = r.id and status = 'act' and coalesce(acted, '') <> r.phase)) loop
    perform dp_next(r.id); select * into r from dp_rounds where id = r.id;
  end loop;
  if r.phase = 'done' and t >= r.done_at + 16 then
    insert into dp_rounds (game, t_no, round_no, deck) values (p_game, 1, r.round_no + 1, dp_deck()) returning * into r;
  end if;
  return r;
end $$;
