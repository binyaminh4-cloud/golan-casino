// Presentation coordinates mirror rv_private.world; every hit/reward is checked by the server.
export const NAMES={range:'מטווח',gate:'ש״ג',base:'הגנה על הבסיס',sniper:'צלף'};
export const TARGETS=['target_olive_v2','target_blue_v2','target_red_v2'];
export const FEATURES=['מעיל זית וצעיף חום','מעיל כחול וכובע מצחייה','מעיל אדום וכובע צמר'];
export function world(mode,scene,t){
 if(mode==='range')return scene.filter(a=>t>=a.at&&t<a.at+a.dur).map(a=>({...a,asset:'target',w:.19,h:.26*Math.min(1,(t-a.at)/.18),good:true}));
 if(mode==='gate'){
  const e=Math.floor(t/5);if(e<0||e>4)return[];const dt=t-e*5;
  return [0,1,2].map(j=>{const firing=j===scene[e].attacker&&dt>=2&&dt<4;return{id:e+':'+j,asset:firing?'hostile':j===1?'civilian_woman':j===2?'civilian_elder':'civilian_walk_sheet',x:.15+j*.27+.04*Math.sin(dt*1.1+j),y:.72,w:.20,h:.35,good:firing,firing,event:e};});
 }
 if(mode==='base')return[{id:'base',asset:'hostile',...scene[Math.min(4,Math.max(0,Math.floor(t/6)))],w:.18,h:.26,good:true}];
 return scene.map((a,i)=>({...a,x:a.x+(a.window?0:.026*Math.sin(t*.24+i*1.7)),w:a.window?.038:.052,h:a.window?.13:.19,good:i<3}));
}
export function camera(width,height,cx=.5,cy=.57,zoom=false){
 const aspect=1774/887,viewW=Math.min(zoom?.19:.48,.90/aspect*width/height),viewH=viewW*aspect*height/width;
 cx=Math.max(viewW/2,Math.min(1-viewW/2,cx));cy=Math.max(Math.min(.5,viewH/2),Math.min(1-Math.min(.5,viewH/2),cy));
 return{x:cx-viewW/2,y:cy-viewH/2,w:viewW,h:viewH,cx,cy};
}
export const point=(cam,x,y)=>({x:cam.x+x*cam.w,y:cam.y+y*cam.h});
