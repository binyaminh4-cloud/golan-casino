(function(root,factory){let motion=typeof module==='object'&&module.exports?require('./motion_core.js'):root.FishingMotion;const api=factory(motion);if(typeof module==='object'&&module.exports)module.exports=api;else root.FishingRender=api})(typeof globalThis!=='undefined'?globalThis:this,function(M){
 'use strict';
 const paths={bg:'backgrounds/bonus_desktop.jpg',main:'backgrounds/main_desktop.jpg',body:'ido/rig/body.png',upper:'ido/rig/body_upper.png',lower:'ido/rig/body_lower.png',head:'ido/rig/head.png',strain:'ido/rig/head_strain.png',ul:'ido/rig/upper_left.png',fl:'ido/rig/fore_left.png',ur:'ido/rig/upper_right.png',fr:'ido/rig/fore_right.png',grip:'props/rod_grip.png',reel:'props/reel.png',box:'props/tacklebox.png',lantern:'props/lantern.png',hole:'props/hole_back.png',front:'props/hole_front.png',splash:'fx/splash.png',ripple:'fx/ripple.png',blue:'fish/blue.png',orange:'fish/orange.png',red:'fish/red.png',dark:'fish/friend_dark_icon.png',light:'fish/friend_light_icon.png',rim:'wheel/rim.png',hub:'wheel/hub.png',pointer:'wheel/pointer.png',stand:'wheel/stand.png',plaque:'ui/title_plaque.png'};
 function contain(ctx,im,x,y,w,h){const s=Math.min(w/im.width,h/im.height),ww=im.width*s,hh=im.height*s;ctx.drawImage(im,x+(w-ww)/2,y+(h-hh)/2,ww,hh)}
 function limb(ctx,im,a,b,pa,pb){const sx=pa[0]*im.width,sy=pa[1]*im.height,ex=pb[0]*im.width,ey=pb[1]*im.height;const scale=Math.hypot(b.x-a.x,b.y-a.y)/Math.hypot(ex-sx,ey-sy);ctx.save();ctx.translate(a.x,a.y);ctx.rotate(Math.atan2(b.y-a.y,b.x-a.x)-Math.atan2(ey-sy,ex-sx));ctx.scale(scale,scale);ctx.drawImage(im,-sx,-sy);ctx.restore()}
 function puppet(ctx,I,p){
  const x=1430,y=440,w=430,h=w*I.body.height/I.body.width,hip={x:w*.5,y:h*.56};
  ctx.save();ctx.translate(x,y);contain(ctx,I.box,100,235,260,210);
  // Fixed lower body: source crop begins at 50% of body height.
  ctx.drawImage(I.lower,0,h*.5,w,h*.5);
  ctx.translate(hip.x,hip.y);ctx.rotate(p.bodyAngle);ctx.translate(-hip.x,-hip.y);
  ctx.drawImage(I.upper,0,0,w,h*.62);
  const sL={x:w*.16,y:h*.27},sR={x:w*.83,y:h*.27};
  const handL={x:126+p.handX,y:194+p.handY},handR={x:195+p.handX+Math.cos(p.reelAngle)*5,y:218+p.handY+Math.sin(p.reelAngle)*5};
  const eL=M.elbow(sL,handL,110,120,1),eR=M.elbow(sR,handR,122,132,-1);
  limb(ctx,I.ul,sL,eL,[.77,.12],[.25,.90]);limb(ctx,I.ur,sR,eR,[.14,.14],[.83,.86]);
  const gripA={x:handL.x-32,y:handL.y-50},gripB={x:handR.x+15,y:handR.y+38};
  limb(ctx,I.grip,gripA,gripB,[.15,.12],[.85,.88]);
  ctx.save();ctx.translate(handR.x-6,handR.y-4);ctx.rotate(p.reelAngle);contain(ctx,I.reel,-31,-31,62,62);ctx.restore();
  limb(ctx,I.fl,eL,handL,[.87,.15],[.18,.78]);limb(ctx,I.fr,eR,handR,[.14,.15],[.86,.79]);
  // Head is a rigid uniformly scaled part, never a stretched mesh.
  ctx.save();ctx.translate(w*.5,h*.10);ctx.rotate(p.headAngle);const head=p.done===false?I.strain:I.head;const hh=355,hw=hh*head.width/head.height;ctx.drawImage(head,-hw*.5,-hh*.92,hw,hh);ctx.restore();
  const local=gripA;const cos=Math.cos(p.bodyAngle),sin=Math.sin(p.bodyAngle);const dx=local.x-hip.x,dy=local.y-hip.y;
  const rodBase={x:x+hip.x+dx*cos-dy*sin,y:y+hip.y+dx*sin+dy*cos};ctx.restore();return rodBase;
 }
 function header(ctx,I,title,status){ctx.save();contain(ctx,I.plaque,600,12,720,140);ctx.fillStyle='#ead9af';ctx.textAlign='center';ctx.font='bold 54px sans-serif';ctx.fillText(title,960,92);ctx.font='28px sans-serif';ctx.fillStyle='#c7d4e5';ctx.fillText(status,960,163);ctx.restore()}
 function bonusFrame(ctx,I,seconds,total,color='red'){
  const p=M.poseAt(seconds,total);ctx.clearRect(0,0,1920,1080);ctx.drawImage(I.bg,0,0,1920,1080);ctx.fillStyle='#03091655';ctx.fillRect(0,0,1920,1080);
  const hole={x:800,y:850};contain(ctx,I.hole,hole.x-370,hole.y-115,740,240);
  const fish=I[color];const fit=M.fishFit(total,fish.width,fish.height,{width:1450,height:680});
  const x=70+(1450-fit.width)/2,y=hole.y-fit.height*p.reveal;
  const finalMouth={x:x+fit.width*.955,y:hole.y-fit.height*.58};
  const eased=M.smooth(p.reveal),mouth={x:hole.x+(finalMouth.x-hole.x)*eased,y:hole.y+(finalMouth.y-hole.y)*eased};
  const fishAngle=-Math.PI/2*(1-eased)+(p.done?Math.sin(seconds*4)*.008:0);
  ctx.save();ctx.beginPath();ctx.rect(35,170,1480,hole.y-170+14);ctx.clip();if(p.reveal>0){ctx.translate(mouth.x,mouth.y);ctx.rotate(fishAngle);ctx.drawImage(fish,-fit.width*.955,-fit.height*.42,fit.width,fit.height);}ctx.restore();
  contain(ctx,I.front,hole.x-370,hole.y-8,740,160);
  if(p.splash>.04){ctx.save();ctx.globalAlpha=p.splash*.7;contain(ctx,I.splash,hole.x-260,hole.y-180,520,200);ctx.restore()}
  ctx.save();ctx.globalAlpha=.22+.15*Math.sin(seconds*3);contain(ctx,I.ripple,hole.x-320,hole.y-55,640,110);ctx.restore();
  const base=puppet(ctx,I,p),tip={x:1100-p.pull*35,y:235-p.pull*65};const control={x:1190,y:100+p.rodTension*70};
  ctx.lineWidth=8;ctx.strokeStyle='#111a24';ctx.beginPath();ctx.moveTo(base.x,base.y);ctx.quadraticCurveTo(control.x,control.y,tip.x,tip.y);ctx.stroke();ctx.lineWidth=2;ctx.strokeStyle='#b79861';ctx.stroke();
  const target=p.reveal>.02?mouth:hole;ctx.lineWidth=1.6;ctx.strokeStyle='#d5e7f4aa';ctx.beginPath();ctx.moveTo(tip.x,tip.y);ctx.lineTo(target.x,target.y);ctx.stroke();
  contain(ctx,I.lantern,1740,775,100,155);header(ctx,I,'מסע הדיג של עידו',`בונוס ${color==='blue'?'כחול':color==='orange'?'כתום':'אדום'}`);
  ctx.fillStyle='#080f1deb';ctx.fillRect(440,940,1040,118);ctx.strokeStyle='#8b6d3f';ctx.strokeRect(440,940,1040,118);ctx.textAlign='center';ctx.fillStyle='#ced8e4';ctx.font='26px sans-serif';ctx.fillText('מכפיל כולל',960,977);ctx.fillStyle='#efc467';ctx.font='bold 62px sans-serif';ctx.fillText(p.shownMultiplier===null?'?':p.shownMultiplier.toLocaleString('en-US')+'×',960,1040);
  return p;
 }
 function wheelFrame(ctx,I,seconds,layout){
  ctx.clearRect(0,0,1920,1080);ctx.drawImage(I.main,0,0,1920,1080);ctx.fillStyle='#03091644';ctx.fillRect(0,0,1920,1080);ctx.save();ctx.translate(400,0);header(ctx,I,'מסע הדיג של עידו','תצוגת גלגל — 53 גזרות');ctx.restore();
  const cx=610,cy=550,r=405,rot=seconds*.16;contain(ctx,I.stand,cx-500,380,1000,650);ctx.save();ctx.translate(cx,cy);ctx.rotate(rot);
  const colors={dark:'#26445a',light:'#a0aeb9',blue:'#1856a0',orange:'#aa6423',red:'#a52e3a'};
  for(let i=0;i<53;i++){const a=-Math.PI/2+i*Math.PI*2/53,b=a+Math.PI*2/53;const gradient=ctx.createRadialGradient(-70,-110,25,0,0,r);gradient.addColorStop(0,'#0c1724');gradient.addColorStop(.55,colors[layout[i]]);gradient.addColorStop(.88,colors[layout[i]]);gradient.addColorStop(1,'#101c2c');ctx.fillStyle=gradient;ctx.strokeStyle='#91764b';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,r,a,b);ctx.closePath();ctx.fill();ctx.stroke();const mid=(a+b)/2;ctx.save();ctx.translate(Math.cos(mid)*315,Math.sin(mid)*315);ctx.rotate(mid+Math.PI/2);contain(ctx,I[layout[i]],-20,-33,40,66);ctx.restore()}
  ctx.restore();contain(ctx,I.rim,cx-480,cy-480,960,960);contain(ctx,I.hub,cx-118,cy-118,236,236);contain(ctx,I.pointer,cx-45,cy-455,90,120);
  puppet(ctx,I,{bodyAngle:0,headAngle:0,handX:0,handY:0,reelAngle:seconds,breathing:0});
  ctx.fillStyle='#080f1de8';ctx.fillRect(80,965,1760,90);['dark','light','blue','orange','red'].forEach((key,i)=>{contain(ctx,I[key],250+i*240,970,95,75)});
 }
 return {paths,bonusFrame,wheelFrame,puppet,contain};
});
