// Presentation only: results and payments always come from pc_spin / pc_buy.
export const WIN_HOLD = 1.25;
export const LINES = [[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],[0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[1,0,1,2,1]];
export function reelPlan(grid,start){
 const stops=[];let shownBonusColumns=0,slow=0,anticipationAt=null;
 for(let col=0;col<5;col++){
  const delay=col===0?.62:shownBonusColumns>=2?.60+.14*slow++:.24;
  stops.push((stops.at(-1)??start)+delay);
  if([0,1,2].some(row=>grid[row*5+col]===6))shownBonusColumns++;
  if(shownBonusColumns>=2&&col<4&&anticipationAt===null)anticipationAt=stops[col];
 }
 return {start,stops,anticipationAt,end:stops[4]};
}
export function reelPhase(plan,col,time){
 const duration=plan.stops[col]-plan.start,slow=plan.anticipationAt!==null&&plan.stops[col]>plan.anticipationAt?.7:.25;
 const tail=Math.min(slow,duration,plan.anticipationAt!==null&&plan.stops[col]>plan.anticipationAt?plan.stops[col]-plan.anticipationAt:duration),fast=duration-tail,cycles=Math.ceil(duration*16),speed=cycles/(fast+tail/2),t=Math.max(0,Math.min(duration,time-plan.start));
 if(time>=plan.stops[col])return cycles;
 if(t<=fast)return speed*t;
 const u=(t-fast)/tail;return speed*fast+speed*tail*(u-u*u/2);
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
