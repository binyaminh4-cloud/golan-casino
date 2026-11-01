// Isolated PostgreSQL (PGlite). Runs production wallet and poker functions on synthetic data.
// Setup: npm install --prefix .poker-test-runtime --no-save --package-lock=false @electric-sql/pglite@0.5.14
const fs=require('fs'),assert=require('assert');
const {PGlite}=require('../.poker-test-runtime/node_modules/@electric-sql/pglite');
async function main(){
 const db=new PGlite();
 const core=fs.readFileSync('supabase/migrations/0001_core.sql','utf8');
 const poker=fs.readFileSync('supabase/migrations/0018_poker.sql','utf8');
 const bots=fs.readFileSync('supabase/migrations/0079_poker_bots.sql','utf8');
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;`);
 for(const name of ['profiles','wallets','wallet_transactions','poker_tables','poker_seats']){
  const sql=core.match(new RegExp('create table '+name+' \\([\\s\\S]*?\\n\\);'))[0];await db.exec(sql);
 }
 await db.exec(poker.match(/create table if not exists poker_hands \([\s\S]*?\n\);/)[0]);
 await db.exec(`alter table poker_tables add level int, add min_buyin bigint, add max_buyin bigint, add tourney uuid,
 add bots_owner uuid,add bots_shared bigint,add friends_bb bigint;
 alter table poker_seats add leaving boolean not null default false,add missed int not null default 0;
 create table tourneys(id uuid primary key,table_id uuid,status text,started_at timestamptz,prize bigint,mult int,places jsonb,players uuid[]);
 create function chat_sys(text,text) returns void language sql as $$select$$;`);
 await db.exec(bots.match(/create table if not exists poker_bots \([\s\S]*?\n\);/)[0]);
 const latest=new Map();
 for(const file of fs.readdirSync('supabase/migrations').sort()){
  if(file.startsWith('0095'))continue;
  const sql=fs.readFileSync('supabase/migrations/'+file,'utf8');
  for(const m of sql.matchAll(/create or replace function (\w+)\([^;]*?\$\$[\s\S]*?\$\$;/gi))
   if(/^(ph_|pb_|poker_|apply_tx$|tn_between_hands$)/.test(m[1]))latest.set(m[1],m[0]);
 }
 for(const sql of latest.values()) await db.exec(sql);
 const migration=fs.readFileSync('supabase/migrations/0095_poker_seat_presence.sql','utf8');
 await db.exec(migration.replace('create extension if not exists pg_cron;','').replace(/select cron.schedule\([^\n]+\);/,''));
 // Applying a second time must also be safe (Cron scheduling is verified on the server separately).
 await db.exec(migration.replace('create extension if not exists pg_cron;','').replace(/select cron.schedule\([^\n]+\);/,''));
 const u='00000000-0000-0000-0000-000000000001',v='00000000-0000-0000-0000-000000000002',w='00000000-0000-0000-0000-000000000003';
 for(const id of [u,v,w])await db.exec(`insert into auth.users values('${id}');insert into profiles(id,nickname) values('${id}','test');insert into wallets(user_id,balance)values('${id}',100000);`);
 const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
 const uid=async id=>db.query("select set_config('request.jwt.sub',$1,false)",[id]);
 const rpc=async(name,args)=> (await q(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args))[0].value;
 const table=async()=>{const id=(await q(`insert into poker_tables(name,max_seats,small_blind,big_blind,level,min_buyin,max_buyin) values('test',6,10,20,1,100,10000) returning id`))[0].id;await db.query('insert into poker_hands(table_id,next_at)values($1,now()+interval \'1 day\')',[id]);return id;};
 const a=await table(),b=await table(); await uid(u);
 await rpc('poker_sit',[a,0,1000]); await rpc('poker_sit',[b,0,2000]);
 assert.equal((await q('select count(*)::int n from poker_seats where user_id=$1',[u]))[0].n,2);
 assert.equal((await q('select balance from wallets where user_id=$1',[u]))[0].balance,97000);
 await rpc('poker_sit',[a,2,1000]); // Re-entry must not debit or move the old seat.
 assert.equal((await q('select balance from wallets where user_id=$1',[u]))[0].balance,97000);
 assert.equal((await rpc('poker_my_tables',[])).length,2);
 await uid(v); assert.equal((await rpc('poker_my_tables',[])).length,0);
 await rpc('poker_touch',[a]);
 assert.equal((await q('select user_id from poker_seats where table_id=$1',[a]))[0].user_id,u);
 await uid(u);
 await db.query("update poker_seats set last_seen=now()-interval '119 seconds' where table_id=$1",[a]);
 await rpc('poker_touch',[a]);await rpc('poker_expire_table',[a]);
 assert.equal((await q('select count(*)::int n from poker_seats where table_id=$1',[a]))[0].n,1);
 await db.query("update poker_seats set last_seen=now()-interval '121 seconds' where table_id=$1",[a]);
 await rpc('poker_presence_sweep',[]);
 assert.equal((await q('select count(*)::int n from poker_seats where table_id=$1',[a]))[0].n,0);
 assert.equal((await q('select balance from wallets where user_id=$1',[u]))[0].balance,98000);
 await rpc('poker_presence_sweep',[]);await rpc('poker_cash_leave',[a]);
 assert.equal((await q('select balance from wallets where user_id=$1',[u]))[0].balance,98000);
 assert.equal((await q("select count(*)::int n from wallet_transactions where user_id=$1 and kind='cashout'",[u]))[0].n,1);
 // A refreshed second table stays seated while the first table is swept.
 assert.equal((await q('select count(*)::int n from poker_seats where table_id=$1',[b]))[0].n,1);
 await rpc('poker_cash_leave',[b]); assert.equal((await q('select balance from wallets where user_id=$1',[u]))[0].balance,100000);
 // Real hand, including side-pot eligibility for an all-in player who explicitly leaves.
 const c=await table(); for(const [i,id]of [u,v,w].entries()){await uid(id);await rpc('poker_sit',[c,i,1000]);}
 await db.query('update poker_hands set next_at=now() where table_id=$1',[c]);await rpc('poker_tick',[c]);
 let hand=(await q('select * from poker_hands where table_id=$1',[c]))[0];
 const allSeat=hand.to_act,allUser=hand.players[allSeat].user;
 await uid(allUser);await rpc('poker_act',[c,'allin',0,hand.hand_no]);
 await rpc('poker_cash_leave',[c]);
 hand=(await q('select * from poker_hands where table_id=$1',[c]))[0];
 assert.equal(hand.players[allSeat].allin,true);assert.equal(hand.players[allSeat].folded,false);
 assert.equal((await q('select leaving from poker_seats where table_id=$1 and user_id=$2',[c,allUser]))[0].leaving,true);
 const balanceBefore=(await q('select balance from wallets where user_id=$1',[allUser]))[0].balance;
 await rpc('poker_touch',[c]);assert.equal((await q('select leaving from poker_seats where table_id=$1 and user_id=$2',[c,allUser]))[0].leaving,true);
 // Expire the two other humans and drive the real betting/settlement code.
 await db.query("update poker_seats set last_seen=now()-interval '3 minutes' where table_id=$1",[c]);
 for(let i=0;i<12;i++)await rpc('poker_presence_sweep',[]);
 assert.equal((await q('select count(*)::int n from poker_seats where table_id=$1',[c]))[0].n,0);
 const total=(await q('select sum(balance)::bigint n from wallets'))[0].n;assert.equal(total,300000);
 const txCount=(await q('select count(*)::int n from wallet_transactions'))[0].n;
 await rpc('poker_presence_sweep',[]);await rpc('poker_cash_leave',[c]);
 assert.equal((await q('select count(*)::int n from wallet_transactions'))[0].n,txCount);
 // Explicit stand-up during a normal active hand folds safely and waits for settlement.
 const d=await table(); for(const [i,id]of [u,v,w].entries()){await uid(id);await rpc('poker_sit',[d,i,1000]);}
 await db.query('update poker_hands set next_at=now() where table_id=$1',[d]);await rpc('poker_tick',[d]);
 hand=(await q('select * from poker_hands where table_id=$1',[d]))[0];
 const leavingSeat=(hand.to_act+1)%3;await uid(hand.players[leavingSeat].user);
 const leaving=await rpc('poker_cash_leave',[d]);assert.equal(leaving.pending,true);
 hand=(await q('select * from poker_hands where table_id=$1',[d]))[0];assert.equal(hand.players[leavingSeat].folded,true);
 await db.query("update poker_seats set last_seen=now()-interval '3 minutes' where table_id=$1",[d]);
 for(let i=0;i<12;i++)await rpc('poker_presence_sweep',[]);
 assert.equal((await q('select sum(balance)::bigint n from wallets'))[0].n,300000);
 assert.equal((await q("select has_function_privilege('anon','poker_presence_sweep()','execute') as allowed"))[0].allowed,false);
 assert.equal((await q("select has_function_privilege('authenticated','poker_expire_table(uuid)','execute') as allowed"))[0].allowed,false);
 // Friend locations reuse presence and resolve the visible table without exposing private ids.
 await db.exec(`alter table profiles add last_seen timestamptz,add where_now text;
 create table chat_messages(id bigint,room text,user_id uuid,kind text,body text,created_at timestamptz);`);
 await db.exec(fs.readFileSync('supabase/migrations/0096_friend_game_locations.sql','utf8'));
 await uid(u);await rpc('poker_state',[a]);
 let locations=await rpc('gc_friend_locations',[]);
 assert.equal(locations.find(x=>x.id===u).where,'poker.html?t='+a);
 await rpc('chat_since',['lobby',0,'poker.html?fr=1&bb=20000']);
 assert.equal((await q('select where_now from profiles where id=$1',[u]))[0].where_now,'poker.html?t='+a);
 await rpc('poker_state',[b]);
 assert.equal((await rpc('gc_friend_locations',[])).find(x=>x.id===u).where,'poker.html?t='+b);
 await rpc('chat_since',['lobby',0,'index.html']);
 assert.equal((await rpc('gc_friend_locations',[])).find(x=>x.id===u).where,'index.html');
 await db.query('update poker_tables set bots_owner=$1 where id=$2',[u,a]);
 await db.query("update profiles set where_now=$1,last_seen=now() where id=$2",['poker.html?t='+a,u]);
 await uid(v);const hidden=(await rpc('gc_friend_locations',[])).find(x=>x.id===u);
 assert.equal(hidden.where,'poker_private');assert.equal(hidden.table_name,null);assert(!JSON.stringify(hidden).includes(a));
 await db.query("update profiles set where_now='poker.html?t=------------------------------------',last_seen=now() where id=$1",[u]);
 assert.equal((await rpc('gc_friend_locations',[])).find(x=>x.id===u).where,'poker.html');
 await db.query("update profiles set last_seen=now()-interval '46 seconds' where id=$1",[u]);
 assert(!(await rpc('gc_friend_locations',[])).some(x=>x.id===u));
 assert.equal((await q("select has_function_privilege('anon','gc_friend_locations()','execute') as allowed"))[0].allowed,false);
 await uid('');await assert.rejects(()=>rpc('gc_friend_locations',[]),/not_signed_in/);
 console.log('PASS: last viewed poker table, chat preservation, lobby exit, private table redaction, malformed ids, stale presence and signed-in access.');
 console.log('PASS: multi-table, same-seat re-entry, ownership, 119/121s reconnect/expiry, empty-table cleanup, all-in preservation, total chips and idempotent cash-out.');
 await db.close();
}
main().catch(e=>{console.error(e);process.exitCode=1});
