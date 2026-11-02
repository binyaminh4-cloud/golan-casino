/* ElevenLabs assets. Local 70/30 mix; shared mute/music preferences are respected. */
(function(){
 'use strict';
 const roles=['music_wheel_v2','tick','shot','win','ball','pour','bonus','target'];
 const settings=Object.freeze({effects:.7,music:.3});
 let ctx,fxBus,musicBus,musicSource,musicName='',musicPending='',musicToken=0,unlocked=false,last=null,key='',draws=null,offset=0,spinToken=0,countdownKey='',countdownLast=Infinity;
 const buffers={},loading={},spinSources=new Set(),sources=new Set();
 const visible=()=>!document.hidden&&!matchMedia('(pointer:coarse) and (orientation:landscape)').matches;
 const clock=()=>Date.now()+offset;
 function context(){if(!ctx){const C=window.AudioContext||window.webkitAudioContext;if(!C)return null;ctx=new C();fxBus=ctx.createGain();musicBus=ctx.createGain();const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-3;limiter.knee.value=3;limiter.ratio.value=16;limiter.attack.value=.003;limiter.release.value=.15;fxBus.connect(limiter);musicBus.connect(limiter);limiter.connect(ctx.destination);}return ctx;}
 function normalize(buffer,role){
  let peak=0,energy=0,count=0;
  for(let c=0;c<buffer.numberOfChannels;c++){const a=buffer.getChannelData(c);for(let i=0;i<a.length;i++){const v=a[i];peak=Math.max(peak,Math.abs(v));if(Math.abs(v)>.002){energy+=v*v;count++;}}}
  const rms=Math.sqrt(energy/Math.max(1,count)),gain=Math.min(role.startsWith('music')?.14/Math.max(.001,rms):.2/Math.max(.001,rms),.85/Math.max(.001,peak));
  for(let c=0;c<buffer.numberOfChannels;c++){const a=buffer.getChannelData(c);for(let i=0;i<a.length;i++)a[i]*=gain;}
  if(role==='tick'){
   let onset=0;const a=buffer.getChannelData(0),threshold=Math.max(.005,peak*gain*.12);
   while(onset<a.length&&Math.abs(a[onset])<threshold)onset++;
   const len=Math.min(Math.ceil(.032*buffer.sampleRate),buffer.length-onset);if(len>0){const tick=ctx.createBuffer(buffer.numberOfChannels,len,buffer.sampleRate);
    for(let c=0;c<buffer.numberOfChannels;c++){const src=buffer.getChannelData(c),out=tick.getChannelData(c);for(let i=0;i<len;i++){const edge=Math.min(1,i/Math.max(1,buffer.sampleRate*.001),(len-i)/Math.max(1,buffer.sampleRate*.004));out[i]=src[onset+i]*edge;}}return tick;}
  }
  return buffer;
 }
 function load(role){if(buffers[role])return Promise.resolve(buffers[role]);if(loading[role])return loading[role];if(!context())return Promise.resolve(null);
  loading[role]=fetch('snd/zlm/'+role+'.mp3').then(r=>{if(!r.ok)throw Error('audio unavailable');return r.arrayBuffer();}).then(a=>ctx.decodeAudioData(a)).then(b=>buffers[role]=normalize(b,role)).catch(()=>{delete loading[role];return null;});return loading[role];
 }
 function play(buffer,{delay=0,level=1,spin=false,rate=1}={}){if(!buffer||!unlocked||!visible()||window.SFX?.muted)return null;const s=ctx.createBufferSource(),g=ctx.createGain();s.buffer=buffer;s.playbackRate.value=rate;g.gain.value=level;s.connect(g).connect(fxBus);sources.add(s);if(spin)spinSources.add(s);s.onended=()=>{sources.delete(s);spinSources.delete(s);s.disconnect();g.disconnect();};s.start(ctx.currentTime+Math.max(0,delay));return s;}
 function effect(role,options={}){if(!unlocked||!visible()||window.SFX?.muted)return;const stamp=key;load(role).then(b=>{if(stamp===key)play(b,options);});}
 function countdown(n){if(!last||last.phase!=='betting')return;if(countdownKey!==key){countdownKey=key;countdownLast=Infinity;}if(n<=0||n>=countdownLast)return;countdownLast=n;if(!unlocked||!visible()||window.SFX?.muted)return;const stamp=key;load('tick').then(b=>{if(key===stamp&&countdownLast===n)play(b,{level:n<=5?1.35:.65,rate:n<=5?1.45:1});});}
 function stopSpin(){spinToken++;for(const s of spinSources)try{s.stop();}catch{}spinSources.clear();}
 async function spin(s){stopSpin();const token=spinToken,b=await load('tick');if(!b||token!==spinToken||!visible()||last?.phase!=='spin')return;
  const duration=(Date.parse(s.deadline)-Date.parse(s.phase_at))/1000,elapsed=Math.max(0,(clock()-Date.parse(s.phase_at))/1000);
  // Closely spaced little clicks become progressively farther apart as the wheel brakes.
  for(let at=0;at<duration;at+=.018+.34*Math.pow(at/duration,3))if(at>=elapsed)play(b,{delay:at-elapsed,level:.65,spin:true});
 }
 function desiredMusic(){return last&&!['betting','spin'].includes(last.phase)&&['yoav','range','vip','balls'].includes(last.spot)?'music_'+last.spot:'music_wheel_v2';}
 function stopMusic(){musicToken++;musicPending='';if(musicSource){try{musicSource.stop();musicSource.disconnect();}catch{}musicSource=null;}musicName='';}
 async function startMusic(){const name=desiredMusic();if(!unlocked||!visible()||window.SFX?.musicOn===false||musicSource&&musicName===name||musicPending===name)return;
  const token=++musicToken;musicPending=name;const b=await load(name);if(token!==musicToken)return;musicPending='';
  if(!b||!visible()||window.SFX?.musicOn===false||desiredMusic()!==name)return;
  if(musicSource){try{musicSource.stop();musicSource.disconnect();}catch{}}
  musicSource=ctx.createBufferSource();musicSource.buffer=b;musicSource.loop=true;musicSource.connect(musicBus);musicName=name;musicSource.start();
 }
 function sync(){if(!ctx||!unlocked)return;fxBus.gain.setTargetAtTime(window.SFX?.muted||!visible()?0:settings.effects,ctx.currentTime,.02);musicBus.gain.setTargetAtTime(window.SFX?.musicOn===false||!visible()?0:settings.music,ctx.currentTime,.15);
  if(window.SFX?.musicOn===false||!visible()){stopMusic();}else startMusic();
  const button=document.getElementById('sound');if(button)button.textContent=window.SFX?.muted&&window.SFX?.musicOn===false?'🔇':'🔊';
 }
 function update(s){offset=Date.parse(s.server_time)-Date.now();const next=s.id+':'+s.phase,changed=next!==key,first=last===null,fresh=clock()-Date.parse(s.phase_at)<2200;last=s;sync();
  if(changed){key=next;stopSpin();if(s.phase==='spin'&&unlocked)spin(s);}
  if(!first&&changed&&fresh){
   if(s.phase==='choice')effect('bonus');
   if(s.phase==='reveal'&&['range','vip'].includes(s.spot)){const n=s.spot==='vip'?3:1;for(let i=0;i<n;i++)effect('shot',{delay:i*.16,level:n===3?.55:1});}
   if(s.phase==='extra_reveal')effect('shot');
   if(s.phase==='extra'||s.phase==='summary'&&['range','vip'].includes(s.spot))effect('target');
   if(s.phase==='reveal'&&s.spot==='yoav')effect('pour');
   if(s.phase==='summary'&&s.last_result?.round===s.id&&BigInt(s.last_result.payout)>0n)effect('win');
  }
  if(s.spot==='balls'&&s.draws>0&&draws!==null&&s.draws===draws+1){const eventTime=s.phase==='balls'?Date.parse(s.phase_at)+s.draws*3000:Date.parse(s.phase_at);if(clock()-eventTime<1800)effect('ball');}
  draws=s.spot==='balls'?s.draws:null;
 }
 function pause(){stopSpin();for(const s of sources)try{s.stop();}catch{}sources.clear();stopMusic();last=null;key='';draws=null;}
 addEventListener('pointerdown',()=>{if(!context())return;unlocked=true;ctx.resume().catch(()=>{});roles.forEach(load);sync();if(last?.phase==='spin'&&spinSources.size===0)spin(last);},{capture:true});
 document.addEventListener('DOMContentLoaded',()=>{const b=document.getElementById('sound');if(b&&window.GC_SOUND_MENU)GC_SOUND_MENU(b);});
 document.addEventListener('change',e=>{if(e.target.closest('.sfx-menu'))sync();});
 document.addEventListener('visibilitychange',()=>{if(!visible())pause();else sync();});addEventListener('pagehide',pause);
 addEventListener('resize',()=>{if(!visible())pause();});
 window.ZLM_AUDIO={update,effect,countdown,pause,settings};
})();
