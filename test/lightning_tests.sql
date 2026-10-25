\set ON_ERROR_STOP on
select set_config('request.jwt.sub', '00000000-0000-0000-0000-00000000000a', false);
-- exact return-to-player of a straight-up bet, from the weight tables
create temp table rtp as
with c as (select sum(val*w)::numeric/sum(w) ek from rl_w where kind='count'),
     m as (select sum(val*w)::numeric/sum(w) em from rl_w where kind='mult'),
     d as (select sum(val*w)::numeric/sum(w) ed from rl_w where kind='double')
select ((c.ek/37)*(m.em+1) + (1-c.ek/37)*30)/37*100 as std,
       (((c.ek+0.12*3)/37)*((0.829*m.em+0.171*d.ed)+1) + (1-(c.ek+0.12*3)/37)*20)/37*100 as xxx
from c, m, d;
select t_assert((select std between 97.1 and 97.5 from rtp), 'lightning straight-up RTP ~97.3% (' || (select round(std,2) from rtp) || ')');
select t_assert((select xxx between 97.1 and 97.5 from rtp), 'xxxtreme straight-up RTP ~97.3% (' || (select round(xxx,2) from rtp) || ')');
-- payouts
select t_assert(rl_pay2('[{"nums":[17],"amt":10}]',17,'lightning','{"17":200}')=2010, 'struck straight pays 200:1');
select t_assert(rl_pay2('[{"nums":[17],"amt":10}]',17,'lightning','{"5":200}')=300, 'plain straight pays 29:1');
select t_assert(rl_pay2('[{"nums":[17],"amt":10}]',17,'xxx','{}')=200, 'xxx plain straight pays 19:1');
select t_assert(rl_pay2('[{"nums":[17],"amt":10}]',5,'lightning','{"5":500}')=0, 'losing straight pays nothing even if struck');
select t_assert(rl_pay2('[{"nums":[16,17],"amt":10}]',17,'lightning','{"17":500}')=180, 'splits ignore lightning (17:1)');
select t_assert(rl_pay2('[{"nums":[17],"amt":10}]',17,'classic','{"17":500}')=360, 'classic unaffected');
-- strike shape
do $$ declare i int; s jsonb; n int; mx int := 0; begin
  for i in 1..3000 loop
    s := rl_strike('xxx'); n := (select count(*) from jsonb_object_keys(s));
    if n < 1 or n > 10 then raise exception 'bad strike count %', n; end if;
    if exists (select 1 from jsonb_each_text(s) where key::int not between 0 and 36 or value::int not between 50 and 2000) then raise exception 'bad strike %', s; end if;
    mx := greatest(mx, (select max(value::int) from jsonb_each_text(s)));
  end loop;
  perform t_assert(mx > 500, 'xxx double strikes appear (max seen ' || mx || ')');
  for i in 1..2000 loop s := rl_strike('lightning');
    if (select count(*) from jsonb_object_keys(s)) > 5 or (select max(value::int) from jsonb_each_text(s)) > 500 then raise exception 'lightning out of range %', s; end if; end loop;
  perform t_assert(true, 'lightning strikes: 1-5 numbers, 50-500x');
end $$;
-- live spins: ledger consistent
do $$ declare i int; r jsonb; b0 bigint; mo text; begin
  update wallets set balance = 50000000 where user_id = '00000000-0000-0000-0000-00000000000a';
  for i in 1..1500 loop
    mo := (array['lightning','xxx'])[1 + i % 2];
    b0 := (select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a');
    r := rl_spin('[{"nums":[17],"amt":10},{"nums":[0],"amt":5},{"nums":[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36],"amt":20}]', 'L'||i, mo);
    if (select balance from wallets where user_id = '00000000-0000-0000-0000-00000000000a') <> b0 - 35 + (r->>'payout')::bigint
       or (r->>'payout')::bigint <> rl_pay2((select bets from rl_spins where id=(r->>'id')::uuid), (r->>'result')::int, mo, r->'lucky') then raise exception 'mismatch %', r; end if;
  end loop;
  perform t_assert(true, '1500 lightning spins: ledger and payouts consistent');
end $$;
select t_assert(t_raises($$select rl_spin('[{"nums":[17],"amt":10}]','bad','turbo')$$, 'invalid_mode'), 'unknown mode rejected');
select t_assert((rl_spin('[{"nums":[17],"amt":10}]','c1')->>'mode') = 'classic', 'two-argument call still classic');
\echo LIGHTNING TESTS DONE
