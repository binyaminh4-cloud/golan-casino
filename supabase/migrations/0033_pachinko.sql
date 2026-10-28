-- מכונת השירותים והפצ׳ינקו (Bathroom Pachinko). 5×3 reels, 10 lines, a toilet (BONUS scatter) at most once per reel.
-- 3 toilets: Avichai's regular pachinko bonus (8 cells incl. DOUBLE); 4-5: Fisher's super bonus (20 drops on 7 friends).
-- Toilets may carry ×2/×3/×5 badges; badges add up into the entry multiplier (none = ×1).
-- Project math (not from the art kit): simulated 1.5M spins ≈ 95.8% return; regular ≈1 in 75 spins, super ≈1 in 1,080.
create table if not exists pc_spins (
  id bigint generated always as identity primary key, user_id uuid not null references profiles(id) on delete cascade, ref text not null,
  stake bigint not null, result jsonb not null, payout bigint not null, created_at timestamptz not null default now(), unique (user_id, ref));
alter table pc_spins enable row level security; revoke all on pc_spins from anon, authenticated;

create or replace function pc_pick(w numeric[]) returns int language plpgsql volatile as $$
declare tot numeric := 0; x numeric; i int;
begin
  for i in 1 .. array_length(w, 1) loop tot := tot + w[i]; end loop;
  x := random() * tot;
  for i in 1 .. array_length(w, 1) loop x := x - w[i]; if x < 0 then return i - 1; end if; end loop;
  return array_length(w, 1) - 1;
end $$;

create or replace function pc_spin(p_stake bigint, p_ref text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); old pc_spins; g int[] := array_fill(0, array[15]); badges jsonb := '{}'; bsum int := 0; nb int := 0; t int := 0;
  c int; r int; s int; k int; L int[]; lines int[][] := array[[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],[0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[1,0,1,2,1]];
  pays int[][] := array[[4,10,30],[6,16,50],[8,24,80],[12,40,150],[20,80,300],[40,200,1000]];
  wins jsonb := '[]'; linesum bigint := 0; bonus jsonb := null; entry int; scale bigint; total bigint := 0; i int; tg jsonb := '[]'; pay bigint; res jsonb; bal bigint;
  RV int[] := array[5,100,10,0,20,50,15,25]; SV int[] := array[5,100,10,20,50,15,25];
begin
  if u is null then raise exception 'not_signed_in'; end if;
  select * into old from pc_spins where user_id = u and ref = p_ref;
  if found then return old.result || jsonb_build_object('balance', (select balance from wallets where user_id = u)); end if;
  if p_stake is null or p_stake < 10 or p_stake > gc_max_bet(u) then raise exception 'invalid_amount'; end if;
  perform apply_tx(u, 'pachinko', 'stake', -p_stake, 'pcstake:' || u || ':' || p_ref);
  for i in 1..15 loop g[i] := pc_pick(array[20,18,16,14,11,7]); end loop;            -- grid index = row*5 + col (+1)
  for c in 0..4 loop
    if random() < 0.12 then
      r := floor(random() * 3)::int; g[r * 5 + c + 1] := 6; t := t + 1;
      if random() < 0.12 then nb := (array[2,3,5])[pc_pick(array[60,30,10]) + 1]; badges := badges || jsonb_build_object((r * 5 + c)::text, nb); bsum := bsum + nb; end if;
    end if;
  end loop;
  for i in 1..10 loop
    L := lines[i:i][1:5]; s := g[L[1][1] * 5 + 1];
    if s <> 6 then
      k := 1; while k < 5 and g[L[1][k + 1] * 5 + k + 1] = s loop k := k + 1; end loop;
      if k >= 3 then linesum := linesum + pays[s + 1][k - 2]; wins := wins || jsonb_build_object('line', i - 1, 'sym', s, 'n', k, 'pay', pays[s + 1][k - 2]); end if;
    end if;
  end loop;
  if t >= 3 then
    entry := case when bsum > 0 then bsum else 1 end;
    if t = 3 then
      scale := entry;
      loop i := pc_pick(array[24,1,18,8,12,3,16,8]); tg := tg || to_jsonb(i);
        if i = 3 then scale := scale * 2; else total := RV[i + 1] * scale; exit; end if; end loop;
      bonus := jsonb_build_object('kind', 'regular', 'entry', entry, 'targets', tg, 'total', total);
    else
      for k in 1..20 loop i := pc_pick(array[85,0.05,8,2,0.25,4,0.7]); tg := tg || to_jsonb(i); total := total + SV[i + 1]; end loop;
      total := total * entry;
      bonus := jsonb_build_object('kind', 'super', 'entry', entry, 'targets', tg, 'total', total);
    end if;
  end if;
  pay := (p_stake * linesum) / 10 + p_stake * total;
  res := jsonb_build_object('grid', to_jsonb(g), 'badges', badges, 'wins', wins, 'line_mult', linesum, 'bonus', bonus, 'stake', p_stake, 'payout', pay);
  insert into pc_spins (user_id, ref, stake, result, payout) values (u, p_ref, p_stake, res, pay);
  if pay > 0 then bal := apply_tx(u, 'pachinko', 'payout', pay, 'pcpay:' || u || ':' || p_ref); else bal := (select balance from wallets where user_id = u); end if;
  if total * p_stake >= 50000 then perform chat_sys('lobby', '🚽 ' || (select nickname from profiles where id = u) || ' זכה ב־₪' || to_char(pay, 'FM999,999,999,999,999,999') || ' במכונת השירותים!'); end if;
  return res || jsonb_build_object('balance', bal);
end $$;
revoke all on function pc_pick(numeric[]) from public, anon, authenticated;
revoke all on function pc_spin(bigint, text) from public, anon; grant execute on function pc_spin(bigint, text) to authenticated;
