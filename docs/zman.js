/* The browser presents server state. Outcomes, choices, deadlines and money are SQL-owned. */
(function () {
 'use strict';
 const $=id=>document.getElementById(id), params=new URLSearchParams(location.search), preview=params.has('preview');
 const db=preview?null:supabase.createClient(GC_CONFIG.supabaseUrl,GC_CONFIG.supabaseKey);
 const labels={one:'1',yoav:'יואב',range:'מטווח',vip:'מטווח VIP',balls:'הכדורים של ביניו'};
 const rows=[['f','פישר'],['i','עידו'],['b','בניו']];
 rows.forEach(([prefix,word])=>[...word].forEach((ch,i)=>labels[prefix+i]=ch+' · '+word));
 const names={betting:'ההימורים פתוחים',spin:'הגלגל מסתובב',choice:'זמן לבחירה',reveal:'חושפים את התוצאות',extra:'ירייה נוספת',extra_reveal:'חושפים את הירייה הנוספת',balls:'הכדורים יוצאים',summary:'סיכום הסיבוב'};
 const colors=['green','purple','orange'], ladder=[5,10,15,20,30,50,75,100,150,250,500,1000];
 const people=['friend_01','friend_02','friend_03','friend_04','friend_05_yoav'];
 const asMoney=n=>BigInt(n||0).toLocaleString('en-US'), money=n=>'₪'+asMoney(n);
 const short=n=>{n=BigInt(n||0);for(const [d,s] of [[1000000000000n,'T'],[1000000000n,'B'],[1000000n,'M'],[1000n,'K']])if(n>=d)return String(n/d)+s;return String(n);};
 const image=(name,cls='')=>{const im=document.createElement('img');im.src='img/zlm/'+name+'.webp';im.alt='';im.className=cls;im.draggable=false;return im;};
 let state=null, offset=0, timer=null, fetching=false, acting=false, user=null, pending=null, bonusKey='', lastBallKey='', stopped=false, epoch=0, spinId='', spinAnimations=[];
 function now(){return Date.now()+offset;}
 function seconds(){return state?Math.max(0,(Date.parse(state.deadline)-now())/1000):0;}
 function amount(){const v=$('amount').value.replace(/[,\s₪]/g,'');if(!/^\d+$/.test(v)||BigInt(v)<1n)throw Error('בחרו סכום חיובי של שקלים שלמים');return BigInt(v).toString();}
 const errors={betting_closed:'ההימורים לסיבוב הזה ננעלו.',choice_closed:'זמן הבחירה הסתיים. השרת משלים בחירה חסרה.',invalid_bet:'ההימור אינו תקין.',invalid_amount:'הסכום גבוה מהיתרה הזמינה או מטווח הארנק.',insufficient_funds:'אין יתרה מספיקה.',not_participant:'לא הימרתם על הבונוס הזה.',invalid_pick:'הבחירה אינה זמינה.',not_signed_in:'יש להתחבר מחדש מהלובי.'};
 function errorText(e){const raw=e?.message||String(e);for(const k of Object.keys(errors))if(raw.includes(k))return errors[k];if(/zlm_|schema cache|PGRST202/.test(raw))return 'המשחק עדיין לא הופעל בשרת. יש להשלים את התקנת המשחק.';if(raw==='Failed to fetch')return 'החיבור נותק. מנסים להתחבר מחדש.';return /[\u0590-\u05ff]/.test(raw)?raw:'לא התקבל אישור לפעולה. אפשר לנסות שוב; פעולה שכבר אושרה לא תחויב פעמיים.';}
 function savePending(){try{const key='zlm_pending_'+user;if(pending)localStorage.setItem(key,JSON.stringify(pending));else localStorage.removeItem(key);}catch{}}
 function accept(s){if(!s?.id)return;state=s;offset=Date.parse(s.server_time)-Date.now();render();}
 async function poll(){
  clearTimeout(timer);if(stopped||document.hidden||fetching||orientationBlocked())return;
  if(preview)return;
  fetching=true;const version=epoch;
  try{const {data,error}=await db.rpc('zlm_state');if(error)throw error;if(version===epoch){accept(data);if(!pending)$('error').textContent='';}}
  catch(e){$('error').textContent=errorText(e);}
  finally{fetching=false;if(!stopped&&!document.hidden)timer=setTimeout(poll,2000);}
 }
 async function sendBet(spot,cancel=false){
  if(acting||!state||state.phase!=='betting'||seconds()<=0||pending)return;
  try{pending={p_round:state.id,p_spot:spot,p_amount:cancel?'0':amount(),p_request:crypto.randomUUID()};savePending();await retry();}
  catch(e){$('error').textContent=errorText(e);}
 }
 async function retry(){
  if(!pending||acting)return;acting=true;epoch++;renderControls();
  try{
   if(preview){const bets={...state.bets};if(pending.p_spot==='all')for(const k of Object.keys(bets))delete bets[k];else if(pending.p_amount==='0')delete bets[pending.p_spot];else bets[pending.p_spot]=String(BigInt(bets[pending.p_spot]||0)+BigInt(pending.p_amount));state.bets=bets;pending=null;render();return;}
   const {data,error}=await db.rpc('zlm_bet',pending);
   if(error){if(Object.keys(errors).some(k=>(error.message||'').includes(k))||['22P02','PGRST202'].includes(error.code)){pending=null;savePending();}throw error;}
   pending=null;savePending();$('error').textContent='';accept(data);
  }catch(e){$('error').textContent=errorText(e);}
  finally{acting=false;renderControls();}
 }
 async function choose(pick){
  if(acting||!state||seconds()<=0)return;acting=true;epoch++;
  try{
   if(preview){if(state.phase==='extra')state.bonus.extra=pick;else if(!state.bonus.picks.includes(pick))state.bonus.picks.push(pick);bonusKey='';render();return;}
   const {data,error}=await db.rpc('zlm_choose',{p_round:state.id,p_pick:pick});if(error)throw error;accept(data);$('error').textContent='';
  }catch(e){$('error').textContent=errorText(e);}finally{acting=false;}
 }
 function makeBoard(){
  const specs=[['one',13.7,34.1,20.3,25],['yoav',13.7,66.7,20.3,25],['range',86.2,29,16,21],['balls',86.2,50.8,16,21],['vip',86.2,72.5,16,21]];
  rows.forEach(([prefix],r)=>[68.1,56,44.2,32.1].forEach((x,i)=>specs.push([prefix+i,x,[29.1,51,72.8][r],10.8,20])));
  for(const [key,x,y,w,h] of specs){const b=document.createElement('button');b.type='button';b.className='bet-spot';b.dataset.spot=key;b.style.cssText=`left:${x-w/2}%;top:${y-h/2}%;width:${w}%;height:${h}%`;
   const ratio=key==='one'?'1:1':key[0]==='b'&&key!=='balls'?'42:1':/^[fi]/.test(key)?'25:1':'בונוס';
   b.title=labels[key]+' · '+ratio;b.setAttribute('aria-label','הימור על '+b.title);b.onclick=()=>sendBet(key);$('betSpots').append(b);}
 }
 function renderControls(){
  const active=!!state&&state.phase==='betting'&&seconds()>0&&!acting&&!pending;
  document.querySelectorAll('.bet-spot').forEach(b=>b.disabled=!active);
  ['amount','half','all','cancel'].forEach(id=>$(id).disabled=!active);
  $('retry').hidden=!pending;$('retry').disabled=acting;
  document.querySelectorAll('#myBets button').forEach(b=>b.disabled=!active);
 }
 function render(){
  const s=state,b=s.bonus||{};const bonus=['yoav','range','vip','balls'].includes(s.spot)&&!['betting','spin'].includes(s.phase);
  $('wallet').textContent=money(s.balance);$('phase').textContent=preview?'תצוגה מקדימה · ללא חיוב':names[s.phase]||s.phase;
  $('wheelMult').textContent=s.cell&&s.phase!=='spin'?'מכפיל גלגל ×'+(s.boosts[s.cell]||1):'';
  $('mainGame').hidden=bonus;$('bonus').hidden=!bonus;
  const final=-(s.cell-1)*360/54;
  if(s.phase==='spin'){
   if(spinId!==s.id){
    const start=parseFloat($('wheelTurn').style.transform.replace('rotate(',''))||0;spinAnimations.forEach(a=>a.cancel());spinId=s.id;
    const duration=Date.parse(s.deadline)-Date.parse(s.phase_at),reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;
    spinAnimations=[$('wheelTurn'),$('wheelBoosts')].map(el=>{const a=el.animate([{transform:`rotate(${start}deg)`},{transform:`rotate(${2160+final}deg)`}],{duration:reduced?1:duration,easing:'cubic-bezier(.15,.8,.2,1)',fill:'forwards'});return a;});
   }
   spinAnimations.forEach(a=>a.currentTime=Math.max(0,now()-Date.parse(s.phase_at)));
  }else{
   spinAnimations.forEach(a=>a.cancel());spinAnimations=[];spinId='';
   if(s.cell){const angle=`rotate(${final}deg)`;$('wheelTurn').style.transform=angle;$('wheelBoosts').style.transform=angle;}
  }
  $('wheelResult').textContent=s.cell&&s.phase!=='spin'?labels[s.spot]+' · תא '+s.cell:'';
  const boostKey=s.id+JSON.stringify(s.boosts);
  if($('wheelBoosts').dataset.key!==boostKey){$('wheelBoosts').replaceChildren();$('wheelBoosts').dataset.key=boostKey;
   for(const [cell,mult] of Object.entries(s.boosts)){const a=-(Number(cell)-1)*2*Math.PI/54,el=document.createElement('span');el.className='boost';el.textContent='×'+mult;el.style.left=50-Math.sin(a)*29+'%';el.style.top=50-Math.cos(a)*29+'%';$('wheelBoosts').append(el);}
  }
  document.querySelectorAll('.bet-spot').forEach(el=>{const key=el.dataset.spot,amt=s.bets[key];el.classList.toggle('marked',!!amt);el.classList.toggle('winner',s.phase==='summary'&&s.spot===key);el.querySelector('.chip')?.remove();if(amt){const chip=document.createElement('span');chip.className='chip';chip.textContent=short(amt);el.append(chip);}});
  $('myBets').replaceChildren();for(const [key,n] of Object.entries(s.bets)){const bt=document.createElement('button');bt.textContent=labels[key]+' '+money(n)+' ✕';bt.onclick=()=>sendBet(key,true);$('myBets').append(bt);}
  const last=s.last_result;$('receipt').textContent=last?'סיבוב אחרון: הימור '+money(last.stake)+' · חזר לארנק '+money(last.payout)+' · שינוי '+money(BigInt(last.payout)-BigInt(last.stake)):'';
  if(bonus){const key=[s.id,s.spot,s.phase,JSON.stringify(b.picks),b.extra,s.draws,JSON.stringify(b.targets)].join('|');if(key!==bonusKey){bonusKey=key;renderBonus();}}
  renderControls();updateClock();
 }
 function heading(text){const h=document.createElement('h2');h.textContent=text;$('bonus').append(h);}
 function note(text){const p=document.createElement('div');p.className='bonus-info';p.textContent=text;$('bonus').append(p);}
 function renderBonus(){
  const s=state,b=s.bonus,box=$('bonus');box.replaceChildren();box.className='bonus';heading(labels[s.spot]);
  const can=b.eligible&&s.phase==='choice', extra=s.phase==='extra'&&b.profit===30;
  const selected=b.picks||[];
  if(!b.eligible)note('צופים בבונוס המשותף. ההימורים ייפתחו בסיומו.');
  else if(s.phase==='summary')note('הבונוס הושלם והתוצאה נשמרה. חוזרים יחד לגלגל.');
  else if(s.phase==='extra'&&!extra)note('ממתינים לשחקנים שזכו בירייה נוספת');
  else note(s.spot==='vip'?'בחרו שלוש מטרות שונות · נבחרו '+selected.length+' מתוך 3':extra?'בחרו מטרה נוספת':selected.length?'הבחירה נשמרה בשרת':s.spot==='yoav'?'בחרו כוס':s.spot==='balls'?'בחרו צבע':'בחרו מטרה');
  if(s.spot==='range'||s.spot==='vip'){
   box.classList.add('range-scene');const grid=document.createElement('div');grid.className='targets';
   for(const t of b.targets||[]){const bt=document.createElement('button'),sel=selected.includes(t.index)||b.extra===t.index;
    bt.className='target'+(sel?' selected':'')+(t.open?' open':'')+(sel&&['reveal','extra_reveal'].includes(s.phase)?' hit':'');
    bt.setAttribute('aria-label',t.open?'מטרה '+(t.index+1)+' · פי '+t.value:'מטרה '+(t.index+1));
    bt.disabled=!(can&&selected.length<(s.spot==='vip'?3:1)&&!selected.includes(t.index)||extra&&b.extra==null&&!selected.includes(t.index));
    if(t.open){bt.append(image('range-'+people[t.person],'person'));const prize=document.createElement('span');prize.className='prize';prize.textContent='×'+t.value+(s.spot==='range'&&t.value===30?' +':'');bt.append(prize);}
    bt.append(image('range-cover','cover'));bt.onclick=()=>choose(t.index);grid.append(bt);
   }box.append(grid);
  }else if(s.spot==='yoav'){
   box.classList.add('yoav-scene');box.append(image('yoav','yoav-host'));const cups=document.createElement('div');cups.className='cups';
   for(let i=0;i<3;i++){const bt=document.createElement('button');bt.className='cup'+(selected.includes(i)?' selected':'');bt.disabled=!can||selected.length>0;bt.setAttribute('aria-label','כוס '+(i+1));bt.onclick=()=>choose(i);
    bt.innerHTML=`<b data-cup-number="${i}">?</b><svg viewBox="0 0 100 150" aria-hidden="true"><defs><clipPath id="cup-mask-${i}"><path d="M5 10H95L54 66Q50 70 46 66Z"/></clipPath><linearGradient id="wine-${i}" x2="0" y2="1"><stop stop-color="#ff5e68"/><stop offset="1" stop-color="#940a21"/></linearGradient></defs><g clip-path="url(#cup-mask-${i})"><rect data-liquid="${i}" x="0" y="70" width="100" height="0" fill="url(#wine-${i})"/></g><path d="M5 10H95L54 66Q50 70 46 66ZM50 68V132M30 136Q50 129 70 136Q50 142 30 136" fill="none" stroke="#fff2d9" stroke-width="2"/><ellipse cx="50" cy="10" rx="45" ry="5" fill="none" stroke="#fff2d9" stroke-width="2"/></svg>`;cups.append(bt);
   }box.append(cups);
  }else renderBalls(can);
  if(s.phase==='summary'&&b.eligible){const p=document.createElement('div');p.className='bonus-total';const wm=s.boosts[s.cell]||1;p.textContent='רווח: ×'+b.profit+' × '+wm+' = ×'+b.profit*wm+' · הקרן חוזרת בנוסף';box.append(p);}
 }
 function renderBalls(can){
  const s=state,b=s.bonus,box=$('bonus');box.classList.add('balls-scene');const layout=document.createElement('div');layout.className='balls-layout';
  const levels=b.levels||[0,0,0],values=b.values||[5,5,5],events=b.events||[],chosen=b.picks?.[0];
  const ladders=document.createElement('div');ladders.className='ladders';
  for(let c=0;c<3;c++){const l=document.createElement('div');l.className='ladder'+(chosen===c?' selected':'');const bt=document.createElement('button');bt.className=['g','p','o'][c];bt.textContent=['ירוק','סגול','כתום'][c];bt.disabled=!can||chosen!==undefined;bt.onclick=()=>choose(c);l.append(bt);
   for(let i=11;i>=0;i--){const step=document.createElement('div');step.className='step '+['g','p','o'][c]+(levels[c]===i?' active':'');step.textContent='×'+ladder[i];l.append(step);}ladders.append(l);
  }layout.append(ladders,image('balls-host','ball-host'));
  const drum=document.createElement('div');drum.className='drum';drum.append(image('balls-drum'));const deco=document.createElement('div');deco.className='drum-balls';
  // Decoration only. The visible sequence and remaining counts always use server events.
  for(let i=0;i<Math.min(24,110-events.length);i++){const im=image('balls-ball_'+(i%6===0?'black':colors[i%3]));im.style.cssText=`left:${(i*31)%78}%;top:${(i*23)%72}%;animation-delay:-${i*.17}s`;deco.append(im);}
  const glass=document.createElement('div');glass.className='glass-front';drum.append(deco,glass);layout.append(drum,image('balls-podium','podium'),image('balls-outlet_tray','outlet'));
  const counter=document.createElement('div');counter.className='black-count';counter.setAttribute('aria-label',(b.black||0)+' שחורים מתוך 4');for(let i=0;i<4;i++){const el=document.createElement('i');if(i<(b.black||0))el.className='lit';counter.append(el);}layout.append(counter);
  const collected=document.createElement('div');collected.className='collected';events.forEach((v,i)=>{const im=image('balls-ball_'+(v===0?'black':colors[(v-1)%3]));im.title='שליפה '+(i+1)+(v>3?' · פי 2':'');collected.append(im);});layout.append(collected);
  if(events.length){const key=s.id+':'+events.length;if(lastBallKey!==key){lastBallKey=key;const v=events.at(-1),el=document.createElement('div');el.className='draw-ball';el.append(image('balls-ball_'+(v===0?'black':colors[(v-1)%3])));if(v>3){const txt=document.createElement('b');txt.textContent='×2';el.append(txt);}const elapsed=Math.max(0,(now()-Date.parse(s.phase_at))/1000-events.length*3);if(s.phase==='balls'&&elapsed<1.8){el.style.animationDelay=-elapsed+'s';layout.append(el);}}}
  const caption=document.createElement('div');caption.className='balls-caption';caption.textContent='נותרו '+(110-events.length)+' כדורים · '+(b.black||0)+' שחורים מתוך 4'+(chosen!==undefined?' · הצבע שלך ×'+values[chosen]:'');layout.append(caption);box.append(layout);
 }
 function updateClock(){
  $('clock').textContent=state?Math.ceil(seconds())+'″':'';
  if(state?.spot==='yoav'&&state.bonus.cups){const elapsed=Math.max(0,(now()-Date.parse(state.phase_at))/1000),done=state.phase==='summary';state.bonus.cups.forEach((v,i)=>{const n=done?v:Math.min(v,Math.floor(elapsed*5)),rect=document.querySelector(`[data-liquid="${i}"]`),num=document.querySelector(`[data-cup-number="${i}"]`);if(num)num.textContent='×'+n;if(rect){const h=60*Math.min(1,n/v);rect.setAttribute('y',70-h);rect.setAttribute('height',h);}});}
  if(state&&seconds()<=0)renderControls();
 }
 function fixture(){
  const spot=params.get('bonus'),s={id:'preview',phase:spot?'choice':'betting',phase_at:new Date().toISOString(),deadline:new Date(Date.now()+20000).toISOString(),server_time:new Date().toISOString(),bets:{},balance:'3500000000000',boosts:{1:3,12:2,23:5},cell:spot?({range:1,vip:12,yoav:6,balls:23}[spot]||23):null,spot:spot||null,bonus:{picks:[],extra:null,eligible:true,profit:0,targets:Array.from({length:5},(_,index)=>({index,open:false}))},draws:0,last_result:null};
  if(params.has('summary')){s.phase='summary';s.bonus.profit=spot==='balls'?30:spot==='yoav'?4:130;s.bonus.picks=spot==='range'?[3]:[0];s.bonus.extra=spot==='range'?1:null;s.bonus.cups=[4,8,20];s.bonus.targets=s.bonus.targets.map((t,i)=>({...t,open:true,person:i,value:[10,100,25,30,50][i]}));s.bonus.events=[1,4,0,2,3,0,6,2,0,1,3,0];s.bonus.levels=[4,2,4];s.bonus.values=[30,15,30];s.bonus.black=4;s.draws=12;}
  accept(s);
 }
 $('half').onclick=()=>{$('amount').value=String(BigInt(state.balance)/2n);};$('all').onclick=()=>{$('amount').value=state.balance;};$('cancel').onclick=()=>sendBet('all',true);$('retry').onclick=retry;
 $('rulesBtn').onclick=()=>$('rules').showModal();$('closeRules').onclick=()=>$('rules').close();
 document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden){bonusKey='';poll();} });
 addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);});addEventListener('pageshow',()=>{stopped=false;poll();});
 addEventListener('online',()=>poll());
 function orientationBlocked(){return matchMedia('(pointer:coarse) and (orientation:landscape)').matches;}
 addEventListener('resize',()=>{if(orientationBlocked()){clearTimeout(timer);$('rules').close();}else poll();});
 addEventListener('pointerdown',()=>{if(matchMedia('(pointer:coarse)').matches&&matchMedia('(display-mode:standalone)').matches)try{screen.orientation?.lock?.('portrait').catch(()=>{});}catch{}},{once:true});
 makeBoard();setInterval(updateClock,100);
 (async()=>{
  try{
   if(preview){fixture();return;}
   const {data:{session}}=await db.auth.getSession();if(!session){location.href='./';return;}user=session.user.id;
   try{pending=JSON.parse(localStorage.getItem('zlm_pending_'+user)||'null');}catch{}
   await poll();
   window.GC_LOADER?.done();
   if(pending)$('error').textContent='פעולה קודמת ממתינה לאימות. לחצו „נסה שוב את הפעולה”; חיוב מאושר לא יתבצע פעמיים.';
   await GC_GUIDE.init({game:'zman',db,mount:$('guideMount'),auto:false,steps:[
    {el:'#board',t:'בוחרים סכום ולוחצים על משבצת. אותיות זהות בצבעים שונים הן הימורים נפרדים. יש 20 שניות להמר ולבטל לפני הנעילה.'},
    {t:'מכפיל הגלגל מכפיל את הרווח בלבד. הקרן חוזרת בנוסף בזכייה. פירוט התשלומים נמצא בכללי המשחק.'},
    {t:'בבונוס בוחרים כוס, מטרות או צבע. בחירה שלא הושלמה בזמן תושלם בשרת. הגלגל ממתין לסיום הבונוס המשותף, והתוצאה נשמרת גם בניתוק.'}
   ]});
  }catch(e){$('error').textContent=errorText(e);}finally{window.GC_LOADER?.done();}
 })();
})();
