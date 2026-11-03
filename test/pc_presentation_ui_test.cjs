const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const{chromium}=require(process.env.GC_PLAYWRIGHT||'C:/Users/hp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const root=path.resolve('docs'),server=http.createServer((req,res)=>{const f=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!f.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}fs.readFile(f,(e,bytes)=>{if(e){res.writeHead(404);res.end();return;}let data=bytes;
 if(f.endsWith('pachinko.html'))data=bytes.toString().replace('Math.max(0, seconds) * 1000','(window.fastBonus && seconds>4 ? .01 : Math.max(0, seconds)) * 1000').replace('GC_AUTO({ mount:',`window.pcTest={get state(){return state},get busy(){return busy},get renderer(){return renderer},playResult};\nGC_AUTO({ mount:`);
 res.setHeader('Content-Type',f.endsWith('.mjs')||f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html; charset=utf-8':f.endsWith('.mp3')?'audio/mpeg':f.endsWith('.webp')?'image/webp':'application/octet-stream');res.end(data);});});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
 try{
 for(const viewport of [{width:844,height:390},{width:1024,height:768}]){
  const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/supabase.min.js',r=>r.fulfill({contentType:'text/javascript',body:`
  window.pcCalls=0;window.pcMode='plain';const normal=[0,1,2,3,4,1,2,3,4,5,2,3,4,5,0];
  window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'fixture'}}}})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{balance:1000000}})})})}),rpc:async(name)=>{if(name!=='pc_spin')return {data:null};pcCalls++;if(pcMode==='error')return{error:{message:'insufficient_funds'}};const grid=[...normal];if(pcMode==='two'){grid[0]=grid[6]=6;}if(pcMode==='win'){grid[5]=grid[6]=grid[7]=0;}return{data:{stake:100,balance:999983,payout:pcMode==='win'?83:0,grid,badges:{},line_mult:pcMode==='win'?8:0,wins:pcMode==='win'?[{line:0,sym:0,n:3,pay:8}]:[],bonus:null}};}})};
  `}));
  await page.route('**/guide.js?*',r=>r.fulfill({contentType:'text/javascript',body:'window.GC_GUIDE={init:()=>{}};window.GC_STEPS={pachinko:()=>[]};'}));
  await page.route('**/sfx.js?*',r=>r.fulfill({contentType:'text/javascript',body:`window.fxEvents=[];window.SFX={chip:()=>{},flip:()=>fxEvents.push(['stop',performance.now()/1000]),slotWin:()=>fxEvents.push(['win',performance.now()/1000]),fx:(name,options)=>{fxEvents.push([name,performance.now()/1000,options.loop]);return()=>fxEvents.push(['off',performance.now()/1000]);},bonus:()=>{}};window.bonusAwards=[];window.GC_BONUS=(title,amount,sub)=>bonusAwards.push({title,amount,sub});window.GC_BONUS_INTRO=async()=>{};`+fs.readFileSync('docs/sfx.js','utf8').slice(fs.readFileSync('docs/sfx.js','utf8').indexOf('window.GC_AUTO = function'))}));
  await page.route('**/chat.js?*',r=>r.fulfill({contentType:'text/javascript',body:''}));await page.route('https://fonts.googleapis.com/**',r=>r.abort());
  await page.goto('http://127.0.0.1:'+server.address().port+'/pachinko.html');await page.waitForFunction(()=>window.pcTest?.renderer&&document.getElementById('bal').textContent!=='…');
  assert(await page.evaluate(async()=>{const c=new AudioContext(),a=await c.decodeAudioData(await(await fetch('snd/pc_anticipation.mp3')).arrayBuffer()),samples=a.getChannelData(0);let sum=0;for(const v of samples)sum+=v*v;await c.close();return a.duration>1&&a.duration<5&&sum/samples.length>.000001;}),'generated sound must decode and contain audio');
  const canvas=await page.locator('#game').boundingBox();assert(canvas.x>=0&&canvas.y>=0&&canvas.x+canvas.width<=viewport.width+1&&canvas.y+canvas.height<=viewport.height+1);
  // Check all actual atlas poses after preparation, not just a synthetic sprite.
  assert(await page.evaluate(()=>{const a=pcTest.renderer.art,calls=[],fake={drawImage:(_img,x,y,w,h)=>calls.push({y,h})},c=pcTest.renderer.c;pcTest.renderer.c=fake;for(let pose=0;pose<8;pose++)for(const id of Object.keys(a.heads)){pcTest.renderer.character(id,200,816,127,pose);}pcTest.renderer.c=c;return calls.every(r=>r.y>=689-.01&&r.y+r.h<=816+.01);}));
  await page.locator('#spin').click();await page.waitForFunction(()=>pcTest.state.reels);const plan=await page.evaluate(()=>pcTest.state.reels);assert(plan.stops.every((t,i)=>i===0||t>plan.stops[i-1]));
  await page.waitForFunction(()=>pcTest.state.reels&&performance.now()/1000>pcTest.state.reels.stops[0]+.03&&performance.now()/1000<pcTest.state.reels.stops[1]);
  assert.equal(await page.locator('#spin').isDisabled(),true);await page.waitForFunction(()=>!pcTest.busy);
  await page.evaluate(()=>pcMode='two');await page.locator('#spin').click();await page.waitForFunction(()=>pcTest.state.reels?.anticipationAt!=null);const slow=await page.evaluate(()=>pcTest.state.reels);assert(slow.end-slow.start>2.5);
  await page.waitForFunction(()=>fxEvents.some(x=>x[0]==='pc_anticipation'&&x[2]));const sound=await page.evaluate(()=>fxEvents.find(x=>x[0]==='pc_anticipation'&&x[2]));assert(sound[1]>=slow.anticipationAt-.02,'tension cannot start before two revealed columns');await page.waitForFunction(()=>!pcTest.busy);
  await page.evaluate(()=>pcMode='win');await page.locator('#spin').click();await page.waitForFunction(()=>pcTest.state.winHighlight);const started=Date.now();assert.equal(await page.evaluate(()=>pcTest.state.winHighlight.amount),83);assert.deepEqual(await page.evaluate(()=>pcTest.state.winHighlight.cells),[5,6,7]);
  fs.mkdirSync('../asset-intake/pc-presentation',{recursive:true});await page.screenshot({path:'../asset-intake/pc-presentation/win-'+viewport.width+'.png'});
  await page.waitForFunction(()=>!pcTest.busy);assert(Date.now()-started>=1000,'win stays visible before unlocking');assert.equal(await page.evaluate(()=>pcCalls),3);
  await page.evaluate(()=>pcMode='error');await page.locator('#spin').click();await page.waitForFunction(()=>!pcTest.busy);assert.equal(await page.locator('#spin').isEnabled(),true);
  await page.evaluate(()=>{pcMode='win';document.getElementById('err').textContent='';});await page.locator('.gc-auto>button').click();await page.locator('.gc-auto [data-n="10"]').click();await page.waitForFunction(()=>pcTest.state.winHighlight);const during=await page.evaluate(()=>pcCalls);await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>pcCalls),during,'auto must wait for the win highlight');await page.locator('.gc-auto>button').click();await page.waitForFunction(()=>!pcTest.busy);
  await page.evaluate(async()=>{window.fastBonus=true;const data={stake:100,balance:1000506,payout:606,grid:[0,1,2,3,4,0,0,0,4,5,2,3,4,5,0],badges:{},wins:[{line:0,sym:0,n:3,pay:8}],bonus:{kind:'regular',entry:1,targets:[0]}};await pcTest.playResult(data,true);});
  const award=await page.evaluate(()=>bonusAwards.at(-1));assert.equal(award.amount,523);assert(award.sub.includes('606'));assert.equal(await page.locator('#spin').isEnabled(),true);assert.deepEqual(errors,[]);await page.close();

 }
 console.log('PASS: real mobile/tablet renderer, all head/pose bounds, sequential stops, delayed suspense sound, line+amount hold, one RPC per spin and error recovery');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e.stack);process.exit(1)});
