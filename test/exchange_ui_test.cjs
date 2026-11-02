// Test-only synthetic RPC data. Exercises the real page, without production credentials.
const {chromium}=require(process.env.GC_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
 for(const [name,viewport]of [['small',{width:320,height:568}],['phone',{width:390,height:844}],['tablet',{width:768,height:1024}],['desktop',{width:1366,height:768}]]){
  const page=await browser.newPage({viewport,hasTouch:name!=='desktop'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'application/javascript',body:`
   window.exchangeOrders=[];window.fakeBank='9007199254740993';window.fakePositions=[];window.failFirst=true;
   const defs=[['house','הבנק של הבית','house'],['fisher','מדד הבנקים של פישר','fisher'],['fish','חוות הדגים של עידו','fish'],['protein','אבקות החלבון של אביחי','protein'],['smoke','המעשנה של רועי','smokehouse'],['BNYM','בנימין אחזקות','house'],['FSHR','פישר בלי סטופ','fisher'],['IDO','עידו דגים ונכסים','fish'],['MASS','אביחי מסה בע״מ','protein']];
   function snapshot(args={}){const t=Date.now();return {server_time:new Date(t).toISOString(),bank:fakeBank,realized:'0',positions:structuredClone(fakePositions),markets:defs.map(([code,name,icon])=>({code,name,icon,kind:code===code.toUpperCase()?'daily':'long',tagline:code==='FSHR'?'המשקיע השקט':'',risk:'גבוהה',price:'100',previous:'99',at:new Date(t).toISOString(),history:args.p_hours===0?[]:[{at:new Date(t-60000).toISOString(),price:'99'},{at:new Date(t).toISOString(),price:'100'}]})),...(args.p_code?{chart:[{at:new Date(t-60000).toISOString(),price:'99'},{at:new Date(t).toISOString(),price:'100'}]}:{})};}
   window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'test'}}}})},rpc:async(name,args={})=>{
    if(name==='exchange_state')return {data:snapshot(args)};
    if(name==='exchange_open'){exchangeOrders.push(structuredClone(args));if(!fakePositions.some(p=>p.id===args.p_request)){fakeBank=(BigInt(fakeBank)-BigInt(args.p_amount)).toString();const m=defs.find(d=>d[0]===args.p_code);fakePositions.unshift({id:args.p_request,code:m[0],name:m[1],kind:m[0]===m[0].toUpperCase()?'daily':'long',direction:args.p_direction,stake:args.p_amount,leverage:args.p_leverage,entry:'100',last:'100',value:args.p_amount,opened_at:new Date().toISOString(),expires_at:new Date(Date.now()+args.p_days*86400000).toISOString(),status:'open'});}if(failFirst){failFirst=false;throw Error('Failed to fetch');}return {data:snapshot({p_code:args.p_code})};}
    if(name==='exchange_close'){const p=fakePositions.find(p=>p.id===args.p_position);if(p.status==='open'){p.status='closed';p.payout=p.stake;p.exit='100';p.reason='manual';p.closed_at=new Date().toISOString();fakeBank=(BigInt(fakeBank)+BigInt(p.stake)).toString();}return {data:snapshot()};}
    return {data:null};
   }})};`}));
  await page.goto((process.env.GC_TEST_ORIGIN||'http://127.0.0.1:8766')+'/exchange.html');await page.locator('.market-row').first().waitFor();
  assert.equal(await page.locator('.market-row').count(),5);assert.equal(await page.locator('#bank').getAttribute('aria-label'),'₪9,007,199,254,740,993');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name+' overview fits');
  if(name==='phone'&&process.env.GC_EXCHANGE_SCREENSHOTS)await page.screenshot({path:path.join(process.env.GC_EXCHANGE_SCREENSHOTS,'exchange-market.png'),fullPage:true});
  await page.locator('[data-kind=daily]').click();assert.equal(await page.locator('.market-row').count(),4);await page.getByRole('button',{name:'פרטי פישר בלי סטופ',exact:true}).click();
  await page.locator('#chart svg').waitFor();assert.equal(await page.locator('#leverage').getAttribute('max'),'1000');assert(await page.locator('#longDuration').isHidden());
  await page.locator('#amount').fill('9007199254740993');await page.locator('#leverage').fill('1000');await page.locator('#review').click();assert(await page.locator('#confirmOrder').isVisible());assert((await page.locator('#confirmDetails').innerText()).includes('9,007,199,254,740,993'));
  if(name==='phone'&&process.env.GC_EXCHANGE_SCREENSHOTS)await page.screenshot({path:path.join(process.env.GC_EXCHANGE_SCREENSHOTS,'exchange-confirm.png'),fullPage:true});
  await page.locator('#confirmSubmit').click();await page.locator('#confirmError').filter({hasText:'החיבור לא הושלם'}).waitFor();
  await page.locator('#confirmSubmit').click();await page.locator('#confirmOrder').waitFor({state:'hidden'});assert.equal(await page.locator('#positions .position').count(),1);
  const calls=await page.evaluate(()=>exchangeOrders);assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].p_amount,'9007199254740993');assert.equal(await page.locator('#bank').innerText(),'₪0');
  await page.getByRole('button',{name:'סגירת עסקה במחיר הנוכחי',exact:true}).click();assert.equal(await page.locator('#positions .position').count(),0);await page.locator('[data-view=history]').click();assert.equal(await page.locator('#history .position').count(),1);
  await page.locator('[data-view=market]').click();await page.locator('[data-kind=long]').click();await page.getByRole('button',{name:'פרטי חוות הדגים של עידו',exact:true}).click();assert.equal(await page.locator('#leverage').getAttribute('max'),'50');assert(await page.locator('#longDuration').isVisible());await page.locator('[data-days="7"]').click();assert.equal(await page.locator('#days').inputValue(),'7');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name+' order fits');
  if(name==='phone'&&process.env.GC_EXCHANGE_SCREENSHOTS)await page.screenshot({path:path.join(process.env.GC_EXCHANGE_SCREENSHOTS,'exchange-detail.png'),fullPage:true});
  for(const im of await page.locator('img:visible').all()){await im.evaluate(i=>i.decode());assert(await im.evaluate(i=>i.naturalWidth>0));}
  assert.deepEqual(errors,[]);await page.close();
 }
 const preview=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});await preview.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({body:'window.supabase={};',contentType:'application/javascript'}));await preview.goto((process.env.GC_TEST_ORIGIN||'http://127.0.0.1:8766')+'/exchange.html?preview');await preview.locator('.market-row').first().waitFor();assert(await preview.locator('#previewNotice').isVisible());assert.equal(await preview.locator('.spark svg').count(),0);await preview.locator('.market-row').first().click();assert(await preview.locator('#review').isDisabled());await preview.close();
 const bank=await browser.newPage({viewport:{width:320,height:568},hasTouch:true});await bank.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({body:'window.supabase={};',contentType:'application/javascript'}));await bank.route('https://fonts.googleapis.com/**',r=>r.abort());await bank.goto((process.env.GC_TEST_ORIGIN||'http://127.0.0.1:8766')+'/bank.html?preview');await bank.locator('#exchangeLink').waitFor();const link=await bank.locator('#exchangeLink').boundingBox();assert(link.y>0&&link.y+link.height<568);await bank.locator('#amt').fill('100');await bank.locator('#depBtn').click();assert((await bank.locator('#msg').innerText()).includes('הופקדו'));await bank.close();
 await browser.close();console.log('PASS: responsive exchange, live charts from RPC, exact large amounts, confirmation, lost-response retry with same UUID, portfolio, daily close, long duration and non-trading preview.');
})().catch(e=>{console.error(e);process.exit(1)});
