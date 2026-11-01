const fs=require('fs'),vm=require('vm'),assert=require('assert');
const code=fs.readFileSync('docs/sw.js','utf8');
const response=(name,ok=true)=>({name,ok,type:'basic',clone(){return this}});
async function run(path,{cached=response('old'),offline=false,cacheFailure=false,statusOK=true}={}){
 const listeners={},calls=[],stored=[],pending=[];let result;
 const context={URL,location:{origin:'https://casino.test'},
  self:{addEventListener:(name,fn)=>listeners[name]=fn},
  caches:{open:async()=>({match:async()=>cached,put:async(req,r)=>{if(cacheFailure)throw Error('quota');stored.push(r)}})},
  fetch:async(req,opts)=>{calls.push(opts);if(offline)throw Error('offline');return response('new',statusOK)}};
 vm.runInNewContext(code,context);
 listeners.fetch({request:{method:'GET',url:new URL(path,context.location.origin).href},respondWith:p=>result=p,waitUntil:p=>pending.push(p)});
 const value=await result;await Promise.all(pending);return{value,calls,stored};
}
(async()=>{
 for(const asset of ['/lobby.css?v=67','/lobby-ui.js?v=17','/pk.js']){
  const r=await run(asset);assert.equal(r.value.name,'new');assert.equal(r.calls[0].cache,'no-cache');assert.equal(r.stored[0].name,'new');
  assert.equal((await run(asset,{offline:true})).value.name,'old');
  assert.equal((await run(asset,{cacheFailure:true})).value.name,'new');
  const failed=await run(asset,{statusOK:false});assert.equal(failed.value.ok,false);assert.equal(failed.stored.length,0);
 }
 await assert.rejects(()=>run('/pk.js',{offline:true,cached:null}),/offline/);
 assert.equal((await run('https://example.supabase.co/rest/v1/wallets')).value,undefined);
 assert.equal((await run('/version.json?t=1')).value,undefined);
 assert.equal((await run('/img/poster.webp?v=1')).value.name,'old');
 console.log('PASS: fresh JS/CSS wins over stale cache; offline fallback; cache-write failure; HTTP errors; Supabase and update checks bypass the worker.');
})().catch(e=>{console.error(e);process.exitCode=1});
