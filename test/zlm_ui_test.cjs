// Run with a local docs/ HTTP server; GC_PLAYWRIGHT may point to the bundled module.
const {chromium}=require(process.env.GC_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
async function main(){
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
 const origin=process.env.GC_TEST_ORIGIN||'http://127.0.0.1:8766',out=process.env.GC_SCREENSHOTS;
 if(out)fs.mkdirSync(out,{recursive:true});
 const failures=[];
 for(const [name,viewport]of [['phone',{width:390,height:844}],['landscape',{width:844,height:390}],['desktop',{width:1366,height:768}],['ipad',{width:768,height:1024}],['ipad-landscape',{width:1024,height:768}]]){
  const page=await browser.newPage({viewport,hasTouch:name!=='desktop'});page.on('pageerror',e=>failures.push(e.message));
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({body:'window.supabase={};',contentType:'application/javascript'}));
  for(const [scene,query] of [['main',''],['yoav','&bonus=yoav&summary'],['range','&bonus=range&summary'],['vip','&bonus=vip'],['balls','&bonus=balls&summary']]){
   await page.goto(origin+'/zman.html?preview'+query);
   await page.locator('#gcLoad').waitFor({state:'detached',timeout:10000});
   await page.locator('#wallet').filter({hasText:'3,500,000,000,000'}).waitFor({state:'attached'});
   if(name.includes('landscape')){assert(await page.locator('.rotate-gate').isVisible());assert.equal(await page.locator('main').evaluate(el=>getComputedStyle(el).visibility),'hidden');if(out)await page.screenshot({path:path.join(out,name+'-gate.png')});break;}
   assert.equal(await page.locator('.zlm-bar').evaluate(el=>getComputedStyle(el).display),'grid');
   assert(await page.locator('.zlm-bar').evaluate(el=>el.getBoundingClientRect().width<=540));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name+' '+scene+' overflows');
   for(const im of await page.locator('img:visible').all()){await im.evaluate(el=>el.decode());assert(await im.evaluate(el=>el.complete&&el.naturalWidth>0),'missing image '+await im.getAttribute('src'));}
   if(scene==='main'){
    const centered=await page.evaluate(()=>{const w=document.querySelector('.wheel-wrap').getBoundingClientRect(),p=document.querySelector('.pointer').getBoundingClientRect();return Math.abs((p.x+p.width/2)-(w.x+w.width/2))<2;});assert(centered,'pointer must stay at 12 oclock in RTL');
    assert.equal(await page.locator('.bet-spot').count(),17);
    assert.equal(await page.locator('#amount,#half,#all').count(),0);assert.equal(await page.locator('#chips button').count(),7);
    assert.equal(await page.locator('.odds').count(),13);assert.equal(await page.locator('[data-spot=one] .odds').innerText(),'1:1');assert.equal(await page.locator('[data-spot=f1] .odds').innerText(),'25:1');assert.equal(await page.locator('[data-spot=b1] .odds').innerText(),'42:1');
    assert(await page.locator('#board').evaluate(el=>el.getBoundingClientRect().height>210));
    const chip=page.locator('#chips button').first(),value=await chip.getAttribute('data-value');await chip.click();await page.locator('[data-spot=f1]').click();
    assert.equal(await page.locator('#totalBet').innerText(),'הימור כולל: ₪'+BigInt(value).toLocaleString('en-US'));
    assert.equal(await page.locator('[data-spot=f1] .chip').getAttribute('aria-label'),'₪'+BigInt(value).toLocaleString('en-US'));assert.equal(await page.locator('[data-spot=i1] .chip').count(),0);
    assert((await page.locator('[data-spot=f1] .chip').getAttribute('style')).includes('img/chips/chip_'));
    await page.locator('#cancel').click();assert.equal(await page.locator('.bet-spot .chip').count(),0);
    await page.locator('#rulesBtn').click();assert(await page.locator('#rules').isVisible());await page.locator('#closeRules').click();
   }
   if(query.includes('summary')){assert((await page.locator('#receipt').innerText()).includes('₪'));assert(!(await page.locator('#receipt').innerText()).includes('='));}
   if(scene==='vip'){
    for(let i=0;i<3;i++)await page.locator('.target').nth(i).click();
    assert.equal(await page.locator('.target.selected').count(),3);assert.equal(await page.locator('.target:enabled').count(),0);
   }
   if(scene==='balls'){
    assert.equal(await page.locator('.ladder .step').count(),36);assert.equal(await page.locator('.black-count .lit').count(),4);
    assert.equal(await page.locator('.collected img').count(),12);
   }
   if(out)await page.screenshot({path:path.join(out,name+'-'+scene+'.png'),fullPage:true});
  }
  await page.close();
 }
 assert.deepEqual(failures,[]);await browser.close();
 console.log('PASS: 15 portrait scenes; phone/iPad landscape gates; larger board; 13 odds labels; seven real chip graphics; colored bets; clear; currency-only wins; VIP picks and ball counters.');
}
main().catch(e=>{console.error(e.message);process.exit(1)});
