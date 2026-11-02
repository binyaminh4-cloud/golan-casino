// Real isolated PostgreSQL. Real bank_add; synthetic accounts and terminal game records.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.poker-test-runtime/node_modules/@electric-sql/pglite');
const read=n=>fs.readFileSync('supabase/migrations/'+n,'utf8');
const table=(sql,n)=>{const match=sql.match(new RegExp('create table (?:if not exists )?'+n.replaceAll('.','\\.')+'\\s*\\([\\s\\S]*?\\);','i'));if(!match)throw Error('table missing '+n);return match[0];};
(async()=>{
 const db=new PGlite(),q=async(s,a=[])=>(await db.query(s,a)).rows;
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;
 create schema cron;create table cron.job(jobid bigserial,jobname text primary key,schedule text,command text,active boolean default true);create table cron.job_run_details(jobid bigint,status text,start_time timestamptz,end_time timestamptz,return_message text);create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin insert into cron.job(jobname,schedule,command)values($1,$2,$3) on conflict(jobname)do update set schedule=$2,command=$3;return 1;end$$;`);
 const core=read('0001_core.sql');for(const n of ['profiles','wallets','wallet_transactions','game_rounds','poker_tables','poker_seats'])await db.exec(table(core,n));
 await db.exec('alter table profiles add column character_key text;alter table poker_tables add column tourney uuid;');
 await db.exec(table(read('0018_poker.sql'),'poker_hands'));await db.exec(table(read('0079_poker_bots.sql'),'poker_bots'));
 const bank=read('0060_bank.sql'),loans=read('0086_loans_house.sql');for(const n of ['bank_accounts','bank_tx'])await db.exec(table(bank,n));
 await db.exec(core.match(/create or replace function apply_tx\([\s\S]*?end \$\$;/)[0]);await db.exec(bank.match(/create or replace function bank_state\([\s\S]*?end \$\$;/)[0]);
 await db.exec(`create table loans(borrower uuid,status text);create function loan_tick() returns void language sql as $$select$$;create function loan_debt(uuid)returns bigint language sql as $$select 0::bigint$$;create function loan_pay_all(uuid,bigint,text)returns bigint language sql as $$select 0::bigint$$;`);
 await db.exec(loans.match(/create or replace function bank_add\([\s\S]*?end \$\$;/)[0]);
 await db.exec(loans.match(/create or replace function bank_move\([\s\S]*?end \$\$;/)[0]);
 await db.exec(bank.match(/create or replace function bank_bal\([\s\S]*?\$\$;/)[0]);await db.exec("create function loan_lent(uuid)returns bigint language sql as $$select 0::bigint$$;create function loan_late(uuid)returns boolean language sql as $$select false$$;");
 await db.exec(read('0069_challenges_economy.sql').match(/create or replace function gc_is_test\([\s\S]*?\$\$;/)[0]);
 await db.exec(read('0007_lightning_roulette.sql').match(/create or replace function rl_randint\([\s\S]*?\$\$;/)[0]);
 for(const [file,names]of [
 ['0004_roulette.sql',['rl_spins']],['0002_blackjack.sql',['bj_rounds']],['0009_slots.sql',['sl_spins']],
 ['0010_live_roulette.sql',['rl_live_rounds','rl_live_bets']],['0030_ido_fishing.sql',['if_rounds','if_bets']],
 ['0032_protein_miner.sql',['pm_runs']],['0031_fisher90.sql',['f90_runs']],['0033_pachinko.sql',['pc_spins']],
 ['0035_kinneret.sql',['kin_spins']],['0037_wild_west.sql',['ww_spins']],['0045_dragons.sql',['dg_spins']],
 ['0048_ido_chicken.sql',['ck_runs']],['0064_dealer_poker.sql',['dp_rounds','dp_hands']]])for(const n of names)await db.exec(table(read(file),n));
 await db.exec('create schema zlm_private');for(const n of ['zlm_private.rounds','zlm_private.bets'])await db.exec(table(read('0097_zman_lamatvach.sql'),n));
 const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002';
 for(const [u,n]of [[a,'alpha'],[b,'beta']]){await q('insert into auth.users values($1)',[u]);await q('insert into profiles(id,nickname)values($1,$2)',[u,n]);await q('insert into wallets(user_id,balance)values($1,0)',[u]);await q('insert into bank_accounts values($1,1000000)',[u]);}
 const sql=read('0100_golan_exchange.sql');await db.exec(sql);await db.exec(sql);
 const guard=read('0101_exchange_scheduler_guard.sql');await db.exec(guard);await db.exec(guard);
 assert.equal((await q('select gx.worker_ready() v'))[0].v,false,'no successful worker run means not ready');
 await q("insert into cron.job_run_details(jobid,status,start_time,end_time) select jobid,'succeeded',clock_timestamp(),clock_timestamp() from cron.job where jobname='golan-exchange'");
 const uid=async u=>q("select set_config('request.jwt.sub',$1,false)",[u]);
 const rpc=async(s,args=[])=>(await q('select '+s+' as v',args))[0].v;
 await uid('');await assert.rejects(()=>rpc('exchange_state()'),/not_signed_in/);await uid(a);
 let state=await rpc('exchange_state()');assert.equal(state.markets.length,9);assert.equal(state.bank,'1000000');
 await rpc("bank_move(50,'withdraw','regression-withdraw')");await rpc("bank_move(50,'deposit','regression-deposit')");assert.equal((await rpc('exchange_state()')).bank,'1000000','existing bank deposit and withdrawal remain functional');
 const open=async(code,dir=1,amount=100,lev=1,days=1,ref='10000000-0000-0000-0000-000000000001')=>rpc('exchange_open($1,$2,$3,$4,$5,$6)',[code,dir,amount,lev,days,ref]);
 await q("update cron.job set active=false where jobname='golan-exchange'");await assert.rejects(()=>open('house'),/price_unavailable/);assert.equal((await rpc('exchange_state()')).bank,'1000000');await q("update cron.job set active=true where jobname='golan-exchange'");
 state=await open('house');assert.equal(state.bank,'999900');assert.equal(state.positions.length,1);const first=state.positions[0].id;
 assert.equal(await rpc('exchange_wealth($1)',[a]),'1000000','escrow does not reduce leaderboard wealth');
 assert.equal((await open('house')).bank,'999900');await assert.rejects(()=>open('house',-1),/request_conflict/);
 await assert.rejects(()=>rpc('exchange_close($1)',[first]),/locked_position/);
 await assert.rejects(()=>open('house',1,10,51),/request_conflict|invalid_order/);
 await assert.rejects(()=>open('BNYM',1,10,1001,1,'10000000-0000-0000-0000-000000000002'),/invalid_order/);
 await assert.rejects(()=>open('house',1,999999999,1,1,'10000000-0000-0000-0000-000000000003'),/insufficient_bank/);
 assert.equal((await rpc('exchange_state()')).positions.length,1,'failed open rolls back escrow and position');
 const publish=async(code,p,scope='00000000-0000-0000-0000-000000000000')=>q('select gx.publish($1,$2,$3,clock_timestamp(),clock_timestamp())',[code,scope,p]);
 assert.equal(await rpc('gx.value(100,50,1,100,103)'),'250','profit may exceed 100%');
 assert.equal(await rpc('gx.value(100,1000,-1,100,101)'),'0','no negative payout');
 assert.equal((await q('select gx.value(9007199254740993,1,1,100,100)::text as v'))[0].v,'9007199254740993');
 await q("update gx.positions set expires_at=clock_timestamp()-interval '1 second' where id=$1",[first]);await publish('house',120);
 state=await rpc('exchange_state()');assert.equal(state.positions[0].status,'closed');assert.equal(state.positions[0].payout,'120');assert.equal(state.bank,'1000020');
 await publish('house',130);assert.equal((await rpc('exchange_state()')).bank,'1000020','credit only once');
 state=await open('house',1,100,50,1,'10000000-0000-0000-0000-000000000004');const loss=state.positions[0];await publish('house',Number(loss.entry)*.98);
 assert.equal((await rpc('exchange_state()')).positions.find(p=>p.id===loss.id).reason,'liquidated');await publish('house',200);assert.equal((await rpc('exchange_state()')).positions.find(p=>p.id===loss.id).payout,'0','no recovery');
 state=await open('BNYM',1,100,1000,1,'10000000-0000-0000-0000-000000000005');const daily=state.positions[0].id;await rpc('exchange_close($1)',[daily]);const after=(await rpc('exchange_state()')).bank;await rpc('exchange_close($1)',[daily]);assert.equal((await rpc('exchange_state()')).bank,after);
 await uid(b);await assert.rejects(()=>rpc('exchange_close($1)',[daily]),/position_not_found/);assert.equal((await rpc('exchange_state()')).positions.length,0);await uid(a);
 // Only terminal games contribute; modifying an already recorded terminal row does not count twice.
 await q("insert into pm_runs(user_id,ref,stake,mode,rocks)values($1,'pm-test',100,'normal','[]')",[a]);assert.equal((await q('select count(*)::int n from gx.settlements'))[0].n,0);
 await q("update pm_runs set phase='cashed',paid=80 where ref='pm-test'");await q("update pm_runs set paid=80 where ref='pm-test'");assert.equal((await q('select count(*)::int n from gx.settlements'))[0].n,1);
 for(const stmt of [
  "insert into rl_spins(user_id,ref,bets,total,result,payout)values($1,'rl','{}',100,1,80)",
  "insert into sl_spins(user_id,ref,line_bet,total,stops,payout)values($1,'sl',20,100,array[1,2,3],80)",
  "insert into bj_rounds(user_id,ref,status,main_bet,hands,dealer,total_staked,payout)values($1,'bj','done',100,'[]',array['AS'],100,80)",
  "insert into game_rounds(user_id,game,stake,status,payout)values($1,'fixture',100,'settled',80)",
  "insert into pc_spins(user_id,ref,stake,result,payout)values($1,'pc',100,'{}',80)",
  "insert into kin_spins(user_id,ref,stake,seed,total,payout)values($1,'kin',100,1,0.8,80)",
  "insert into ww_spins(user_id,ref,stake,seed,total,payout)values($1,'ww',100,1,0.8,80)",
  "insert into dg_spins(user_id,ref,stake,seed,total,payout)values($1,'dg',100,1,0.8,80)",
  "insert into ck_runs(user_id,ref,stake,mode,status,paid)values($1,'ck',100,'normal','cashed',80)",
  "insert into f90_runs(user_id,ref,stake,status,paid)values($1,'f90',100,'cashed',80)"] )await q(stmt,[a]);
 await q("insert into rl_live_rounds values(1,1,'{}','{}',now())");await q("insert into rl_live_bets(round_no,user_id,mode,ref,bets,total,payout,settled)values(1,$1,'classic','rll','{}',100,80,true)",[a]);
 await q("insert into if_rounds(round_no,start_at,dur,seg,cat,boost_seg,boost_mult)values(1,0,42,1,'dark',1,2)");await q("insert into if_bets(round_no,user_id,ref,bets,total,payout,settled)values(1,$1,'if','{}',100,80,true)",[a]);
 const dr=(await q("insert into dp_rounds(game)values('tcp')returning id"))[0].id;await q("insert into dp_hands(round_id,user_id,ante,status,result,ref)values($1,$2,100,'done','{\"pay\":80}','dp')",[dr,a]);
 const zr=(await q('insert into zlm_private.rounds default values returning id'))[0].id;await q("insert into zlm_private.bets(round_id,user_id,spot,amount,payout,settled)values($1,$2,'one',100,80,true)",[zr,a]);
 assert.equal((await q('select count(distinct source)::int n from gx.settlements'))[0].n,15,'all terminal source adapters execute against actual table definitions');
 const pt=(await q("insert into poker_tables(name,max_seats,small_blind,big_blind)values('fixture',6,10,20)returning id"))[0].id;
 await q('insert into poker_bots(table_id,name)values($1,\'fixture bot\')',[pt]);
 await q("insert into poker_hands(table_id,hand_no,street,players,result)values($1,1,'done',jsonb_build_object('0',jsonb_build_object('user',$2::uuid,'committed',100)),'{\"won\":{\"0\":80}}')",[pt,a]);
 assert.equal((await q("select (stake-payout)::text net from gx.settlements where source='poker_bots'"))[0].net,'20');
 // Unitisation: bank-wallet transfers and locked capital never create fund returns.
 const feed=async(kind,n,ref)=>{await q('select bank_add($1,$2,$3,$4)',[a,kind,n,ref]);await q('select gx.bank_event(b) from bank_tx b where ref=$1',[ref]);};
 await feed('deposit',100000,'test-deposit');assert.equal((await q('select nav::text n from gx.funds where user_id=$1',[a]))[0].n,'100');
 await feed('withdraw',100000*-1,'test-withdraw');assert.equal((await q('select nav::text n from gx.funds where user_id=$1',[a]))[0].n,'100');
 await feed('job',100000,'test-income');assert(Number((await q('select nav::text n from gx.funds where user_id=$1',[a]))[0].n)>100);
 const isPrivate=await q("select has_schema_privilege('authenticated','gx','usage') as exposed,has_function_privilege('anon','exchange_state(text,integer)','execute') as anon");assert.deepEqual(isPrivate,[{exposed:false,anon:false}]);
 assert.equal((await q("select count(*)::int n from cron.job where jobname='golan-exchange' and active"))[0].n,1);
 const live=fs.readFileSync('test/exchange_live_check.sql','utf8');assert((await q(live.split(';')[0]))[0].validation.startsWith('PASS:'));await db.exec(live);
 // Daily formula and replay protection, including negative performance.
 const day='2026-01-10';
 await q("insert into gx.settlements(source,ref,user_id,category,stake,payout,at)values('fixture','day-profit',$1,'fish',100,80,($2::date+time '12:00') at time zone 'Asia/Jerusalem')",[a,day]);
 const beforeFish=Number((await q("select price::text p from gx.quotes where code='fish'"))[0].p),beforeHouse=Number((await q("select price::text p from gx.quotes where code='house'"))[0].p);
 await q('select gx.daily($1::date)',[day]);
 const afterFish=(await q("select price::text p from gx.quotes where code='fish'"))[0].p;assert(Math.abs(Number(afterFish)/beforeFish-1-20/180)<1e-10);
 assert(Math.abs(Number((await q("select price::text p from gx.quotes where code='house'"))[0].p)/beforeHouse-1-.2*20/180)<1e-10);
 await q('select gx.daily($1::date)',[day]);assert.equal((await q("select price::text p from gx.quotes where code='fish'"))[0].p,afterFish);
 await q("insert into gx.settlements(source,ref,user_id,category,stake,payout,at)values('fixture','day-loss',$1,'fish',100,120,('2026-01-11'::date+time '12:00') at time zone 'Asia/Jerusalem')",[a]);await q("select gx.daily('2026-01-11')");assert(Math.abs(Number((await q("select price::text p from gx.quotes where code='fish'"))[0].p)/Number(afterFish)-1+20/220)<1e-10);
 // Personal Fisher: own contribution excluded, membership paired, no cap on others' gains.
 for(const [u,prev,curr]of [[a,100,200],[b,100,300]]){
  for(const [d,v]of [['2026-01-11',prev],['2026-01-12',curr]])await q("insert into gx.fund_days(user_id,day,area,epoch)values($1,$2::date,$3*86400,'2025-01-01') on conflict(user_id,day)do update set area=excluded.area,epoch=excluded.epoch",[u,d,v]);
 }
 await q("update gx.quotes set price=100 where code='fisher'");await q("select gx.daily('2026-01-12')");assert.equal((await q("select price::text p from gx.quotes where code='fisher' and scope=$1",[a]))[0].p,'300.000000000000');assert.equal((await q("select price::text p from gx.quotes where code='fisher' and scope=$1",[b]))[0].p,'200.000000000000');
 // Below-one-shekel equity is not a premature 100% liquidation.
 await q("update gx.control set last_day=(now() at time zone 'Asia/Jerusalem')::date-1");await uid(a);await publish('protein',100);state=await open('protein',1,1,50,1,'10000000-0000-0000-0000-000000000009');const dust=state.positions[0].id;await publish('protein',99);assert.equal((await q('select status from gx.positions where id=$1',[dust]))[0].status,'open');await publish('protein',98);assert.equal((await q('select reason from gx.positions where id=$1',[dust]))[0].reason,'liquidated');
 // A bank at bigint capacity keeps the entitlement, rather than losing/capping the win.
 await q("select bank_add($1,'deposit',(9223372036854775807::numeric-bank_bal($1)-5)::bigint,'overflow-capital')",[a]);
 state=await open('house',1,100,1,1,'10000000-0000-0000-0000-000000000011');const overflow=state.positions.find(p=>p.status==='open'&&p.code==='house');
 await q("update gx.positions set expires_at=clock_timestamp()-interval '1 second' where id=$1",[overflow.id]);await publish('house',Number(overflow.entry)*2);
 assert.equal((await q('select status from gx.positions where id=$1',[overflow.id]))[0].status,'awaiting_credit');
 await q("select bank_add($1,'withdraw',-1000,'overflow-space')",[a]);await q('select gx.tick()');assert.equal((await q('select status from gx.positions where id=$1',[overflow.id]))[0].status,'closed');
 // One published price per second; random increments remain inside each instrument's disclosed bound.
 await q("update gx.quotes set price=100,at=clock_timestamp()-interval '2 seconds' where code='BNYM'");await q("update gx.markets set viewed_at=clock_timestamp() where code='BNYM'");await q('select gx.tick()');
 const tick=(await q("select price::text p from gx.quotes where code='BNYM'"))[0].p;assert(Math.abs(Number(tick)/100-1)<=.000020000001);
 await q("update gx.quotes set at=clock_timestamp()+interval '1 second' where code='BNYM'");await q('select gx.tick()');assert.equal((await q("select price::text p from gx.quotes where code='BNYM'"))[0].p,tick);
 // History is bounded and paginated, and cannot expose another member's positions.
 await q("insert into gx.positions(user_id,request,code,scope,direction,stake,leverage,days,entry,opened_at,expires_at,status,exit,payout,reason,closed_at) select $1,gen_random_uuid(),'house','00000000-0000-0000-0000-000000000000',1,1,1,1,100,clock_timestamp()-i*interval '1 hour',clock_timestamp(),'closed',100,1,'expired',clock_timestamp() from generate_series(1,65)i",[a]);
 state=await rpc('exchange_state()');const history=state.positions.filter(p=>p.status==='closed');assert.equal(history.length,50);const cursor=history.at(-1),older=await rpc('exchange_history($1,$2)',[cursor.opened_at,cursor.id]);assert(older.length>0);assert(!older.some(p=>history.some(h=>h.id===p.id)));
 await uid(b);assert.deepEqual(await rpc('exchange_history($1,$2)',[cursor.opened_at,cursor.id]),[]);await uid(a);
 await db.exec('set role authenticated');await assert.rejects(()=>q('select * from gx.positions'),/permission denied/);assert.equal((await rpc('exchange_state()')).markets.length,9);await db.exec('reset role');
 await db.exec('set role anon');await assert.rejects(()=>rpc('exchange_state()'),/permission denied/);await db.exec('reset role');
 await q("insert into cron.job_run_details(jobid,status,start_time,end_time) select jobid,'failed',clock_timestamp(),clock_timestamp() from cron.job where jobname='golan-exchange'");assert.equal(await rpc('exchange_ready()'),0,'a failed latest worker run disables new orders');
 await q("insert into cron.job_run_details(jobid,status,start_time,end_time) select jobid,'succeeded',clock_timestamp(),clock_timestamp() from cron.job where jobname='golan-exchange'");
 // Loan restriction is inherited rather than bypassed by investments.
 await q("insert into loans values($1,'late')",[a]);await assert.rejects(()=>open('house',1,1,1,1,'10000000-0000-0000-0000-000000000010'),/loan_late/);
 await db.close();console.log('PASS: isolated SQL, rerunnable migration, bank escrow, exact amounts, leverage, idempotency, liquidation, expiry, manual close, private ownership, settled sources, Fisher flows and scheduler.');
})().catch(e=>{console.error(e);process.exit(1)});
