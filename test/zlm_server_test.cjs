// Real isolated PostgreSQL, synthetic users, production money primitive and complete new migration.
const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.poker-test-runtime/node_modules/@electric-sql/pglite');
async function main(){
 const db=new PGlite(), q=async(sql,a=[])=>(await db.query(sql,a)).rows;
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;
 create schema cron;create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;`);
 const core=fs.readFileSync('supabase/migrations/0001_core.sql','utf8');
 for(const name of ['profiles','wallets','wallet_transactions'])await db.exec(core.match(new RegExp('create table '+name+' \\([\\s\\S]*?\\n\\);'))[0]);
 await db.exec(core.match(/create or replace function apply_tx\([\s\S]*?\$\$;/)[0]);
 await db.exec(fs.readFileSync('supabase/migrations/0007_lightning_roulette.sql','utf8').match(/create or replace function rl_randint\([\s\S]*?\$\$;/)[0]);
 const migration=fs.readFileSync('supabase/migrations/0097_zman_lamatvach.sql','utf8');
 await db.exec(migration);await db.exec(migration);
 const batchMigration=fs.readFileSync('supabase/migrations/0098_zman_repeat_bets.sql','utf8');await db.exec(batchMigration);await db.exec(batchMigration);
 const spinMigration=fs.readFileSync('supabase/migrations/0099_zman_spin_duration.sql','utf8');await db.exec(spinMigration);await db.exec(spinMigration);
 const users=['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'];
 for(const u of users)await db.query("insert into auth.users values($1);",[u]);
 for(const u of users){await db.query("insert into profiles(id,nickname) values($1,'test_zlm')",[u]);await db.query('insert into wallets(user_id,balance)values($1,1000000)',[u]);}
 let request=0;
 const uid=async u=>q("select set_config('request.jwt.sub',$1,false)",[u]);
 const rpc=async(name,a=[])=>(await q(`select ${name}(${a.map((_,i)=>'$'+(i+1)).join(',')}) as v`,a))[0].v;
 const state=()=>rpc('zlm_state');
 const next=async()=>{await db.exec("update zlm_private.rounds set deadline=clock_timestamp()-interval '1 millisecond' where id=(select round_id from zlm_private.control)");await rpc('zlm_private.tick');return state();};
 const bet=async(r,spot,n,ref)=>rpc('zlm_bet',[r,spot,n,ref||`10000000-0000-0000-0000-${String(++request).padStart(12,'0')}`]);
 const force=async(cell,boost=1)=>db.query("update zlm_private.rounds set cell=$1,spot=(zlm_private.spots())[$1],boosts=jsonb_build_object($1::text,$2::int) where id=(select round_id from zlm_private.control)",[cell,boost]);
 const newRound=async()=>{await db.exec("update zlm_private.rounds set phase='summary',deadline=clock_timestamp()-interval '1 millisecond' where id=(select round_id from zlm_private.control)");return state();};
 await uid('');await assert.rejects(state,/not_signed_in/);await assert.rejects(()=>rpc('zlm_ready'),/not_signed_in/);await uid(users[0]);
 assert.equal(await rpc('zlm_ready'),1);assert.equal((await q('select round_id from zlm_private.control'))[0].round_id,null);
 let s=await state();assert.equal(s.phase,'betting');assert.equal(s.cell,null);
 const batch=async(layout,ref='40000000-0000-0000-0000-000000000001')=>rpc('zlm_bet_batch',[s.id,layout,ref]);
 s=await batch({one:'100',f1:'200',i1:'300'});assert.equal(s.balance,'999400');assert.deepEqual(s.bets,{one:'100',f1:'200',i1:'300'});
 s=await batch({one:'100',f1:'200',i1:'300'});assert.equal(s.balance,'999400');
 const batchTx=(await q('select count(*)::int n from wallet_transactions'))[0].n;
 await assert.rejects(()=>batch({one:'100',bad:'100'},'40000000-0000-0000-0000-000000000002'),/invalid_bet/);
 await assert.rejects(()=>batch({one:'999400',f1:'1'},'40000000-0000-0000-0000-000000000003'),/invalid_amount/);
 assert.equal((await q('select count(*)::int n from wallet_transactions'))[0].n,batchTx);s=await bet(s.id,'all',0);assert.equal(s.balance,'1000000');
 const ref='20000000-0000-0000-0000-000000000001';
 await bet(s.id,'one',100,ref);s=await bet(s.id,'one',100,ref);assert.equal(s.balance,'999900');assert.equal(s.bets.one,'100');
 s=await bet(s.id,'one',0);assert.equal(s.balance,'1000000');assert(!s.bets.one);
 // Request UUIDs belong to users: an identical UUID from another user must not steal a refund ref.
 for(const u of users){await uid(u);await bet(s.id,'one',100,'30000000-0000-0000-0000-000000000001');const cancelled=await bet(s.id,'one',0,'30000000-0000-0000-0000-000000000002');assert.equal(cancelled.balance,'1000000');}await uid(users[0]);
 await assert.rejects(()=>bet(s.id,'not-a-spot',100),/invalid_bet/);
 await assert.rejects(()=>bet(s.id,'one',1000001),/invalid_amount/);
 await bet(s.id,'one',100);const oldId=s.id;s=await next();assert.equal(s.phase,'spin');assert.equal(Date.parse(s.deadline)-Date.parse(s.phase_at),9000);
 assert(Object.keys(s.boosts).length>=3&&Object.keys(s.boosts).length<=10);
 assert(s.cell>=1&&s.cell<=54);await assert.rejects(()=>bet(s.id,'one',1),/betting_closed/);
 await assert.rejects(()=>rpc('zlm_bet_batch',[s.id,{one:'1'},'40000000-0000-0000-0000-000000000004']),/betting_closed/);
 await force(2);s=await next();assert.equal(s.phase,'summary');assert.equal(s.last_result.payout,'200');assert.equal(s.balance,'1000100');
 const tx=(await q('select count(*)::int n from wallet_transactions'))[0].n;await state();await rpc('zlm_private.tick');
 assert.equal((await q('select count(*)::int n from wallet_transactions'))[0].n,tx);
 for(const [spot,cell,wm,expected] of [['f1',9,1,2600],['i1',20,2,5100],['b1',30,1,4300]]){
  s=await newRound();await bet(s.id,spot,100);await bet(s.id,spot==='f1'?'i1':'f1',100);
  await next();await force(cell,wm);s=await next();assert.equal(s.last_result.payout,String(expected));
 }
 // Shared Yoav result, independent private selections and no hidden cup leakage.
 s=await newRound();await bet(s.id,'yoav',100);await uid(users[1]);await bet(s.id,'yoav',100);
 await next();await force(6,3);s=await next();assert.equal(s.phase,'choice');assert(!JSON.stringify(s).includes('cups'));
 await rpc('zlm_choose',[s.id,0]);s=await rpc('zlm_choose',[s.id,1]);assert.deepEqual(s.bonus.picks,[0]);
 await uid(users[0]);s=await state();assert.deepEqual(s.bonus.picks,[]);await rpc('zlm_choose',[s.id,1]);
 s=await next();assert.equal(s.phase,'reveal');const cups=s.bonus.cups;assert.equal(new Set(cups).size,3);
 s=await next();assert.equal(s.last_result.payout,String(100*(1+cups[1]*3)));
 await uid(users[1]);assert.equal((await state()).last_result.payout,String(100*(1+cups[0]*3)));await uid(users[0]);
 // Range extra shot: an ordinary winner cannot see unrevealed target values or select again.
 s=await newRound();await bet(s.id,'range',100);await uid(users[1]);await bet(s.id,'range',100);
 await next();await force(1,2);s=await next();
 await db.exec(`update zlm_private.rounds set secret='{"people":[0,1,2,3,4],"values":[10,100,25,30,50]}' where id=(select round_id from zlm_private.control)`);
 assert(s.bonus.targets.every(t=>t.value===undefined));await rpc('zlm_choose',[s.id,0]);
 await uid(users[0]);await rpc('zlm_choose',[s.id,3]);await next();s=await next();assert.equal(s.phase,'extra');
 assert.equal(s.bonus.targets.filter(t=>t.open).length,1);
 await assert.rejects(()=>rpc('zlm_choose',[s.id,3]),/invalid_pick/);await rpc('zlm_choose',[s.id,1]);
 await uid(users[1]);s=await state();assert.equal(s.phase,'extra');assert.equal(s.bonus.targets.filter(t=>t.open).length,1);
 await assert.rejects(()=>rpc('zlm_choose',[s.id,1]),/invalid_pick/);await uid(users[0]);
 await next();s=await next();assert.equal(s.last_result.payout,'26100');assert.equal(s.bonus.profit,130);
 // VIP: three distinct, locked picks, timeout fills missing choices.
 s=await newRound();await bet(s.id,'vip',100);await next();await force(12);s=await next();
 await rpc('zlm_choose',[s.id,0]);await rpc('zlm_choose',[s.id,0]);s=await next();assert.equal(s.bonus.picks.length,3);assert.equal(new Set(s.bonus.picks).size,3);
 s=await next();assert(s.bonus.profit>=55&&s.bonus.profit<=175);
 // Balls: 20 black in full bag; truncated draw sequence ends at exactly fourth black.
 for(let trial=0;trial<40;trial++){
  s=await newRound();await bet(s.id,'balls',100);await next();await force(23,2);s=await next();
  const secret=(await q('select secret from zlm_private.rounds where id=$1',[s.id]))[0].secret;
  assert.equal(secret.deck.filter(x=>x===0).length,4);assert.equal(secret.deck.at(-1),0);
  assert(!JSON.stringify(s).includes('deck'));assert.deepEqual(s.bonus.events,[]);
  await rpc('zlm_choose',[s.id,0]);s=await next();assert.equal(s.phase,'balls');
  await db.query("update zlm_private.rounds set phase_at=clock_timestamp()-interval '3.1 seconds',deadline=clock_timestamp()-interval '1 millisecond' where id=$1",[s.id]);
  s=await state();assert.equal(s.bonus.events.length,1);assert.equal(s.draws,1);
  await db.query("update zlm_private.rounds set phase_at=clock_timestamp()-interval '400 seconds',deadline=clock_timestamp()-interval '1 millisecond' where id=$1",[s.id]);
  // Keep the view heartbeat stale so catch-up settles offline without creating a fresh round.
  await db.exec("update zlm_private.control set viewed_at=clock_timestamp()-interval '1 day'");await rpc('zlm_private.tick');
  const settled=(await q('select * from zlm_private.rounds where id=$1',[s.id]))[0];assert.equal(settled.phase,'summary');
  const b=(await q('select * from zlm_private.bets where round_id=$1',[s.id]))[0];assert(b.settled);assert(b.payout>=1100&&b.payout<=200100);
 }
 const balls=(await rpc('zlm_private.balls_result',[[1,4,2,0,0,0,0,3],8]));assert.equal(balls.black,4);assert.deepEqual(balls.levels,[3,1,0]);
 const priv=(await q("select has_schema_privilege('authenticated','zlm_private','usage') a,has_function_privilege('anon','zlm_state()','execute') b"))[0];assert.equal(priv.a,false);assert.equal(priv.b,false);
 await db.exec('set role authenticated');await assert.rejects(()=>q('select * from zlm_private.rounds'),/permission denied/);s=await state();assert(s.id);await db.exec('reset role');
 console.log('PASS: migration twice; auth; request retry; cancel; wallet limit; colored letters; 1:1; profit-only wheel boost; atomic settle; two players; hidden data; Yoav; extra shot; VIP timeout; 40 ball rounds; offline catch-up; private schema.');
 if(process.env.GC_PLAYWRIGHT){
  // Drive the real page against this real PostgreSQL engine; no production account or wallet is used.
  const {chromium}=require(process.env.GC_PLAYWRIGHT),browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});let loseResponse=true,stateCalls=0;
  await uid(users[0]);await rpc('apply_tx',[users[0],'test','reset',1000000-Number((await state()).balance),'zlm_e2e_reset']);s=await newRound();const before=BigInt(s.balance);let betsBefore=(await q("select count(*)::int n from wallet_transactions where user_id=$1 and kind='stake'",[users[0]]))[0].n;
  await page.exposeFunction('__zlmRpc',async(name,args)=>{
   if(name==='zlm_state')stateCalls++;
   const keys={zlm_state:[],zlm_repeat_ready:[],zlm_bet:['p_round','p_spot','p_amount','p_request'],zlm_bet_batch:['p_round','p_layout','p_request'],zlm_choose:['p_round','p_pick']}[name];
   if(!keys)return {error:{message:'unexpected_rpc'}};
   try{const data=await rpc(name,keys.map(k=>args[k]));if(name==='zlm_bet'&&loseResponse){loseResponse=false;return {error:{message:'Failed to fetch'}};}return {data,error:null};}
   catch(e){return {data:null,error:{code:e.code,message:e.message}};}
  });
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'application/javascript',body:`window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'${users[0]}'}}}})},rpc:(name,args={})=>window.__zlmRpc(name,args)})};`}));
  await page.route('**/chat.js?*',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await page.route('**/sfx.js?*',r=>r.fulfill({contentType:'application/javascript',body:'window.GC_CHIPIFY=(el)=>el.classList.add("gcchip");window.SFX={muted:true,musicOn:false};'}));
  const failures=[];page.on('pageerror',e=>failures.push(e.message));
  await page.goto((process.env.GC_TEST_ORIGIN||'http://127.0.0.1:8766')+'/zman.html');await page.locator('#gcLoad').waitFor({state:'detached'});
  const callsBeforeResize=stateCalls;await page.evaluate(async()=>{for(let i=0;i<20;i++)dispatchEvent(new Event('resize'));await new Promise(requestAnimationFrame);});assert(stateCalls<=callsBeforeResize+1,'portrait resize events must not create extra polling');
  await page.locator('#guideMount .gd-btn').click();await page.locator('.gd').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.locator('.gd-skip').click();
  await page.locator('[data-spot=one]:enabled').waitFor();await page.locator('[data-spot=one]').click();
  await page.locator('#retry:visible').waitFor();assert.equal((await q('select balance::text b from wallets where user_id=$1',[users[0]]))[0].b,String(before-100n));
  await page.locator('#retry').click();await page.locator('[data-spot=one] .chip').waitFor();
  assert.equal((await q("select count(*)::int n from wallet_transactions where user_id=$1 and kind='stake'",[users[0]]))[0].n,betsBefore+1);
  const refresh=()=>page.evaluate(()=>dispatchEvent(new Event('online')));
  await next();await force(2);await refresh();await page.waitForFunction(()=>document.querySelector('#wheelTurn').getAnimations().length>0);
  assert(await page.locator('#wheelTurn').evaluate(el=>el.getAnimations().length>0));
  await next();await refresh();await page.locator('#receipt').filter({hasText:'זכייה כוללת ₪200'}).waitFor();
  s=await newRound();await refresh();await page.locator('[data-spot=range]:enabled').waitFor();await page.locator('[data-spot=range]').click();await page.locator('[data-spot=range] .chip').waitFor();
  await next();await force(1,2);await next();
  await db.exec(`update zlm_private.rounds set secret='{"people":[0,1,2,3,4],"values":[10,100,25,30,50]}' where id=(select round_id from zlm_private.control)`);
  await refresh();await page.locator('.target:enabled').first().waitFor();await page.locator('.target').nth(3).click();
  await page.locator('.target.selected').waitFor();assert.deepEqual((await state()).bonus.picks,[3]);
  await next();await next();await refresh();await page.locator('.target:enabled').first().waitFor();
  await page.locator('.target').nth(1).click();assert.equal((await state()).bonus.extra,1);
  await next();await next();await refresh();await page.locator('#receipt').filter({hasText:'26,100'}).waitFor();
  s=await newRound();await refresh();await page.locator('#repeat:enabled').click();await page.locator('[data-spot=range] .chip').waitFor();assert.equal((await state()).bets.range,'100');
  await page.locator('#cancel').click();await page.locator('[data-spot=range] .chip').waitFor({state:'detached'});
  await page.locator('#auto').click();await page.locator('#autoMenu [data-count="10"]').click();await page.locator('[data-spot=range] .chip').waitFor();assert.equal((await state()).bets.range,'100');
  const autoTx=(await q("select count(*)::int n from wallet_transactions where user_id=$1 and kind='stake'",[users[0]]))[0].n;
  await refresh();await refresh();assert.equal((await q("select count(*)::int n from wallet_transactions where user_id=$1 and kind='stake'",[users[0]]))[0].n,autoTx);
  await next();await force(2);await next();s=await newRound();await refresh();await page.locator('#auto').filter({hasText:'8'}).waitFor();assert.equal((await state()).bets.range,'100');
  await page.evaluate(()=>dispatchEvent(new Event('pagehide')));assert.equal(await page.locator('#auto').innerText(),'אוטומטי');
  assert.deepEqual(failures,[]);await browser.close();
  console.log('PASS: real browser + PostgreSQL: lost-response retry charged once; 100 -> 200; range + extra shot -> 26,100; atomic repeat; auto once per round and stop on exit.');
 }
 await db.close();
}
main().catch(e=>{console.error(e.message, e.where||'',e.position||'');process.exit(1)});
