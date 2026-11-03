import assert from 'node:assert/strict';
import {reelPlan,reelPhase,REEL_SPEED,bonusTimeline,releasePosition} from '../docs/vendor/pc_presentation.mjs';
import {Renderer} from '../docs/vendor/pc_renderer.mjs';
const grid=Array(15).fill(0);grid[0]=grid[6]=6;const plan=reelPlan(grid,10);
const velocity=(col,t)=>(reelPhase(plan,col,t+.0001)-reelPhase(plan,col,t))/.0001;
for(let col=2;col<5;col++){
 const turn=plan.turboStarts[col],brake=turn+1.5;
 assert(Math.abs(velocity(col,turn+.2)-REEL_SPEED*3)<.01);assert(Math.abs(velocity(col,turn+1.4)-REEL_SPEED*3)<.01);
 assert(velocity(col,brake+.1)>velocity(col,brake+.7));assert(velocity(col,plan.stops[col]-.05)<1);
 assert.equal(reelPhase(plan,col,plan.stops[col]),plan.cycles[col]);
}
const renderer=Object.create(Renderer.prototype);
for(const kind of ['regular','super']){
 const count=kind==='super'?7:8,events=Array.from({length:20},(_,i)=>({target:i%2?count-1:0})),tl=bonusTimeline(kind,events);
 assert.equal(tl.endsAt,tl.releases.at(-1)+tl.duration);
 for(let i=0;i<events.length;i++){
  const end=105+(events[i].target+.5)*tl.cell,release=tl.releases[i];
  for(const delta of [-.15,0,.15])assert(Math.abs(releasePosition(tl,release+delta)-end)<.01,'performer stops above the landing cell');
  const path=renderer.path(i,tl.sources[i],end);assert.equal(path[0].x,end);assert.equal(path.at(-1).x,end);
  path.forEach((p,j)=>{assert(Math.abs(p.x-end)<=80);if(j){assert(p.y>path[j-1].y);assert(Math.abs(p.x-path[j-1].x)<150);}});
 }
 for(let t=0;t<tl.endsAt;t+=.01){const v=Math.abs(releasePosition(tl,t+.001)-releasePosition(tl,t))/.001;assert(v<=1001,'rail motion cannot teleport between releases');}
}
console.log('PASS: 1.5s at triple reel speed, long progressive braking, stationary releases, bounded local pin paths and consistent bonus completion');
