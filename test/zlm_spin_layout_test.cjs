// Exercise real phase changes using a local fake server; never touch real accounts or bets.
const {chromium}=require(process.env.GC_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
 for(const [name,viewport] of [['small',{width:320,height:568}],['phone',{width:390,height:844}],['tablet',{width:768,height:1024}],['desktop',{width:1366,height:768}]]){
  const page=await browser.newPage({viewport,hasTouch:name!=='desktop'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'application/javascript',body:`
   window.testPhase='betting';window.testRound=1;
   window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'test'}}}})},rpc:async(name)=>{
    if(name==='zlm_repeat_ready')return {data:1};
    if(name!=='zlm_state')return {data:null,error:{message:'not used'}};
    const t=Date.now(),phase=window.testPhase,bonus=phase==='choice';
    return {data:{id:'round-'+window.testRound,phase,phase_at:new Date(t-1000).toISOString(),deadline:new Date(t+20000).toISOString(),server_time:new Date(t).toISOString(),bets:{one:'100'},balance:'100000',boosts:{1:3,12:2},cell:bonus?6:1,spot:bonus?'yoav':'one',bonus:{eligible:true,picks:[],extra:null,targets:[]},draws:0,last_result:phase==='summary'?{round:'round-'+window.testRound,payout:'200'}:null}};
   }})};`}));
  await page.route('**/guide.js?*',r=>r.fulfill({contentType:'application/javascript',body:'window.GC_GUIDE={init:async()=>{}};'}));
  await page.route('**/chat.js?*',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await page.goto((process.env.GC_TEST_ORIGIN||'http://127.0.0.1:8766')+'/zman.html');
  await page.locator('#wallet').filter({hasText:'100,000'}).waitFor();
  const sizes=async()=>page.evaluate(()=>{const w=document.querySelector('.wheel-scene').getBoundingClientRect(),b=document.querySelector('#board').getBoundingClientRect(),p=document.querySelector('.pointer').getBoundingClientRect();return {wheel:w.width,board:b.width,boardTop:b.top,pointerDelta:Math.abs((p.x+p.width/2)-(w.x+w.width/2)),overflow:document.documentElement.scrollWidth>innerWidth+1};});
  const phase=async(p,round)=>{await page.evaluate(({p,round})=>{window.testPhase=p;if(round)window.testRound=round;dispatchEvent(new Event('online'));},{p,round});};
  const waitClass=async enabled=>{await page.waitForFunction(enabled=>document.querySelector('#mainGame').classList.contains('spin-view')===enabled,enabled);await page.waitForTimeout(550);};
  const betting=await sizes();assert.equal(await page.locator('.bet-spot:enabled').count(),17);
  await phase('spin');await waitClass(true);const spinning=await sizes();
  assert(spinning.wheel>betting.wheel*1.15,name+' wheel grows');assert(spinning.board<betting.board*.9,name+' board shrinks');assert(spinning.boardTop>betting.boardTop,name+' board moves down');assert(spinning.pointerDelta<2,name+' pointer centered');assert(!spinning.overflow||betting.overflow,name+' no new horizontal overflow');
  assert.equal(await page.locator('.bet-spot:enabled').count(),0);assert.equal(await page.locator('[data-spot=one] .chip').count(),1);
  await page.evaluate(()=>window.spinAnimation=document.querySelector('#wheelTurn').getAnimations()[0]);await phase('spin');await page.waitForTimeout(300);assert(await page.evaluate(()=>window.spinAnimation===document.querySelector('#wheelTurn').getAnimations()[0]),'poll does not restart animation');
  if(name==='phone'&&process.env.GC_SPIN_SCREENSHOT)await page.screenshot({path:process.env.GC_SPIN_SCREENSHOT});
  await phase('choice');await page.locator('#bonus:not([hidden])').waitFor();assert(await page.locator('#mainGame').isHidden());
  await phase('betting',2);await waitClass(false);assert(await page.locator('#mainGame').isVisible());assert.equal(await page.locator('.bet-spot:enabled').count(),17);assert(Math.abs((await sizes()).wheel-betting.wheel)<2);
  await phase('summary');await waitClass(true);assert((await page.locator('#receipt').innerText()).includes('₪200'));
  await phase('betting',3);await waitClass(false);assert.equal(await page.locator('.bet-spot:enabled').count(),17);
  await page.locator('#rulesBtn').scrollIntoViewIfNeeded();assert(await page.locator('#rulesBtn').isVisible());assert.deepEqual(errors,[]);
  await page.close();
 }
 await browser.close();console.log('PASS: server phase transitions, larger wheel, smaller board, preserved animation/bets, bonus and next-round restoration across four screen sizes.');
})().catch(e=>{console.error(e);process.exit(1)});
