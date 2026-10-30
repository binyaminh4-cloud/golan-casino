-- the inviter can cancel a Zeus invitation that wasn't accepted yet
create or replace function zeus_cancel(p_duel uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); d zeus_duels;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into d from zeus_duels where id = p_duel and a = u for update;
  if not found or d.status <> 'invited' then raise exception 'challenge_closed'; end if;
  update zeus_duels set status = 'declined', finished_at = now() where id = d.id;
  return jsonb_build_object('duel', d.id, 'status', 'declined');
end $$;
revoke all on function zeus_cancel(uuid) from public, anon;
grant execute on function zeus_cancel(uuid) to authenticated;
