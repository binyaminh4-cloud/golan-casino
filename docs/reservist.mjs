import {NAMES,TARGETS,FEATURES,world,camera,point} from './reservist-world.mjs?v=1794218060';
const $=id=>document.getElementById(id),PREVIEW=new URLSearchParams(location.search).has('preview');
const db=PREVIEW?null:supabase.createClient(GC_CONFIG.supabaseUrl,GC_CONFIG.supabaseKey);
const compact=n=>Number(n)>=1e6?'₪'+Number((n/1e6).toFixed(2))+'M':'₪'+Number(n).toLocaleString('en-US');
const fmt=n=>'₪'+Number(n).toLocaleString('en-US'),uid=()=>crypto.randomUUID();
const files=['range_bg','gate_bg','base_bg','city_separate_bg','window_frame','target','hostile',...TARGETS,'civilian_elder','civilian_woman','civilian_walk_sheet','scope_v2','button_fire','button_scope','muzzle_flash','impact'];
const art={},canvas=$('scene'),ctx=canvas.getContext('2d');
const metaReady=fetch('img/reservist/meta.json?v=1794218060').then(r=>{if(!r.ok)throw new Error('art_missing');return r.json();}).then(data=>{meta=data;});
const ready=Promise.all(files.map(name=>new Promise((ok,no)=>{const img=new Image();img.onload=()=>{art[name]=img;ok();};img.onerror=()=>no(new Error('art_missing'));img.src='img/reservist/'+name+'.webp';})));
let meta={},config,run=null,received=0,zoom=false,view={cx:.5,cy:.57},aim={x:.5,y:.5},cam=null,sending=false,settling=false,unresolved=null,startRef=null,coolUntil=0,lastSecond=-1,flash=0,impact=null,feedbackUntil=0,finishedResult=null,previewBank=0,firedEvents=new Set(),nextFinishAttempt=0;
const RULES={range:'10 מטרות, אחת בכל פעם למשך 1–2 שניות. נגיעה במרכז העיגולים משלמת מיליון, בשאר המטרה 100 אלף, והחטאה אפס. אפשר לגעת במטרה כדי לירות.',gate:'5 אירועים. המתינו להבזק הירי ופגעו בתוקף בתוך 2 שניות. כל פגיעה נכונה שווה 4 מיליון. פגיעה בדמות שגויה מורידה 25% מהסכום שנצבר, עד אפס.',base:'מצאו את התוקף שמסתתר בין הסככות ופגעו בו בתוך 30 שניות. פגיעה נכונה משלמת 30 מיליון. אין דמויות מסיחות.',sniper:'גררו כדי לסרוק את הרחוב והבניינים. זהו את שלושת היעדים לפי התמונות והתכונות שבתיק. לחצו כוונת להגדלה, כוונו במרכז ולחצו ירי. כל יעד נכון שווה 25 מיליון. פגיעה בכל דמות אחרת מורידה 25% מהסכום שנצבר, עד אפס. זמן המשימה 90 שניות.'};
function effect(name){try{SFX.fx('rv_'+name,{vol:.8});}catch(_){}}
function note(txt){$('note').textContent=txt;}
function elapsed(){return run?Math.max(0,run.elapsed+(performance.now()-received)/1000):0;}
function sync(r){run=r;received=performance.now();}
function makePreview(mode){
 let scene=[];
 if(mode==='range')scene=Array.from({length:10},(_,i)=>({id:String(i),at:.5+i*2,dur:1.5,x:.16+(i%5)*.17,y:i<5?.41:.533}));
 if(mode==='gate')scene=Array.from({length:5},(_,i)=>({attacker:i%3}));
 if(mode==='base')scene=Array.from({length:5},(_,i)=>({x:.25+i*.12,y:.56}));
 if(mode==='sniper')scene=Array.from({length:7},(_,i)=>({id:i<3?'target-'+i:'npc-'+i,asset:[...TARGETS,'civilian_walk_sheet','civilian_elder','civilian_woman','hostile'][i],x:i===2?.192:.14+i*.128,y:i===2?.406:.82,window:i===2}));
 return{id:uid(),mode,scene,seconds:mode==='range'?20:config[mode].seconds,unit:config[mode].unit,mult:1,elapsed:0,earned:0,hits:[],shots:0,done:false,paid:0};
}
async function call(name,args={}){
 if(!PREVIEW){const {data,error}=await db.rpc(name,args);if(error)throw error;return data;}
 if(name==='rv_state')return{config:{range:{seconds:25,unit:1e6,max:1e7},gate:{seconds:25,unit:4e6,max:2e7},base:{seconds:30,unit:3e7,max:3e7},sniper:{seconds:90,unit:25e6,max:75e6},mult:1,cooldown:15},run:null,cooldown:0};
 if(name==='rv_start')return makePreview(args.p_mode);
 if(name==='rv_finish'){run.done=true;run.paid=run.earned;previewBank+=run.paid;return{run:{...run},paid:run.paid,bank:previewBank,cooldown:0};}
 const t=args.p_t/1000,hit=world(run.mode,run.scene,t).filter(a=>args.p_x>=a.x-a.w/2&&args.p_x<=a.x+a.w/2&&args.p_y>=a.y-a.h&&args.p_y<=a.y).at(-1);
 let tag='miss';if(hit&&!run.hits.includes(hit.id)){
  if(hit.good){const center=run.mode!=='range'||((args.p_x-hit.x)/.035)**2+((args.p_y-(hit.y-hit.h*(.135/.26)))/.04)**2<=1;run.earned+=center?run.unit:run.unit/10;run.hits.push(hit.id);tag=center&&run.mode==='range'?'center':'hit';}
  else if(['gate','sniper'].includes(run.mode)){run.earned=Math.floor(run.earned*.75);tag='wrong';}
 }return{tag,run:{...run,elapsed:elapsed(),hits:[...run.hits],shots:run.shots+1}};
}
function choose(){
 $('choices').innerHTML=Object.entries(NAMES).map(([mode,name])=>`<button class="choice" data-mode="${mode}" style="background-image:linear-gradient(transparent,#000e),url(img/reservist/${mode==='sniper'?'city_separate_bg':mode+'_bg'}.webp)"><strong>${name}</strong><small>${mode==='range'?'10 מטרות · דיוק במרכז':mode==='gate'?'5 אירועים · זיהוי התוקף':mode==='base'?'מצאו את התוקף בזמן':'3 יעדים · זיהוי וסריקה'}</small><b>עד ${compact(config[mode].max*config.mult)}</b><small>${mode==='sniper'?compact(25e6*config.mult)+' לכל יעד · ':''}${mode==='range'?'עד ':''}${config[mode].seconds} שניות</small></button>`).join('');
 document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>start(b.dataset.mode));
}
function showFeedback(text){$('feedback').textContent=text;feedbackUntil=performance.now()+1100;}
function drawDossier(){
 $('dossier').hidden=run.mode!=='sniper';if(run.mode!=='sniper')return;
 $('dossier').innerHTML=TARGETS.map((asset,i)=>`<div class="${run.hits.includes('target-'+i)?'done':''}"><canvas width="90" height="110" aria-label="תמונת יעד ${i+1}"></canvas><small>${FEATURES[i]}<br>${compact(25e6*run.mult)}</small></div>`).join('');
 [...$('dossier').querySelectorAll('canvas')].forEach((el,i)=>{const image=art[TARGETS[i]],rect=meta[TARGETS[i]],c=el.getContext('2d');
  // The dossier is cropped from this very sprite, rather than an approximate separate portrait.
  c.drawImage(image,rect.x,rect.y,rect.w,rect.h*.36,0,0,90,110);
 });
}
function enter(r){sync(r);zoom=false;view={cx:.5,cy:.57};aim={x:.5,y:.5};lastSecond=-1;finishedResult=null;firedEvents.clear();nextFinishAttempt=0;feedbackUntil=0;impact=null;flash=0;$('feedback').textContent='';
 $('select').hidden=true;$('play').hidden=false;$('mission').textContent=NAMES[r.mode];$('scope').hidden=r.mode!=='sniper';$('scope').setAttribute('aria-pressed','false');$('helpText').textContent=RULES[r.mode];
 $('hint').textContent=r.mode==='sniper'?'גררו לסריקה · כוונת להגדלה · ירי במרכז הכוונת':'געו בדמות או במטרה כדי לכוון ולירות';
 if(r.mult>1)$('hint').textContent+=' · תוספת שבת +200%';
 drawDossier();if(r.done)showResult({run:r,paid:r.paid,cooldown:0});
}
async function start(mode){
 if(sending)return;if(Date.now()<coolUntil){note('המשימה הבאה זמינה בעוד '+Math.ceil((coolUntil-Date.now())/1000)+' שניות');return;}
 sending=true;document.querySelectorAll('[data-mode]').forEach(b=>b.disabled=true);note('מכין משימה…');
 for(const name of ['scope_in','scope_out','success','target_hit','distant_gunfire','shot','target_mechanism','timer','miss','failure'])try{SFX.fx('rv_'+name,{vol:0,dur:.01});}catch(_){}
 try{await Promise.all([ready,metaReady]);startRef??=uid();const r=await call('rv_start',{p_mode:mode,p_ref:startRef});startRef=null;enter(r);note('');}
 catch(e){note(message(e));}finally{sending=false;document.querySelectorAll('[data-mode]').forEach(b=>b.disabled=false);}
}
function message(e){const m=e?.message||'';return m.includes('cooldown')?'יש להמתין 15 שניות בין משימות.':m.includes('economy_maintenance')?'המשחק בתחזוקה. נסו שוב מאוחר יותר.':m.includes('art_missing')?'לא כל התמונות נטענו. רעננו לפני תחילת המשימה.':m.includes('run_expired')?'המשימה פגה. חזרו לעמוד העבודות.':'החיבור לא הושלם. אפשר לנסות שוב; התוצאה נשמרת בשרת.';}
async function shoot(){
 if(!run||run.done||sending||settling||$('help').open)return;
 if(elapsed()>run.seconds&&!unresolved){await finish();return;}
 sending=true;
 const at=run.mode==='sniper'?point(cam,aim.x,aim.y):aim;
 const args=unresolved||{p_run:run.id,p_ref:uid(),p_x:at.x,p_y:at.y,p_t:Math.floor(elapsed()*1000)};
 unresolved=args;flash=performance.now()+140;impact={x:args.p_x,y:args.p_y,until:performance.now()+650};effect('shot');
 try{const result=await call('rv_shot',args);unresolved=null;sync(result.run);drawDossier();
  effect(result.tag==='miss'?'miss':result.tag==='wrong'?'failure':'target_hit');
  showFeedback({miss:'החטאה',wrong:'זיהוי שגוי · 25% פחות',center:'פגיעה במרכז',hit:'פגיעה'}[result.tag]);
 }catch(e){if(/invalid_shot|already_finished|slow_down/.test(e.message||'')){unresolved=null;showFeedback('הירי לא נקלט בזמן');}else showFeedback(message(e));}
 finally{sending=false;$('fire').lastChild.textContent=unresolved?' שליחה חוזרת':'ירי';}
}
async function finish(){
 if(!run||settling||run.done||performance.now()<nextFinishAttempt)return;
 if(sending)return;
 if(unresolved){await shoot();if(unresolved)return;}
 settling=true;nextFinishAttempt=performance.now()+5000;$('finish').disabled=true;
 try{const result=await call('rv_finish',{p_run:run.id});sync(result.run);showResult(result);}
 catch(e){showFeedback(message(e));$('hint').textContent='לחצו סיום משימה כדי לנסות שוב לקבל את התשלום.';}
 finally{settling=false;$('finish').disabled=false;}
}
function showResult(result){
 finishedResult=result;coolUntil=Date.now()+(result.cooldown||0)*1000;
 effect(result.paid>0?'success':'failure');$('help').close();
 $('resultText').textContent=(PREVIEW?'הדגמה בלבד — ללא תשלום\n':'')+'שכר המשימה: '+fmt(result.paid)+'\nיתרה בבנק: '+fmt(result.bank||0)+(result.run.mult>1?'\nכולל תוספת שבת +200%':'');
 if(!$('result').open)$('result').showModal();
}
function sprite(name,x,y,w,h,time=0){
 const image=art[name],m=meta[name];if(!image||!m)return;
 if(name==='civilian_walk_sheet'){const col=Math.floor(time*5)%3;ctx.drawImage(image,col*image.width/3,0,image.width/3,image.height,x,y,w,h);}
 else ctx.drawImage(image,m.x,m.y,m.w,m.h,x,y,w,h);
}
function draw(){
 requestAnimationFrame(draw);if(!run||$('play').hidden)return;
 const box=canvas.getBoundingClientRect(),w=Math.max(1,Math.round(box.width)),h=Math.max(1,Math.round(box.height)),dpr=Math.min(2,devicePixelRatio||1);
 if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle='#131711';ctx.fillRect(0,0,w,h);
 const t=elapsed(),mode=run.mode,sniper=mode==='sniper',actors=world(mode,run.scene,Math.min(t,run.seconds));
 if(sniper){cam=camera(w,h,view.cx,view.cy,zoom);view.cx=cam.cx;view.cy=cam.cy;const bg=art.city_separate_bg;ctx.drawImage(bg,cam.x*bg.width,cam.y*bg.height,cam.w*bg.width,cam.h*bg.height,0,0,w,h);}
 else{cam={x:0,y:0,w:1,h:1};const bg=art[mode+'_bg'];ctx.drawImage(bg,0,0,w,h);}
 for(const a of actors){if(run.hits.includes(a.id))continue;
  const x=((a.x-a.w/2)-cam.x)/cam.w*w,y=(a.y-a.h-cam.y)/cam.h*h,aw=a.w/cam.w*w,ah=a.h/cam.h*h;
  sprite(a.asset,x,y,aw,ah,t);
  if(a.firing){sprite('muzzle_flash',x+aw*.65,y+ah*.2,aw*.7,ah*.23,t);if(!firedEvents.has(a.event)){effect('distant_gunfire');firedEvents.add(a.event);}}
 }
 if(sniper){
  if(zoom){const radius=Math.min(w,h)*.44;ctx.save();ctx.fillStyle='#000d';ctx.beginPath();ctx.rect(0,0,w,h);ctx.arc(w/2,h/2,radius,0,Math.PI*2,true);ctx.fill('evenodd');ctx.restore();sprite('scope_v2',w/2-radius,h/2-radius,radius*2,radius*2);}
  else{const frame=art.window_frame;ctx.drawImage(frame,0,0,w,h);}
 }
 const ax=aim.x*w,ay=aim.y*h;
 ctx.strokeStyle=sniper?'#f4e7ca':'#ffe9a6';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(ax-11,ay);ctx.lineTo(ax+11,ay);ctx.moveTo(ax,ay-11);ctx.lineTo(ax,ay+11);ctx.stroke();
 if(impact&&performance.now()<impact.until){const ix=(impact.x-cam.x)/cam.w*w,iy=(impact.y-cam.y)/cam.h*h;sprite('impact',ix-25,iy-25,50,50);}
 if(performance.now()<flash){ctx.fillStyle='#ffedac22';ctx.fillRect(0,0,w,h);}
 if(performance.now()>feedbackUntil)$('feedback').textContent='';
 const left=Math.max(0,Math.ceil(run.seconds-t));$('clock').textContent=left+'″';$('clock').classList.toggle('urgent',left<=5);$('score').textContent='נצבר '+compact(run.earned*run.mult);
 if(left!==lastSecond){if(left>0&&left<=5)effect('timer');if(mode==='range')effect('target_mechanism');lastSecond=left;}
 const complete=mode==='base'?run.hits.includes('base'):mode==='sniper'?run.hits.filter(id=>id.startsWith('target-')).length===3:false;
 if((left===0||complete)&&!run.done&&!sending&&!settling&&!unresolved)finish();
}
let drag=null;
canvas.addEventListener('pointerdown',e=>{if(!run||run.done)return;const b=canvas.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,moved:false};canvas.setPointerCapture(e.pointerId);if(run.mode!=='sniper'){aim={x:(e.clientX-b.left)/b.width,y:(e.clientY-b.top)/b.height};shoot();}});
canvas.addEventListener('pointermove',e=>{if(!drag||run?.mode!=='sniper')return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>2)drag.moved=true;view.cx-=dx/canvas.clientWidth*cam.w;view.cy-=dy/canvas.clientHeight*cam.h;drag.x=e.clientX;drag.y=e.clientY;});
canvas.addEventListener('pointerup',()=>{drag=null;});canvas.addEventListener('pointercancel',()=>{drag=null;});
$('scope').onclick=()=>{if(!run||run.done)return;zoom=!zoom;aim={x:.5,y:.5};$('scope').setAttribute('aria-pressed',String(zoom));effect(zoom?'scope_in':'scope_out');};
$('fire').onclick=shoot;$('finish').onclick=()=>{nextFinishAttempt=0;finish();};
$('rules').onclick=()=>{$('help').showModal();};$('closeHelp').onclick=()=>$('help').close();
try{GC_SOUND_MENU($('sound'));}catch(_){$('sound').onclick=()=>SFX.setMuted(!SFX.muted);}
$('result').addEventListener('cancel',e=>{e.preventDefault();$('again').click();});
$('again').onclick=async()=>{$('result').close();run=null;$('play').hidden=true;$('select').hidden=false;note(Date.now()<coolUntil?'המשימה הבאה תיפתח בעוד 15 שניות.':'');};
addEventListener('keydown',e=>{if(e.code==='Space'&&!e.repeat&&!['INPUT','BUTTON','A'].includes(document.activeElement?.tagName)){e.preventDefault();shoot();}});
(async()=>{
 try{
  if(!PREVIEW){const {data:{session}}=await db.auth.getSession();if(!session){location.href='./';return;}}
  const state=await call('rv_state');config=state.config;choose();coolUntil=Date.now()+(state.cooldown||0)*1000;
  await Promise.all([ready,metaReady]);
  if(state.run)enter(state.run);else if(PREVIEW)note('מצב הדגמה — ללא תשלום');
  GC_GUIDE.init({game:'reservist',db,mount:document.querySelector('header'),steps:[{t:'מילואימניק: ארבע משימות. בוחרים משימה וקוראים את הכללים לפני ההתחלה. השכר נכנס לבנק.'},{t:'בצלף גוררים כדי לסרוק, משתמשים בכוונת להגדלה ומשווים את הדמות לתיק היעד. זיהוי שגוי מוריד 25% מהתגמול שנצבר.'}]});
  requestAnimationFrame(draw);
 }catch(e){note(message(e));}finally{try{GC_LOADER.done();}catch(_){}}
})();
