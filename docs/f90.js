'use strict';
// Golan Casino wiring: every draw, payment and the balance live on the server (f90_start / f90_act / f90_cash).
const $=id=>document.getElementById(id), R=FisherRules, img=src=>{const i=new Image();i.src=src;return i;};
const fmt=n=>{n=Number(n);const a=Math.abs(n);return a>=1e9?'₪'+ +(n/1e9).toFixed(2)+'B':a>=1e6?'₪'+ +(n/1e6).toFixed(2)+'M':'₪'+n.toLocaleString('en-US');};
const db=supabase.createClient(GC_CONFIG.supabaseUrl,GC_CONFIG.supabaseKey);
try{if(localStorage.getItem('gc_dev')!=='1')location.href='./';}catch(e){}
// a thin mirror of the server run, shaped like the kit's Game so the drawing code stays as it was
const game={balance:0,status:'idle',stage:0,ratio:[1,1],stake:0,paid:0,id:null,
 get pot(){return this.status==='lost'?0:R.amount(this.stake,this.ratio);},get canCash(){return this.status==='active'&&this.stage>0;},
 choices(){if(this.status!=='active')return [];return R.STEPS[this.stage].actions.map(a=>{const ratio=R.mul(this.ratio,a.factor),payout=R.amount(this.stake,ratio);return {...a,payout,profit:payout-this.stake,ratio};});},
 load(v){if(!v)return;this.id=v.id;this.stake=+v.stake;this.ratio=[+v.num,+v.den];this.stage=v.stage;this.status=v.status;this.paid=+v.paid;if(v.balance!=null)this.balance=+v.balance;},
 snapshot(){return {balance:this.balance,stake:this.stake,pot:this.pot,stage:this.stage,status:this.status,paid:this.paid,canCash:this.canCash};}};
const errMsg=e=>{const m=(e&&e.message)||'';return m.includes('insufficient')?'אין מספיק שקלים בארנק.':m.includes('invalid_amount')?'הסכום גבוה מהמקסימום להימור שלך.':m.includes('run_in_progress')?'יש לך התקפה פתוחה.':'משהו השתבש. נסה שוב.';};
const field=img('img/f90/pitch-night.webp'),fisher=img('img/f90/fisher-poses.webp'),opponents=img('img/f90/opponents-poses.webp');
const canvas=$('pitch'),ctx=canvas.getContext('2d');let visual=0,animation=null,ready=false,forced=null,sound=false,audio;
const positions=[[330,690,240],[485,635,220],[630,575,200],[760,510,180],[880,455,160],[950,420,150]];
const lerp=(a,b,t)=>a+(b-a)*t;
function sprite(image,rect,x,y,h,pivot=.94){let [sx,sy,sw,sh]=rect,w=h*sw/sh;ctx.drawImage(image,sx,sy,sw,sh,x-w/2,y-h*pivot,w,h);}
function guy(frame,x,y,h){sprite(fisher,[(frame%4)*384,Math.floor(frame/4)*512,384,512],x,y,h);}
function opp(frame,x,y,h){const p=[[0,0,440,443],[443,0,443,443],[886,0,585,443],[1490,0,284,443],[0,443,400,444],[400,443,520,444],[930,443,580,444],[1535,443,239,444]][frame];sprite(opponents,p,x,y,h);}
function ball(x,y,r){ctx.save();ctx.beginPath();ctx.ellipse(x,y+3,r*1.3,r*.42,0,0,7);ctx.fillStyle='#0007';ctx.fill();ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.fillStyle='#f6f6f2';ctx.fill();ctx.lineWidth=1.6;ctx.strokeStyle='#374452';ctx.stroke();ctx.beginPath();for(let i=0;i<5;i++){let a=i*2*Math.PI/5-.5;ctx.lineTo(x+Math.cos(a)*r*.48,y+Math.sin(a)*r*.48)}ctx.closePath();ctx.fillStyle='#263447';ctx.fill();ctx.restore();}
// follow-camera: stays a little behind Fisher and looks up the pitch toward the goal, pushing in as he gets closer
let camX=500,camY=560,camZ=1.35,lastX=330,lastY=690;
function draw(now){if(!ready){requestAnimationFrame(draw);return;}
 const tz=1.35+Math.min(.45,Math.max(0,(lastX-330)/620*.45)),tx=lastX+260,ty=lastY-140;camX+=(tx-camX)*.06;camY+=(ty-camY)*.06;camZ+=(tz-camZ)*.05;
 ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#0b1421';ctx.fillRect(0,0,1440,810);
 let ox=720-camX*camZ,oy=405-camY*camZ;ox=Math.min(0,Math.max(1440-1440*camZ,ox));oy=Math.min(0,Math.max(810-810*camZ,oy));ctx.setTransform(camZ,0,0,camZ,ox,oy);
 ctx.drawImage(field,0,0,1440,810);let p=positions[visual],x=p[0],y=p[1],h=p[2],frame=0,bx=x+40,by=y-12,keeper=4,def=0;
 if(animation){let t=Math.min(1,(now-animation.start)/animation.duration),n=positions[Math.min(animation.from+1,5)],move=animation.ok?t*.98:Math.sin(t*Math.PI)*.28;x=lerp(p[0],n[0],move);y=lerp(p[1],n[1],move);h=lerp(p[2],n[2],move);frame=animation.kind==='shot'?(t<.35?4:5):(Math.floor(t*8)%2?1:2);def=t>.5?2:0;bx=x+40;by=y-12;if(animation.kind==='shot'&&t>.32){let q=(t-.32)/.68;bx=lerp(x+42,animation.ok?1260:1170,q);by=lerp(y-16,animation.ok?235:270,q);keeper=t>.45?(animation.ok?5:6):4;}if(!animation.ok&&animation.kind!=='shot'&&t>.65){bx=lerp(x+40,x+150,(t-.65)/.35);by=y-35;}if(t===1){let a=animation;animation=null;if(a.ok&&a.terminal){net();if(window.GC_BONUS)GC_BONUS('⚽ גול של פישר!',game.paid,'בדקה ה־90');}else flash(a.ok?(a.kind==='pass'?'✅ המסירה הושלמה בהצלחה!':'✅ הדריבל עבר!'):'❌ המהלך נכשל, הכדור נלקח',a.ok);if(a.ok&&!a.terminal)visual=Math.min(a.from+1,4);render();}}
 else if(game.status==='won')frame=6;else if(game.status==='lost')frame=7;
 // Generic defender and teammate, placed at field depth. Goalkeeper remains near goal.
 opp(keeper,1215,285,110);if(visual<4)opp(def,x+205,y-70,h*.83);if(visual<2)guy(1,850,405,125);lastX=x;lastY=y;guy(frame,x,y,h);if(game.status!=='won'&&game.status!=='cashed'&&game.status!=='lost'||animation)ball(bx,by,Math.max(7,h*.055));requestAnimationFrame(draw);}
function kick(){try{audio=audio||new AudioContext();const t=audio.currentTime,o=audio.createOscillator(),g=audio.createGain();o.type='sine';o.frequency.setValueAtTime(150,t);o.frequency.exponentialRampToValueAtTime(45,t+.12);g.gain.setValueAtTime(.55,t);g.gain.exponentialRampToValueAtTime(.001,t+.18);o.connect(g).connect(audio.destination);o.start(t);o.stop(t+.2);
 const b=audio.createBuffer(1,audio.sampleRate*.04,audio.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*(1-i/d.length);const n=audio.createBufferSource(),ng=audio.createGain();ng.gain.value=.35;n.buffer=b;n.connect(ng).connect(audio.destination);n.start(t);}catch{}}
function net(){try{audio=audio||new AudioContext();const t=audio.currentTime,len=audio.sampleRate*.7,b=audio.createBuffer(1,len,audio.sampleRate),d=b.getChannelData(0);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2.2);
 const n=audio.createBufferSource(),f=audio.createBiquadFilter(),g=audio.createGain();f.type='bandpass';f.frequency.value=1800;f.Q.value=.7;g.gain.value=.6;n.buffer=b;n.connect(f).connect(g).connect(audio.destination);n.start(t);}catch{}}
function tone(freq=280,dur=.12){if(!sound)return;try{audio=audio||new AudioContext();const o=audio.createOscillator(),g=audio.createGain();o.frequency.value=freq;g.gain.setValueAtTime(.035,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+dur);o.connect(g).connect(audio.destination);o.start();o.stop(audio.currentTime+dur);}catch{}}
function render(){const s=game.snapshot(),active=s.status==='active',busy=!!animation;$('balance').textContent=fmt(s.balance);$('pot').textContent=active?fmt(s.pot):fmt(s.stake||100);$('pot-label').textContent=active?'קופה נוכחית':'סכום כניסה';$('start-panel').hidden=active||busy;$('actions').hidden=!active||busy;$('cash').hidden=!s.canCash||busy;$('result').hidden=active||s.status==='idle'||busy;$('stage-title').textContent=active?R.STEPS[s.stage].title:'הכדור אצל פישר';$('stage-count').textContent=active?`שלב ${s.stage+1} מתוך 5`:'התקפה אחרונה';$('progress').innerHTML=Array.from({length:5},(_,i)=>`<i class="${active&&i===s.stage?'current':i<s.stage?'done':''}"></i>`).join('');
 if(active&&!busy){$('actions').replaceChildren();for(const a of game.choices()){const b=document.createElement('button');b.dataset.action=a.id;b.innerHTML=`<span class="name">${a.name}</span><span class="amount">תקבל ${fmt(a.payout)}</span><span class="profit">רווח ${fmt(a.profit)}+</span><span class="odds">סיכוי ${(100*a.p[0]/a.p[1]).toFixed(2)}% · ×${a.factor[0]/a.factor[1]}</span>`;b.onclick=()=>play(a.id);$('actions').append(b);}$('cash').innerHTML=`קח וצא <small>קבל ${fmt(s.pot)} · רווח ${fmt(s.pot-s.stake)}+</small>`;}
 if(!active&&s.status!=='idle'&&!busy){let win=s.status!=='lost';$('result').className=win?'win':'loss';$('result').innerHTML=win?`<b>${s.status==='won'?'גול!':'לקחת ויצאת'}</b><span>קיבלת ${fmt(s.paid)} · רווח ${fmt(s.paid-s.stake)}+</span>`:'<b>ההתקפה נעצרה</b><span>הפעם לא זכית</span>';}}
let busyRpc=false;
function flash(t,ok){const d=document.createElement('div');d.className='flash '+(ok?'ok':'bad');d.textContent=t;document.querySelector('.field').appendChild(d);setTimeout(()=>d.remove(),1800);}
async function play(id){if(animation||busyRpc)return;const action=game.choices().find(a=>a.id===id),from=game.stage;if(!action)return;busyRpc=true;
 const {data,error}=await db.rpc('f90_act',{p_run:game.id,p_action:id});busyRpc=false;if(error){$('message').textContent=errMsg(error);return;}
 const ok=data.status!=='lost';game.load(data);const r={action,from,ok};animation={start:performance.now(),duration:r.action.kind==='shot'?2400:1900,from:r.from,kind:r.action.kind,ok:r.ok,terminal:r.action.terminal};$('message').textContent='פישר יוצא למהלך…';kick();render();}
$('start').onclick=async()=>{const v=Number($('stake').value);if(!Number.isInteger(v)||v<1){$('message').textContent='יש לבחור סכום שלם וחיובי.';return;}if(busyRpc)return;busyRpc=true;
 const {data,error}=await db.rpc('f90_start',{p_stake:v,p_ref:(crypto.randomUUID?crypto.randomUUID():Date.now()+''+Math.random())});busyRpc=false;
 if(error){$('message').textContent=errMsg(error);return;}game.load(data);visual=0;$('message').textContent='בחר מהלך. כל סכום מוצג למקרה של הצלחה.';render();};
$('cash').onclick=async()=>{if(busyRpc)return;busyRpc=true;const {data,error}=await db.rpc('f90_cash',{p_run:game.id});busyRpc=false;if(error){$('message').textContent=errMsg(error);return;}game.load(data);$('message').textContent='הקופה נכנסה לארנק.';tone(600);render();if(window.GC_BONUS&&game.paid>=game.stake*5)GC_BONUS('⚽ לקחת ויצאת',game.paid,'');};
$('sound').onclick=()=>{sound=!sound;$('sound').textContent=sound?'סאונד פעיל':'סאונד כבוי';$('sound').setAttribute('aria-pressed',String(sound));tone(440);};
if(false){$('review').hidden=false;document.querySelectorAll('[data-outcome]').forEach(b=>b.onclick=()=>{forced=b.dataset.outcome;game.win=forced==='random'?R.secureWin:()=>forced==='win';$('message').textContent='מצב המחשה: '+b.textContent;});}
Promise.all([field,fisher,opponents].map(i=>i.decode())).then(async()=>{const {data:{session}}=await db.auth.getSession();if(!session){location.href='./';return;}
 const w=await db.from('wallets').select('balance').eq('user_id',session.user.id).single();if(w.data)game.balance=+w.data.balance;
 const c=await db.rpc('f90_current');if(c.data)game.load(c.data);ready=true;$('loading').hidden=true;$('start').disabled=false;render();if(window.GC_LOADER)GC_LOADER.done();}).catch(()=>{$('loading').textContent='לא ניתן לטעון את התמונות. יש לחלץ את כל התיקייה מה-ZIP.';});requestAnimationFrame(draw);
