const fs=require('fs'),vm=require('vm'),assert=require('assert');
const code=fs.readFileSync('docs/friend-locations.js','utf8');
const bare={URLSearchParams};vm.runInNewContext(code,bare);const resolve=bare.GC_FRIEND_LOCATION;
const id='00000000-0000-0000-0000-000000000001';
assert.equal(resolve({where:'poker.html?t='+id,table_name:'חבר׳ה'}).href,'poker.html?t='+id);
for(const where of ['poker_private','poker.html?t=javascript:alert(1)','poker.html?t=------------------------------------','roulette.html?private','roulette.html?duel='+id,'blackjack.html','dp.html?g=uth&t=0','protein.html'])assert.equal(resolve({where}).href,null);
for(const where of ['https://evil.test','javascript:alert(1)','//evil.test','../poker.html','index.html','jobs.html'])assert.equal(resolve({where}),null);
assert.equal(resolve({where:'roulette.html?mode=xxx&skin=fish'}).href,'roulette.html?mode=xxx&skin=fish');
assert.equal(resolve({where:'blackjack.html?table=1&ch=secret'}).href,null);
assert.equal(resolve({where:'tcp_live'}).href,'dp.html?g=tcp&t=1');
// Mock the sheet lifecycle: one call on opening, one timer, none while closed/hidden.
let opened=false,hidden=false,calls=0,timer=null,observer;const events={};
const sheet={classList:{contains:()=>opened}};
const ctx={URLSearchParams,Map,document:{get hidden(){return hidden},body:{},getElementById:()=>sheet,querySelectorAll:()=>[],addEventListener:(k,f)=>events[k]=f},
 MutationObserver:class{constructor(fn){observer=fn}observe(){}},
 db:{rpc:async()=>{calls++;return{data:[]}}},setTimeout:(fn,ms)=>{assert.equal(ms,10000);timer=fn;return 1},clearTimeout:()=>timer=null};
vm.runInNewContext(code,ctx);
(async()=>{
 await ctx.GC_REFRESH_FRIEND_LOCATIONS();assert.equal(calls,0);
 opened=true;await ctx.GC_REFRESH_FRIEND_LOCATIONS();assert.equal(calls,1);assert(timer);
 await timer();assert.equal(calls,2);
 opened=false;observer();assert.equal(timer,null);await ctx.GC_REFRESH_FRIEND_LOCATIONS();assert.equal(calls,2);
 opened=true;hidden=true;events.visibilitychange();assert.equal(timer,null);
 hidden=false;events.visibilitychange();await new Promise(setImmediate);assert.equal(calls,3);
 assert(timer);console.log('PASS: safe exact-table links and one 10-second poll only while friends are visible.');
})().catch(e=>{console.error(e);process.exitCode=1});
