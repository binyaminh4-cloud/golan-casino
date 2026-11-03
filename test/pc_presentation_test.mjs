import assert from 'node:assert/strict';
import {reelPlan,reelPhase,winningLines,WIN_HOLD,LINES} from '../docs/vendor/pc_presentation.mjs';
import {Renderer} from '../docs/vendor/pc_renderer.mjs';
const plain=Array(15).fill(0),normal=reelPlan(plain,10);
assert.equal(WIN_HOLD,1.25);assert.equal(LINES.length,10);
assert(normal.end-10>1.5&&normal.end-10<1.7);assert.equal(normal.anticipationAt,null);
const two=[...plain];two[0]=two[6]=6;const tense=reelPlan(two,10);
assert.equal(tense.anticipationAt,tense.stops[1]);assert.equal(tense.stops[0],normal.stops[0]);assert.equal(tense.stops[1],normal.stops[1]);
let previous=0;for(let col=2;col<5;col++){const gap=tense.stops[col]-tense.stops[col-1];assert(gap>previous);previous=gap;}
// An unrevealed scatter or two scatters in one reel cannot trigger early tension.
const late=[...plain];late[3]=late[14]=6;assert.equal(reelPlan(late,0).anticipationAt,null);
const same=[...plain];same[0]=same[5]=6;assert.equal(reelPlan(same,0).anticipationAt,null);
for(const plan of [normal,tense])for(let col=0;col<5;col++){
 let last=-1;for(let t=plan.start;t<plan.stops[col]+.1;t+=.005){const phase=reelPhase(plan,col,t);assert(phase>=last-1e-9);last=phase;}
 assert.equal(reelPhase(plan,col,plan.stops[col])%1,0);
}
const wins=winningLines({stake:100,payout:83,wins:[{line:0,n:3,pay:4},{line:3,n:4,pay:40}]});
assert.equal(wins.reduce((n,w)=>n+w.amount,0),83);assert.deepEqual(wins[0].cells,[5,6,7]);assert.deepEqual(wins[1].cells,[0,6,12,8]);
assert.deepEqual(winningLines({payout:0,wins:[]}),[]);
const mixed=winningLines({payout:1097,wins:[{line:0,n:3,pay:50}]},100);assert(mixed[0].amount>0&&mixed[0].amount<1097);
// The full body AND original head stay inside the requested vertical box.
for(const anchorY of [-90,-30,0,30,100])for(const height of [119,127,139,470]){
 const calls=[],c={drawImage:(_image,x,y,w,h)=>calls.push({x,y,w,h})},image={width:160,height:420},head={width:200,height:300};
 const renderer=new Renderer({getContext:()=>c},{bodies:[{image}],anchors:[{x:80,y:anchorY}],heads:{fisher:head}});
 renderer.character('fisher',200,816,height,0);for(const r of calls){assert(r.y>=816-height-.01);assert(r.y+r.h<=816+.01);}
}
console.log('PASS: left-to-right stops, visible-only anticipation, progressive slow-down, exact line allocations and complete head/body bounds');
