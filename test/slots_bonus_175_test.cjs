const fs=require('node:fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.poker-test-runtime/node_modules/@electric-sql/pglite');
const read=n=>fs.readFileSync('supabase/migrations/'+n,'utf8');
const funcs=s=>[...s.matchAll(/create or replace function (\w+)\([^;]*?\$\$[\s\S]*?\$\$;/gi)];
const table=(s,n)=>s.match(new RegExp('create table (?:if not exists )?'+n+'\\s*\\([\\s\\S]*?\\);','i'))[0];
(async()=>{
 const db=new PGlite(),q=async(s,a=[])=>(await db.query(s,a)).rows;
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;create function chat_sys(text,text)returns void language sql as $$select$$;`);
 const core=read('0001_core.sql');for(const n of ['profiles','wallets','wallet_transactions'])await db.exec(table(core,n));
 await db.exec(funcs(core).find(m=>m[1]==='apply_tx')[0]);
 for(const [file,names]of [['0009_slots.sql',['sl_spins']],['0014_fortune.sql',['sl_jackpots']],['0021_fortune_free.sql',['sl_free']],['0033_pachinko.sql',['pc_spins']],['0035_kinneret.sql',['kin_spins']],['0037_wild_west.sql',['ww_spins']],['0045_dragons.sql',['dg_spins']]])for(const n of names)await db.exec(table(read(file),n));
 await db.exec('alter table sl_spins add machine text,add jackpot jsonb');
 const latest=new Map();for(const f of fs.readdirSync('supabase/migrations').sort())for(const m of funcs(read(f)))if(/^(fo_(strip|stop|pay3|line|eval|state)|rl_randint|pc_pick)$/.test(m[1]))latest.set(m[1],m[0]);for(const s of latest.values())await db.exec(s);
 const boost=read('0088_slots_bonus_x4.sql'),stats=[];
 for(const [prefix,file,engine]of [['dg','0045_dragons.sql','dg'],['kin','0034_kin_seeds.sql','kin'],['ww','0036_ww_seeds.sql','ww']]){
  const s=read(file),n=prefix+'_seeds';await db.exec(table(s,n));for(const m of s.matchAll(new RegExp('insert into '+n+' \\(id, seed, total\\) values [\\s\\S]*?;','gi')))await db.exec(m[0]);await db.exec('alter table '+n+' add bonus boolean not null default false');await db.exec(boost.match(new RegExp('update '+n+' set bonus = [\\s\\S]*?;'))[0]);
  const ctx={module:{exports:{}}};require('node:vm').runInNewContext(fs.readFileSync('docs/vendor/'+engine+'_engine.js','utf8'),ctx);const E=ctx.module.exports,rows=await q('select * from '+n+' order by id');let b=0;
  for(const r of rows){const v=E.play(Number(r.seed));const bonus=prefix==='kin'?v.fs>0:!!v.bonus;assert.equal(r.bonus,bonus,`${prefix} seed ${r.id} bonus classification`);if(bonus)b++;}
  assert.equal(rows.length,30000);const p=b/rows.length,extra=.75*p/(1-p);assert(Math.abs((p+(1-p)*extra)/p-1.75)<1e-12);stats.push({machine:prefix,original:p,target:p*1.75,originalOneIn:1/p,targetOneIn:1/(p*1.75)});
 }
 const baseline=read('0092_machine_wallet_and_protein.sql');for(const m of funcs(baseline))if(['dg_spin','kin_spin','ww_spin','pc_spin','fo_spin'].includes(m[1]))await db.exec(m[0]);
 const sql=read('0102_slots_bonus_175.sql');await db.exec(sql);await db.exec(sql);
 assert.match((await q(fs.readFileSync('test/slots_bonus_175_live_check.sql','utf8')))[0].validation,/^PASS:/);
 // A different installed definition must abort instead of overwriting unrelated changes.
 const patched=funcs(sql).find(m=>m[1]==='fo_spin')[0];await db.exec(patched.replace('begin','begin\n  -- independent production change'));
 await assert.rejects(()=>db.exec(sql),/Unexpected installed fo_spin/);await db.exec('rollback');await db.exec(patched);await db.exec(sql);
 // Exhaustive original Fortune reel weights, including adjacency and wraparound.
 const strip=(await q('select fo_strip() s'))[0].s,w=strip.map(s=>s==='FREE'?7:s==='ZEUS'?3:4),sum=w.reduce((a,b)=>a+b),free=strip.reduce((a,_,i)=>a+([strip[(i+31)%32],strip[i],strip[(i+1)%32]].includes('FREE')?w[i]:0),0);
 assert.equal(sum,133);assert.equal(free,29);const p=(free/sum)**3;stats.push({machine:'fortune',original:p,target:p*1.75,originalOneIn:1/p,targetOneIn:1/(p*1.75)});
 const bin=(n,k)=>{let a=1;for(let i=1;i<=k;i++)a=a*(n-i+1)/i;return a;};let p3=0;for(let k=3;k<=5;k++)p3+=bin(5,k)*.12**k*.88**(5-k);assert(Math.abs(p3-.0143188992)<1e-15);
 // Both regular and super probabilities scale equally; conditional badge rules unchanged.
 for(let k=3;k<=5;k++){const pk=bin(5,k)*.12**k*.88**(5-k);assert(Math.abs((pk+(1-p3)*(.75*p3/(1-p3))*(pk/p3))/pk-1.75)<1e-12);}
 stats.push({machine:'pachinko',original:p3,target:p3*1.75,originalOneIn:1/p3,targetOneIn:1/(p3*1.75)});
 const u='00000000-0000-0000-0000-000000000001';await q('insert into auth.users values($1)',[u]);await q("insert into profiles(id,nickname)values($1,'test-slots175')",[u]);await q('insert into wallets(user_id,balance)values($1,1000000000000)',[u]);await q("select set_config('request.jwt.sub',$1,false)",[u]);
 await db.exec("insert into sl_jackpots(kind,amount,drop_at,deadline)values('mini',250000,now()+interval '7 days',now()+interval '14 days'),('grand',1000000,null,null)");
 for(const [name,prefix,mult]of [['dg_spin','dg',1.022],['kin_spin','kin',1.05],['ww_spin','ww',1.035]]){
  for(let i=0;i<120;i++){const s=(await q(`select ${name}(100,$1) s`,[name+i]))[0].s;assert.equal(s.payout,Math.floor(100*Number(s.total)*mult));}
  const before=(await q('select balance from wallets where user_id=$1',[u]))[0].balance;const replay=(await q(`select ${name}(100,$1) s`,[name+'0']))[0].s;assert.equal((await q('select balance from wallets where user_id=$1',[u]))[0].balance,before);assert.equal(replay.stake,100);
  await assert.rejects(()=>q(`select ${name}(1,'invalid')`),/invalid_amount/);
 }
 for(const name of ['pc_spin','fo_spin']){
  for(let i=0;i<200;i++){const s=(await q(`select ${name}(100,$1) s`,[name+i]))[0].s;assert(s.payout>=0);if(name==='pc_spin'){const t=s.grid.filter(n=>n===6).length;assert.equal(!!s.bonus,t>=3);if(s.bonus)assert.equal(s.bonus.kind,t===3?'regular':'super');const expected=Math.floor((Math.floor(100*s.line_mult/10)+100*(s.bonus?.total||0))*1.045);assert.equal(s.payout,expected);}}
  const before=(await q('select balance from wallets where user_id=$1',[u]))[0].balance;await q(`select ${name}(100,$1)`,[name+'0']);assert.equal((await q('select balance from wallets where user_id=$1',[u]))[0].balance,before);
 }
 // Paid all-in remains permitted by 0092; no cache/UI changes are needed.
 const bal=(await q('select balance from wallets where user_id=$1',[u]))[0].balance;await q('select dg_spin($1,\'all-in\')',[bal]);
 await q("select set_config('request.jwt.sub','',false)");await assert.rejects(()=>q("select dg_spin(100,'anon')"),/not_signed_in/);
 console.log(JSON.stringify(stats,null,2));console.log('PASS: 90,000 real seeds; exact probabilities; real PostgreSQL spin paths, payouts, repeat refs, all-in and authentication');await db.close();
})().catch(e=>{console.error(e);process.exit(1)});
