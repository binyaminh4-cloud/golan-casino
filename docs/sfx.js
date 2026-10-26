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
