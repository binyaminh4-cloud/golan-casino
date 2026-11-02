// Browser checks with an isolated fake server: no real wallet or production rounds.
const {chromium}=require(process.env.GC_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
 for(const width of [320,390,768]){
  const selected=width===320?'ירוק':width===390?'סגול':'כתום',selectedIndex=['ירוק','סגול','כתום'].indexOf(selected);
  const page=await browser.newPage({viewport:{width,height:width===320?568:width===390?844:1024},hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'application/javascript',body:`
   window.fakeEligible=true;window.fakePhase='choice';window.fakeFail=false;window.fakePicks=[];window.fakeRequests=0;
   function makeState(){const t=Date.now();return {id:'test-round',phase:fakePhase,phase_at:new Date(t-1000).toISOString(),deadline:new Date(t+20000).toISOString(),server_time:new Date(t).toISOString(),bets:{balls:'100'},balance:'100000',boosts:{},cell:12,spot:'balls',bonus:{eligible:fakeEligible,picks:[...fakePicks],levels:[0,0,0],values:[5,5,5],events:[],black:0},draws:0};}
   window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'test'}}}})},rpc:async(name,args)=>{
    if(name==='zlm_repeat_ready')return {data:1};if(name==='zlm_state')return {data:makeState()};
    if(name==='zlm_choose'){fakeRequests++;await new Promise(r=>setTimeout(r,250));if(fakeFail)return {error:{message:'Failed to fetch'}};fakePicks=[args.p_pick];return {data:makeState()};}
    return {data:null,error:{message:'not used'}};
   }})};`}));
  await page.route('**/guide.js?*',r=>r.fulfill({contentType:'application/javascript',body:'window.GC_GUIDE={init:async()=>{}};'}));
  await page.route('**/chat.js?*',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await page.goto((process.env.GC_TEST_ORIGIN||'http://127.0.0.1:8766')+'/zman.html');
  const picker=page.locator('.ball-picker');await picker.waitFor();
  assert.equal(await picker.locator('button').count(),3);assert.deepEqual(await picker.locator('button span').allTextContents(),['ירוק','סגול','כתום']);
  assert.equal(await page.locator('.drum-balls img').count(),24);
  assert.equal(await page.locator('.drum-balls img').first().evaluate(e=>getComputedStyle(e).animationName),'none');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  if(width===390&&process.env.GC_BALLS_SCREENSHOT)await page.screenshot({path:process.env.GC_BALLS_SCREENSHOT});
  await page.evaluate(()=>window.fakeFail=true);await picker.getByRole('button',{name:'בחירת כדור '+selected}).click();
  await page.waitForTimeout(70);assert.equal(await picker.locator('button:disabled').count(),3);
  await page.locator('#error').filter({hasText:'החיבור נותק'}).waitFor();assert((await picker.locator('.ball-picker-error').innerText()).includes('לא נשמרה'));assert.equal(await picker.locator('button:enabled').count(),3,'failed selection is retryable');
  await page.evaluate(()=>window.fakeFail=false);await picker.getByRole('button',{name:'בחירת כדור '+selected}).click();await picker.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>fakeRequests),2);assert.deepEqual(await page.evaluate(()=>fakePicks),[selectedIndex]);assert.equal(await page.locator('.ladder.selected .ladder-label').innerText(),selected);assert((await page.locator('.balls-caption').innerText()).includes(selected));
  await page.evaluate(()=>dispatchEvent(new Event('online')));await page.waitForTimeout(300);assert.equal(await picker.count(),0,'confirmed selection remains closed on refresh');
  await page.evaluate(()=>{fakePhase='balls';dispatchEvent(new Event('online'));});await page.locator('.drum-balls.mixing').waitFor();
  assert.equal(await page.locator('.drum-balls img').first().evaluate(e=>getComputedStyle(e).animationName),'ball-roll-gently');
  await page.evaluate(()=>{fakePhase='choice';fakePicks=[];fakeEligible=false;dispatchEvent(new Event('online'));});
  await page.locator('.bonus-info').filter({hasText:'צופים'}).waitFor();assert.equal(await picker.count(),0,'spectators do not choose');
  assert.deepEqual(errors,[]);await page.close();
 }
 await browser.close();console.log('PASS: three clear choices, server acknowledgement, failed retry, reconnect, spectators and restrained ball animation at three screen widths.');
})().catch(e=>{console.error(e);process.exit(1)});
