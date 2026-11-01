const fs=require('fs'),vm=require('vm'),assert=require('assert');
const events={},timers=new Map(),calls=[],nodes=new Map();let next=0;
const context={URLSearchParams,console,
 location:{href:'https://example.test/poker.html?t=test-table',search:'?t=test-table'},
 GC_CONFIG:{},supabase:{createClient:()=>({rpc:async(name,args)=>{calls.push([name,args]);return{data:true}},auth:{getSession:async()=>({data:{session:null}})}})},
 document:{hidden:true,getElementById:id=>{if(!nodes.has(id))nodes.set(id,{addEventListener(){}});return nodes.get(id)}},
 addEventListener:(name,fn)=>events[name]=fn,
 setInterval:(fn,ms)=>{timers.set(++next,{fn,ms});return next},clearInterval:id=>timers.delete(id)};
vm.createContext(context);vm.runInContext(fs.readFileSync('docs/pk.js','utf8'),context);
(async()=>{
 await vm.runInContext('heartbeat()',context);
 assert.equal(calls[0][0],'poker_touch');assert.equal(calls[0][1].p_table,'test-table');
 // Hidden pages still send an independent table-specific heartbeat.
 vm.runInContext('startHeartbeat()',context);await Promise.resolve();
 assert([...timers.values()].some(t=>t.ms===15000));
 events.pagehide();assert(![...timers.values()].some(t=>t.ms===15000));
 events.pageshow();await Promise.resolve();assert([...timers.values()].some(t=>t.ms===15000));
 events.pageshow();assert.equal([...timers.values()].filter(t=>t.ms===15000).length,1);
 console.log('PASS: background heartbeat, page exit, return and a single heartbeat timer.');
})().catch(e=>{console.error(e);process.exitCode=1});
