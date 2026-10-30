/* Golan Casino · job "טכנאי סיבים": a messy telecom cabinet. Tap a fiber, then the tray slot of the same colour — the splicer welds it.
   Finish the whole cabinet before the clock runs out = paid. 3 cabinets a shift; the total goes into the bank. */
const $ = (id) => document.getElementById(id);
const fmt = (n) => { n = Math.round(Number(n) || 0); const a = Math.abs(n); return a >= 1e9 ? "₪" + +(n / 1e9).toFixed(2) + "B" : a >= 1e6 ? "₪" + +(n / 1e6).toFixed(2) + "M" : a >= 1e3 ? "₪" + +(n / 1e3).toFixed(0) + "K" : "₪" + n; };
const PREVIEW = /[?#&]preview/.test(location.href);
const LEVEL = Math.min(4, Math.max(1, +(new URLSearchParams(location.search).get("l")) || 1));
const db = PREVIEW ? null : supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);

// ---------- tuning (must match fiber_rate() on the server) ----------
const RATE = [0, 250000, 400000, 550000, 6000000][LEVEL];
const NFIB = [0, 6, 12, 12, 24][LEVEL], SECS = [0, 30, 40, 35, 45][LEVEL];
const TRACE = LEVEL >= 3;          // stripped grey tips: follow the coloured jacket from the cable to the tip
const SHUFFLE_TRAY = LEVEL === 4, STRIPES = LEVEL === 4, CABS = 3, PENALTY = 3;
const COLORS = [["כחול", "#2f6fe0"], ["כתום", "#ff8a1f"], ["ירוק", "#2fb44a"], ["חום", "#8a5a2b"], ["אפור", "#8e98a3"], ["לבן", "#f4f4f4"],
  ["אדום", "#e23b3b"], ["שחור", "#1b1b1b"], ["צהוב", "#ffd21f"], ["סגול", "#8b4fd6"], ["ורוד", "#ff7fb6"], ["תכלת", "#3fd6e6"]];

// ---------- canvas ----------
const cv = $("cv"), cx = cv.getContext("2d"); const W = 720; let H = 1280, scale = 1;
function fit() { const dpr = Math.min(2, devicePixelRatio || 1); scale = innerWidth / W; H = Math.round(innerHeight / scale);
  cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr); cx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0); }
addEventListener("resize", fit); fit();
const IMG = {}; const NAMES = ["cabinet_bg", "cable_left", "glow_ok", "spark", "splice_tray", "splicer", "tangle", "technician"];
const loadImg = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
const ready = Promise.all(NAMES.map(async (n) => { IMG[n] = await loadImg(`img/fiber/${n}.webp?v=1`); }));
const TOP = () => H * .16, BOT = () => H * .74;
const TIP_X = 250, SLOT_X = 560, CABLE = () => ({ x: 120, y: H * .8 });

// ---------- state ----------
let G = null, run = null;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function cabinet() {
  const n = NFIB, kinds = [];
  for (let i = 0; i < n; i++) kinds.push({ c: i % 12, stripe: STRIPES && i >= 12 });
  const tipOrder = shuffle(kinds.map((_, i) => i));
  const slotOrder = SHUFFLE_TRAY ? shuffle(kinds.map((_, i) => i)) : kinds.map((_, i) => i);
  const rowY = (k) => TOP() + (BOT() - TOP()) * (n === 1 ? .5 : k / (n - 1));
  const fibers = kinds.map((f, i) => ({ ...f, tip: { x: TIP_X + (n > 12 ? (tipOrder.indexOf(i) % 2 ? -70 : 50) : (Math.random() - .5) * (TRACE ? 70 : 16)), y: rowY(tipOrder.indexOf(i)) },
    bend: { x: 120 + Math.random() * 260, y: TOP() + Math.random() * (BOT() - TOP()) }, done: false }));
  const slots = slotOrder.map((fi, k) => ({ fi, y: rowY(k), done: false }));
  return { fibers, slots, sel: null, left: SECS, startedAt: G ? G.time : 0 };
}

// ---------- input ----------
addEventListener("pointerdown", (e) => { if (e.target.closest("a,button,.card")) return; e.preventDefault(); tap(e.clientX / scale, e.clientY / scale); }, { passive: false });
addEventListener("touchstart", (e) => { if (!e.target.closest("a,button,.card")) e.preventDefault(); }, { passive: false });
addEventListener("contextmenu", (e) => e.preventDefault());
function tap(x, y) {
  if (!G || G.done || G.pause > 0) return; const c = G.cab, R = Math.max(22, (BOT() - TOP()) / NFIB / 1.6);
  const fi = c.fibers.findIndex((f) => !f.done && Math.hypot(f.tip.x - x, f.tip.y - y) < R + 14);
  if (fi >= 0) { c.sel = fi; try { SFX.button(); } catch (e) {} return; }
  const sk = c.slots.findIndex((s) => !s.done && Math.abs(s.y - y) < R + 6 && Math.abs(SLOT_X - x) < 80);
  if (sk < 0 || c.sel == null) return;
  const s = c.slots[sk], f = c.fibers[c.sel];
  if (s.fi === c.sel || (f.c === c.fibers[s.fi].c && f.stripe === c.fibers[s.fi].stripe)) {      // same colour (and stripe) = right
    const real = c.fibers[s.fi]; if (s.fi !== c.sel) { const t = real.tip; real.tip = f.tip; f.tip = t; }   // identical fibers are interchangeable
    s.done = true; c.fibers[s.fi].done = true; c.fibers[s.fi].slotY = s.y;
    G.fx.push({ img: "spark", x: SLOT_X - 40, y: s.y, t: 0, life: .5, size: 110 }, { img: "glow_ok", x: SLOT_X + 40, y: s.y, t: 0, life: .7, size: 70 });
    try { SFX.chip(); } catch (e) {}
    c.sel = null;
    if (c.slots.every((q) => q.done)) cabinetDone(true);
  } else {
    c.left = Math.max(0, c.left - PENALTY); G.pop.push({ txt: `−${PENALTY} שנ׳`, x: SLOT_X, y: s.y, t: 0 }); c.sel = null;
    try { SFX.error(); navigator.vibrate && navigator.vibrate(80); } catch (e) {}
  }
}
function cabinetDone(ok) {
  G.pause = 2.2; if (ok) { G.ok++; try { SFX.coins(1); } catch (e) {} }
  G.banner = { ok, t: 0 }; hud();
  G.after = () => { G.banner = null; if (G.n >= CABS) end(); else { G.n++; G.cab = cabinet(); hud(); } };
}
function hud() { $("hCab").textContent = `${G.n}/${CABS}`; $("hEarn").textContent = fmt(G.ok * RATE); $("hTime").textContent = Math.ceil(G.cab.left); }

function step(dt) {
  G.time += dt;
  if (G.pause > 0) { G.pause -= dt; if (G.pause <= 0 && G.after) { const f = G.after; G.after = null; f(); } }
  else if (!G.done) { G.cab.left -= dt; if (G.cab.left <= 0) { G.cab.left = 0; cabinetDone(false); } $("hTime").textContent = Math.ceil(G.cab.left); }
  for (const a of [G.fx, G.pop]) for (let i = a.length - 1; i >= 0; i--) { a[i].t += dt; if (a[i].t > (a[i].life || 1)) a.splice(i, 1); }
}
function draw() {
  const bg = IMG.cabinet_bg; if (bg) { const s = Math.max(W / bg.width, H / bg.height), w = bg.width * s, h = bg.height * s; cx.drawImage(bg, (W - w) / 2, (H - h) / 2, w, h); }
  const img = (n, x, y, w, h, a = 1) => { const i = IMG[n]; if (!i) return; cx.save(); cx.globalAlpha = a; cx.drawImage(i, x - w / 2, y - h / 2, w, h); cx.restore(); };
  const c = G.cab, R = Math.max(14, Math.min(26, (BOT() - TOP()) / NFIB / 2.2));
  img("splice_tray", SLOT_X, (TOP() + BOT()) / 2, 150, (BOT() - TOP()) + 90);
  img("cable_left", CABLE().x, CABLE().y + 120, 110, 330);
  img("splicer", W - 130, H * .86, 210, 168);
  // fibers: coloured jacket from the cable, through the mess, to the tip (or to its slot once spliced)
  const col = (f) => COLORS[f.c][1];
  c.fibers.forEach((f, i) => {
    const a = CABLE(), end = f.done ? { x: SLOT_X - 60, y: f.slotY } : f.tip;
    cx.save(); cx.lineCap = "round";
    cx.strokeStyle = "rgba(0,0,0,.45)"; cx.lineWidth = 9; cx.beginPath(); cx.moveTo(a.x, a.y - 30); cx.bezierCurveTo(f.bend.x, f.bend.y, f.bend.x + 60, end.y, end.x, end.y); cx.stroke();
    cx.strokeStyle = col(f); cx.lineWidth = 6; if (c.sel === i) { cx.shadowColor = "#ffe27a"; cx.shadowBlur = 16; }
    cx.beginPath(); cx.moveTo(a.x, a.y - 30); cx.bezierCurveTo(f.bend.x, f.bend.y, f.bend.x + 60, end.y, end.x, end.y); cx.stroke();
    if (f.stripe) { cx.setLineDash([6, 12]); cx.strokeStyle = f.c === 7 ? "#fff" : "#000"; cx.lineWidth = 3; cx.stroke(); cx.setLineDash([]); }
    cx.restore();
    if (!f.done) {   // the tip: coloured, or stripped glass on the hard levels
      cx.beginPath(); cx.arc(end.x, end.y, R, 0, Math.PI * 2); cx.fillStyle = TRACE ? "#cfd6dc" : col(f); cx.fill();
      cx.lineWidth = c.sel === i ? 5 : 2.5; cx.strokeStyle = c.sel === i ? "#ffe27a" : "rgba(0,0,0,.6)"; cx.stroke();
      if (f.stripe && !TRACE) { cx.fillStyle = "#000"; cx.fillRect(end.x - R, end.y - 3, R * 2, 6); }
    }
  });
  // tray slots: the colour each slot wants
  c.slots.forEach((s) => { const f = c.fibers[s.fi];
    cx.beginPath(); cx.roundRect ? cx.roundRect(SLOT_X - 14, s.y - R * .7, 56, R * 1.4, 8) : cx.rect(SLOT_X - 14, s.y - R * .7, 56, R * 1.4);
    cx.fillStyle = s.done ? "#3ad16f" : col(f); cx.fill(); cx.lineWidth = 2; cx.strokeStyle = "rgba(0,0,0,.6)"; cx.stroke();
    if (f.stripe && !s.done) { cx.fillStyle = f.c === 7 ? "#fff" : "#000"; cx.fillRect(SLOT_X - 14, s.y - 3, 56, 6); }
    if (s.done) { cx.fillStyle = "#fff"; cx.font = "800 22px Heebo"; cx.textAlign = "center"; cx.fillText("✔", SLOT_X + 14, s.y + 8); } });
  for (const e of G.fx) img(e.img, e.x, e.y, e.size * (1 + e.t), e.size * (1 + e.t), Math.max(0, 1 - e.t / e.life));
  cx.textAlign = "center";
  for (const p of G.pop) { cx.globalAlpha = Math.max(0, 1 - p.t); cx.font = "800 30px Heebo"; cx.fillStyle = "#ffb3b3"; cx.strokeStyle = "#000"; cx.lineWidth = 4; cx.strokeText(p.txt, p.x, p.y - p.t * 60); cx.fillText(p.txt, p.x, p.y - p.t * 60); cx.globalAlpha = 1; }
  // clock bar
  const fr = c.left / SECS; cx.fillStyle = "rgba(0,0,0,.5)"; cx.fillRect(40, TOP() - 60, W - 80, 16); cx.fillStyle = fr > .5 ? "#3ad16f" : fr > .25 ? "#ffd34d" : "#E5484D"; cx.fillRect(40, TOP() - 60, (W - 80) * fr, 16);
  if (G.banner) { const b = G.banner; cx.fillStyle = "rgba(8,6,4,.75)"; cx.fillRect(0, H * .38, W, 170);
    if (b.ok) img("technician", 130, H * .38 + 85, 160, 160);
    cx.font = "800 44px Heebo"; cx.fillStyle = b.ok ? "#9ff0bf" : "#ffb3b3"; cx.fillText(b.ok ? `ארון מסודר! +${fmt(RATE)}` : "נגמר הזמן ⏱", W / 2 + (b.ok ? 60 : 0), H * .38 + 80);
    cx.font = "600 26px Heebo"; cx.fillStyle = "#f5ecdd"; cx.fillText(G.n < CABS ? "ממשיכים לארון הבא…" : "סוף המשמרת", W / 2 + (b.ok ? 60 : 0), H * .38 + 124); }
}
let last = 0;
function loop(t) { const dt = Math.min(.05, (t - last) / 1000 || 0); last = t; if (G) { step(dt); draw(); } requestAnimationFrame(loop); }

// ---------- server ----------
async function begin() {
  $("startBox").hidden = true; try { SFX.button(); } catch (e) {}
  if (PREVIEW) run = { id: "p" };
  else { const { data, error } = await db.rpc("fiber_start", { p_level: LEVEL }); if (error) { alert("לא הצלחנו לפתוח משמרת. נסה שוב."); location.href = "jobs.html"; return; } run = data; }
  G = { time: 0, n: 1, ok: 0, done: false, pause: 0, fx: [], pop: [], banner: null }; G.cab = cabinet(); hud();
  setTimeout(() => { $("hint").style.opacity = "0"; }, 6000);
}
async function end() {
  G.done = true; let paid = G.ok * RATE, lvl = null;
  if (!PREVIEW) { const { data, error } = await db.rpc("fiber_finish", { p_id: run.id, p_ok: G.ok });
    if (error) paid = -1; else { paid = data.paid; lvl = data.level; } }
  try { if (paid > 0) SFX.win(G.ok === CABS); } catch (e) {}
  $("sumBox").innerHTML = `<div class="card"><h2>${G.ok === CABS ? "🏆 כל הארונות מסודרים!" : "🔌 סוף המשמרת"}</h2>
    <div class="row"><span>ארונות שסודרו בזמן</span><b>${G.ok}/${CABS}</b></div><div class="row"><span>לכל ארון</span><b>${fmt(RATE)}</b></div>
    <div class="tot">${paid < 0 ? "שגיאה" : fmt(paid)}</div><p>${paid < 0 ? "התשלום לא עבר. נסה משמרת נוספת." : paid > 0 ? "נכנס לבנק 🏦" : ""}${lvl ? ` · רמה ${lvl}` : ""}</p>
    <button class="go" id="againBtn">משמרת נוספת</button><a class="btn ghost" href="jobs.html">חזרה לעבודות</a></div>`;
  $("sumBox").hidden = false; $("againBtn").onclick = () => location.reload();
}
(async () => {
  const LV = ["", "6 סיבים, 30 שניות לארון.", "12 סיבים בכל צבעי התקן, 40 שניות.", "12 סיבים — הקצוות קלופים (אפורים): עקוב אחרי הצבע מהכבל עד הקצה. 35 שניות.", "24 סיבים, חצי עם פס שחור, המגש מעורבב. 45 שניות."];
  if (LEVEL === 4) $("stTitle").textContent = "🔥 בלגן בארון · אקסטרים";
  $("stText").innerHTML += `<br><b>${LV[LEVEL]}</b> לכל ארון: ${fmt(RATE)}.`;
  if (!PREVIEW) { const { data: { session } } = await db.auth.getSession(); if (!session) { location.href = "./"; return; } }
  await ready; try { GC_LOADER.done(); } catch (e) {}
  G = { time: 0, n: 1, ok: 0, done: true, pause: 0, fx: [], pop: [], banner: null }; G.cab = cabinet();
  $("goBtn").onclick = begin; requestAnimationFrame(loop);
})();
