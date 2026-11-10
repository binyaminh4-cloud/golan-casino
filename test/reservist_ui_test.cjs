const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/hp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const root=path.resolve('docs'),server=http.createServer((req,res)=>{const f=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!f.startsWith(root+path.sep)){res.writeHead(403);return res.end();}fs.readFile(f,(err,bytes)=>{if(err){res.writeHead(404);return res.end();}let content=bytes;
  if(f.endsWith('reservist.mjs'))content=bytes.toString().replace('(async()=>{',`window.rvTest={get run(){return run},get cam(){return cam},get unresolved(){return unresolved},get sending(){return sending},get view(){return view},aimAt:id=>{const a=world(run.mode,run.scene,elapsed()).find(a=>a.id===id);view.cx=a.x;view.cy=a.y-a.h/2;},world,shoot,finish,elapsed,at:t=>sync({...run,elapsed:t})};\n(async()=>{`);
  res.setHeader('Content-Type',/\.(m?js)$/.test(f)?'text/javascript':f.endsWith('.json')?'application/json':f.endsWith('.html')?'text/html; charset=utf-8':f.endsWith('.css')?'text/css':f.endsWith('.mp3')?'audio/mpeg':f.endsWith('.webp')?'image/webp':'application/octet-stream');res.end(content);
 });});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
 try{
  fs.mkdirSync('../asset-intake/reservist/screens',{recursive:true});
  for(const viewport of [{width:390,height:844},{width:1024,height:768}]){
   const page=await browser.newPage({viewport}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'text/javascript',body:`window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'fixture-owner'}}}})},rpc:async name=>({data:!location.search.includes('locked'),error:null})})};`});if(u.hostname!=='127.0.0.1')return route.abort();if(/\/(char)\.js$/.test(u.pathname))return route.fulfill({contentType:'text/javascript',body:'window.GC_GUIDE={init(){}};'});return route.continue();});
   await page.goto(`http://127.0.0.1:${server.address().port}/reservist.html?preview`);await page.waitForFunction(()=>document.querySelectorAll('[data-mode]').length===4);await page.locator('#gcLoad').waitFor({state:'detached'});
   assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
   await page.screenshot({path:`../asset-intake/reservist/screens/select-${viewport.width}.png`});
   for(const mode of ['range','gate','base','sniper']){
    await page.locator(`[data-mode=${mode}]`).click();await page.waitForFunction(()=>rvTest.run!==null);
    await page.waitForTimeout(100);
    const box=await page.locator('#scene').boundingBox();assert(box.width>200&&box.height>200);assert(box.x>=0&&box.x+box.width<=viewport.width+1);
    assert.equal(await page.locator('#fire').isVisible(),true);
    if(mode==='range'){
     await page.evaluate(()=>rvTest.at(.8));const target=await page.evaluate(()=>rvTest.world('range',rvTest.run.scene,rvTest.elapsed())[0]);await page.screenshot({path:`../asset-intake/reservist/screens/target-${viewport.width}.png`});
     await page.mouse.click(box.x+target.x*box.width,box.y+(target.y-.135)*box.height);await page.waitForFunction(()=>rvTest.run.earned===1000000);
     await page.evaluate(()=>rvTest.at(2.7));const second=await page.evaluate(()=>rvTest.world('range',rvTest.run.scene,rvTest.elapsed())[0]);await page.mouse.click(box.x+second.x*box.width,box.y+(second.y-.25)*box.height);await page.waitForFunction(()=>rvTest.run.earned===1100000);
    }
    if(mode==='gate'){
     await page.evaluate(()=>rvTest.at(2.3));const actors=await page.evaluate(()=>rvTest.world('gate',rvTest.run.scene,rvTest.elapsed())),good=actors.find(a=>a.good),bad=actors.find(a=>!a.good);
     await page.mouse.click(box.x+good.x*box.width,box.y+(good.y-good.h/2)*box.height);await page.waitForFunction(()=>rvTest.run.earned===4000000);
     await page.mouse.click(box.x+bad.x*box.width,box.y+(bad.y-bad.h/2)*box.height);await page.waitForFunction(()=>rvTest.run.earned===3000000);
    }
    if(mode==='base'){
     const target=await page.evaluate(()=>rvTest.world('base',rvTest.run.scene,rvTest.elapsed())[0]);await page.mouse.click(box.x+target.x*box.width,box.y+(target.y-target.h/2)*box.height);await page.waitForFunction(()=>rvTest.run.done);
     assert.match(await page.locator('#resultText').textContent(),/30,000,000/);
    }
    if(mode==='sniper'){
     const before=await page.evaluate(()=>({x:rvTest.cam.cx,y:rvTest.cam.cy}));await page.locator('#scope').click();await page.waitForTimeout(50);const after=await page.evaluate(()=>({x:rvTest.cam.cx,y:rvTest.cam.cy}));assert(Math.abs(before.x-after.x)<1e-9&&Math.abs(before.y-after.y)<1e-9,'scope must preserve world center');
     await page.screenshot({path:`../asset-intake/reservist/screens/scope-${viewport.width}.png`});await page.locator('#scope').click();
     await page.mouse.move(box.x+box.width*.7,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.3,box.y+box.height*.45,{steps:8});await page.mouse.up();const moved=await page.evaluate(()=>rvTest.cam.cx);assert(Math.abs(moved-before.x)>.02);
     assert.equal(await page.locator('#dossier canvas').count(),3);
     await page.locator('#scope').click();for(let i=0;i<3;i++){await page.evaluate(id=>rvTest.aimAt(id),'target-'+i);await page.waitForTimeout(90);await page.locator('#fire').click();await page.waitForFunction(n=>rvTest.run.earned===n,25000000*(i+1));}await page.waitForFunction(()=>rvTest.run.done);assert.match(await page.locator('#resultText').textContent(),/75,000,000/);
    }
    await page.screenshot({path:`../asset-intake/reservist/screens/${mode}-${viewport.width}.png`});
    if(!['base','sniper'].includes(mode)){await page.locator('#finish').click();await page.waitForFunction(()=>document.querySelector('#result').open);}
    await page.locator('#again').click();await page.waitForFunction(()=>rvTest.run===null);
   }
   const sound=await page.evaluate(async()=>{const audio=new AudioContext(),report=[];for(const f of ['scope_out','scope_in','success','target_hit','distant_gunfire','shot','target_mechanism','timer','miss','failure']){const b=await audio.decodeAudioData(await(await fetch('snd/rv_'+f+'.mp3')).arrayBuffer()),a=b.getChannelData(0);let sum=0;for(const s of a)sum+=s*s;report.push(b.duration>0&&b.duration<20&&sum/a.length>1e-8);}await audio.close();return report;});assert(sound.every(Boolean),'supplied sound effects must decode and contain audio');
   for(const query of ['?preview&locked','?locked']){await page.goto(`http://127.0.0.1:${server.address().port}/reservist.html`+query);await page.waitForFunction(()=>document.querySelector('#note').textContent.includes('רק לבנימין'));assert.equal(await page.locator('[data-mode]').count(),0);assert.equal(await page.locator('#play').isVisible(),false);}
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS: phone/tablet layouts, all four task flows, precise range rewards, gate penalty, base completion, persistent scope coordinates, drag scan and audio files');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
