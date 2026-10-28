(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FishingMotion=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
 const smooth=x=>{x=clamp(x);return x*x*(3-2*x)};
 function tier(m){return m<300?'tiny':m<1500?'medium':'large'}
 const specs={tiny:{end:7.8,pulls:[{at:5.15,length:.36,to:1}]},medium:{end:12.5,pulls:[{at:5.25,length:.8,to:.22},{at:7.4,length:.85,to:.58},{at:9.85,length:.9,to:1}]},large:{end:17,pulls:[{at:5.2,length:.75,to:.08},{at:7.2,length:.9,to:.24},{at:9.5,length:.9,to:.46},{at:11.8,length:1,to:.70},{at:14.2,length:1,to:1}]}};
 function poseAt(seconds,total){
  const kind=tier(total),spec=specs[kind];let reveal=0,pull=0,splash=0,last=0;let stage=0;
  if(seconds<4.8){pull=.45+.23*Math.sin(seconds*3.1)+.12*Math.sin(seconds*7.3);}
  for(const [i,p] of spec.pulls.entries()){
   if(seconds>=p.at){const u=clamp((seconds-p.at)/p.length);reveal=last+(p.to-last)*smooth(u);pull=Math.max(pull,Math.sin(u*Math.PI));stage=i+1;if(u<1)splash=Math.max(splash,Math.sin(u*Math.PI));}
   if(seconds>=p.at+p.length)reveal=p.to;
   last=p.to;
  }
  // Small resistance slip, only after a partial reveal; never alters actual size/outcome.
  for(const p of spec.pulls)if(p.to<1){const u=(seconds-p.at-p.length)/.55;if(u>0&&u<1)reveal-=Math.sin(u*Math.PI)*.035;}
  const done=seconds>=spec.pulls.at(-1).at+spec.pulls.at(-1).length;
  let shown=null;if(stage){const frac=spec.pulls[stage-1].to;shown=done?total:Math.max(1,Math.floor(total*frac));}
  return {kind,duration:spec.end,reveal:clamp(reveal),pull:clamp(pull),splash,stage,shownMultiplier:shown,
   bodyAngle:-.015-pull*.045,headAngle:.012+pull*.008,handX:-pull*14,handY:-pull*24,reelAngle:seconds*7.5,
   breathing:Math.sin(seconds*2.4)*1.4,rodTension:.45+pull*.5,done};
 }
 function fishFit(total,nativeWidth,nativeHeight,zone,minLength=48){
  if(!(total>0&&nativeWidth>0&&nativeHeight>0))throw Error('Invalid fish dimensions/multiplier');
  const maxScale=Math.min(zone.width/nativeWidth,zone.height/nativeHeight);
  const scale=Math.min(maxScale,Math.max(minLength/nativeWidth,maxScale*total/5000));
  return {scale,width:nativeWidth*scale,height:nativeHeight*scale,maxWidth:nativeWidth*maxScale};
 }
 function elbow(shoulder,hand,l1,l2,bend){const dx=hand.x-shoulder.x,dy=hand.y-shoulder.y,raw=Math.hypot(dx,dy);const d=clamp(raw,Math.abs(l1-l2)+.01,l1+l2-.01);const a=Math.atan2(dy,dx)+bend*Math.acos(clamp((l1*l1+d*d-l2*l2)/(2*l1*d),-1,1));return {x:shoulder.x+Math.cos(a)*l1,y:shoulder.y+Math.sin(a)*l1}}
 function bezier(a,b,c,t){const q=1-t;return {x:q*q*a.x+2*q*t*b.x+t*t*c.x,y:q*q*a.y+2*q*t*b.y+t*t*c.y}}
 return {clamp,smooth,tier,specs,poseAt,fishFit,elbow,bezier};
});
