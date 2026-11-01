const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const code=fs.readFileSync('docs/zman-lobby.js','utf8');
async function check({session=true,ready=1,error=null,preview=false}){
 let shown=false,calls=[];
 const sandbox={document:{getElementById:()=>({style:{removeProperty:k=>{assert.equal(k,'display');shown=true;}}})},
 location:{search:preview?'?preview':''},db:{auth:{getSession:async()=>({data:{session:session?{}:null}})},rpc:async name=>{calls.push(name);return{data:ready,error};}}};
 await vm.runInNewContext(code,sandbox);return {shown,calls};
}
(async()=>{
 assert.deepEqual(await check({}),{shown:true,calls:['zlm_ready']});
 assert.equal((await check({error:{message:'not installed'}})).shown,false);
 assert.equal((await check({ready:2})).shown,false);
 assert.deepEqual(await check({session:false}),{shown:false,calls:[]});
 assert.deepEqual(await check({preview:true}),{shown:true,calls:[]});
 assert(/id="zlmLobbyCard"[^>]*display:none!important/.test(fs.readFileSync('docs/index.html','utf8')));
 console.log('PASS: lobby hides uninstalled game; one authenticated read-only readiness request; no game round is started; preview and missing-session handling.');
})().catch(e=>{console.error(e);process.exitCode=1;});
