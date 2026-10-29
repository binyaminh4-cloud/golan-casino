(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.ProteinScene=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const clamp=x=>Math.max(0,Math.min(1,x)),ease=x=>{x=clamp(x);return x*x*(3-2*x);};
 function draw(ctx,imgs,state){
  const r=state.round,t=state.time||0,phase=r.phase,pose=state.pose||'idle';
  ctx.clearRect(0,0,1920,1080);ctx.drawImage(imgs['backgrounds/field_desktop.jpg'],0,0,1920,1080);
  const image=(file,x,y,w,h,alpha=1,rot=0)=>{const im=imgs[file];if(!im)return;ctx.save();ctx.globalAlpha=alpha;ctx.translate(x,y);ctx.rotate(rot);ctx.drawImage(im,-w/2,-h/2,w,h);ctx.restore();};
  const text=(str,x,y,size=28,color='#f2e4c3',align='center')=>{ctx.save();ctx.font=`600 ${size}px Arial`;ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(str,x,y);ctx.restore();};
  const panel=(str,x,y,w,h,size=28)=>{image('ui/plaque_blank.png',x,y,w,h);ctx.save();ctx.font=`600 ${size}px Arial`;const actual=ctx.measureText(str).width;ctx.restore();text(str,x,y,Math.min(size,size*(w-32)/Math.max(actual,1)));};
  // A closed layer is only dimmed; size, shell and skin never reveal contents.
  for(const rock of r.rocks){
   if(rock.taken||state.hiddenRock===rock.id)continue;
   const a=rock.layer===r.layer?1:.52;
   if(rock.bomb!==undefined)image('prizes/'+(rock.bomb?'bomb':rock.food)+'.png',rock.x,rock.y,rock.w*1.25,rock.w*1.25,a);else image(`rocks/rock_${'abc'[rock.skin]}.png`,rock.x,rock.y,rock.w,rock.w,a);
   const tagIndex=r.rocks.filter(x=>x.tagged).findIndex(x=>x.id===rock.id);
   const landed=phase!=='intro'||t>(.4+tagIndex*.5+.9);
   if(rock.tagged&&landed){image('ui/tag_blank.png',rock.x+rock.w*.25,rock.y-rock.w*.46,59,30,a, -.08);ctx.save();ctx.globalAlpha=a;text('×'+rock.boost,rock.x+rock.w*.25,rock.y-rock.w*.46,19,'#241c13');ctx.restore();}
  }
  const actor=(file,x,feet,h,rot=0)=>{const im=imgs[file];image(file,x,feet-h*(744/768-.5),h*im.width/im.height,h,1,rot);};
  actor(`characters/avichai_${pose}.png`,883,278,220,state.bodyTilt||0);
  image('props/winch.png',1000,220,170,120);
  image('props/crank.png',943,220,53,27,1,state.crankAngle||0);
  image('props/tray.png',267,230,218,109);
  panel((r.successes%3|| (r.phase==='checkpoint'||r.phase==='finished'?3:0))+'/3',268,149,105,48,26);
  r.history.slice(-3).forEach((p,i)=>{image('prizes/'+p.food+'.png',202+i*65,215,48,48);text('×'+(p.rewardUnits/100).toFixed(2),202+i*65,253,17);});
  if(phase==='intro'){
   const u=clamp(t/7),x=-110+2180*u;
   actor('characters/yoav_walk_'+String(Math.floor(t*8)%4).padStart(2,'0')+'.png',x,278+Math.sin(t*16)*2.5,218,Math.sin(t*8)*.012);
   r.rocks.filter(x=>x.tagged).forEach((rock,i)=>{
    const start=.4+i*.5,u=clamp((t-start)/.9);if(t<start||u>=1)return;
    const sx=-110+2180*clamp(start/7)+57,sy=190,ex=rock.x,ey=rock.y-rock.w*.46;
    const x=sx+(ex-sx)*u,y=sy+(ey-sy)*u-65*4*u*(1-u);
    image('ui/tag_blank.png',x,y,59,30,1,u*.6);text('×'+rock.boost,x,y,19,'#241c13');
   });
  }
  const angle=state.angle||0,len=state.length||45;
  const endX=1000+Math.sin(angle)*len,endY=280+Math.cos(angle)*len;
  ctx.save();ctx.strokeStyle='#b6a182';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(1000,280);ctx.lineTo(endX,endY);ctx.stroke();ctx.restore();
  image('props/claw_'+(state.closed?'closed':'open')+'.png',endX+Math.sin(angle)*12,endY+Math.cos(angle)*12,45,45,1,-angle);
  if(state.carried){const a=state.carried;if(a.bomb!==undefined)image('prizes/'+(a.bomb?'bomb':a.food)+'.png',endX+Math.sin(angle)*42,endY+Math.cos(angle)*42,a.w*1.25,a.w*1.25);else image(`rocks/rock_${'abc'[a.skin]}.png`,endX+Math.sin(angle)*42,endY+Math.cos(angle)*42,a.w,a.w);}
  if(state.reveal){const q=state.reveal;image('prizes/'+(q.bomb?'bomb':q.food)+'.png',1000,340,90,90);}
  if(state.fx){const f=state.fx;image('fx/'+(f.bomb?'bomb_puff':'dust')+'.png',f.x,f.y,150+80*f.progress,150+80*f.progress,1-f.progress);}
  panel('שולה החלבון',1540,72,520,110,49);
  const modes=[['easy','קל'],['normal','רגיל'],['extreme','אקסטרים']];
  modes.forEach(([key,label],i)=>{const x=1360+i*180;ctx.save();ctx.fillStyle=key===r.mode?'#bba06d':'rgba(36,29,21,.86)';ctx.fillRect(x-80,137,160,44);ctx.restore();text(label,x,159,25,key===r.mode?'#251e15':'#e3d8c0');});
  panel('הימור '+(state.stake||10),1712,232,215,58,25);
  panel('×'+(r.bankUnits/100).toFixed(2),1500,230,150,58,28);
  const messages={intro:'יואב מחלק מכפילים...',playing:'לחץ לשליחה',checkpoint:'לקחת או להמשיך?',busted:'בום! הלך החלבון',cashed:'השלל נאסף',finished:'החיטוב הושלם',ready:'בחר הימור ולחץ התחל'};
  panel(state.message||messages[phase]||'',960,1003,510,70,30);
 }
 return{draw,ease};
});
