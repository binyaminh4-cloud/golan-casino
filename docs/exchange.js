/* Server-owned prices, positions and money. No client price generation. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id),preview=new URLSearchParams(location.search).has('preview');
 const db=preview?null:supabase.createClient(GC_CONFIG.supabaseUrl,GC_CONFIG.supabaseKey);
 const names={house:'הבנק של הבית',fisher:'מדד הבנקים של פישר',fish:'חוות הדגים של עידו',protein:'אבקות החלבון של אביחי',smoke:'המעשנה של רועי',BNYM:'בנימין אחזקות',FSHR:'פישר בלי סטופ',IDO:'עידו דגים ונכסים',MASS:'אביחי מסה בע״מ'};
 const sources={house:'חמישית משינוי רווחיות משחקי הבית שהסתיימו. נתונים נצברים מיום ההפעלה.',fisher:'שער אישי לפי הממוצע היומי המתואם של יתר החברים, בלי הבנק שלך. מתחיל לצבור השוואה לאחר שני ימים מלאים. ראו מידע לפירוט.',fish:'רווחי הבית מגלגל הדגים בלבד, מסיבובים שהסתיימו.',protein:'רווחי הבית משולה החלבון, מסיבובים שהסתיימו.',smoke:'רווחי הבית מכל הרולטות, מסיבובים שהסתיימו.'};
 let state=null,kind='long',view='market',selected=null,hours=24,chart=[],chartAt=0,chartCode='',offset=0,user='',pending=null,busy=false,loading=false,epoch=0,timer=null,stopped=false,reviewed=null,historyEnd=false,historyBusy=false,accountChanged=false;
 const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const integer=v=>BigInt(v||0),money=v=>'₪'+integer(v).toLocaleString('en-US');
 const compact=v=>{const n=integer(v),abs=n<0n?-n:n;for(const [scale,suffix]of [[1000000000000000n,'Q'],[1000000000000n,'T'],[1000000000n,'B'],[1000000n,'M']])if(abs>=scale){const scaled=abs*100n/scale;return '₪'+(n<0n?'-':'')+(scaled/100n)+'.'+String(scaled%100n).padStart(2,'0')+suffix;}return money(n);};
 const price=v=>v==null?'—':Number.isFinite(Number(v))?Number(v).toLocaleString('en-US',{maximumFractionDigits:6}):String(v);
 const date=t=>new Date(t).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',dateStyle:'short',timeStyle:'medium'});
 const now=()=>Date.now()+offset;
 const market=()=>state?.markets.find(m=>m.code===selected);
 const amount=()=>{const s=$('amount').value.replaceAll(',','').trim();return /^\d+$/.test(s)?BigInt(s):0n;};
 function sign(el,v){el.classList.toggle('positive',v>0);el.classList.toggle('negative',v<0);}
 function message(text){$('message').textContent=text;}
 function persist(){try{const key='gx_pending_'+user;if(pending)localStorage.setItem(key,JSON.stringify(pending));else localStorage.removeItem(key);}catch{}}
 function errorText(e){const s=e?.message||String(e);for(const [key,text]of Object.entries({insufficient_bank:'אין בבנק יתרה מספיקה להשקעה.',loan_late:'יש הלוואה בפיגור. יש להסדיר אותה לפני פתיחת השקעה.',price_unavailable:'אין כרגע מחיר תקין לפתיחת העסקה. נסו שוב לאחר עדכון.',invalid_order:'בדקו את הסכום, המינוף והתקופה.',invalid_market:'המדד אינו זמין.',locked_position:'השקעה ארוכה נעולה עד מועד הסיום.',position_not_found:'העסקה אינה זמינה בחשבון זה.',request_conflict:'פרטי הפעולה אינם תואמים לבקשה שנשמרה.',not_signed_in:'יש להתחבר מחדש דרך הבנק.'}))if(s.includes(key))return text;
  return /PGRST202|schema cache|exchange_state.*does not exist/.test(s)?'הבורסה עדיין לא הופעלה בשרת. אפשר לחזור לבנק.':'החיבור לא הושלם. פעולה שנשלחה נשמרת לאימות; אין לפתוח אותה מחדש.';
 }
 function setView(next){view=next;document.querySelectorAll('.view').forEach(e=>e.hidden=e.id!==next+'View');document.querySelectorAll('.bottom [data-view]').forEach(b=>b.setAttribute('aria-current',b.dataset.view===(next==='detail'?'market':next)?'page':'false'));if(next==='positions'||next==='history')drawPositions();window.scrollTo({top:0,behavior:'instant'});}
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));$('infoBtn').onclick=()=>setView('info');$('marketBack').onclick=()=>{selected=null;setView('market');};
 document.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{kind=b.dataset.kind;document.querySelectorAll('[data-kind]').forEach(x=>x.setAttribute('aria-pressed',x===b));$('marketNote').textContent=kind==='daily'?'מחירים מדומים מהשרת, בערך פעם בשנייה. מינוף גבוה עלול למחוק את הקרן במהירות.':'המחירים מתעדכנים ב־00:05 לפי שעון ישראל.';drawMarkets();});

 function svgGraph(points,width=600,height=240,mini=false,daily=false){
  const data=points.map(p=>({t:Date.parse(p.at),v:Number(p.price)})).filter(p=>Number.isFinite(p.t)&&Number.isFinite(p.v));if(!data.length)return null;
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('aria-hidden','true');
  const pad=mini?3:30,lo=Math.min(...data.map(p=>p.v)),hi=Math.max(...data.map(p=>p.v)),range=hi-lo||Math.max(1,Math.abs(hi)*.001),start=data[0].t,end=data.at(-1).t;
  const x=p=>pad+(p.t-start)/Math.max(1,end-start)*(width-2*pad),y=p=>height-pad-(p.v-lo)/range*(height-2*pad);
  if(!mini){for(let i=0;i<4;i++){const line=document.createElementNS(ns,'line'),py=pad+i*(height-2*pad)/3;line.setAttribute('x1',pad);line.setAttribute('x2',width-pad);line.setAttribute('y1',py);line.setAttribute('y2',py);line.setAttribute('stroke','#423b2d');svg.append(line);}}
  const gap=daily?(mini?120000:Math.max(120000,Math.ceil(hours*60/1200)*120000)):172800000;
  let path='';data.forEach((p,i)=>{path+=(i===0||p.t-data[i-1].t>gap?'M':'L')+x(p).toFixed(2)+','+y(p).toFixed(2)+' ';});
  const line=document.createElementNS(ns,'path');line.setAttribute('d',path);line.setAttribute('fill','none');line.setAttribute('stroke','#d8b779');line.setAttribute('stroke-width',mini?'2':'2.5');line.setAttribute('vector-effect','non-scaling-stroke');svg.append(line);
  for(const p of data.length>250?data.filter((_,i)=>i%Math.ceil(data.length/250)===0||i===data.length-1):data){const dot=document.createElementNS(ns,'circle');dot.setAttribute('cx',x(p));dot.setAttribute('cy',y(p));dot.setAttribute('r',data.length===1?3:1.5);dot.setAttribute('fill','#e6c789');const title=document.createElementNS(ns,'title');title.textContent=date(p.t)+' · '+price(p.v);dot.append(title);svg.append(dot);}
  return svg;
 }
 function drawMarkets(){if(!state)return;const list=$('markets');list.replaceChildren();
  for(const m of state.markets.filter(m=>m.kind===kind)){const row=node('button',undefined,'market-row');row.type='button';row.setAttribute('aria-label','פרטי '+m.name);const name=node('span',undefined,'market-name'),im=new Image();im.src='img/exchange/icon_'+m.icon+'.webp';im.alt='';im.loading='lazy';name.append(im);const label=node('span');label.append(node('strong',m.name),node('small',m.tagline||m.risk));name.append(label);
   const quote=node('span',undefined,'quote'),p=node('b',price(m.price)),change=node('small');const delta=m.price!=null&&Number(m.previous)>0?(Number(m.price)/Number(m.previous)-1)*100:null;change.textContent=delta==null?'טרם פורסם שער':(delta>0?'↑ +':delta<0?'↓ ':'↔ ')+delta.toFixed(3)+'%';sign(change,delta);quote.append(p,change);
   const spark=node('span',undefined,'spark'),graph=svgGraph(m.history||[],100,35,true,m.kind==='daily');if(graph)spark.append(graph);row.append(name,quote,spark);row.onclick=()=>selectMarket(m.code);list.append(row);
  }
 }
 function drawBalances(){if(!state)return;const open=state.positions.filter(p=>p.status!=='closed');let locked=0n,value=0n;for(const p of open){locked+=integer(p.stake);value+=integer(p.status==='awaiting_credit'?p.payout:p.value);}
  for(const [id,n]of [['bank',state.bank],['portfolioValue',value],['locked',locked],['realized',state.realized],['unrealized',value-locked]]){$(id).textContent=compact(n);$(id).title=money(n);$(id).setAttribute('aria-label',money(n));}sign($('realized'),integer(state.realized));sign($('unrealized'),value-locked);
 }
 function drawPositions(){if(!state)return;$('moreHistory').hidden=historyEnd||state.positions.filter(p=>p.status==='closed').length<50;for(const [host,closed]of [['positions',false],['history',true]]){const list=$(host);list.replaceChildren();const positions=state.positions.filter(p=>(p.status==='closed')===closed);if(!positions.length){list.append(node('p',closed?'אין עדיין עסקאות סגורות.':'אין כרגע השקעות פתוחות.','empty'));continue;}
   for(const p of positions){const card=node('article',undefined,'position');card.append(node('h3',p.name+' · '+(p.direction===1?'↑ עלייה':'↓ ירידה')+' ×'+p.leverage));const dl=node('dl');const val=p.status==='open'?p.value:p.payout,fields=[['קרן',money(p.stake)],['מחיר כניסה',price(p.entry)],[p.status==='open'?'מחיר אחרון':'מחיר סגירה',price(p.status==='open'?p.last:p.exit)],[closed?'החזר':'שווי נוכחי',money(val)],['רווח / הפסד',money(integer(val)-integer(p.stake))],['סיום מתוכנן',date(p.expires_at)],['מצב',p.status==='awaiting_credit'?'ממתין לזיכוי':closed?({manual:'נסגרה ידנית',expired:'הסתיימה',liquidated:'הפסד מלא'}[p.reason]||'נסגרה'):'פתוחה']];
    if(p.closed_at)fields.push(['נסגרה',date(p.closed_at)]);for(const [k,v]of fields)dl.append(node('dt',k),node('dd',v));card.append(dl);
    if(p.status==='open'&&p.kind==='daily'){const b=node('button','סגירת עסקה במחיר הנוכחי');b.disabled=busy||!!pending;b.onclick=()=>closePosition(p);card.append(b);}list.append(card);
   }
  }
 }
 function drawChart(){const m=market();if(!m)return;const host=$('chart');host.replaceChildren();const svg=svgGraph(chart,600,250,false,m.kind==='daily');if(svg){host.append(svg);const points=node('p',chart.length+' נקודות · '+date(chart[0].at)+' — '+date(chart.at(-1).at));host.append(points);}else host.append(node('p','טרם נצברה היסטוריה בטווח שנבחר.'));host.setAttribute('aria-label','מחירי '+m.name+'; '+chart.length+' נקודות נתונים');}
 function drawDetail(){const m=market();if(!m)return;const title=$('detailTitle');title.replaceChildren();const im=new Image();im.src='img/exchange/icon_'+m.icon+'.webp';im.alt='';const text=node('div');text.append(node('h2',m.name),node('small',m.tagline||m.risk),node('p','שער נוכחי: '+price(m.price)));title.append(im,text);$('updated').textContent=m.at?'עודכן: '+date(m.at):'ממתינים לשער מהשרת';$('source').textContent=sources[m.code]||'נכס מדומה. מחירים אקראיים שנוצרים בשרת, משותפים לכל השחקנים ואינם תלויים בעסקאות שלהם.';
  $('leverage').max=m.kind==='daily'?'1000':'50';$('longDuration').hidden=m.kind==='daily';$('days').disabled=m.kind==='daily';$('review').disabled=preview||stopped||busy||!!pending||m.price==null||Number(m.price)<=0;drawChart();summary();
 }
 function summary(){const m=market();if(!m)return;const lev=Number($('leverage').value),days=m.kind==='daily'?1:Number($('days').value);$('leverageValue').textContent='×'+(lev||1);const expiry=now()+days*86400000;
  $('summary').textContent='קרן לנעילה: '+money(amount())+' · מינוף ×'+lev+' · '+(m.kind==='daily'?'סגירה ידנית או אוטומטית אחרי 24 שעות':'נעילה ל־'+days+' יממות')+' · מועד משוער: '+(Number.isFinite(expiry)?date(expiry):'—')+'. מועד הפתיחה והסיום המדויקים יישמרו בשרת.';
  $('liquidation').textContent=lev>0?'תנועה נגד העסקה של כ־'+(100/lev).toLocaleString('he-IL',{maximumFractionDigits:4})+'% מוחקת את הקרן. אין חוב מעבר לקרן.':'';
 }
 function accept(data,code){offset=Date.parse(data.server_time)-Date.now();if(state){for(const m of data.markets)if(!m.history?.length)m.history=state.markets.find(x=>x.code===m.code)?.history||[];}
  if(state){const incoming=new Set(data.positions.map(p=>p.id));data.positions.push(...state.positions.filter(p=>p.status==='closed'&&!incoming.has(p.id)));data.positions.sort((a,b)=>Date.parse(b.opened_at)-Date.parse(a.opened_at)||b.id.localeCompare(a.id));}state=data;if(Array.isArray(data.chart)&&code===selected){chart=data.chart;chartAt=Date.now();chartCode=code;}drawBalances();drawMarkets();drawPositions();if(selected)drawDetail();
 }
 function schedule(){clearTimeout(timer);if(!preview&&!stopped&&!document.hidden)timer=setTimeout(load,view==='detail'&&market()?.kind==='daily'||view==='market'&&kind==='daily'?1000:10000);}
 async function load(){clearTimeout(timer);if(preview||busy||loading||stopped||document.hidden)return;loading=true;const ticket=++epoch,code=view==='detail'?selected:null,full=!state||code&&((Date.now()-chartAt)>10000||chartCode!==code),args={p_code:full?code:null,p_hours:full?hours:0};
  try{const {data,error}=await db.rpc('exchange_state',args);if(error)throw error;if(ticket===epoch){accept(data,args.p_code);if(!pending){message('');$('retry').hidden=true;}}}
  catch(e){if(ticket===epoch){message(errorText(e));$('retry').hidden=false;}}
  finally{loading=false;window.GC_LOADER?.done();schedule();}
 }
 function selectMarket(code){selected=code;chart=[];chartCode='';chartAt=0;hours=market()?.kind==='daily'?1:24;document.querySelectorAll('[data-hours]').forEach(b=>b.setAttribute('aria-pressed',Number(b.dataset.hours)===hours));$('leverage').value='1';$('days').value='1';drawDetail();setView('detail');if(!preview)load();}
 document.querySelectorAll('[data-hours]').forEach(b=>b.onclick=()=>{hours=Number(b.dataset.hours);chartAt=0;document.querySelectorAll('[data-hours]').forEach(x=>x.setAttribute('aria-pressed',x===b));load();});
 document.querySelectorAll('[data-days]').forEach(b=>b.onclick=()=>{$('days').value=b.dataset.days;document.querySelectorAll('[data-days]').forEach(x=>x.setAttribute('aria-pressed',x===b));summary();});
 $('days').oninput=()=>{document.querySelectorAll('[data-days]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.days===$('days').value));summary();};
 document.querySelectorAll('[data-amount]').forEach(b=>b.onclick=()=>{$('amount').value=(b.dataset.amount==='half'?integer(state?.bank)/2n:BigInt(b.dataset.amount)).toLocaleString('en-US');summary();});
 $('amount').oninput=summary;$('leverage').oninput=summary;$('orderForm').onchange=summary;
 $('orderForm').onsubmit=e=>{e.preventDefault();if(preview||stopped||busy||pending)return;const m=market(),n=amount(),lev=Number($('leverage').value),days=m.kind==='daily'?1:Number($('days').value);
  if(n<1n||n>integer(state.bank)||n>9223372036854775807n){message('בחרו סכום חיובי שאינו גבוה מיתרת הבנק.');return;}
  if(!Number.isInteger(lev)||lev<1||lev>Number($('leverage').max)||!Number.isInteger(days)||days<1||days>14)return;
  reviewed={p_code:m.code,p_direction:Number(document.querySelector('[name=direction]:checked').value),p_amount:n.toString(),p_leverage:lev,p_days:days,p_request:crypto.randomUUID()};
  $('confirmDetails').replaceChildren(node('p',m.name+' · '+(reviewed.p_direction===1?'עלייה':'ירידה')),node('p','קרן: '+money(n)+' · מינוף ×'+lev),node('p','מועד פקיעה משוער: '+date(now()+days*86400000)),node('p',m.kind==='daily'?'סגירה אוטומטית אחרי 24 שעות, עם אפשרות לסגירה ידנית.':'נעילה ל־'+days+' יממות; אין מכירה מוקדמת. לאחר המועד, הסגירה בשער היומי הבא.'));$('confirmError').textContent='';$('confirmSubmit').textContent='אישור השקעה ונעילת הסכום';$('confirmOrder').showModal();
 };
 $('confirmCancel').onclick=()=>{if(!busy)$('confirmOrder').close();};$('confirmOrder').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 $('confirmSubmit').onclick=()=>{if(busy||!reviewed)return;pending=reviewed;persist();submitPending();};
 async function submitPending(){if(!pending||busy||preview||stopped)return;busy=true;epoch++;clearTimeout(timer);$('confirmSubmit').disabled=true;$('confirmCancel').disabled=true;drawPositions();drawDetail();
  try{const {data,error}=await db.rpc('exchange_open',pending);if(accountChanged)return;if(error)throw error;const code=pending.p_code;pending=null;persist();$('confirmOrder').close();accept(data,code);message('ההשקעה נפתחה והקרן ננעלה בבנק.');$('retry').hidden=true;setView('positions');}
  catch(e){const definitive=/invalid_order|invalid_market|insufficient_bank|loan_late|price_unavailable|request_conflict/.test(e.message||'');if(definitive){pending=null;persist();$('confirmOrder').close();}message(errorText(e));$('confirmError').textContent=errorText(e);$('confirmSubmit').textContent=pending?'שליחה חוזרת באותו מזהה':'אישור השקעה ונעילת הסכום';$('retry').textContent=pending?'שליחה חוזרת באותו מזהה':'רענון נתונים';$('retry').hidden=false;}
  finally{busy=false;$('confirmSubmit').disabled=false;$('confirmCancel').disabled=false;drawPositions();drawDetail();schedule();}
 }
 async function closePosition(p){if(busy||pending||stopped)return;busy=true;epoch++;clearTimeout(timer);drawPositions();try{const {data,error}=await db.rpc('exchange_close',{p_position:p.id});if(accountChanged)return;if(error)throw error;accept(data,p.code);message('מצב העסקה עודכן.');}catch(e){message(errorText(e));$('retry').hidden=false;}finally{busy=false;drawPositions();schedule();}}
 $('retry').onclick=()=>pending?submitPending():load();
 $('moreHistory').onclick=async()=>{if(historyBusy||preview||stopped||!state)return;const rows=state.positions.filter(p=>p.status==='closed').sort((a,b)=>Date.parse(b.opened_at)-Date.parse(a.opened_at)||b.id.localeCompare(a.id)),last=rows.at(-1);if(!last)return;historyBusy=true;$('moreHistory').disabled=true;try{const {data,error}=await db.rpc('exchange_history',{p_before:last.opened_at,p_before_id:last.id});if(accountChanged)return;if(error)throw error;const existing=new Set(state.positions.map(p=>p.id));state.positions.push(...data.filter(p=>!existing.has(p.id)));historyEnd=data.length<50;drawPositions();}catch(e){message(errorText(e));}finally{historyBusy=false;$('moreHistory').disabled=false;}};
 document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden)load();});addEventListener('pagehide',()=>{stopped=true;epoch++;clearTimeout(timer);});addEventListener('pageshow',()=>{if(accountChanged)return;stopped=false;if(state)load();});
 (async()=>{
  if(preview){$('previewNotice').hidden=false;state={bank:'0',positions:[],realized:'0',markets:Object.entries(names).map(([code,name])=>({code,name,kind:code===code.toUpperCase()?'daily':'long',icon:({BNYM:'house',FSHR:'fisher',IDO:'fish',MASS:'protein',smoke:'smokehouse'}[code]||code),risk:'',price:null,previous:null,history:[]}))};message('');drawBalances();drawMarkets();window.GC_LOADER?.done();return;}
  const {data:{session},error}=await db.auth.getSession();if(error||!session){location.href='bank.html';return;}user=session.user.id;
  db.auth.onAuthStateChange?.((_event,current)=>{if(current?.user?.id!==user){accountChanged=true;stopped=true;epoch++;clearTimeout(timer);$('review').disabled=true;$('confirmOrder').close();message('החיבור לחשבון השתנה. יש לחזור לבנק ולהיכנס מחדש.');}});
  try{pending=JSON.parse(localStorage.getItem('gx_pending_'+user)||'null');}catch{}
  await load();if(pending){message('נמצאה בקשת השקעה הממתינה לאימות. שליחה חוזרת תשתמש באותו מזהה פעולה.');$('retry').textContent='שליחה חוזרת באותו מזהה';$('retry').hidden=false;}
  window.GC_GUIDE?.init({game:'exchange',db,mount:document.querySelector('.top'),auto:false,steps:[{el:'.balances',t:'כאן מופיעים יתרת הבנק, שווי התיק והרווח או ההפסד. הקרן של השקעה פתוחה נעולה.'},{el:'.market-tabs',t:'השקעות ארוכות מתבססות על פעילות הקזינו. במסחר יומי המחירים מדומים ונוצרים באקראי בשרת.'},{el:'#markets',t:'לחצו על מדד כדי לראות גרף, מקור נתונים וטופס השקעה. מינוף מגדיל רווחים והפסדים; אפשר להפסיד את מלוא הקרן.'},{t:'השקעות ארוכות נעולות לתקופה שבחרתם. במסחר יומי אפשר לסגור ידנית, והעסקה מסתיימת לכל המאוחר אחרי 24 שעות. הכללים המלאים זמינים בכפתור המידע.'}]});
 })().catch(e=>{message(errorText(e));$('retry').hidden=false;window.GC_LOADER?.done();});
})();
