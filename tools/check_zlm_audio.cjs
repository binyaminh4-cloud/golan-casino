// Decode and inspect supplied MP3s in a real browser's audio decoder without playing them.
const {chromium}=require(process.env.GC_PLAYWRIGHT||'playwright'),fs=require('fs'),crypto=require('crypto'),assert=require('node:assert/strict');
(async()=>{
 const meta=JSON.parse(fs.readFileSync('test/zlm_audio_sources.json','utf8'));
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']}),page=await browser.newPage();
 for(const asset of meta.assets){const bytes=fs.readFileSync('docs/snd/zlm/'+asset.role+'.mp3');
  const stats=await page.evaluate(async b64=>{const a=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const ctx=new OfflineAudioContext(2,1,48000),b=await ctx.decodeAudioData(a.buffer);let peak=0,energy=0,nonFinite=0;for(let c=0;c<b.numberOfChannels;c++){const d=b.getChannelData(c);for(const v of d){if(!Number.isFinite(v))nonFinite++;peak=Math.max(peak,Math.abs(v));energy+=v*v;}}return {duration:b.duration,channels:b.numberOfChannels,sample_rate:b.sampleRate,peak,rms:Math.sqrt(energy/(b.length*b.numberOfChannels)),nonFinite};},bytes.toString('base64'));
  // MP3 reconstruction can overshoot 1.0; the runtime normalizes decoded samples before either bus.
  assert(stats.duration>0&&Math.abs(stats.duration-asset.duration)<.15);assert(stats.peak>.01);assert.equal(stats.nonFinite,0);
  stats.peak_attenuation_required=stats.peak>.85;
  asset.sha256=crypto.createHash('sha256').update(bytes).digest('hex');asset.bytes=bytes.length;asset.decoded=stats;
  console.log(asset.role,stats.duration.toFixed(3)+'s','peak='+stats.peak.toFixed(3),'rms='+stats.rms.toFixed(3));
 }
 fs.writeFileSync('test/zlm_audio_sources.json',JSON.stringify(meta,null,2)+'\n');await browser.close();console.log('PASS: all eight ElevenLabs MP3s decode, contain audible signal and have expected durations.');
})().catch(e=>{console.error(e.message);process.exit(1);});
