const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('docs/slot-bets.js', 'utf8'), ctx);
const ladder = ctx.window.GC_SLOT_LADDER;
assert.equal(ctx.window.GC_SLOT_SELECT(ladder(10,99000000),100000000),50000000);
const slots=fs.readFileSync('docs/sl.js','utf8');
assert(slots.indexOf('FREE_LEFT = 0')<slots.indexOf('drawRack(0)'));
Object.assign(ctx,ctx.window);
vm.runInContext('let lineBet=20000000, busy=false, FREE_LEFT=0; const fmt=String; const $=()=>({textContent:"",innerHTML:"",querySelectorAll:()=>[]});',ctx);
vm.runInContext(slots.slice(slots.indexOf('let rackKey ='),slots.indexOf('drawRack(0);')),ctx);
vm.runInContext('drawRack(99000000);',ctx); assert.equal(vm.runInContext('lineBet',ctx),10000000);
vm.runInContext('lineBet=10000000;busy=true;drawRack(0);',ctx);assert.equal(vm.runInContext('lineBet',ctx),10000000);
vm.runInContext('busy=false;FREE_LEFT=10;drawRack(0);',ctx);assert.equal(vm.runInContext('lineBet',ctx),10000000);
vm.runInContext('FREE_LEFT=0;drawRack(0);',ctx);assert.equal(vm.runInContext('lineBet',ctx),1);
assert(ladder(10, 50000000).includes(50000000));
assert(ladder(10, 100000000).includes(100000000));
assert(ladder(10, 500000000).includes(250000000));
assert(ladder(10, 500000000).includes(500000000));
assert(ladder(10, 4000000000000).includes(4000000000000));
assert.equal(ladder(10, 99000000).filter(v => v < 100000000 && v !== 99000000).pop(), 50000000);
for (const bal of [0, 5, 9, 10, 50, 499999, 500000, 50000000, 99000000, 100000000]) {
  const a = ladder(10, bal); assert(a.every((v, i) => Number.isInteger(v) && v >= 10 && (!i || v > a[i-1])));
  assert(a.every(v => v <= Math.max(10, bal)));
}
vm.runInContext(fs.readFileSync('docs/pm-geometry.js','utf8'),ctx);
const geo = ctx.window.PM_GEOMETRY;
for(let a=-1.46;a<=1.46;a+=.001) {
  const d=geo.limit(a), x=1000+Math.sin(a)*d,y=280+Math.cos(a)*d;
  assert(Number.isFinite(d)&&d>0);assert(x>=39.999&&x<=1880.001&&y<=1040.001);
}
for(let j=0;j<12;j++) {
 const p=geo.position(j),a=Math.atan2(p.x-1000,p.y-280);
 assert(Math.hypot(p.x-1000,p.y-280)<geo.limit(a));
 for(let k=0;k<12;k++)if(k!==j){const q=geo.position(k),t=(q.x-1000)*Math.sin(a)+(q.y-280)*Math.cos(a);
  const dist=Math.abs((q.x-1000)*Math.cos(a)-(q.y-280)*Math.sin(a));assert(t<0||dist>78);}
}
// Parse every inline script in changed HTML before deploying.
for(const file of ['slots','dragons','wildwest','kinneret','pachinko','protein']) {
 const s=fs.readFileSync(`docs/${file}.html`,'utf8');
 for(const m of s.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(m[1].trim()) {
  const result=require('child_process').spawnSync(process.execPath,['--input-type=module','--check'],{input:m[1],encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
 }
}
console.log('Machine ladders, claw boundaries, target access and script syntax passed');
