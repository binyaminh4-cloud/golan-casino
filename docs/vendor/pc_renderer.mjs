import {RULES,slotsFor} from './pc_rules.mjs';
export const W=1600,H=900;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function trim(canvas,factory){
  const c=canvas.getContext('2d'),{width:w,height:h}=canvas,d=c.getImageData(0,0,w,h).data;
  let l=w,t=h,r=-1,b=-1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(d[(y*w+x)*4+3]>12){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}
  if(r<l)throw new Error('Empty sprite');
  l=Math.max(0,l-3);t=Math.max(0,t-3);r=Math.min(w-1,r+3);b=Math.min(h-1,b+3);
  const out=factory(r-l+1,b-t+1);out.getContext('2d').drawImage(canvas,l,t,out.width,out.height,0,0,out.width,out.height);
  return {image:out,offset:[l,t],size:[w,h]};
}
function atlasCells(img,factory){
  const out=[];const sw=img.width/4,sh=img.height/2;
  for(let i=0;i<8;i++){const c=factory(Math.floor(sw),Math.floor(sh));c.getContext('2d').drawImage(img,(i%4)*sw,Math.floor(i/4)*sh,sw,sh,0,0,c.width,c.height);removeStrayComponents(c);out.push(trim(c,factory));}
  return out;
}
function removeStrayComponents(canvas){
  const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height,data=c.getImageData(0,0,w,h),d=data.data;
  const seen=new Uint8Array(w*h),queue=new Int32Array(w*h);const components=[];
  for(let p=0;p<w*h;p++)if(!seen[p]&&d[p*4+3]>12){
    let begin=0,end=1;queue[0]=p;seen[p]=1;const pixels=[];
    while(begin<end){const at=queue[begin++];pixels.push(at);const x=at%w,y=Math.floor(at/w);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(nx<0||nx>=w||ny<0||ny>=h)continue;const k=ny*w+nx;if(!seen[k]&&d[k*4+3]>12){seen[k]=1;queue[end++]=k;}}
    }components.push(pixels);
  }
  const largest=Math.max(...components.map(x=>x.length));
  for(const list of components)if(list.length<largest*.018)for(const p of list)d[p*4+3]=0;
  c.putImageData(data,0,0);
}
// Flood only near-white background connected to an outer edge. Interior white
// eyes/shirt/highlights are preserved. Original JPEGs are never overwritten.
function originalHead(img,bottom,factory){
  const c=factory(img.width,Math.round(img.height*bottom)),ctx=c.getContext('2d');ctx.drawImage(img,0,0);
  const data=ctx.getImageData(0,0,c.width,c.height),d=data.data,w=c.width,h=c.height;
  const visited=new Uint8Array(w*h),q=new Int32Array(w*h);let read=0,end=0;
  const push=(p)=>{if(p<0||p>=w*h||visited[p])return;visited[p]=1;const k=p*4;const lo=Math.min(d[k],d[k+1],d[k+2]),hi=Math.max(d[k],d[k+1],d[k+2]);if(lo>232&&hi-lo<20)q[end++]=p;};
  for(let x=0;x<w;x++){push(x);push((h-1)*w+x);}for(let y=0;y<h;y++){push(y*w);push(y*w+w-1);}
  while(read<end){const p=q[read++];d[p*4+3]=0;const x=p%w;if(x)push(p-1);if(x<w-1)push(p+1);push(p-w);push(p+w);}
  ctx.putImageData(data,0,0);
  // Softly restrict lower shoulder area; facial pixels stay unchanged.
  ctx.globalCompositeOperation='destination-in';ctx.beginPath();
  ctx.moveTo(w*.18,0);ctx.lineTo(w*.82,0);ctx.lineTo(w*.82,h*.60);ctx.lineTo(w*.69,h*.75);ctx.lineTo(w*.62,h*.90);ctx.lineTo(w*.57,h);ctx.lineTo(w*.43,h);ctx.lineTo(w*.38,h*.90);ctx.lineTo(w*.31,h*.75);ctx.lineTo(w*.18,h*.60);ctx.closePath();ctx.fill();
  ctx.globalCompositeOperation='source-over';return trim(c,factory).image;
}
export function prepareArt(images,manifest,factory){
  const symbols=atlasCells(images.symbols,factory),bodies=atlasCells(images.bodies,factory),heads={};
  for(const id of manifest.originals)heads[id]=originalHead(images[id],manifest.faceCropBottom[id],factory);
  const anchors=manifest.bodyAtlas.neckAnchors.map((p,i)=>({x:p[0]*bodies[i].size[0]-bodies[i].offset[0],y:p[1]*bodies[i].size[1]-bodies[i].offset[1]}));
  return {background:images.background,symbols,bodies,heads,anchors};
}
export class Renderer {
  constructor(canvas,art){this.canvas=canvas;this.c=canvas.getContext('2d');this.art=art;}
  rr(x,y,w,h,r=12){this.c.beginPath();this.c.roundRect(x,y,w,h,r);}
  plate(text,x,y,w=150,h=44,size=25){const c=this.c;const g=c.createLinearGradient(x,y,x,y+h);g.addColorStop(0,'#24423b');g.addColorStop(1,'#0b1916');c.fillStyle=g;this.rr(x,y,w,h,9);c.fill();c.strokeStyle='#bd9651';c.lineWidth=2;c.stroke();c.font=`bold ${size}px "DejaVu Sans", Arial`;c.fillStyle='#f5d99c';c.textAlign='center';c.textBaseline='middle';c.fillText(text,x+w/2,y+h/2);}
  text(s,x,y,size=24,color='#f9e3b6'){const c=this.c;c.font=`bold ${size}px "DejaVu Sans", Arial`;c.fillStyle=color;c.textAlign='center';c.textBaseline='middle';c.fillText(s,x,y);}
  fit(img,x,y,w,h){const s=Math.min(w/img.width,h/img.height);this.c.drawImage(img,x+(w-img.width*s)/2,y+(h-img.height*s)/2,img.width*s,img.height*s);}
  symbol(i,x,y,w,h){this.fit(this.art.symbols[i].image,x,y,w,h);}
  character(id,x,feet,totalHeight,pose=0){
    const c=this.c,b=this.art.bodies[pose],anchor=this.art.anchors[pose],head=this.art.heads[id];
    // Uniform body scale and independent original head layer; never stretch face.
    const bodyH=totalHeight*.66,s=bodyH/b.image.height,bw=b.image.width*s;
    const top=feet-bodyH,headH=totalHeight*.45,headW=head.width/head.height*headH;
    const bodyX=x-anchor.x*s;c.drawImage(b.image,bodyX,top,bw,bodyH);
    const neckY=top+anchor.y*s;c.drawImage(head,x-headW/2,neckY-headH+5,headW,headH);
  }
  path(id,start,end){
    this._paths??={};const key=id+':'+Math.round(start)+':'+Math.round(end);if(this._paths[key])return this._paths[key];
    let seed=(id*9301+49297)%233280;const rnd=()=>(seed=(seed*9301+49297)%233280)/233280;
    const pinsAt=r=>{const xs=[];for(let col=0;col<13;col++){const px=150+col*104+(r%2)*44;if(px<=1450)xs.push(px);}return xs;};
    const pts=[{x:start,y:225}];let x=start;
    for(let r=0;r<8;r++){
      const xs=pinsAt(r);let pin=xs.reduce((a,b)=>Math.abs(b-x)<Math.abs(a-x)?b:a);if(Math.abs(pin-x)>22||r===7)pin=x;
      pts.push({x:pin+(rnd()-.5)*8,y:268+r*43-14});
      // drift toward the target a share at a time, so the last pin is already above the right cell (no late jump)
      const left=Math.max(1,7-r),need=end-pin,jit=(rnd()-.5)*Math.min(90,26*left);
      x=Math.max(120,Math.min(1480,pin+need/left+jit*(left>2?1:0)));
    }
    pts.push({x:x+(end-x)*.6,y:268+8*43+10});pts.push({x:end,y:640});pts.push({x:end,y:715});
    return this._paths[key]=pts;
  }
  frame(state,time){
    const c=this.c;c.save();c.setTransform(this.canvas.width/W,0,0,this.canvas.height/H,0,0);
    c.clearRect(0,0,W,H);c.drawImage(this.art.background,0,0,W,H);
    this.plate('GOLAN CASINO',65,28,270,55,27);
    this.plate(state.mode==='slot'?'המכונה':state.mode==='super'?'סופר בונוס':'בונוס',1240,28,290,55,29);
    const info=state.mode==='slot'?this.slot(state,time):this.bonus(state,time);
    c.restore();return info;
  }
  slot(state,time){
    const c=this.c,x=285,y=170,cw=206,ch=200;
    c.fillStyle='#14352e';this.rr(x-12,y-12,cw*5+24,ch*3+24,20);c.fill();c.strokeStyle='#ac8547';c.lineWidth=4;c.stroke();
    for(let r=0;r<3;r++)for(let col=0;col<5;col++){
      const px=x+cw*col,py=y+ch*r;c.fillStyle='#eadcc0';this.rr(px+3,py+3,cw-6,ch-6,8);c.fill();
      const index=r*5+col;let icon=state.grid[index];
      if(state.spinning)icon=(Math.floor(time*14+col*3)+r)%7;
      c.save();c.beginPath();c.rect(px+6,py+6,cw-12,ch-12);c.clip();
      const offset=state.spinning?Math.sin(time*32+col)*12:0;
      this.symbol(icon,px+25,py+15+offset,cw-50,ch-30);
      if(!state.spinning&&icon===6){this.plate('BONUS',px+35,py+ch-58,cw-70,33,19);const badge=state.badges[index];if(badge)this.plate('×'+badge,px+cw-68,py+10,52,34,20);}
      c.restore();
    }
    // Keep full arms within side margins; originals supply the unchanged heads.
    this.character('avichai',150,880,470,7);this.character('fisher',1450,880,470,7);
    this.plate(state.betLabel||'',580,820,300,48,23);this.plate(state.msg||'',910,820,220,48,23);
  }
  bonus(state,time){
    const c=this.c,slots=slotsFor(state.mode),left=105,right=1495,cell=(right-left)/slots.length;
    const elapsed=Math.max(0,time-state.startedAt),events=state.outcome.events;
    const releases=events.map((_,i)=>state.mode==='super'?1.4+i*.9:1.4+i*10.0);
    const duration=state.mode==='super'?6.2:9;const settled=[];const flying=[];
    for(let i=0;i<events.length;i++){
      const age=elapsed-releases[i];if(age>=duration)settled.push(events[i]);else if(age>=0)flying.push({event:events[i],progress:age/duration,i});
    }
    const last=settled.at(-1),scale=last?.scale??state.outcome.entry,total=last?.total??0;
    const released=releases.filter(t=>t<=elapsed).length;
    const nextIndex=clamp(released,0,events.length-1),nextRelease=releases[nextIndex];
    const sourceAt=t=>800+Math.sin(t*1.4)*500;
    const performerX=sourceAt(Math.min(elapsed,nextRelease));
    // Thin rail; toilet and seated body remain a single translating assembly.
    c.fillStyle='#b28b46';c.fillRect(100,194,1400,5);c.fillStyle='#384b3d';c.fillRect(100,201,1400,5);
    this.symbol(6,performerX-61,111,122,130);
    this.character(state.mode==='super'?'fisher':'avichai',performerX,207,139,6);
    for(const xx of [performerX-48,performerX+48]){c.fillStyle='#b68c48';c.beginPath();c.arc(xx,210,11,0,Math.PI*2);c.fill();c.fillStyle='#34372a';c.beginPath();c.arc(xx,210,5,0,Math.PI*2);c.fill();}
    for(let row=0;row<8;row++)for(let col=0;col<13;col++){
      const px=150+col*104+(row%2)*44;if(px>1450)continue;const py=268+row*43;
      const g=c.createRadialGradient(px-2,py-2,1,px,py,7);g.addColorStop(0,'#ffdfa0');g.addColorStop(.5,'#bc8f3f');g.addColorStop(1,'#614522');c.fillStyle=g;c.beginPath();c.arc(px,py,7,0,Math.PI*2);c.fill();
    }
    for(let j=0;j<slots.length;j++){
      const s=slots[j],x=left+j*cell;
      const shade=c.createLinearGradient(x,660,x,823);shade.addColorStop(0,'#d1b88a');shade.addColorStop(1,'#f0dfbe');c.fillStyle=shade;c.fillRect(x+4,657,cell-8,165);
      c.strokeStyle='rgba(95,91,65,.2)';c.lineWidth=1;for(let yy=686;yy<820;yy+=34){c.beginPath();c.moveTo(x+4,yy);c.lineTo(x+cell-4,yy);c.stroke();}
      const recent=last?.target===j && elapsed-releases[last.index]-duration<.8;
      this.plate(s.id==='double'?'דאבל':'×'+s.base*scale,x+9,622,cell-18,40,24);
      if(s.id!=='double'){
        const danger=flying.some(f=>f.event.target===j&&f.progress>.55);
        const swing=Math.sin(elapsed*(danger?12:5)+j*1.8),amp=cell*.14;
        const xx=x+cell/2+(recent?0:swing*amp);
        let pose=swing>=0?(Math.floor(elapsed*8)%2):2+(Math.floor(elapsed*8)%2);
        if(recent)pose=5;
        // Each cell clips its own character; full sprite fits inside at extremes.
        c.save();c.beginPath();c.rect(x+6,666,cell-12,156);c.clip();
        this.character(s.id,xx,816,recent?119:127,pose);c.restore();
        if(recent){this.text('+'+last.win,x+cell/2,690,23,'#583e1c');this.symbol(state.mode==='super'?7:5,xx-10,679,20,20);}
      }
      c.fillStyle='#26483e';c.fillRect(x,661,7,166);c.fillStyle='#b08a48';c.fillRect(x,660,7,3);
    }
    c.fillStyle='#26483e';c.fillRect(right-7,661,7,166);
    for(const f of flying){
      // a real pachinko fall: the ball hops pin to pin under gravity, nudged so it ends in the cell the server chose
      const start=sourceAt(releases[f.i]),end=left+(f.event.target+.5)*cell;
      const path=this.path(f.i+(state.mode==='super'?100:0),start,end);
      const n=path.length-1,q=f.progress*n,k=Math.min(n-1,Math.floor(q)),u=q-k,a=path[k],b=path[k+1];
      const lift=k===0?0:(b.y-a.y)<60?26:10;            // a small bounce off each pin, then gravity takes over
      const px=a.x+(b.x-a.x)*u,py=a.y+(b.y-a.y)*u*u*.6+(b.y-a.y)*u*.4-lift*4*u*(1-u);
      const size=state.mode==='super'?19:39;c.save();c.translate(px,py);c.rotate((k+u)*1.3*(b.x>a.x?1:-1));this.symbol(state.mode==='super'?7:5,-size/2,-size/2,size,size);c.restore();
      if(u<.12&&k>0){c.save();c.globalAlpha=.6*(1-u/.12);c.strokeStyle='#ffe3a0';c.lineWidth=2;c.beginPath();c.arc(a.x,a.y+8,12+u*80,0,Math.PI*2);c.stroke();c.restore();}
    }
    this.plate('כניסה ×'+state.outcome.entry,140,842,235,42,22);
    this.plate('זכייה מצטברת ×'+total,580,842,440,42,25);
    this.plate(state.mode==='super'?`נחתו ${settled.length}/20`:last?.isDouble?'דאבל! נפילה נוספת':last?'הבונוס הסתיים':'הכדור בדרך',1130,842,340,42,22);
    return {landed:settled.length,total,done:settled.length===events.length,last};
  }
}
