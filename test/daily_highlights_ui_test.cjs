const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const{chromium}=require(process.env.GC_PLAYWRIGHT||'C:/Users/hp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const root=path.resolve('docs'),server=http.createServer((req,res)=>{const f=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!f.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}fs.readFile(f,(e,data)=>{if(e){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html; charset=utf-8':f.endsWith('.webp')?'image/webp':'application/octet-stream');res.end(data)});});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
 try{
 for(const viewport of [{width:390,height:844},{width:320,height:568},{width:1024,height:768}]){
  const page=await browser.newPage({viewport,hasTouch:true,isMobile:viewport.width<700,...(viewport.width>=700?{userAgent:'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'}:{})});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('gc_sound_chosen','1');localStorage.setItem('gc_install_seen','done');});
  await page.route('**/supabase.min.js',r=>r.fulfill({contentType:'text/javascript',body:`
   window.hCalls=0;window.hMode='items';const members=[{id:'00000000-0000-0000-0000-000000000001',nickname:'שחקן עם שם ארוך מאוד לבדיקה',wealth:123456789012345},{id:'00000000-0000-0000-0000-000000000002',nickname:'חבר',wealth:50000000},{id:'00000000-0000-0000-0000-000000000003',nickname:'ניסיון חוזר',wealth:1}];
   window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:members[0]}}}),onAuthStateChange:()=>{}},
    from:(table)=>{const data=table==='profiles'?members[0]:table==='leaderboard'?members:table==='wallets'?{balance:100}:[];const query={select:()=>query,eq:()=>query,order:()=>query,limit:()=>query,single:async()=>({data}),then:(resolve)=>Promise.resolve({data}).then(resolve)};return query;},
    rpc:async(name)=>{if(name==='gc_daily_highlights'){hCalls++;if(hMode==='error')return{error:{message:'fixture network error'}};return{data:{day:'2026-11-03',items:hMode==='empty'?[]:[{kind:'game',label:'<img src=x onerror=alert(1)> רולטת הברק המחומש',profit:'500000000'},{kind:'exchange',label:'בורסה · מדד הבנקים של פישר',profit:'320000000'},{kind:'interest',label:'ריבית מהלוואה',profit:'150000000'},{kind:'prize',label:'פרס אלוף העונה',profit:'100000000'},{kind:'jobs',label:'הכנסות מעבודות',profit:'9007199254740993'}]}};}
    return{data:name==='gc_public'?{challenges:false,games:{}}:name==='gc_online'?{}:name==='gc_friend_locations'||name==='rl_live_recent'?[]:null};}})};
  `}));
  await page.route('**/guide.js?*',r=>r.fulfill({contentType:'text/javascript',body:'window.GC_GUIDE={init:()=>{}};window.GC_STEPS={lobby:()=>[]};'}));
  await page.route('**/char.js?*',r=>r.fulfill({contentType:'text/javascript',body:'window.GC_CHAR=async()=>({url:""});'}));
  for(const name of ['chat','install','zman-lobby'])await page.route('**/'+name+'.js?*',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.locator('#lbBox .dh-button').first().waitFor();
  assert.equal(await page.evaluate(()=>hCalls),0,'loading rankings must not query highlights');
  // Reproduce the real row: level badges, online status, favourite game and a large balance.
  await page.evaluate(()=>{
   document.querySelectorAll('#lbBox .lvu').forEach(el=>{el.innerHTML='<img class="lvi" src="img/lvl/lv3.webp" alt="רמה 3" style="width:27px;height:27px;object-fit:contain">';});
   document.querySelectorAll('#lbBox .fav').forEach(el=>el.textContent='🎮 מכונת השירותים');
  });
  const rows=await page.locator('#lbBox li').evaluateAll(els=>els.slice(0,3).map(el=>{
   const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};};
   return {row:rect(el),avatar:rect(el.querySelector('.av')),name:rect(el.querySelector('.nmt')),meta:rect(el.querySelector('.player-meta')),button:rect(el.querySelector('.dh-button')),wealth:rect(el.querySelector('.w')),fav:rect(el.querySelector('.fav'))};
  }));
  const frame=await page.locator('#lobbyView .lb').boundingBox();
  if(viewport.height<650){await page.locator('#lbBox li').nth(2).scrollIntoViewIfNeeded();const last=await page.locator('#lbBox li').nth(2).boundingBox();assert(last.y+last.height<=frame.y+frame.height-3,'short screens can scroll to the full third row');await page.locator('#lbBox').evaluate(el=>el.scrollTop=0);}
  for(const r of rows){if(viewport.height>=650)assert(r.row.bottom<=frame.y+frame.height-3,JSON.stringify({message:'all three rows must fit inside the gold frame',viewport,frame,row:r.row}));assert(r.row.right-r.avatar.right<=15,'avatar stays at right edge');
   for(const k of ['avatar','name','meta','button','wealth','fav'])assert(r[k].x>=r.row.x-1&&r[k].right<=r.row.right+1&&r[k].y>=r.row.y-1&&r[k].bottom<=r.row.bottom+1,JSON.stringify({viewport,k,r}));
   assert(r.button.right<=r.meta.x+1&&r.meta.right<=r.name.x+1,'icons must have separate horizontal space');
   assert(r.wealth.right<=r.fav.x+1,'wealth and favourite must not overlap');
  }

  fs.mkdirSync('../asset-intake/daily-highlights',{recursive:true});await page.screenshot({path:'../asset-intake/daily-highlights/lobby-'+viewport.width+'.png'});await page.evaluate(()=>openFriends());await page.screenshot({path:'../asset-intake/daily-highlights/friends-'+viewport.width+'.png'});await page.locator('#frSheet .dh-button').first().click();await page.locator('.dh-list li').last().waitFor();
  assert.equal(await page.locator('.dh-list li').count(),5);assert.equal(await page.locator('.dh-list img').count(),0,'labels must be text, not HTML');
  assert.equal(await page.locator('.dh-profit').last().getAttribute('title'),'+9,007,199,254,740,993 ₪');
  const box=await page.locator('.dh-box').boundingBox();assert(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1);
  const exit=page.locator('.dh-close');await exit.click();assert(await page.locator('#frSheet').evaluate(el=>el.classList.contains('on')),'closing result must preserve friends sheet');
  await page.locator('#frSheet .dh-button').first().click();await page.locator('.dh-list li').first().waitFor();assert.equal(await page.evaluate(()=>hCalls),1,'same player uses cache');
  await page.keyboard.press('Escape');assert(await page.locator('#frSheet').evaluate(el=>el.classList.contains('on')));
  await page.evaluate(()=>hMode='empty');await page.locator('#frSheet .dh-button').nth(1).click();await page.getByText('עדיין אין רווחים להצגה היום.').waitFor();await exit.click();
  await page.evaluate(()=>hMode='error');await page.locator('#frSheet .dh-button').nth(2).click();await page.locator('.dh-retry').waitFor();
  await page.evaluate(()=>hMode='items');await page.locator('.dh-retry').click();await page.locator('.dh-list li').first().waitFor();
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('dh-close')),true);
  fs.mkdirSync('../asset-intake/daily-highlights',{recursive:true});await page.screenshot({path:'../asset-intake/daily-highlights/'+viewport.width+'x'+viewport.height+'.png'});
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: real lobby/friends integration on phone/tablet; no eager RPC, minute cache, empty/error/retry, five entries, safe labels, exact large amounts, focus/Escape and bounded dialog');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e.stack);process.exit(1)});
