// Presentation only: results and payments always come from pc_spin / pc_buy.
export const WIN_HOLD = 1.25;
export const LINES = [[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],[0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[1,0,1,2,1]];
export const REEL_SPEED = 16;
export function reelPlan(grid,start){
 const stops=[],tails=[],turboStarts=[],cycles=[];let shownBonusColumns=0,slow=0,anticipationAt=null;
 for(let col=0;col<5;col++){
  const previous=stops.at(-1)??start,tense=col>0&&shownBonusColumns>=2;
  let tail=.25,stop;
  if(tense){
   const pre=previous-start,rawTail=1.8+.2*slow++;
   const turns=Math.ceil(REEL_SPEED*pre+REEL_SPEED*3*1.5+REEL_SPEED*rawTail);
   tail=(turns-REEL_SPEED*pre-REEL_SPEED*3*1.5)/REEL_SPEED;
   stop=previous+1.5+tail;cycles.push(turns);turboStarts.push(previous);
  }else{stop=previous+(col===0?.625:.25);cycles.push(Math.round(REEL_SPEED*(stop-start-tail/2)));turboStarts.push(null);}
  tails.push(tail);stops.push(stop);
  if([0,1,2].some(row=>grid[row*5+col]===6))shownBonusColumns++;
  if(shownBonusColumns>=2&&col<4&&anticipationAt===null)anticipationAt=stop;
 }
 return {start,stops,tails,turboStarts,cycles,anticipationAt,end:stops[4]};
}
export function reelPhase(plan,col,time){
 if(time>=plan.stops[col])return plan.cycles[col];
 const t=Math.max(0,time-plan.start),tail=plan.tails[col],turbo=plan.turboStarts[col];
 if(turbo!==null){
  const pre=turbo-plan.start;
  if(t<=pre)return REEL_SPEED*t;
  if(t<=pre+1.5)return REEL_SPEED*pre+REEL_SPEED*3*(t-pre);
  const u=Math.max(0,Math.min(1,(t-pre-1.5)/tail));
  return REEL_SPEED*pre+REEL_SPEED*3*1.5+REEL_SPEED*3*tail*(u-u*u+u*u*u/3);
 }
 const fast=plan.stops[col]-plan.start-tail;
 if(t<=fast)return REEL_SPEED*t;
 const u=(t-fast)/tail;return REEL_SPEED*fast+REEL_SPEED*tail*(u-u*u/2);
}
// Regular bonus: before every drop Avichai sweeps the rail right-left at least twice (SWEEP seconds), then stops above
// the cell the server chose and releases. Super bonus keeps its quick hops between sources.
export const SWEEP=4.6;
export function bonusTimeline(kind,events){
 const count=kind==='super'?7:8,cell=1390/count,sources=events.map(e=>105+(e.target+.5)*cell),releases=[];
 const duration=kind==='super'?6.2:9;
 sources.forEach((x,i)=>releases.push(kind==='super'?(i===0?1.4:releases[i-1]+Math.max(.9,.36+1.5*Math.abs(x-sources[i-1])/1000)):(i===0?SWEEP+.8:releases[i-1]+duration+SWEEP+.6)));
 return {kind,sources,releases,duration,cell,endsAt:(releases.at(-1)??0)+duration};
}
const smooth=u=>u*u*(3-2*u);
function sweepPosition(from,to,u){
 // from -> far end -> near end -> far end -> near end -> target (two full passes), each leg timed by its length
 const a=from>800?200:1400,b=a===200?1400:200,pts=[from,a,b,a,b,to],len=[];let total=0;
 for(let i=1;i<pts.length;i++){const d=Math.max(120,Math.abs(pts[i]-pts[i-1]));len.push(d);total+=d;}
 let t=Math.max(0,Math.min(1,u))*total;
 for(let i=0;i<len.length;i++){if(t<=len[i])return pts[i]+(pts[i+1]-pts[i])*smooth(t/len[i]);t-=len[i];}
 return to;
}
export function releasePosition(timeline,time){
 const {sources,releases}=timeline;
 if(timeline.kind==='regular'){
  for(let i=0;i<releases.length;i++){
   const end=releases[i]-.25,start=end-SWEEP,from=i===0?800:sources[i-1];
   if(time<start)return from;
   if(time<=releases[i]+.18)return sweepPosition(from,sources[i],(time-start)/SWEEP);
  }
  return sources.at(-1);
 }
 if(time<=releases[0]+.18)return sources[0];
 for(let i=1;i<releases.length;i++){
  const start=releases[i-1]+.18,end=releases[i]-.18;
  if(time<=releases[i]+.18){const u=Math.max(0,Math.min(1,(time-start)/(end-start))),smooth=u*u*(3-2*u);return sources[i-1]+(sources[i]-sources[i-1])*smooth;}
 }
 return sources.at(-1);
}
export function winningLines(data,bonusMultiplier=0){
 const wins=(data.wins||[]).filter(w=>LINES[w.line]&&w.n>=3&&w.n<=5&&w.pay>0);
 const weight=wins.reduce((sum,w)=>sum+Number(w.pay),0);
 if(!weight)return [];
 const payout=BigInt(String(data.payout)),denominator=BigInt(weight+bonusMultiplier*10);
 // Allocate the server's credited total, including any return adjustment. No
 // local RNG, guessed payout or extra wallet movement is introduced here.
 const lineTotal=Number(payout*BigInt(weight)/denominator);let shown=0;
 return wins.map((w,i)=>{
  const amount=i===wins.length-1?lineTotal-shown:Number(BigInt(lineTotal)*BigInt(w.pay)/BigInt(weight));shown+=amount;
  return {cells:LINES[w.line].slice(0,w.n).map((row,col)=>row*5+col),amount};
 }).filter(w=>w.amount>0);
}
