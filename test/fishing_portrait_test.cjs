// Portrait layout and preview-only interactions; no real wallet or server requests.
const {chromium}=require(process.env.GC_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
 for(const [name,viewport] of [['small',{width:320,height:568}],['phone',{width:390,height:844}],['tablet',{width:768,height:1024}],['desktop',{width:1366,height:768}],['sideways',{width:844,height:390}]]){
  const page=await browser.newPage({viewport,hasTouch:name!=='desktop'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('gc_guide2_fishing','1');});
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({})};'}));
  await page.route('https://fonts.googleapis.com/**',r=>r.abort());
  await page.route('https://fonts.gstatic.com/**',r=>r.abort());
  await page.goto((process.env.GC_TEST_ORIGIN||'http://127.0.0.1:8766')+'/fishing.html?preview');
  await page.locator('#gcLoad').waitFor({state:'detached',timeout:20000});
  await page.locator('#zones .zone').first().waitFor();
  if(name==='sideways'){assert(await page.locator('.fishing-rotate').isVisible());await page.close();continue;}
  assert(await page.locator('.fishing-rotate').isHidden());assert.equal(await page.locator('.rotate-gate').count(),0);
  assert.equal(await page.locator('#zones .zone').count(),5);assert.equal(await page.locator('#chips button').count(),6);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  for(const sel of ['.back','#rulesBtn','#zones','#chips','#allBtn','#rebetBtn','#clearBtn']){
   const box=await page.locator(sel).boundingBox();assert(box&&box.x>=-1&&box.y>=-1&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,name+' '+sel+' fits viewport');
  }
  const stage=await page.locator('.stagewrap').boundingBox(),bar=await page.locator('.betbar').boundingBox();assert(stage.height>bar.height+130,name+' has room for the wheel');
  const chip=page.locator('#chips button').first();await chip.click();await page.locator('.zone[data-k="blue"]').click();assert.notEqual(await page.locator('[data-a=blue]').innerText(),'');
  await page.locator('#clearBtn').click();assert.equal(await page.locator('[data-a=blue]').innerText(),'');
  await page.locator('#rulesBtn').click();assert(await page.locator('#rules').isVisible());await page.locator('#rules button').click();
  if(['small','phone','tablet'].includes(name)&&process.env.GC_FISHING_SCREENSHOTS)await page.screenshot({path:path.join(process.env.GC_FISHING_SCREENSHOTS,'fishing-'+name+'.png')});
  if(name==='phone'){
   await page.evaluate(()=>{FAKE0=Date.now()-18000;document.dispatchEvent(new Event('visibilitychange'));});
   await page.waitForFunction(()=>document.body.classList.contains('closeup'),null,{timeout:10000});
   assert(await page.locator('#bonusPop').isHidden());
   assert.equal(await page.locator('.zone').first().evaluate(e=>getComputedStyle(e).pointerEvents),'none');
   if(process.env.GC_FISHING_SCREENSHOTS)await page.screenshot({path:path.join(process.env.GC_FISHING_SCREENSHOTS,'fishing-closeup.png')});
   const stopAligned=await page.evaluate(()=>Math.abs(Math.sin((rotAt(20)+(S.stop+.5)*TH)/2))<1e-8);assert(stopAligned,'wheel ends on server result');
   await page.evaluate(()=>{FAKE0=Date.now()-22000;document.dispatchEvent(new Event('visibilitychange'));});
   await page.locator('#bonusPop').waitFor({state:'visible',timeout:10000});const bonus=await page.locator('#bonusPop').boundingBox(),canvas=await page.locator('#bonusCv').boundingBox();assert(bonus.width<=viewport.width&&Math.abs(canvas.width/canvas.height-16/9)<.04);assert(await page.locator('#bonusValue').isVisible());
   if(process.env.GC_FISHING_SCREENSHOTS)await page.screenshot({path:path.join(process.env.GC_FISHING_SCREENSHOTS,'fishing-bonus.png')});
  }
  assert.deepEqual(errors,[]);await page.close();
 }
 const first=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
 await first.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({})};'}));
 await first.route('https://fonts.googleapis.com/**',r=>r.abort());
 await first.goto((process.env.GC_TEST_ORIGIN||'http://127.0.0.1:8766')+'/fishing.html?preview');await first.locator('.gd').waitFor({state:'visible',timeout:15000});await first.close();
 await browser.close();console.log('PASS: portrait wheel, controls, preview betting, full bonus frame, first-visit guide, desktop and landscape gate.');
})().catch(e=>{console.error(e);process.exit(1)});
