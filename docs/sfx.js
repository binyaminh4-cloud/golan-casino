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
  // ---- recorded sounds (ElevenLabs pack in snd/): play the file when it's loaded, otherwise the synth above ----
  const BUF = {}, LOADING = {};
  function load(name) { if (BUF[name] || LOADING[name] || !ac()) return; LOADING[name] = fetch("snd/" + name + ".mp3").then((r) => r.ok ? r.arrayBuffer() : Promise.reject())
    .then((a) => new Promise((ok, no) => ctx.decodeAudioData(a, ok, no))).then((b) => { BUF[name] = b; }).catch(() => {}); }
  function play(name, { vol = 0.9, dur = null, rate = 1 } = {}) { if (!ac() || muted || !BUF[name]) return false;
    const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = BUF[name]; src.playbackRate.value = rate; g.gain.value = vol;
    src.connect(g).connect(master); const T = now(); src.start(T);
    if (dur) { g.gain.setValueAtTime(vol, T + Math.max(0, dur - 0.4)); g.gain.linearRampToValueAtTime(0.0001, T + dur); src.stop(T + dur + 0.05); }
    return true; }
  const SAMPLES = ["chip", "tick", "card_flip", "shuffle", "win_small", "win_medium", "lose", "ball_roll", "ball_drop", "no_more_bets", "notify", "orb_lock", "splash", "reel_spin", "reel_stop", "card_deal", "bonus_trigger", "reel_tension", "error", "whoosh", "button", "win_big", "coins_count", "lightning"];
  addEventListener("pointerdown", () => SAMPLES.forEach(load), { once: true, capture: true });
  const synth = { ...S };
  S.chip = () => play("chip", { vol: 0.8 }) || synth.chip();
  S.tick = (u) => play("tick", { vol: u ? 1 : 0.6, rate: u ? 1.15 : 1 }) || synth.tick(u);
  S.card = () => play("card_deal", { vol: 0.8 }) || synth.card();
  S.cardFlip = () => play("card_flip", { vol: 0.8 }) || synth.flip();
  S.flip = () => play("reel_stop", { vol: 0.55, dur: 0.6 }) || synth.flip();
  S.bonus = () => play("bonus_trigger", { vol: 0.8 }) || synth.riser(1.2);
  S.riser = (sec) => play("reel_tension", { vol: 0.6, dur: sec || 2.5 }) || synth.riser(sec);
  S.error = () => play("error", { vol: 0.6 });
  S.whoosh = () => play("whoosh", { vol: 0.5 });
  S.button = () => play("button", { vol: 0.5 });
  S.win = (big) => play(big ? "win_medium" : "win_small", { vol: big ? 0.8 : 0.7 }) || synth.win(big);
  S.bigWin = () => { S.musicDuck(true); setTimeout(() => S.musicDuck(false), 5200); return play("win_big", { vol: 0.85 }) || synth.win(true); };
  S.coins = (sec) => play("coins_count", { vol: 0.5, dur: sec || 1.5 });
  S.zap = () => play("lightning", { vol: 0.7, dur: 2 }) || synth.zap();
  S.thunder = () => play("lightning", { vol: 0.85 }) || synth.thunder();
  S.lose = () => play("lose", { vol: 0.6, dur: 1.6 }) || synth.lose();
  S.roll = (sec) => play("ball_roll", { vol: 0.7, dur: sec }) || synth.roll(sec);
  S.ballDrop = () => play("ball_drop", { vol: 0.8, dur: 2.2 }) || synth.pocket();
  S.gong = () => play("no_more_bets", { vol: 0.7, dur: 2.5 }) || synth.drop();
  S.notify = () => play("notify", { vol: 0.6 });
  S.orbLock = () => play("orb_lock", { vol: 0.8, dur: 1.8 }) || synth.zap();
  S.splash = () => play("splash", { vol: 0.8, dur: 3 }) || synth.drop();
  S.shuffle = () => play("shuffle", { vol: 0.7 }) || synth.card();
  S.reelSpin = (sec) => play("reel_spin", { vol: 0.45, dur: sec || 1.5 });
  // ---- background music per page (its own on/off, remembered; quieter than the effects) ----
  const PAGE = (location.pathname.split("/").pop() || "index.html") + location.search;
  const MUSIC = /dragons/.test(PAGE) ? "music_dragons" : /wildwest/.test(PAGE) ? "music_wildwest" : /fisher90/.test(PAGE) ? "music_fisher90" : /kinneret/.test(PAGE) ? "music_kinneret" : /pachinko/.test(PAGE) ? "music_pachinko" : /fishing|skin=fish/.test(PAGE) ? "music_fishing" : /protein/.test(PAGE) ? "music_protein"
    : /(roulette|blackjack|poker)/.test(PAGE) ? "music_tables" : /^(index\.html|)$/.test(PAGE.split("?")[0]) ? "music_lobby" : null;
  let musicOn = true, mSrc = null, mGain = null, mName = null; try { musicOn = localStorage.getItem("gc_music") !== "0"; } catch (e) {}
  async function startMusic(name) { name = name || MUSIC; if (!name || !musicOn || muted || !ac()) return; if (mName === name && mSrc) return;
    load(name); await LOADING[name]; if (!BUF[name] || !musicOn || muted) return; stopMusic(); mName = name;
    mSrc = ctx.createBufferSource(); mGain = ctx.createGain(); mSrc.buffer = BUF[name]; mSrc.loop = true;
    mGain.gain.setValueAtTime(0.0001, now()); mGain.gain.linearRampToValueAtTime(0.22, now() + 1.5); mSrc.connect(mGain).connect(master); mSrc.start(); }
  function stopMusic() { if (mSrc) { const s = mSrc, g = mGain; g.gain.linearRampToValueAtTime(0.0001, now() + 0.6); setTimeout(() => { try { s.stop(); } catch (e) {} }, 700); } mSrc = mGain = null; mName = null; }
  S.music = (name) => startMusic(name);                // a page can switch tracks (e.g. a bonus)
  S.musicDuck = (on) => { if (mGain) mGain.gain.linearRampToValueAtTime(on ? 0.06 : 0.22, now() + 0.3); };
  S.setMusic = (on) => { musicOn = on; try { localStorage.setItem("gc_music", on ? "1" : "0"); } catch (e) {} if (on) startMusic(); else stopMusic(); };
  Object.defineProperty(S, "musicOn", { get: () => musicOn });
  addEventListener("pointerdown", () => startMusic(), { once: true, capture: true });
  const baseMute = S.setMuted; S.setMuted = (m) => { baseMute(m); if (m) stopMusic(); else startMusic(); };
  window.SFX = S;
  // mute button in the top bar
  document.addEventListener("DOMContentLoaded", () => {
    const bar = document.querySelector(".top") || document.querySelector("#lobbyView header .me"); if (!bar) return;
    const b = document.createElement("button"); b.className = "sfx-btn"; b.type = "button";
    const draw = () => { b.textContent = muted ? "🔇" : "🔊"; b.setAttribute("aria-label", muted ? "הפעל צלילים" : "השתק צלילים"); };
    b.onclick = () => { S.setMuted(!muted); draw(); if (!muted) S.chip(); }; draw(); bar.appendChild(b);
    if (MUSIC) { const m = document.createElement("button"); m.className = "sfx-btn"; m.type = "button";
      const dm = () => { m.textContent = musicOn ? "🎵" : "🎵̸"; m.style.opacity = musicOn ? 1 : .45; m.setAttribute("aria-label", musicOn ? "כבה מוזיקה" : "הפעל מוזיקה"); };
      m.onclick = () => { S.setMusic(!musicOn); dm(); }; dm(); bar.appendChild(m); }
    const st = document.createElement("style"); st.textContent = ".sfx-btn{background:rgba(23,18,15,.9);border:1px solid #80602E;border-radius:99px;width:40px;height:40px;font-size:18px;cursor:pointer;flex:none}"; document.head.appendChild(st);
  });
})();
// A bonus win gets the whole stage: big gold text in the middle of the screen (about 40% of it) for a few seconds.
window.GC_BONUS = function (title, amount, sub) {
  try { SFX.bigWin(); } catch (e) {}
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
window.GC_BI_CSS = function () {
  if (!document.getElementById("gcBiCss")) { const c = document.createElement("style"); c.id = "gcBiCss";
    c.textContent = `.gc-bi{position:fixed;inset:0;z-index:9550;display:grid;place-items:center;background:rgba(0,0,0,.85);direction:rtl;animation:gcbiF .25s}
.gc-bi .box{width:min(520px,92vw);max-height:92dvh;overflow:auto;background:radial-gradient(ellipse at 50% 0%,#3a2a10,#120c08);border:2px solid #F1D69A;border-radius:18px;padding:16px 18px;text-align:center;box-shadow:0 0 50px rgba(255,214,110,.45);animation:gcbiP .35s cubic-bezier(.2,1.5,.4,1)}
.gc-bi img{max-height:26dvh;max-width:70%;object-fit:contain;margin-bottom:6px}
.gc-bi h2{margin:0 0 8px;font:900 clamp(22px,5vmin,34px) Heebo,sans-serif;color:#ffe27a;text-shadow:0 0 14px rgba(255,200,80,.7)}
.gc-bi ul{margin:0 0 12px;padding:0;list-style:none;display:grid;gap:6px;text-align:right}.gc-bi li{font:500 15px Heebo,sans-serif;color:#F5ECDD;background:rgba(255,255,255,.05);border-radius:10px;padding:6px 10px}
.gc-bi button{width:100%;height:50px;border:0;border-radius:99px;background:linear-gradient(180deg,#ffe9a8,#C5A05A);color:#120c08;font:900 20px Heebo,sans-serif;cursor:pointer}
@media (max-height:500px){.gc-bi .box{padding:10px 14px}.gc-bi img{max-height:16dvh}.gc-bi h2{font-size:20px;margin-bottom:4px}.gc-bi li{font-size:13px;padding:4px 8px}.gc-bi ul{gap:4px;margin-bottom:8px}.gc-bi button{height:40px;font-size:17px}}
@keyframes gcbiF{from{opacity:0}}@keyframes gcbiP{from{transform:scale(.7);opacity:0}}`; document.head.appendChild(c); }
};
window.GC_BONUS_INTRO = function (title, lines, img, btn) {
  GC_BI_CSS();
  return new Promise((done) => {
    const o = document.createElement("div"); o.className = "gc-bi";
    const e = (s) => String(s).replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[x]));
    o.innerHTML = `<div class="box">${img ? `<img src="${e(img)}" alt="">` : ""}<h2>${e(title)}</h2><ul>${lines.map((l) => `<li>${e(l)}</li>`).join("")}</ul><button type="button">${e(btn || "יאללה, לבונוס!")}</button></div>`;
    o.querySelector("button").onclick = () => { o.remove(); done(); };
    document.body.appendChild(o); try { SFX.win(true); } catch (er) {}
  });
};
// Real chip art (img/chips): an exact denomination uses its printed chip; any other amount sits on the nearest smaller blank chip with the number in code.
(function () {
  const V = [5, 25, 100, 500, ...[1e3, 1e6, 1e9].flatMap((m) => [1, 5, 25, 100, 500].map((c) => c * m)), 1e12, 5e12];
  const lab = (v) => v >= 1e12 ? v / 1e12 + "T" : v >= 1e9 ? v / 1e9 + "B" : v >= 1e6 ? v / 1e6 + "M" : v >= 1e3 ? v / 1e3 + "K" : String(v);
  window.GC_CHIP = function (v) {
    v = Number(v); const exact = V.includes(v), base = V.slice().reverse().find((x) => x <= v) || 5;
    return { exact, url: `img/chips/chip_${exact ? "" : "blank_"}${lab(exact ? v : base)}.webp` };
  };
  // decorate any chip element: el.dataset.v = amount
  window.GC_CHIPIFY = function (el, v) { const c = GC_CHIP(v); el.classList.add("gcchip"); el.classList.toggle("txt", !c.exact); el.style.backgroundImage = `url(${c.url})`; };
  const st = document.createElement("style");
  st.textContent = `.gcchip{background-color:transparent!important;background-size:contain!important;background-position:center!important;background-repeat:no-repeat!important;border:0!important;outline-offset:1px;box-shadow:0 3px 6px rgba(0,0,0,.55)!important;border-radius:50%}
.gcchip:not(.txt){color:transparent!important;text-shadow:none!important}.gcchip:not(.txt) *{opacity:0}
.gcchip.txt{color:#fff!important;text-shadow:0 1px 2px #000,0 0 3px #000!important;font-weight:800}`;
  (document.head || document.documentElement).appendChild(st);
  [5, 25, 100, 500, 1000, 5000, 25000].forEach((v) => { const i = new Image(); i.src = GC_CHIP(v).url; });
})();
// Bonus buy: a menu of the bonuses this machine sells, each with its price for the current bet; resolves to the chosen kind (or null).
window.GC_BUYMENU = function (opts, stake, fmt) {
  GC_BI_CSS();
  return new Promise((done) => {
    const o = document.createElement("div"); o.className = "gc-bi";
    const e = (s) => String(s).replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[x]));
    o.innerHTML = `<div class="box"><h2>🛒 קניית בונוס</h2><ul>${opts.map((p, i) => `<li style="cursor:pointer;display:grid;gap:2px" data-i="${i}"><b style="color:#ffe27a;font-size:17px">${e(p.label)} · ${fmt(stake * p.price)}</b><span>${e(p.desc)}</span><small style="color:#B9AA94">${p.price}× מההימור (${fmt(stake)})</small></li>`).join("")}</ul><button type="button" class="no" style="background:#2a1c10;color:#F1D69A;border:1px solid #C5A05A">ביטול</button></div>`;
    let chosen = null;
    o.querySelectorAll("li").forEach((li) => li.onclick = () => {
      chosen = opts[+li.dataset.i]; const b = o.querySelector(".box");
      b.innerHTML = `<h2>לקנות ${e(chosen.label)}?</h2><ul><li>המחיר: <b>${fmt(stake * chosen.price)}</b> (${chosen.price}× מההימור). הבונוס מתחיל מיד.</li></ul><button type="button" class="yes">כן, קנה</button><button type="button" class="no" style="margin-top:8px;background:#2a1c10;color:#F1D69A;border:1px solid #C5A05A">ביטול</button>`;
      b.querySelector(".yes").onclick = () => { o.remove(); done(chosen.kind); };
      b.querySelector(".no").onclick = () => { o.remove(); done(null); };
    });
    o.querySelector(".no").onclick = () => { o.remove(); done(null); };
    document.body.appendChild(o);
  });
};
// Bet stepper: ▼ ₪100 ▲ in fixed jumps (no typing). Keeps a hidden <input> in sync so game code can read .value.
window.GC_STEPPER = function (host, input, opts = {}) {
  const STEPS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1e6, 2.5e6, 5e6, 1e7, 2.5e7, 5e7, 1e8];
  const f = (n) => n >= 1e6 ? "₪" + n / 1e6 + "M" : n >= 1e3 ? "₪" + n / 1e3 + "K" : "₪" + n;
  if (!document.getElementById("gcStepCss")) { const c = document.createElement("style"); c.id = "gcStepCss";
    c.textContent = `.gc-step{display:inline-flex;align-items:center;gap:4px;direction:ltr}.gc-step button{width:34px;height:34px;border-radius:50%;border:1px solid #C5A05A;background:#1d140c;color:#F1D69A;font:900 14px sans-serif;cursor:pointer;padding:0}
.gc-step button:disabled{opacity:.35}.gc-step b{min-width:74px;text-align:center;font:800 17px Inter,Heebo,sans-serif;color:#ffe27a;background:#0b0806;border:1px solid #80602E;border-radius:10px;padding:5px 8px}`; document.head.appendChild(c); }
  let i = Math.max(0, STEPS.indexOf(opts.start || 100));
  host.classList.add("gc-step"); host.innerHTML = `<button type="button" aria-label="פחות">▼</button><b></b><button type="button" aria-label="יותר">▲</button>`;
  const [dn, val, up] = host.children, max = () => (opts.max ? opts.max() : Infinity);
  const draw = () => { while (i > 0 && STEPS[i] > max()) i--; input.value = STEPS[i]; val.textContent = f(STEPS[i]); dn.disabled = i === 0; up.disabled = i >= STEPS.length - 1 || STEPS[i + 1] > max(); };
  dn.onclick = () => { if (i > 0) { i--; draw(); try { SFX.chip(); } catch (e) {} } }; up.onclick = () => { if (STEPS[i + 1] <= max()) { i++; draw(); try { SFX.chip(); } catch (e) {} } };
  draw(); return { refresh: draw, set disabled(v) { dn.disabled = up.disabled = v; if (!v) draw(); } };
};
// the same stepped bet limit the server enforces (gc_max_bet): <₪500K → ₪50K, ₪500K → ₪100K, ₪1M → ₪200K, ₪2.5M → ₪500K ...
window.GC_MAXBET = function (bal) { bal = Number(bal) || 0; if (bal < 500000) return 50000; let v = 500000, k = 0;
  for (;;) { const nx = v * (k % 3 === 1 ? 2.5 : 2); if (nx > bal) break; v = nx; k++; } return Math.floor(v / 5); };
// bet ladder for a machine: 1-2.5-5 steps from the machine's minimum up to the player's limit (the limit itself is the last step)
window.GC_LADDER = function (min, bal) { const max = GC_MAXBET(bal), out = []; let p = 1;
  for (; p <= max * 10; p *= 10) for (const m of [1, 2.5, 5]) { const v = m * p; if (v >= min && v <= max && Number.isInteger(v)) out.push(v); }
  if (out[out.length - 1] !== max) out.push(max); return out; };
