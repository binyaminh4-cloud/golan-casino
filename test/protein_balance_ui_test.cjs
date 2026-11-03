const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const{chromium}=require(process.env.GC_PLAYWRIGHT||'C:/Users/hp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const root=path.resolve('docs'),server=http.createServer((req,res)=>{const f=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!f.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}fs.readFile(f,(e,data)=>{if(e){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':f.endsWith('.webp')?'image/webp':'application/octet-stream');res.end(data)});});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
 try{
 for(const viewport of [{width:844,height:390},{width:1024,height:768},{width:1366,height:768}]){
  const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/supabase.min.js',async route=>route.fulfill({contentType:'text/javascript',body:`
   const rocks=Array.from({length:48},(_,id)=>{const layer=Math.floor(id/12),j=id%12;return{id,layer,size:j%4,w:54*[1,1.3,1.6,2][j%4],bomb:j<4+layer,food:j%2?'chicken':'mushroom',tagged:j===11,boost:2,taken:false,skin:0};});
   let current={id:'00000000-0000-0000-0000-000000000001',mode:'normal',stake:100,rocks,phase:'playing',layer:0,successes:0,bank_units:0,balance:100000000};
   window.collectCalls=[];const snapshot=()=>JSON.parse(JSON.stringify(current));
   window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'fixture'}}}})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{balance:100000000}})})})}),rpc:async(name,args)=>{
    if(name==='pm_current')return{data:snapshot()};
    if(name==='pm_collect'){collectCalls.push(args.p_rock);await new Promise(ok=>setTimeout(ok,700));const rock=rocks[args.p_rock];if(!rock)return{data:{...snapshot(),got:{miss:true}}};rock.taken=true;if(rock.bomb)current.phase='busted';else{current.successes++;current.bank_units+=30;current.phase=current.successes%3?'playing':'checkpoint';}return{data:{...snapshot(),got:{...rock,units:30}}};}
    throw Error('unexpected fixture RPC '+name);
   }})};
  `}));
  await page.route('**/guide.js?*',r=>r.fulfill({contentType:'text/javascript',body:'window.GC_GUIDE={init:async()=>{}};window.GC_STEPS={protein:()=>[]};'}));
  await page.route('**/chat.js?*',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await page.route('https://fonts.googleapis.com/**',r=>r.abort());
  await page.goto('http://127.0.0.1:'+server.address().port+'/protein.html');await page.waitForFunction(()=>typeof r!=='undefined'&&r.phase==='playing'&&motionTime>.1);
  const read=()=>page.evaluate(()=>({food:r.rocks.find(k=>k.layer===0&&!k.bomb).x,bomb:r.rocks.find(k=>k.layer===0&&k.bomb).x,time:motionTime}));
  const a=await read();await page.waitForTimeout(350);const b=await read();assert.notEqual(a.food,b.food);assert.notEqual(a.bomb,b.bomb);assert(b.time>a.time);
  // Predict only in the fixture to time a real pointer event; production chooses
  // nothing until the moving claw physically contacts the first item.
  await page.evaluate(()=>new Promise(resolve=>{function aim(){const max=PM_GEOMETRY.limit(angle),h=PM_GEOMETRY.sweep(r.rocks,r.layer,angle,45,max,motionTime,motionTime+(max-45)/1500);if(h&&!h.rock.bomb){window.expectedRock=h.rock.id;canvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));resolve();}else requestAnimationFrame(aim);}aim();}));
  assert.equal(await page.evaluate(()=>shot.rock===null&&!shot.requested&&collectCalls.length===0),true,'click cannot preselect or collect a target');
  const launched=await read();await page.waitForTimeout(200);const flying=await read();assert(flying.time>launched.time);assert.notEqual(flying.food,launched.food);assert.notEqual(flying.bomb,launched.bomb);
  await page.waitForFunction(()=>shot&&shot.requested);assert.equal(await page.evaluate(()=>shot.rock.id===expectedRock&&collectCalls[0]===expectedRock),true);
  const pulling=await read();await page.waitForTimeout(250);const moved=await read();assert(moved.time>pulling.time);assert.notEqual(moved.food,pulling.food);assert.notEqual(moved.bomb,pulling.bomb);
  await page.locator('#game').dispatchEvent('pointerdown');assert.equal(await page.evaluate(()=>collectCalls.length),1,'double click cannot collect twice');
  await page.waitForFunction(()=>shot===null&&r.successes===1);assert.equal(await page.evaluate(()=>r.rocks.find(k=>k.id===expectedRock).taken),true);
  // The same moving collision rules apply to bombs, with the server deciding loss.
  await page.evaluate(()=>new Promise(resolve=>{function aim(){const max=PM_GEOMETRY.limit(angle),h=PM_GEOMETRY.sweep(r.rocks,r.layer,angle,45,max,motionTime,motionTime+(max-45)/1500);if(h&&h.rock.bomb){window.expectedBomb=h.rock.id;canvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));resolve();}else requestAnimationFrame(aim);}aim();}));
  await page.waitForFunction(()=>shot===null&&r.phase==='busted');assert.equal(await page.evaluate(()=>collectCalls[1]===expectedBomb&&collectCalls.length===2),true);
  const box=await page.locator('#game').boundingBox();assert(box.x>=-.1&&box.y>=-.1&&box.x+box.width<=viewport.width+.1&&box.y+box.height<=viewport.height+.1);
  assert.deepEqual(errors,[]);fs.mkdirSync('../asset-intake/protein-balance',{recursive:true});await page.screenshot({path:'../asset-intake/protein-balance/'+viewport.width+'x'+viewport.height+'.png'});await page.close();
 }
 console.log('PASS: mobile/tablet/desktop; food and bombs move during flight/pull/RPC; first-contact selection; no early collection or double clicks; bomb loss; scene fits viewport; no page errors');
 }finally{await browser.close();await new Promise(ok=>server.close(ok));}
})().catch(e=>{console.error(e.stack);process.exit(1)});
