/* Golan Casino · sound effects, synthesized in the browser (Web Audio). No audio files to download.
   Phones only allow sound after the first touch, so the engine unlocks on the first tap.
   A 🔊/🔇 button is added to the top bar; the choice is remembered on the device. */
(function () {
  let ctx = null, master = null, muted = false;
  try { muted = localStorage.getItem("gc_mute") === "1"; } catch (e) {}
  function ac() {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
      ctx = new C(); master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ctx.destination); }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  addEventListener("pointerdown", ac, { once: true, capture: true });
  // game pages: a "sit down" tap right after loading wakes the phone's audio, so sounds play on time
  if (!muted && /(roulette|blackjack|slots|poker)\.html/.test(location.pathname) && !/preview/.test(location.href)) {
    document.addEventListener("DOMContentLoaded", () => {
      const o = document.createElement("button"); o.className = "gc-sit"; o.type = "button";
      o.innerHTML = '<span>🎰</span><b>שב לשולחן</b><small>לחיצה אחת והצלילים מוכנים</small>';
      const st = document.createElement("style");
      st.textContent = `.gc-sit{position:fixed;inset:0;z-index:9000;display:grid;place-content:center;justify-items:center;gap:6px;border:0;cursor:pointer;
        background:radial-gradient(circle,rgba(40,30,8,.55),rgba(0,0,0,.82));color:#F1D69A;font-family:Heebo,sans-serif}
        .gc-sit span{font-size:56px}.gc-sit b{font:700 30px 'Frank Ruhl Libre',serif;padding:12px 34px;border:2px solid #C5A05A;border-radius:99px;
        background:linear-gradient(180deg,#F1D69A,#C5A05A);color:#0B0908}.gc-sit small{color:#B9AA94;font-size:14px}@media (orientation:portrait) and (pointer:coarse){.gc-sit{display:none}}`;
      document.head.appendChild(st); document.body.appendChild(o);
      o.addEventListener("click", () => { ac(); o.remove(); });
    });
  }
  const now = () => ctx.currentTime;
  function noiseBuf(sec) {
    const b = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * sec)), ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b;
  }
  function env(g, t, a, peak, dcy) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy); }
  function noise({ t = 0, dur = 0.1, type = "bandpass", f = 2000, q = 1, peak = 0.5, a = 0.002, f2 = null }) {
    if (!ac() || muted) return; const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain(), T = now() + t;
    s.buffer = noiseBuf(dur + a + 0.05); fl.type = type; fl.frequency.setValueAtTime(f, T); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, T + dur); fl.Q.value = q;
    env(g, T, a, peak, dur); s.connect(fl).connect(g).connect(master); s.start(T); s.stop(T + a + dur + 0.05);
  }
  function tone({ t = 0, f = 880, f2 = null, dur = 0.15, type = "sine", peak = 0.3, a = 0.004 }) {
    if (!ac() || muted) return; const o = ctx.createOscillator(), g = ctx.createGain(), T = now() + t;
    o.type = type; o.frequency.setValueAtTime(f, T); if (f2) o.frequency.exponentialRampToValueAtTime(f2, T + dur);
    env(g, T, a, peak, dur); o.connect(g).connect(master); o.start(T); o.stop(T + a + dur + 0.05);
  }
  const S = {
    chip() { noise({ f: 3200, q: 6, dur: 0.05, peak: 0.6 }); noise({ t: 0.035, f: 4200, q: 8, dur: 0.04, peak: 0.35 }); tone({ f: 2400, dur: 0.05, peak: 0.08, type: "triangle" }); },
    card() { noise({ type: "highpass", f: 1800, dur: 0.16, peak: 0.35, a: 0.01, f2: 5000 }); },
    flip() { noise({ f: 2600, q: 3, dur: 0.05, peak: 0.45 }); },
    tick(urgent) { tone({ f: urgent ? 1500 : 1100, dur: 0.04, type: "square", peak: urgent ? 0.12 : 0.07 }); },
    pocket() { noise({ f: 3800, q: 10, dur: 0.03, peak: 0.5 }); tone({ f: 3000, dur: 0.03, type: "triangle", peak: 0.08 }); },
    // the ball rolling on the track, slowing down over `sec` seconds
    roll(sec) {
      if (!ac() || muted) return; const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain(), T = now();
      s.buffer = noiseBuf(sec + 0.2); fl.type = "bandpass"; fl.Q.value = 2; fl.frequency.setValueAtTime(1400, T); fl.frequency.exponentialRampToValueAtTime(500, T + sec);
      lfo.frequency.setValueAtTime(14, T); lfo.frequency.exponentialRampToValueAtTime(3, T + sec); lg.gain.value = 0.08; lfo.connect(lg).connect(g.gain);
      g.gain.setValueAtTime(0.0001, T); g.gain.exponentialRampToValueAtTime(0.16, T + 0.3); g.gain.setValueAtTime(0.16, T + sec * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, T + sec);
      s.connect(fl).connect(g).connect(master); s.start(T); lfo.start(T); s.stop(T + sec + 0.1); lfo.stop(T + sec + 0.1);
    },
    zap() { tone({ f: 1800, f2: 120, dur: 0.25, type: "sawtooth", peak: 0.12 }); noise({ type: "highpass", f: 3000, dur: 0.18, peak: 0.4 }); },
    thunder() { noise({ type: "lowpass", f: 900, f2: 90, dur: 1.4, peak: 0.9, a: 0.01 }); noise({ t: 0.05, type: "lowpass", f: 300, dur: 1.8, peak: 0.6, a: 0.05 }); },
    win(big) {
      const notes = big ? [523, 659, 784, 1047, 1319, 1568] : [784, 1047, 1319];
      notes.forEach((f, i) => tone({ t: i * 0.09, f, dur: 0.35, type: "triangle", peak: 0.22 }));
      for (let i = 0; i < (big ? 14 : 6); i++) { noise({ t: 0.15 + i * 0.06, f: 5000 + Math.random() * 2000, q: 12, dur: 0.06, peak: 0.25 }); }
    },
    lose() { tone({ f: 330, f2: 220, dur: 0.45, type: "triangle", peak: 0.12 }); },
    drop() { noise({ type: "lowpass", f: 200, dur: 0.5, peak: 0.9, a: 0.005 }); tone({ f: 55, f2: 40, dur: 0.6, type: "sine", peak: 0.7 }); tone({ t: 0.02, f: 880, f2: 1760, dur: 0.3, type: "sawtooth", peak: 0.08 }); },
    riser(sec = 1) { tone({ f: 200, f2: 1600, dur: sec, type: "sawtooth", peak: 0.06, a: sec * 0.8 }); noise({ type: "highpass", f: 800, f2: 6000, dur: sec, peak: 0.15, a: sec * 0.8 }); },
    get muted() { return muted; },
    setMuted(m) { muted = m; try { localStorage.setItem("gc_mute", m ? "1" : "0"); } catch (e) {} if (master) master.gain.value = m ? 0 : 0.8; },
  };
  window.SFX = S;
  // mute button in the top bar
  document.addEventListener("DOMContentLoaded", () => {
    const bar = document.querySelector(".top") || document.querySelector("#lobbyView header .me"); if (!bar) return;
    const b = document.createElement("button"); b.className = "sfx-btn"; b.type = "button";
    const draw = () => { b.textContent = muted ? "🔇" : "🔊"; b.setAttribute("aria-label", muted ? "הפעל צלילים" : "השתק צלילים"); };
    b.onclick = () => { S.setMuted(!muted); draw(); if (!muted) S.chip(); }; draw(); bar.appendChild(b);
    const st = document.createElement("style"); st.textContent = ".sfx-btn{background:rgba(23,18,15,.9);border:1px solid #80602E;border-radius:99px;width:40px;height:40px;font-size:18px;cursor:pointer;flex:none}"; document.head.appendChild(st);
  });
})();
// A bonus win gets the whole stage: big gold text in the middle of the screen (about 40% of it) for a few seconds.
window.GC_BONUS = function (title, amount, sub) {
  if (!document.getElementById("gcBonusCss")) {
    const c = document.createElement("style"); c.id = "gcBonusCss";
    c.textContent = `.gc-bonus{position:fixed;left:50%;top:50%;z-index:9500;transform:translate(-50%,-50%);width:min(70vw,640px);min-height:40vh;max-height:80vh;display:grid;place-content:center;gap:6px;text-align:center;
  background:radial-gradient(ellipse at 50% 40%,rgba(60,40,10,.96),rgba(11,9,8,.96));border:3px solid #F1D69A;border-radius:24px;box-shadow:0 0 0 9999px rgba(0,0,0,.45),0 0 60px rgba(255,214,110,.7);
  pointer-events:none;direction:rtl;animation:gcbIn .5s cubic-bezier(.2,1.6,.4,1)}
.gc-bonus .t{font:900 clamp(26px,6.5vmin,64px) Heebo,sans-serif;color:#ffe27a;text-shadow:0 0 20px rgba(255,200,80,.8),0 3px 0 #6b4e1e}
.gc-bonus .a{font:900 clamp(40px,13vmin,120px) Inter,Heebo,sans-serif;color:#fff;direction:ltr;text-shadow:0 0 30px rgba(255,226,122,.9),0 4px 0 #8a6420}
.gc-bonus .s{font:600 clamp(14px,3vmin,22px) Heebo,sans-serif;color:#F1D69A}
.gc-bonus.out{animation:gcbOut .5s ease-in forwards}
@keyframes gcbIn{from{transform:translate(-50%,-50%) scale(.3);opacity:0}}@keyframes gcbOut{to{transform:translate(-50%,-50%) scale(1.15);opacity:0}}`;
    document.head.appendChild(c);
  }
  document.querySelectorAll(".gc-bonus").forEach((n) => n.remove());
  const d = document.createElement("div"); d.className = "gc-bonus";
  const e = (s) => String(s).replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[x]));
  d.innerHTML = `<div class="t">${e(title)}</div>${amount != null ? `<div class="a">₪${Number(amount).toLocaleString("en-US")}</div>` : ""}${sub ? `<div class="s">${e(sub)}</div>` : ""}`;
  document.body.appendChild(d);
  try { SFX.win(true); } catch (er) {}
  setTimeout(() => d.classList.add("out"), 3600); setTimeout(() => d.remove(), 4200);
};
// Total bet + bet limit, right next to the wallet. Tap it for the one-line why.
window.GC_LIMIT = function (total, max, bal, fmt) {
  const b = document.getElementById("bal"); if (!b) return;
  let t = document.getElementById("gcLimit");
  if (!t) {
    const c = document.createElement("style");
    c.textContent = `.gc-limit{display:inline-flex;gap:8px;align-items:center;margin-inline-start:10px;padding:3px 10px;border:1px solid #C5A05A;border-radius:99px;background:rgba(11,9,8,.8);font:600 12px Heebo,sans-serif;color:#e8d9b5;white-space:nowrap;cursor:pointer;vertical-align:middle}
.gc-limit b{font:800 13px Inter,sans-serif;color:#ffe27a;direction:ltr;unicode-bidi:isolate}.gc-limit i{font-style:normal;color:#9b8a70}
.gc-limit-tip{position:fixed;z-index:9600;top:52px;left:50%;transform:translateX(-50%);max-width:90vw;background:#17120F;border:1px solid #C5A05A;border-radius:10px;padding:8px 14px;font:500 13px Heebo,sans-serif;color:#F5ECDD;direction:rtl;box-shadow:0 8px 20px rgba(0,0,0,.6)}`;
    document.head.appendChild(c);
    t = document.createElement("span"); t.id = "gcLimit"; t.className = "gc-limit";
    b.parentElement.after(t);
    t.onclick = () => { document.querySelectorAll(".gc-limit-tip").forEach((n) => n.remove()); const d = document.createElement("div"); d.className = "gc-limit-tip";
      d.textContent = t.dataset.why; document.body.appendChild(d); setTimeout(() => d.remove(), 4000); };
  }
  t.innerHTML = `סה״כ הימור <b>${fmt(total)}</b><i>·</i>מקס׳ להימור <b>${fmt(max)}</b>`;
  t.dataset.why = `היתרה שלך ${fmt(bal)}, ולכן ההימור המקסימלי כרגע הוא ${fmt(max)}. כשהיתרה עולה, המקסימום עולה במדרגות.`;
};
// Entering a bonus: a screen that explains it, and the bonus starts only after the player taps "יאללה".
window.GC_BONUS_INTRO = function (title, lines, img) {
  if (!document.getElementById("gcBiCss")) { const c = document.createElement("style"); c.id = "gcBiCss";
    c.textContent = `.gc-bi{position:fixed;inset:0;z-index:9550;display:grid;place-items:center;background:rgba(0,0,0,.85);direction:rtl;animation:gcbiF .25s}
.gc-bi .box{width:min(520px,92vw);max-height:92dvh;overflow:auto;background:radial-gradient(ellipse at 50% 0%,#3a2a10,#120c08);border:2px solid #F1D69A;border-radius:18px;padding:16px 18px;text-align:center;box-shadow:0 0 50px rgba(255,214,110,.45);animation:gcbiP .35s cubic-bezier(.2,1.5,.4,1)}
.gc-bi img{max-height:26dvh;max-width:70%;object-fit:contain;margin-bottom:6px}
.gc-bi h2{margin:0 0 8px;font:900 clamp(22px,5vmin,34px) Heebo,sans-serif;color:#ffe27a;text-shadow:0 0 14px rgba(255,200,80,.7)}
.gc-bi ul{margin:0 0 12px;padding:0;list-style:none;display:grid;gap:6px;text-align:right}.gc-bi li{font:500 15px Heebo,sans-serif;color:#F5ECDD;background:rgba(255,255,255,.05);border-radius:10px;padding:6px 10px}
.gc-bi button{width:100%;height:50px;border:0;border-radius:99px;background:linear-gradient(180deg,#ffe9a8,#C5A05A);color:#120c08;font:900 20px Heebo,sans-serif;cursor:pointer}
@media (max-height:500px){.gc-bi .box{padding:10px 14px}.gc-bi img{max-height:16dvh}.gc-bi h2{font-size:20px;margin-bottom:4px}.gc-bi li{font-size:13px;padding:4px 8px}.gc-bi ul{gap:4px;margin-bottom:8px}.gc-bi button{height:40px;font-size:17px}}
@keyframes gcbiF{from{opacity:0}}@keyframes gcbiP{from{transform:scale(.7);opacity:0}}`; document.head.appendChild(c); }
  return new Promise((done) => {
    const o = document.createElement("div"); o.className = "gc-bi";
    const e = (s) => String(s).replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[x]));
    o.innerHTML = `<div class="box">${img ? `<img src="${e(img)}" alt="">` : ""}<h2>${e(title)}</h2><ul>${lines.map((l) => `<li>${e(l)}</li>`).join("")}</ul><button type="button">יאללה, לבונוס!</button></div>`;
    o.querySelector("button").onclick = () => { o.remove(); done(); };
    document.body.appendChild(o); try { SFX.win(true); } catch (er) {}
  });
};
