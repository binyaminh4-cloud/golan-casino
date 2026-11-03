const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx={window:{}};vm.runInNewContext(fs.readFileSync('docs/pm-geometry.js','utf8'),ctx);const g=ctx.window.PM_GEOMETRY;
// Swept contact agrees across high and low frame rates, and sees every direction.
const rocks=Array.from({length:12},(_,id)=>({id,layer:0,w:110,taken:false}));
function flight(angle,start,dt){let t=start,length=45;const max=g.limit(angle);while(length<max){const next=Math.min(max,length+dt*1500),h=g.sweep(rocks,0,angle,length,next,t,t+dt);if(h)return h;t+=dt;length=next;}return null;}
for(let t=0;t<15;t+=.37)for(let a=-1.45;a<=1.45;a+=.13){const fine=flight(a,t,1/240),coarse=flight(a,t,1/20);if(coarse&&fine){assert.equal(coarse.rock.id,fine.rock.id);assert(Math.abs(coarse.distance-fine.distance)<2);}else if(coarse||fine){const h=coarse||fine,p=g.position(h.rock.id,t+(h.distance-45)/1500,true),distance=Math.hypot(1000+Math.sin(a)*h.distance-p.x,280+Math.cos(a)*h.distance-p.y);assert(Math.abs(distance-(h.rock.w*.52+7))<.02,'only a subpixel grazing contact may differ by frame rate');}}
for(let id=0;id<12;id++){
 let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
 for(let t=0;t<30;t+=.05){const p=g.position(id,t,true);minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);assert(p.x-85>=0&&p.x+85<=1920&&p.y-85>=0&&p.y+85<=1080);}
 assert(maxX-minX>15&&maxY-minY>15,'every item moves on both axes');
}
// A target aimed at on click may move away before arrival: no preselected catch.
let escaped=false;
for(let id=0;id<12;id++)for(let t=0;t<5;t+=.1){const p=g.position(id,t,true),a=Math.atan2(p.x-1000,p.y-280),k={id,layer:0,w:1,...p};assert(g.hit([k],0,a));if(!g.sweep([k],0,a,45,g.limit(a),t,t+(g.limit(a)-45)/1500))escaped=true;}
assert(escaped,'click-time hits are not guaranteed catches');
// Removed items and other layers cannot be caught, even on a direct path.
const p=g.position(5,1,true),a=Math.atan2(p.x-1000,p.y-280);
assert.equal(g.sweep([{id:5,layer:0,w:150,taken:true}],0,a,45,800,1,1.5),null);
assert.equal(g.sweep([{id:5,layer:1,w:150}],0,a,45,800,1,1.5),null);
console.log('PASS: moving collision across 20–240 FPS, all-axis bounded motion, escaped click-time target, taken items and layers');
