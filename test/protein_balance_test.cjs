const fs=require('fs');const{PGlite}=require('../.poker-test-runtime/node_modules/@electric-sql/pglite');(async()=>{const d=new PGlite();await d.exec(fs.readFileSync('test/supabase_stub.sql','utf8').replace(/create extension[^;]*;/gi,''));await d.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid,bucket_id text);create function extensions.gen_random_bytes(int)returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$;create function extensions.crypt(text,text)returns text language sql as $$select 'local-test-stub'::text$$;create function extensions.gen_salt(text)returns text language sql as $$select 'local-test-stub'::text$$;create schema cron;create table cron.job(jobid bigserial,jobname text unique,schedule text,command text,active boolean default true);create table cron.job_run_details(jobid bigint,status text,start_time timestamptz,end_time timestamptz,return_message text);create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin insert into cron.job(jobname,schedule,command)values($1,$2,$3)on conflict(jobname)do update set schedule=$2,command=$3;return 1;end$$;`);for(const f of fs.readdirSync('supabase/migrations').sort().filter(f=>f.slice(0,4)<='0105')){try{await d.exec(fs.readFileSync('supabase/migrations/'+f,'utf8').replace(/create extension[^;]*;/gi,''));}catch(e){throw new Error('Migration '+f+': '+e.message)}}

const assert=require('node:assert/strict'),q=async(s,a=[])=>(await d.query(s,a)).rows;
const rpc=async(s,a=[])=>(await q('select '+s+' v',a))[0].v;
const users=['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'];
const uid=async u=>q("select set_config('request.jwt.sub',$1,false)",[u]);
for(const [i,u]of users.entries()){
 await q('insert into invitations(email)values($1)',['protein'+i+'@example.test']);
 await q('insert into auth.users(id,email)values($1,$2)',[u,'protein'+i+'@example.test']);
}
await uid(users[1]);const legacy=await rpc("pm_start(100,'normal','legacy-run')"),saved=(await q('select rocks from pm_runs where id=$1',[legacy.id]))[0].rocks;
const balances=await q('select user_id,balance from wallets order by user_id');
const sql=fs.readFileSync('supabase/migrations/0106_protein_balanced_bombs.sql','utf8');await d.exec(sql);await d.exec(sql);
assert.deepEqual(await q('select user_id,balance from wallets order by user_id'),balances);assert.deepEqual((await q('select rocks from pm_runs where id=$1',[legacy.id]))[0].rocks,saved,'active runs not reshuffled');
for(const [mode,expected]of [['easy',[3,4,5,6]],['normal',[4,5,6,7]],['extreme',[5,6,7,8]]])for(let i=0;i<500;i++){
 const board=await rpc('pm_make($1)',[mode]);assert.equal(board.length,48);assert.equal(new Set(board.map(k=>k.id)).size,48);
 for(let l=0;l<4;l++){const layer=board.filter(k=>k.layer===l);assert.equal(layer.length,12);assert.equal(layer.filter(k=>k.bomb).length,expected[l]);assert(layer.filter(k=>!k.bomb).length>=4);assert(layer.every(k=>!k.tagged||!k.bomb));assert(layer.every(k=>['chicken','mushroom'].includes(k.food)));}
}
await assert.rejects(()=>rpc("pm_make('invalid')"),/invalid_mode/);
await uid(users[0]);let serial=0;
const start=mode=>rpc('pm_start(100,$1,$2)',[mode,'run-'+serial++]);
async function finish(state){for(let l=0;l<4;l++){const picks=state.rocks.filter(k=>k.layer===l&&!k.bomb&&!k.taken).slice(0,3);assert.equal(picks.length,3);for(const k of picks)state=await rpc('pm_collect($1,$2)',[state.id,k.id]);if(l<3){assert.equal(state.phase,'checkpoint');state=await rpc('pm_next($1,false)',[state.id]);}}return state;}
for(const [mode,min]of [['easy',2],['normal',5],['extreme',10]]){
 let state=await start(mode);assert(state.rocks.every(k=>!('units'in k)),'uncollected amounts hidden');const before=(await q('select balance from wallets where user_id=$1',[users[0]]))[0].balance;
 const miss=await rpc('pm_collect($1,-1)',[state.id]);assert.equal(miss.successes,0);assert.equal(miss.got.miss,true);assert.equal((await q('select balance from wallets where user_id=$1',[users[0]]))[0].balance,before);
 const id=state.id;state=await finish(state);assert.equal(state.successes,12);assert.equal(state.phase,'finished');assert(state.paid>=100*min);
 assert.equal((await q('select count(*)::int n from wallet_transactions where settlement_ref=$1',['pmpay:'+id]))[0].n,1);
 const paid=(await q('select balance from wallets where user_id=$1',[users[0]]))[0].balance;await assert.rejects(()=>rpc('pm_collect($1,0)',[id]),/not_playing/);assert.equal((await q('select balance from wallets where user_id=$1',[users[0]]))[0].balance,paid);
}
let state=await start('extreme');await uid(users[1]);await assert.rejects(()=>rpc('pm_collect($1,-1)',[state.id]),/run_not_found/);await uid(users[0]);
const bomb=state.rocks.find(k=>k.layer===0&&k.bomb);state=await rpc('pm_collect($1,$2)',[state.id,bomb.id]);assert.equal(state.phase,'busted');assert.equal(state.bank_units,0);
await d.exec(fs.readFileSync('test/protein_balance_live_check.sql','utf8'));
// Every target centre remains hittable for EVERY bomb/food pattern, including
// maximum-size sprites, across a complete motion cycle. No bomb blocks a food.
const ctx={window:{}};require('node:vm').runInNewContext(fs.readFileSync('docs/pm-geometry.js','utf8'),ctx);const geo=ctx.window.PM_GEOMETRY;
for(let mask=0;mask<4096;mask++)for(let t=0;t<4;t+=.25){
 const rocks=Array.from({length:12},(_,i)=>({id:i,layer:0,w:134.8,bomb:!!(mask&(1<<i)),...geo.position(i,t,true)}));
 for(const k of rocks){assert(k.x-k.w*.625>=0&&k.x+k.w*.625<=1920&&k.y+k.w*.625<=1080);const angle=Math.atan2(k.x-1000,k.y-280);assert(Math.abs(angle)<=1.46);const hit=geo.hit(rocks,0,angle);assert.equal(hit.rock.id,k.id,'no inaccessible target');assert(hit.distance<=geo.limit(angle));}
}
assert.notEqual(geo.position(5,0,true).x,geo.position(5,1,true).x);assert.notEqual(geo.position(5,0,true).y,geo.position(5,1,true).y);
console.log('PASS: 1500 boards; exact bombs by mode/layer; >=4 foods; safe tags; preserved old runs and payouts; 12 catches; auth; empty claw; no double pay; all moving targets reachable');await d.close();
})().catch(e=>{console.error(e.stack);process.exit(1)});
