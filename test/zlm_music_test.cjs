// Actual browser audio decoder, synthetic shared-round states and no production wallet.
const {chromium}=require(process.env.GC_PLAYWRIGHT||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
 await page.addInitScript(()=>{
  const roles=new WeakMap(),fetchOriginal=window.fetch;
  window.__zlmMusicStarts=[];
  window.fetch=async(...args)=>{const r=await fetchOriginal(...args);const m=String(args[0]).match(/music_(wheel_v2|yoav|range|vip|balls)\.mp3/);if(!m)return r;const original=r.arrayBuffer.bind(r);r.arrayBuffer=async()=>{const a=await original();roles.set(a,m[1]);return a;};return r;};
  const decode=AudioContext.prototype.decodeAudioData;
  AudioContext.prototype.decodeAudioData=function(a,...args){const role=roles.get(a);const p=decode.call(this,a,...args);if(!role)return p;return p.then(b=>{b.__role=role;return b;});};
  const start=AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start=function(...args){if(this.loop&&this.buffer?.__role)window.__zlmMusicStarts.push(this.buffer.__role);return start.apply(this,args);};
 });
 await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({body:'window.supabase={};',contentType:'application/javascript'}));
 await page.route('**/music_range.mp3',async r=>{await new Promise(resolve=>setTimeout(resolve,700));await r.continue();});
 await page.goto((process.env.GC_TEST_ORIGIN||'http://127.0.0.1:8766')+'/zman.html?preview');
 await page.locator('#chips button').first().click();
 const lastIs=async role=>page.waitForFunction(r=>window.__zlmMusicStarts.at(-1)===r,role,{timeout:20000});
 await lastIs('wheel_v2');
 const change=async (spot,phase='choice')=>page.evaluate(({spot,phase})=>{const t=new Date();window.ZLM_AUDIO.update({id:'test',spot,phase,server_time:t.toISOString(),phase_at:new Date(t-5000).toISOString(),deadline:new Date(+t+60000).toISOString(),draws:0});},{spot,phase});
 await change('yoav');await lastIs('yoav');
 await change('range');await change('vip');await lastIs('vip');await page.waitForTimeout(1100);
 assert.equal(await page.evaluate(()=>window.__zlmMusicStarts.at(-1)),'vip','late track must not override the current bonus');
 await change('balls');await lastIs('balls');await change('range');await lastIs('range');
 await page.locator('#sound').click();await page.locator('.sfx-menu input[data-k=mu]').uncheck();
 const before=await page.evaluate(()=>window.__zlmMusicStarts.length);await change('yoav');await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>window.__zlmMusicStarts.length),before);
 await page.locator('.sfx-menu input[data-k=mu]').check();await lastIs('yoav');
 await change(null,'betting');await lastIs('wheel_v2');
 assert.deepEqual(await page.evaluate(()=>window.ZLM_AUDIO.settings),{effects:.7,music:.3});
 await browser.close();console.log('PASS: attached wheel song, four bonus tracks, stale-load race, mute/unmute and 70/30 mix in a real browser.');
})().catch(e=>{console.error(e.message);process.exit(1)});
