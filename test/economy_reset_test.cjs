// Historical one-time reset: audit the exact chain through 0103. Later reward
// rules are covered by season_shabbat_test.cjs and cannot re-run that reset.
const fs=require('fs');const{PGlite}=require('../.poker-test-runtime/node_modules/@electric-sql/pglite');(async()=>{const d=new PGlite();await d.exec(fs.readFileSync('test/supabase_stub.sql','utf8').replace(/create extension[^;]*;/gi,''));await d.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid,bucket_id text);create function extensions.gen_random_bytes(int)returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$;create function extensions.crypt(text,text)returns text language sql as $$select 'local-test-stub'::text$$;create function extensions.gen_salt(text)returns text language sql as $$select 'local-test-stub'::text$$;create schema cron;create table cron.job(jobid bigserial,jobname text unique,schedule text,command text,active boolean default true);create table cron.job_run_details(jobid bigint,status text,start_time timestamptz,end_time timestamptz,return_message text);create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin insert into cron.job(jobname,schedule,command)values($1,$2,$3)on conflict(jobname)do update set schedule=$2,command=$3;return 1;end$$;`);for(const f of fs.readdirSync('supabase/migrations').sort().filter(f=>f.slice(0,4)<='0103')){try{await d.exec(fs.readFileSync('supabase/migrations/'+f,'utf8').replace(/create extension[^;]*;/gi,''));}catch(e){throw new Error('Migration '+f+': '+e.message)}}console.log('FULL MIGRATIONS PASS');await d.exec(fs.readFileSync('supabase/migrations/0103_economy_reset_tools.sql','utf8'));

const assert=require('node:assert/strict'),q=async(s,a=[])=>(await d.query(s,a)).rows;
const rpc=async(s,a=[])=>(await q('select '+s+' v',a))[0].v;
const uid=async u=>q("select set_config('request.jwt.sub',$1,false)",[u]);
assert.match((await q(fs.readFileSync('test/economy_reset_install_check.sql','utf8')))[0].validation,/^PASS:/);
const users=['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003'];
for(const [i,u]of users.entries()){
 await q('insert into invitations(email)values($1)',['reset'+i+'@example.test']);
 await q("insert into auth.users(id,email,raw_user_meta_data)values($1,$2,jsonb_build_object('nickname',$3::text))",[u,'reset'+i+'@example.test',i===2?'test reset':'reset user '+i]);
 await q("update profiles set is_admin=$2,character_key='char_01' where id=$1",[u,i===0]);
 await q("select apply_tx($1,'fixture','grant',10000000000000000,$2)",[u,'fixture-wallet-'+i]);
 await q("select bank_add($1,'deposit',1000000000000,$2)",[u,'fixture-bank-'+i]);
}
const u=users[0];await uid(u);await rpc('gc_economy.check_definitions()');
const season=(await q('select (ch_season()).no n'))[0].n;
await q("insert into loans(kind,borrower,principal,rate,days,due_total,status)values('bank',$1,100,10,7,110,'active')",[u]);
const offer=(await q("insert into loans(kind,lender,principal,rate,days,status)values('p2p',$1,100,10,7,'offer')returning id",[u]))[0].id;
const tb=(await q('select id from poker_tables where level=1'))[0].id;
const bot=(await q("insert into poker_bots(table_id,name)values($1,'fixture')returning id",[tb]))[0].id;
await q('insert into poker_seats(table_id,seat_index,user_id,stack)values($1,0,$2,123000000),($1,1,$3,999000000)',[tb,u,bot]);
await q("insert into poker_hands(table_id,hand_no,street,players)values($1,12,'flop',jsonb_build_object('0',jsonb_build_object('user',$2::uuid,'stack',123000000,'committed',400000)))on conflict(table_id)do update set street='flop',players=excluded.players,hand_no=12",[tb,u]);
await q('insert into sl_free values($1,6,1000000)',[u]);await q('insert into bj_boost values($1,50,100000000)',[u]);
const job=(await q("insert into job_runs(user_id,game,level,puzzle,secret,pay,deadline)values($1,'dealer',1,'{}','{}',1000000,now()+interval '1 hour')returning id",[u]))[0].id;
const pm=(await q("insert into pm_runs(user_id,ref,stake,mode,rocks,phase,bank_units)values($1,'fixture-pm',100,'normal','[[],[],[],[]]','checkpoint',1000000000)returning id",[u]))[0].id;
const ck=(await q("insert into ck_runs(user_id,ref,stake,mode,step)values($1,'fixture-ck',100,'normal',5)returning id",[u]))[0].id;
const f90=(await q("insert into f90_runs(user_id,ref,stake,stage,num,den)values($1,'fixture-f90',100,4,100000,1)returning id",[u]))[0].id;
const generic=(await q("insert into game_rounds(user_id,game,stake)values($1,'fixture',100)returning id",[u]))[0].id;
const bj=(await q("insert into bj_rounds(user_id,ref,status,main_bet,hands,dealer,total_staked)values($1,'fixture-bj','playing',100,'[{\"cards\":[\"AS\",\"KH\"],\"bet\":100,\"done\":false}]',array['AS','2H'],100)returning id",[u]))[0].id;
await q("insert into bjt_rounds(t_no,round_no,phase)values(1,999,'playing')");
const dp=(await q("insert into dp_rounds(game,phase)values('tcp','d1')returning id"))[0].id;await q("insert into dp_hands(round_id,user_id,ante,ref)values($1,$2,100,'fixture-dp')",[dp,u]);
await q("insert into rl_live_rounds values(999,1,'{}','{}',now())");await q("insert into rl_live_bets(round_no,user_id,mode,ref,bets,total)values(999,$1,'classic','fixture-rll','{}',100)",[u]);
await q("insert into if_rounds(round_no,start_at,dur,seg,cat,boost_seg,boost_mult)values(999,0,42,1,'dark',1,2)");await q("insert into if_bets(round_no,user_id,ref,bets,total)values(999,$1,'fixture-if','{}',100)",[u]);
const zr=(await q('insert into zlm_private.rounds default values returning id'))[0].id;await q("insert into zlm_private.bets(round_id,user_id,spot,amount)values($1,$2,'one',100)",[zr,u]);await q('update zlm_private.control set round_id=$1 where id=1',[zr]);
await q("insert into tourneys(season,players,prize)values($1,array[$2::uuid],10000000)",[season,u]);
await q("insert into cron.job_run_details(jobid,status,start_time,end_time)select jobid,'succeeded',clock_timestamp(),clock_timestamp()from cron.job where jobname='golan-exchange'");
for(const status of ['open','awaiting_credit'])await q("insert into gx.positions(user_id,request,code,scope,direction,stake,leverage,days,entry,opened_at,expires_at,status,payout)values($1,gen_random_uuid(),'house','00000000-0000-0000-0000-000000000000',1,100,1,1,100,now(),now()+interval '1 day',$2,999999999)",[u,status]);
await q("select apply_tx($1,'fixture','stake',-1000,'fixture-stake')",[u]);
const initial=await q('select user_id,balance from wallets order by user_id'),profiles=await q('select id,nickname,character_key,is_admin from profiles order by id');
await assert.rejects(()=>rpc('gc_economy.reset_once()'),/pause_required/);
await rpc('gc_economy.pause()');await assert.rejects(()=>rpc("bank_move(10,'withdraw','during-pause')"),/economy_maintenance/);assert.deepEqual(await q('select user_id,balance from wallets order by user_id'),initial);
// A changed installed function aborts the whole reset without a partial snapshot.
const patch=fs.readFileSync('supabase/migrations/0102_slots_bonus_175.sql','utf8').match(/create or replace function dg_spin\([\s\S]*?end \$\$;/)[0];await d.exec(patch.replace('begin','begin\n -- independent change'));
await assert.rejects(()=>rpc('gc_economy.reset_once()'),/install_verified_0102_first/);assert.equal((await q('select count(*)::int n from gc_economy.backups'))[0].n,0);assert.deepEqual(await q('select user_id,balance from wallets order by user_id'),initial);await d.exec(patch);
// A failure AFTER snapshots, cancellations and the first account must roll back ALL changes.
await d.exec(`create function gc_economy.fixture_fail()returns trigger language plpgsql as $$begin if new.kind='economy_reset' and new.user_id='00000000-0000-0000-0000-000000000002' then raise exception 'fixture_mid_reset_failure';end if;return new;end$$;create trigger fixture_fail before insert on bank_tx for each row execute function gc_economy.fixture_fail();`);
await assert.rejects(()=>rpc('gc_economy.reset_once()'),/fixture_mid_reset_failure/);
assert.deepEqual(await q('select user_id,balance from wallets order by user_id'),initial);
assert.equal((await q('select count(*)::int n from gc_economy.backups'))[0].n,0);
assert.equal((await q('select batch from gc_economy.control'))[0].batch,null);
assert.equal((await q('select phase from pm_runs where id=$1',[pm]))[0].phase,'checkpoint');
await d.exec('drop trigger fixture_fail on bank_tx;drop function gc_economy.fixture_fail()');
const result=await rpc('gc_economy.reset_once()');assert.equal(result.result,'PASS');assert.equal(result.accounts,3);assert.equal(result.bank_total,'150000000');assert.equal(result.wallet_total,'0');assert.equal(result.outstanding_claims,0);assert(result.backups>40);
assert.deepEqual(await q('select id,nickname,character_key,is_admin from profiles order by id'),profiles);
assert.equal((await q("select (x->>'balance')::numeric::text v from gc_economy.backups b cross join lateral jsonb_array_elements(b.data)x where table_name='wallets' and x->>'user_id'=$1",[u]))[0].v,initial[0].balance.toString());
assert.equal((await q('select count(*)::int n from poker_seats'))[0].n,1,'bot retained, human stood up');assert.equal((await q('select hand_no from poker_hands where table_id=$1',[tb]))[0].hand_no,13);
assert.equal((await q('select count(*)::int n from leaderboard where wealth<>50000000'))[0].n,0,'leaderboard includes no hidden old wealth');
const ledger=await q('select count(*)::int n from wallet_transactions');assert.equal((await rpc('gc_economy.reset_once()')).already_done,true);assert.deepEqual(await q('select count(*)::int n from wallet_transactions'),ledger);
await assert.rejects(()=>rpc("bank_move(10,'withdraw','after-reset-before-resume')"),/economy_maintenance/);
assert.equal((await rpc('gc_economy.resume()')).maintenance,false);
await rpc('settle_round($1,1000000000)',[generic]);
for(const [name,args]of [['pm_next($1,true)',[pm]],['ck_cash($1)',[ck]],['f90_cash($1)',[f90]],['bj_finish($1)',[bj]],['gx.credit($1)',[(await q('select id from gx.positions limit 1'))[0].id]],['poker_cash_leave($1)',[tb]],['salary_claim()',[]],['gc_level_check()',[]],['ch_settle()',[]]])await rpc(name,args);
await assert.rejects(()=>rpc('loan_cancel($1)',[offer]),/not_offer|loan_closed|offer_closed|not_found/);
assert.equal((await rpc('job_finish($1,$2)',[job,{}])).paid,0);
assert.equal((await rpc('gc_economy.verify()')).result,'PASS','old callbacks cannot resurrect wealth');
// Force a fresh house calculation; the cached zero is not the source of truth.
await q("update house_stats set at=now()-interval '10 minutes'");assert.equal((await rpc('house_stats()')).total,0);
// New legitimate play and banking work normally and contribute to the NEW house baseline.
await rpc("bank_move(1000,'withdraw','post-reset-withdraw')");await rpc("apply_tx($1,'fixture','stake',-100,'new-stake')",[u]);await q("update house_stats set at=now()-interval '10 minutes'");assert.equal((await rpc('house_stats()')).total,100);
await d.exec(fs.readFileSync('supabase/migrations/0103_economy_reset_tools.sql','utf8'));
const later=await q('select balance from wallets where user_id=$1',[u]);await rpc('gc_economy.reset_once()');assert.deepEqual(await q('select balance from wallets where user_id=$1',[u]),later,'rerun after new play does not reset again');
await rpc('gc_economy.pause()');assert.equal((await rpc('gc_economy.resume()')).already_resumed,true);
// Simulate a request whose transaction predates the cutoff: reject before any write.
await q("update gc_economy.control set reset_at=clock_timestamp()+interval '1 minute'");await assert.rejects(()=>rpc("apply_tx($1,'fixture','grant',1000000000,'stale-credit')",[u]),/economy_request_expired_retry/);
await d.exec('set role authenticated');await assert.rejects(()=>rpc('gc_economy.reset_once()'),/permission denied/);await assert.rejects(()=>q('select * from gc_economy.backups'),/permission denied/);await d.exec('reset role');
console.log('PASS: complete migration chain, isolated 50M reset, private snapshots, all claims closed, maintenance, replay protection, preserved profiles, stale requests, house baseline and normal post-reset banking');await d.close()})().catch(e=>{console.log(e.stack);process.exit(1)})
