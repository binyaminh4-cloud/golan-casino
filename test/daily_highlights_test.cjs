const fs=require('fs');const{PGlite}=require('../.poker-test-runtime/node_modules/@electric-sql/pglite');(async()=>{const d=new PGlite();await d.exec(fs.readFileSync('test/supabase_stub.sql','utf8').replace(/create extension[^;]*;/gi,''));await d.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid,bucket_id text);create function extensions.gen_random_bytes(int)returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$;create function extensions.crypt(text,text)returns text language sql as $$select 'local-test-stub'::text$$;create function extensions.gen_salt(text)returns text language sql as $$select 'local-test-stub'::text$$;create schema cron;create table cron.job(jobid bigserial,jobname text unique,schedule text,command text,active boolean default true);create table cron.job_run_details(jobid bigint,status text,start_time timestamptz,end_time timestamptz,return_message text);create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin insert into cron.job(jobname,schedule,command)values($1,$2,$3)on conflict(jobname)do update set schedule=$2,command=$3;return 1;end$$;`);for(const f of fs.readdirSync('supabase/migrations').sort().filter(f=>f.slice(0,4)<='0107')){try{await d.exec(fs.readFileSync('supabase/migrations/'+f,'utf8').replace(/create extension[^;]*;/gi,''));}catch(e){throw new Error('Migration '+f+': '+e.message)}}

const assert=require('node:assert/strict'),q=async(s,a=[])=>(await d.query(s,a)).rows,rpc=async(s,a=[])=>(await q('select '+s+' v',a))[0].v;
const u='00000000-0000-0000-0000-000000000001',v='00000000-0000-0000-0000-000000000002';
for(const [id,name] of [[u,'highlights'],[v,'second']]){await q('insert into invitations(email)values($1)',[name+'@fixture.test']);await q('insert into auth.users(id,email)values($1,$2)',[id,name+'@fixture.test']);await q('update profiles set nickname=$2 where id=$1',[id,name]);}
await q("select set_config('request.jwt.sub',$1,false)",[u]);
const migration=fs.readFileSync('supabase/migrations/0108_daily_highlights.sql','utf8');await d.exec(migration);await d.exec(migration);
const get=async()=>await rpc('gc_daily_highlights($1)',[u]);
assert.deepEqual((await get()).items,[]);
const pc=async(ref,stake,pay,user=u)=>q("insert into pc_spins(user_id,ref,stake,result,payout)values($1,$2,$3,'{}',$4)",[user,ref,stake,pay]);
await pc('loss',1000,500);await pc('win',100,600);await pc('other-user',1,999999,v);
assert.equal((await get()).items[0].profit,'500');assert.equal((await get()).items.length,1);
// Repeated settled updates cannot duplicate results.
await q("update pc_spins set result='{}' where ref='win'");assert.equal((await get()).items.length,1);
await q("insert into rl_live_rounds(round_no,result,lucky_l,lucky_x)values(999,1,'{}','{}')");
await q("insert into rl_live_bets(round_no,user_id,mode,ref,bets,total,payout,settled)values(999,$1,'lightning','livewin','[]',100,1000,true),(999,$1,'lightning','liveloss','[]',500,0,false)",[u]);
assert(!(await get()).items.some(x=>x.label==='רולטת הברק המחומש'));
await q("update rl_live_bets set settled=true where ref='liveloss'");assert.equal((await get()).items.find(x=>x.label==='רולטת הברק המחומש').profit,'400');
// A multi-spot ZLM round is one net result, never individual winning spots.
const z=(await q("insert into zlm_private.rounds default values returning id"))[0].id;
await q("insert into zlm_private.bets(round_id,user_id,spot,amount,payout,settled)values($1,$2,'one',100,1000,true),($1,$2,'red',600,0,true)",[z,u]);
assert.equal((await get()).items.find(x=>x.label==='זמן למטווח').profit,'300');
// Wallet and bank jobs combine once. Transfers, gifts, salaries and resets do not.
await q("select bank_add($1,'job',50,'job:bank')",[u]);await q("select apply_tx($1,'job_driver','grant',75,'job:wallet')",[u]);
await q("select bank_add($1,'gift',999999,'gift:excluded')",[u]);await q("select bank_add($1,'salary_weekly',999999,'salary:excluded')",[u]);
assert.equal((await get()).items.find(x=>x.kind==='jobs').profit,'125');
await q("select apply_tx($1,'season','grant',700,'season:1:champion')",[u]);assert.equal((await get()).items[0].profit,'700');assert.equal((await get()).items.length,5);
// Closed exchange needs actual credit, not an open mark-to-market gain.
const position=(await q("insert into gx.positions(user_id,request,code,scope,direction,stake,leverage,days,entry,opened_at,expires_at,status,payout)values($1,gen_random_uuid(),'house','00000000-0000-0000-0000-000000000000',1,1000,1,1,100,now(),now()+interval '1 day','awaiting_credit',1800) returning id",[u]))[0].id;
assert(!(await get()).items.some(x=>x.kind==='exchange'));
await rpc('gx.credit($1)',[position]);assert.equal((await get()).items.find(x=>x.kind==='exchange').profit,'800');
// Interest on a partial repayment: principal isn't profit; prior-day receipts matter.
const loan=(await q("insert into loans(kind,lender,borrower,principal,rate,days,due_total,repaid,status)values('p2p',$1,$2,1000,100,1,2000,0,'active')returning id",[u,v]))[0].id;
await q("select bank_add($1,'loan_back',900,$2)",[u,'before:back:'+loan]);
await q("update bank_tx set created_at=(date_trunc('day',now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem')-interval '1 second' where ref=$1",['before:back:'+loan]);
await q("select bank_add($1,'loan_back',1000,$2)",[u,'today:back:'+loan]);assert.equal((await get()).items.find(x=>x.kind==='interest').profit,'900');
// All cash tables are archived, with exactly one record per finished hand/player.
const table=(await q("select id from poker_tables where tourney is null limit 1"))[0].id;
await q("insert into poker_hands(table_id,hand_no,street,players,result)values($1,1,'done',$2,$3)on conflict(table_id)do update set hand_no=1,street='done',players=excluded.players,result=excluded.result",[table,JSON.stringify({'0':{user:u,committed:100}}),JSON.stringify({won:{'0':1100}})]);
assert.equal((await get()).items[0].profit,'1000');assert.equal((await get()).items[0].label,'פוקר');
await q("update poker_hands set updated_at=now() where table_id=$1",[table]);assert.equal((await q('select count(*)::int n from gc_highlights.poker_results'))[0].n,1);
await q("update poker_hands set street='idle',players='{}',result=null where table_id=$1",[table]);assert.equal((await get()).items[0].label,'פוקר');
// Test-only challenge chips must not enter the list.
await q("insert into bj_rounds(user_id,ref,status,main_bet,hands,active,dealer,total_staked,payout,ch_run)values($1,'challenge','done',1,'[]',0,'{}',1,999999,null)",[u]);
// Mark as a challenge via its FK (fixture).
const season=(await q("insert into seasons(no,starts_at,ends_at)values(1,now()-interval '1 day',now()+interval '1 day')returning no"))[0].no;
const challenge=(await q("insert into ch_runs(user_id,season,kind,deck,max_hands)values($1,$2,'fisher','{}',10)returning id",[u,season]))[0].id;
await q("update bj_rounds set ch_run=$1 where ref='challenge'",[challenge]);assert(!(await get()).items.some(x=>x.label==='בלאק ג׳ק'));
await q("select set_config('request.jwt.sub','',false)");await assert.rejects(()=>get(),/not_signed_in/);
await q("select set_config('request.jwt.sub',$1,false)",[v]);assert.equal((await get()).items.length,5); // signed-in members can view friends
await q('set role authenticated');await assert.rejects(()=>q('select * from gc_highlights.poker_results'),/permission denied/);await q('reset role');
assert.equal(await rpc("has_function_privilege('anon','gc_daily_highlights(uuid)','execute')"),false);
assert.equal(await rpc("has_schema_privilege('authenticated','gc_highlights','usage')"),false);
// Actual authenticated role can execute only the bounded RPC, not raw source data.
await q('set role authenticated');assert.equal((await get()).items.length,5);await q('reset role');
// Finished before midnight is excluded; settle after midnight counts the whole round.
const midnight=await rpc("date_trunc('day',now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem'");
await q("update gx.settlements set at=$1::timestamptz-interval '1 second' where source='public.pc_spins'",[midnight]);
assert(!(await get()).items.some(x=>x.label==='מכונת השירותים'));
await q("update gx.settlements set at=$1::timestamptz-interval '1 second' where source='public.rl_live_bets' and ref=(select id::text from rl_live_bets where ref='livewin')",[midnight]);
assert.equal((await get()).items.find(x=>x.label==='רולטת הברק המחומש').profit,'400');
await q("update profiles set nickname='test-hidden' where id=$1",[v]);await assert.rejects(()=>rpc('gc_daily_highlights($1)',[v]),/invalid_player/);
// Reading summaries never changes money or settlements.
const counts=await rpc("jsonb_build_array((select sum(balance::numeric) from wallets),(select sum(balance::numeric) from bank_accounts),(select count(*) from wallet_transactions),(select count(*) from bank_tx))");
await get();await get();assert.deepEqual(await rpc("jsonb_build_array((select sum(balance::numeric) from wallets),(select sum(balance::numeric) from bank_accounts),(select count(*) from wallet_transactions),(select count(*) from bank_tx))"),counts);
await q("insert into rl_spins(user_id,ref,bets,total,result,payout,mode)values($1,'private','[]',500,1,2500,'xxx')",[u]);
assert.equal((await get()).items[0].label,'רולטת XXX');assert.equal((await get()).items[0].profit,'2000');
await q("insert into sl_spins(user_id,ref,line_bet,total,stops,payout,machine)values($1,'free',100,0,'{1,1,1}',3000,'fortune')",[u]);
assert.equal((await get()).items[0].label,'מכונת האטרף');assert.equal((await get()).items[0].profit,'3000');
await q("insert into if_rounds(round_no,start_at,dur,seg,cat,boost_seg,boost_mult)values(1,0,20,0,'dark',1,2)");
await q("insert into if_bets(round_no,user_id,ref,bets,total,payout,settled)values(1,$1,'fish1','[]',100,5000,true),(1,$1,'fish2','[]',1000,0,true)",[u]);
assert.equal((await get()).items[0].label,'גלגל הדגים של עידו');assert.equal((await get()).items[0].profit,'3900');
console.log('PASS: net games, whole live/ZLM rounds, settled-only exchange, principal-free interest, daily wallet+bank jobs, prizes, top five, cash-poker archive, replay, member auth and private access');await d.close();
})().catch(e=>{console.error(e.stack);process.exit(1)});
