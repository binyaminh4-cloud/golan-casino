-- several challenges at once: an open run of one kind no longer blocks the others
create or replace function ch_start_fisher() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s seasons; r ch_runs;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if not gc_on('challenges') then raise exception 'challenges_paused'; end if;
  s := ch_season();
  select * into r from ch_runs where user_id = u and kind = 'fisher' and status = 'playing' limit 1;
  if found then return jsonb_build_object('run', r.id, 'kind', r.kind); end if;
  insert into ch_runs (season, user_id, kind, deck, max_hands) values (s.no, u, 'fisher', ch_new_deck(), 15) returning * into r;
  return jsonb_build_object('run', r.id, 'kind', 'fisher');
end $$;

create or replace function ch_challenge_ido(p_opponent uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); s seasons; d ch_duels; r ch_runs;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if not gc_on('challenges') then raise exception 'challenges_paused'; end if;
  if p_opponent is null or p_opponent = u or not exists (select 1 from profiles where id = p_opponent) then raise exception 'invalid_opponent'; end if;
  if (select count(*) from ch_duels where challenger = u and opponent = p_opponent and created_at > now() - interval '1 day') >= 2 then raise exception 'slow_down'; end if;
  s := ch_season();
  insert into ch_duels (season, challenger, opponent, deck) values (s.no, u, p_opponent, ch_new_deck()) returning * into d;
  insert into ch_runs (season, user_id, kind, duel, deck, max_hands) values (s.no, u, 'ido', d.id, d.deck, 20) returning * into r;
  update ch_duels set run_a = r.id where id = d.id;
  return jsonb_build_object('run', r.id, 'kind', 'ido', 'duel', d.id);
end $$;

create or replace function ch_accept_ido(p_duel uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); d ch_duels; r ch_runs;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if not gc_on('challenges') then raise exception 'challenges_paused'; end if;
  select * into d from ch_duels where id = p_duel and opponent = u for update;
  if not found or d.status not in ('waiting', 'playing') then raise exception 'challenge_closed'; end if;
  if d.run_b is not null then return jsonb_build_object('run', d.run_b, 'kind', 'ido', 'target', d.score_a); end if;
  insert into ch_runs (season, user_id, kind, duel, deck, max_hands) values (d.season, u, 'ido', d.id, d.deck, 20) returning * into r;
  update ch_duels set run_b = r.id, status = 'playing' where id = d.id;
  return jsonb_build_object('run', r.id, 'kind', 'ido', 'target', d.score_a);
end $$;
