/* Visual adapter only. All round data and deadlines come from the existing server. */
class IdoFishingOverlay {
  constructor(canvas, {assetBase = './assets/', now = () => Date.now()} = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.now = now;
    this.images = {};
    this.ready = Promise.all(['lake_background','ido_fisherman','carp'].map(name => new Promise((resolve,reject) => {
      const img = new Image(); img.onload = () => { this.images[name] = img; resolve(); };
      img.onerror = () => reject(new Error('Cannot load '+name)); img.src = assetBase+name+'.webp';
    })));
    this.frame = 0; this.run = 0;
  }
  stop() { this.run++; cancelAnimationFrame(this.frame); this.canvas.hidden = true; }
  async play({roundId, bonuses, startAt, endAt}) {
    this.stop(); const run = this.run;
    if (!Array.isArray(bonuses) || !bonuses.length || !Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return;
    if (!bonuses.every(b => Number.isInteger(b.number) && b.number >= 0 && b.number <= 36 && Number.isFinite(b.multiplier) && b.multiplier > 0)) return;
    try { await this.ready; } catch(e) { console.warn('Fishing visuals unavailable',e); return; }
    if (run !== this.run || this.now() >= endAt) return;
    const list = bonuses.map(b => ({...b})); // never modify authoritative payload
    const tick = () => {
      if (run !== this.run) return;
      const t = this.now();
      if (t >= endAt) { this.stop(); return; }
      this.canvas.hidden = t < startAt;
      if (t >= startAt) this.draw(list, (t-startAt)/(endAt-startAt));
      this.frame = requestAnimationFrame(tick);
    }; tick();
  }
  draw(list, progress) {
    const c = this.ctx, W = 1600, H = 900;
    const rect = this.canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1,2);
    const cw = Math.max(1,Math.round(rect.width*dpr)), ch = Math.max(1,Math.round(rect.height*dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {this.canvas.width=cw; this.canvas.height=ch;}
    c.setTransform(1,0,0,1,0,0); c.fillStyle='#101b1c'; c.fillRect(0,0,cw,ch);
    const scale = Math.min(cw/W,ch/H); c.setTransform(scale,0,0,scale,(cw-W*scale)/2,(ch-H*scale)/2);
    c.drawImage(this.images.lake_background,0,0,W,H);
    c.fillStyle='rgba(6,19,23,.19)'; c.fillRect(0,0,W,H);
    // Keep the original face bitmap rigid. No face warping or artificial lip movement.
    c.drawImage(this.images.ido_fisherman,70,170,650,650);
    const q = Math.min(list.length-.00001,Math.max(0,progress)*list.length), idx = Math.floor(q), p = q-idx;
    const catchProgress = Math.max(0,Math.min(1,(p-.12)/.22));   // a quick yank out of the water
    const ease = 1-Math.pow(1-catchProgress,3);
    const fishY = 620-ease*300, fishX = 900;
    const tipX = 1090, tipY = 275-25*Math.sin(p*Math.PI);
    // One continuous rod, with its grip anchored inside Ido's hands.
    c.lineCap='round'; c.strokeStyle='#262b29'; c.lineWidth=10;
    c.beginPath(); c.moveTo(525,552); c.quadraticCurveTo(790,160,tipX,tipY); c.stroke();
    c.strokeStyle='#bda779'; c.lineWidth=3; c.stroke();
    c.fillStyle='#343b38'; c.beginPath(); c.ellipse(548,552,18,25,.4,0,Math.PI*2); c.fill();
    const mouthX = fishX+300, mouthY = fishY+35;
    c.strokeStyle='rgba(240,239,213,.85)'; c.lineWidth=1.5;
    c.beginPath(); c.moveTo(tipX,tipY); c.lineTo(mouthX,catchProgress>0?mouthY:595); c.stroke();
    c.strokeStyle='rgba(230,240,229,.5)'; c.lineWidth=3;
    for(let i=0;i<3;i++) {c.beginPath(); c.ellipse(1170,600,25+i*18+Math.sin(p*15)*5,5+i*4,0,0,Math.PI*2); c.stroke();}
    if(catchProgress>0) {
      c.save(); c.beginPath(); c.rect(800,150,640,455); c.clip();
      c.globalAlpha=Math.min(1,catchProgress*5);
      c.drawImage(this.images.carp,fishX,fishY,320,213); c.restore();
    }
    c.textAlign='center'; c.direction='rtl';
    c.fillStyle='#fff6de'; c.shadowColor='#16221f'; c.shadowBlur=10;
    c.font='bold 40px Arial'; c.fillText('השלל של עידו',1000,120);
    if(p>.38) {
      c.fillStyle='rgba(16,32,30,.91)'; c.fillRect(920,555,320,100);
      c.fillStyle='#f3e4bb'; c.direction='ltr'; c.font='bold 52px Arial';
      c.fillText(list[idx].number+'  |  ×'+list[idx].multiplier,1080,622);
    }
    c.shadowBlur=0;
    const revealed = list.slice(0,idx+(p>.38?1:0));
    c.font='bold 25px Arial'; c.direction='ltr';
    revealed.forEach((b,i) => {
      const x=800+(i-(list.length-1)/2)*Math.min(210,1300/list.length);
      c.fillStyle='rgba(13,30,29,.9)'; c.fillRect(x-90,770,180,62);
      c.fillStyle='#eddfb8'; c.fillText(b.number+' · ×'+b.multiplier,x,810);
    });
  }
}
window.IdoFishingOverlay = IdoFishingOverlay;
