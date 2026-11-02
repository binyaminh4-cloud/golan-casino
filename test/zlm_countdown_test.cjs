// Check the countdown sound and placement without a real account or wallet.
const { chromium } = require(process.env.GC_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({ channel:'msedge', headless:true, args:['--mute-audio'] });
 const page = await browser.newPage({ viewport:{width:390,height:844}, hasTouch:true });
 await page.addInitScript(() => {
  window.countdownSounds=[];
  const connect=AudioBufferSourceNode.prototype.connect;
  AudioBufferSourceNode.prototype.connect=function(destination,...args){
   if(!this.loop && destination instanceof GainNode) window.countdownSounds.push({rate:+this.playbackRate.value.toFixed(2),level:+destination.gain.value.toFixed(2)});
   return connect.call(this,destination,...args);
  };
 });
 await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({body:'window.supabase={};',contentType:'application/javascript'}));
 await page.goto((process.env.GC_TEST_ORIGIN||'http://127.0.0.1:8766')+'/zman.html?preview');
 await page.locator('#chips button').first().click();
 await page.waitForTimeout(1000);
 await page.evaluate(()=>{
  const t=Date.now();ZLM_AUDIO.update({id:'countdown-test',phase:'betting',server_time:new Date(t).toISOString(),phase_at:new Date(t-1000).toISOString(),deadline:new Date(t+20000).toISOString(),draws:0});
  window.countdownSounds=[];
 });
 for(const n of [6,6,5,4,0]) {await page.evaluate(n=>ZLM_AUDIO.countdown(n),n);await page.waitForTimeout(80);}
 assert.deepEqual(await page.evaluate(()=>window.countdownSounds),[{rate:1,level:.65},{rate:1.45,level:1.35},{rate:1.45,level:1.35}]);
 await page.evaluate(()=>{SFX.setMuted(true);ZLM_AUDIO.countdown(3);});await page.waitForTimeout(80);
 assert.equal((await page.evaluate(()=>window.countdownSounds)).length,3,'muted countdown must be silent');
 await page.evaluate(()=>{SFX.setMuted(false);const t=Date.now();ZLM_AUDIO.update({id:'countdown-test',phase:'spin',server_time:new Date(t).toISOString(),phase_at:new Date(t-1000).toISOString(),deadline:new Date(t+2000).toISOString(),draws:0});window.countdownSounds=[];ZLM_AUDIO.countdown(2);});
 // Spin has its own wheel clicks; countdown must not add a high-pitched warning.
 await page.waitForTimeout(80);assert(!(await page.evaluate(()=>window.countdownSounds)).some(s=>s.rate===1.45));
 await page.evaluate(()=>{setInterval(()=>document.querySelector('#clock').textContent='5″',20);});
 await page.waitForTimeout(100);
 const box=await page.locator('#clock').boundingBox();
 assert(Math.abs((box.x+box.width/2)/390-.84)<.01);assert(Math.abs((box.y+box.height/2)/844-.21)<.01);
 if(process.env.GC_COUNTDOWN_SCREENSHOT)await page.screenshot({path:process.env.GC_COUNTDOWN_SCREENSHOT});
 await browser.close();console.log('PASS: countdown placement, distinct last-five sound, no duplicate ticks, mute and spin behavior.');
})().catch(e=>{console.error(e);process.exit(1);});
