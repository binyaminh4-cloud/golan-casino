const fs=require('fs');const{PGlite}=require('../.poker-test-runtime/node_modules/@electric-sql/pglite');(async()=>{const d=new PGlite();await d.exec(fs.readFileSync('test/supabase_stub.sql','utf8').replace(/create extension[^;]*;/gi,''));await d.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid,bucket_id text);create function extensions.gen_random_bytes(int)returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$;create function extensions.crypt(text,text)returns text language sql as $$select 'local-test-stub'::text$$;create function extensions.gen_salt(text)returns text language sql as $$select 'local-test-stub'::text$$;create schema cron;create table cron.job(jobid bigserial,jobname text unique,schedule text,command text,active boolean default true);create table cron.job_run_details(jobid bigint,status text,start_time timestamptz,end_time timestamptz,return_message text);create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin insert into cron.job(jobname,schedule,command)values($1,$2,$3)on conflict(jobname)do update set schedule=$2,command=$3;return 1;end$$;`);for(const f of fs.readdirSync('supabase/migrations').sort().filter(f=>f.slice(0,4)<='0103')){try{await d.exec(fs.readFileSync('supabase/migrations/'+f,'utf8').replace(/create extension[^;]*;/gi,''));}catch(e){throw new Error('Migration '+f+': '+e.message)}}
const assert=require('node:assert/strict'),q=async(s,a=[])=>(await d.query(s,a)).rows;
const rpc=async(s,a=[])=>(await q('select '+s+' v',a))[0].v;
const users=['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004'];
for(const [i,u]of users.entries()){
 await q('insert into invitations(email)values($1)',['reward'+i+'@example.test']);
 await q("insert into auth.users(id,email,raw_user_meta_data)values($1,$2,jsonb_build_object('nickname',$3::text))",[u,'reward'+i+'@example.test',i===3?'test-excluded':'reward-'+i]);
 await q('update profiles set nickname=$2 where id=$1',[u,i===3?'test-excluded':'reward-'+i]);
 await q("select bank_add($1,'deposit',1000,$2)",[u,'fixture-bank-'+i]);
}
const u=users[0];await q("select set_config('request.jwt.sub',$1,false)",[u]);
await q("insert into seasons(no,starts_at,ends_at,settled)values(1,now()-interval '3 days',now()-interval '2 days',true),(2,now()-interval '2 days',now()-interval '1 second',false)");
await rpc("apply_tx($1,'season','grant',1000000000,'season:1:champion')",[u]);
for(const [i,id]of users.entries())for(const kind of ['fisher','ido','zeus','tourney'])await q('insert into ch_points(season,user_id,kind,points)values(2,$1,$2,$3)',[id,kind,i===3?9999:100-i*20]);
const balances=await q('select user_id,balance from wallets order by user_id');
const sql=fs.readFileSync('supabase/migrations/0104_season_prize_shabbat_200.sql','utf8');await d.exec(sql);await d.exec(sql);
assert.deepEqual(await q('select user_id,balance from wallets order by user_id'),balances,'install does not pay or reset balances');
await rpc('ch_settle()');
assert.equal((await q("select amount::text n from wallet_transactions where settlement_ref='season:2:champion'"))[0].n,'15000000000');
assert.equal((await q("select amount::text n from wallet_transactions where settlement_ref='season:1:champion'"))[0].n,'1000000000','no retroactive top-up');
for(const [place,amount]of [[1,100000000],[2,50000000],[3,25000000]])assert.equal((await q("select count(*)::int n from wallet_transactions where settlement_ref like 'season:2:%:'||$1 and amount=$2",[String(place),amount]))[0].n,4);
assert.equal((await q("select count(*)::int n from wallet_transactions where user_id=$1 and game='season'",[users[3]]))[0].n,0,'test account with most points is excluded');
const ledger=await q('select count(*)::int n from wallet_transactions');await rpc('ch_settle()');assert.deepEqual(await q('select count(*)::int n from wallet_transactions'),ledger,'prizes paid once');
// Force only the calendar boundary in the isolated database; all five real
// payment functions still call the actual new gc_job_mult implementation.
await d.exec("create or replace function gc_shabbat_until()returns timestamptz language sql stable as $$select now()+interval '1 hour'$$");
assert.equal(await rpc('gc_job_mult()'),3);
const wealth=async()=> (await q('select ((select balance::numeric from wallets where user_id=$1)+(select balance::numeric from bank_accounts where user_id=$1))::text n',[u]))[0].n;
for(const [game,level,pay,secret,call,extra,expected]of [
 ['dealer',1,170000,{values:[]},'job_finish($1,$2)',[[]],510000],
 ['driver',1,70000,{stops:8},'bus_finish($1,8,0,0)',[],1680000],
 ['fisher',1,0,{casts:20},'fish_finish($1,0,0,5,5)',[],9000000],
 ['fiber',4,6000000,{},'fiber_finish($1,3)',[],54000000],
 ['tamer',4,0,{drops:10},'tamer_finish($1,0,0,5,5,0,0)',[],37500000]]){
 const id=(await q("insert into job_runs(user_id,game,level,puzzle,secret,pay,started_at,deadline)values($1,$2,$3,'{}',$4,$5,now()-interval '1 minute',now()+interval '1 hour')returning id",[u,game,level,secret,pay]))[0].id;
 const before=BigInt(await wealth());let args=[id,...extra];if(game==='dealer')args=[id,'[]'];
 const result=await rpc(call,args);assert.equal(result.paid,expected,game+' Shabbat payout');assert.equal(BigInt(await wealth())-before,BigInt(expected));
 if(game==='dealer')await rpc(call,args);else await assert.rejects(()=>rpc(call,args),/already_done/);
 assert.equal(BigInt(await wealth())-before,BigInt(expected),'repeat cannot pay again');
}
await d.exec("create or replace function gc_shabbat_until()returns timestamptz language sql stable as $$select null::timestamptz$$");assert.equal(await rpc('gc_job_mult()'),1);
const normal=(await q("insert into job_runs(user_id,game,level,puzzle,secret,pay,started_at,deadline)values($1,'fiber',1,'{}','{}',250000,now()-interval '1 minute',now()+interval '1 hour')returning id",[u]))[0].id;
assert.equal((await rpc('fiber_finish($1,3)',[normal])).paid,750000,'normal-day rate unchanged');
assert.match((await q(fs.readFileSync('test/season_shabbat_live_check.sql','utf8')))[0].validation,/^PASS:/);
for(const f of ['docs/challenges.html','docs/index.html','docs/guide.js']){const text=fs.readFileSync(f,'utf8');assert(text.includes('₪15,000,000,000'));assert(!text.includes('₪1,000,000,000'));}
const jobs=fs.readFileSync('docs/jobs.js','utf8');assert(jobs.includes('M = SAT ? 3 : 1'));assert(jobs.includes('+200%'));assert(!jobs.includes('+500%'));
console.log('PASS: full migration chain; 15B champion; unchanged podiums; no retroactive or double prizes; test exclusions; x3 Shabbat for all five jobs; x1 weekdays; UI labels');await d.close();
})().catch(e=>{console.error(e.stack);process.exit(1)});
