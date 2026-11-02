const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const{chromium}=require(process.env.GC_PLAYWRIGHT||'C:/Users/hp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const root=path.resolve('docs'),server=http.createServer((req,res)=>{const f=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!f.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}fs.readFile(f,(e,data)=>{if(e){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':f.endsWith('.webp')?'image/webp':'application/octet-stream');res.end(data)});});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
 try{
 for(const level of [4,1]){
  const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto('http://127.0.0.1:'+server.address().port+'/tamer.html?preview&l='+level);await page.locator('#goBtn').click();
  assert.equal(await page.locator('#hLife').textContent(),level===4?'❤':'❤❤❤');
  const inject=()=>page.evaluate(()=>{G.next=100;G.dropped=5;G.count.rare=5;G.items=[{kind:'bomb',x:G.x,y:FLOOR()-LION_H*.72+20,s:92,v:0,rot:0,vr:0}];step(.001);});
  await inject();assert.equal(await page.evaluate(()=>G.bombs),1);assert.equal(await page.evaluate(()=>G.done),level===4);
  if(level===1){await inject();assert.equal(await page.evaluate(()=>G.done),false);await inject();assert.equal(await page.evaluate(()=>G.done),true);}
  await page.locator('#sumBox').waitFor({state:'visible'});assert.equal(await page.locator('#sumBox .tot').textContent(),level===4?'₪0':'₪3M');await page.close();
 }
 for(const viewport of [{width:667,height:375},{width:844,height:390},{width:1024,height:768}])for(const mode of ['classic','lightning','xxx']){
  const page=await browser.newPage({viewport});await page.goto('http://127.0.0.1:'+server.address().port+'/roulette.html?preview&private&noguide&mode='+mode);await page.waitForFunction(()=>typeof balance!=='undefined'&&balance===10000&&typeof W!=='undefined'&&W);
  await page.evaluate(()=>place('1',10));const before=await page.locator('#spinBtn').boundingBox();
  await page.evaluate(()=>err('אין מספיק שקלים משחקיים. הקטן את ההימור. '.repeat(20)+'ERROR_WITHOUT_SPACES'.repeat(30)));
  const after=await page.locator('#spinBtn').boundingBox();assert(after.x>=0&&after.y>=0&&after.x+after.width<=viewport.width+1&&after.y+after.height<=viewport.height+1,JSON.stringify({viewport,mode,before,after}));
  assert(Math.abs(after.x-before.x)<1&&Math.abs(after.y-before.y)<1,'error cannot move spin');await page.locator('#spinBtn').click();assert.equal(await page.evaluate(()=>busy),true);await page.close();
 }
 // Exercise the actual private RPC failure/retry path as well as long labels.
 {
  const page=await browser.newPage({viewport:{width:667,height:375}});
  await page.route('**/supabase.min.js',r=>r.fulfill({contentType:'text/javascript',body:`let spinCalls=0;window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'fixture'}}}})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{balance:10000}})})})}),rpc:async(name)=>name==='rl_history'?{data:[]}:name==='rl_spin'?(++spinCalls===1?{error:{message:'invalid_amount'}}:{data:{id:'fixture',result:17,total:10,payout:0,balance:9990,lucky:{}}}):{data:null}})};` }));
  await page.route('**/guide.js?*',r=>r.fulfill({contentType:'text/javascript',body:'window.GC_GUIDE={init:()=>{}};window.GC_STEPS={roulette:()=>[]};'}));
  await page.route('**/char.js?*',r=>r.fulfill({contentType:'text/javascript',body:'window.GC_CHAR=async()=>({url:"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2780%27 height=%27160%27%3E%3Crect width=%2780%27 height=%27160%27 fill=%27gold%27/%3E%3C/svg%3E",nick:"משתמש"});'}));await page.route('**/chat.js?*',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/roulette.html?private');await page.waitForFunction(()=>typeof balance!=='undefined'&&balance===10000);await page.locator('.gc-sit').waitFor({state:'visible'});await page.locator('.gc-sit').click();await page.evaluate(()=>place('1',10));
  await page.locator('#spinBtn').click();await page.waitForFunction(()=>document.getElementById('err').textContent.length>0&&!busy);assert.equal(await page.locator('#spinBtn').isEnabled(),true);
  const box=await page.locator('#spinBtn').boundingBox();assert(box.x>=0&&box.y>=0&&box.x+box.width<=668&&box.y+box.height<=376);await page.locator('#spinBtn').click();assert.equal(await page.evaluate(()=>spinCalls),2);await page.close();
 }
 for(const phase of ['ready','busted','cashed','finished']){
  const page=await browser.newPage({viewport:{width:844,height:390}}),base='http://127.0.0.1:'+server.address().port;
  await page.route('**/supabase.min.js',r=>r.fulfill({contentType:'text/javascript',body:`window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'fixture'}}}})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{balance:100000000}})})})}),rpc:async(name)=>({data:name==='pm_current'?${phase==='ready'?'null':JSON.stringify({id:'fixture',mode:'normal',stake:100,rocks:[],phase,layer:3,successes:12,bank_units:500,paid:phase==='busted'?0:500,balance:100000000})}:null})})};`}));
  await page.route('**/guide.js?*',r=>r.fulfill({contentType:'text/javascript',body:'window.GC_GUIDE={init:async()=>{}};window.GC_STEPS={protein:()=>[]};'}));await page.route('**/chat.js?*',r=>r.fulfill({contentType:'text/javascript',body:''}));await page.route(base+'/',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>לובי בדיקה</h1>'}));
  await page.goto(base+'/protein.html');const link=page.locator('.gc-bi .pm-lobby');await link.waitFor({state:'visible'});await page.waitForTimeout(800);const box=await link.boundingBox();assert(box.x>=0&&box.y>=0&&box.y+box.height<=390);await link.click();await page.waitForURL(base+'/');assert.equal(await page.locator('h1').textContent(),'לובי בדיקה');await page.close();
 }
 console.log('PASS: extreme tamer fails on first bomb, normal on third; private roulette controls survive long errors on phone/tablet; protein selectors all exit to lobby');
 }finally{await browser.close();await new Promise(ok=>server.close(ok));}
})().catch(e=>{console.error(e.stack);process.exit(1)});
