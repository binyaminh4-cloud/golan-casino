-- Level-up bonus: once per level, the monthly salary of the level you just left (2 → gets level 1's monthly). Paid into the bank.
alter table bank_tx drop constraint if exists bank_tx_kind_check;
alter table bank_tx add constraint bank_tx_kind_check check (kind in ('salary_weekly', 'salary_monthly', 'gift', 'deposit', 'withdraw', 'job', 'levelup'));
create or replace function gc_level_check() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); L jsonb; lv int; old int; k int; bonus bigint := 0; b bigint;
begin
  if u is null then raise exception 'not_signed_in'; end if;
  L := gc_level_info(u); lv := (L->>'level')::int;
  select level into old from gc_level_seen where user_id = u for update;
  if old is null then insert into gc_level_seen values (u, lv); return L || jsonb_build_object('up', false); end if;
  if lv <= old then return L || jsonb_build_object('up', false); end if;
  update gc_level_seen set level = lv where user_id = u;
  for k in old .. lv - 1 loop                       -- every level crossed pays once (ref is unique per level)
    b := gc_num('salary_monthly') * k;
    begin perform bank_add(u, 'levelup', b, 'levelup:' || u || ':' || (k + 1)); bonus := bonus + b;
    exception when unique_violation then null; end;
  end loop;
  perform chat_sys('lobby', '⬆️ ' || (select nickname from profiles where id = u) || ' עלה לרמה ' || lv || '!');
  return L || jsonb_build_object('up', true, 'from', old, 'bonus', bonus);
end $$;
revoke all on function gc_level_check() from public, anon; grant execute on function gc_level_check() to authenticated;
