-- Golan Casino · text chat. One room per area ('lobby', 'roulette', 'blackjack', 'slots'); polled by the client.
create table if not exists chat_messages (
  id bigserial primary key,
  room text not null check (room in ('lobby', 'roulette', 'blackjack', 'slots')),
  user_id uuid references profiles(id) on delete cascade,
  kind text not null default 'user' check (kind in ('user', 'sys')),
  body text not null check (char_length(body) between 1 and 200),
  created_at timestamptz not null default now()
);
create index if not exists chat_room_id on chat_messages (room, id desc);
alter table chat_messages enable row level security;
revoke all on chat_messages from anon, authenticated;

create or replace function chat_send(p_room text, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); b text := btrim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g')); v bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  if p_room not in ('lobby', 'roulette', 'blackjack', 'slots') then raise exception 'invalid_room'; end if;
  if char_length(b) not between 1 and 200 then raise exception 'invalid_body'; end if;
  if (select count(*) from chat_messages where user_id = u and created_at > now() - interval '10 seconds') >= 5 then raise exception 'slow_down'; end if;
  insert into chat_messages (room, user_id, body) values (p_room, u, b) returning id into v;
  return v;
end $$;

-- messages after p_after (0 = the latest 40)
create or replace function chat_since(p_room text, p_after bigint default 0) returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'body', m.body, 'at', m.created_at,
           'uid', m.user_id, 'name', p.nickname) order by m.id), '[]')
  from (select * from chat_messages where room = p_room and id > coalesce(p_after, 0) order by id desc limit 40) m
  left join profiles p on p.id = m.user_id
  where auth.uid() is not null $$;

-- system line for a big win (called from settlement code)
create or replace function chat_sys(p_room text, p_body text) returns void language sql security definer set search_path = public as $$
  insert into chat_messages (room, kind, body) values (p_room, 'sys', left(p_body, 200)) $$;

-- live roulette: announce wins of 20x the stake or more
create or replace function rl_live_settle() returns void language plpgsql volatile as $$
declare b record; v_pay bigint; v_game text; v_closed bigint;
begin
  v_closed := floor((rl_live_now() - rl_live_window()) / rl_live_cycle());
  for b in select lb.*, r.result, case lb.mode when 'lightning' then r.lucky_l when 'xxx' then r.lucky_x else '{}'::jsonb end as lucky
           from rl_live_bets lb join rl_live_rounds r using (round_no)
           where not lb.settled and lb.round_no <= v_closed
           for update of lb skip locked loop
    v_pay := rl_pay2(b.bets, b.result, b.mode, b.lucky);
    v_game := case b.mode when 'classic' then 'roulette' when 'lightning' then 'lightning_roulette' else 'xxx_roulette' end;
    if v_pay > 0 then perform apply_tx(b.user_id, v_game, 'payout', v_pay, 'rllpay:' || b.id); end if;
    update rl_live_bets set payout = v_pay, settled = true where id = b.id;
    if v_pay >= b.total * 20 then
      perform chat_sys('roulette', '🎉 ' || (select nickname from profiles where id = b.user_id) || ' זכה ב־₪' || to_char(v_pay, 'FM999,999,999') ||
        ' על ' || b.result || case when b.lucky ? b.result::text then ' ⚡ ' || (b.lucky->>b.result::text) || 'x' else '' end);
    end if;
  end loop;
end $$;

revoke all on function chat_sys(text, text), rl_live_settle() from public, anon, authenticated;
revoke all on function chat_send(text, text), chat_since(text, bigint) from public, anon;
grant execute on function chat_send(text, text), chat_since(text, bigint) to authenticated;
