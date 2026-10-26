-- One chat room for the whole group: system lines (big wins, jackpots) always go to 'lobby', the room every page uses.
create or replace function chat_sys(p_room text, p_body text) returns void language sql security definer set search_path = public as $$
  insert into chat_messages (room, kind, body) values ('lobby', 'sys', left(p_body, 200)) $$;
update chat_messages set room = 'lobby' where room <> 'lobby';
revoke all on function chat_sys(text, text) from public, anon, authenticated;
