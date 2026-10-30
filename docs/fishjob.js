/* Golan Casino · job "דייג": a power bar goes up and down; tap to cast — the bait lands farther the higher the bar.
   Landing on a fish catches it. The server opens the session and pays the total into the bank at the end. */
const $ = (id) => document.getElementById(id);
const fmt = (n) => { n = Math.round(Number(n) || 0); const a = Math.abs(n); return a >= 1e9 ? "₪" + +(n / 1e9).toFixed(2) + "B" : a >= 1e6 ? "₪" + +(n / 1e6).toFixed(2) + "M" : a >= 1e3 ? "₪" + +(n / 1e3).toFixed(0) + "K" : "₪" + n; };
const PREVIEW = /[?#&]preview/.test(location.href);
const LEVEL = Math.min(4, Math.max(1, +(new URLSearchParams(location.search).get("l")) || 1));
const EXTREME = LEVEL === 4;
const db = PREVIEW ? null : supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);

// ---------- tuning (values must match fish_vals() on the server) ----------
const VAL = [null, [30000, 120000, 600000], [45000, 180000, 900000], [60000, 240000, 1200000], [0, 0, 2500000]][LEVEL];
const SPEED = [0, 1, 1.2, 1.4, 1.5][LEVEL];
const BAR = [0, 0.75, 0.95, 1.15, 1.35][LEVEL];          // power-bar cycles per second
const CASTS = EXTREME ? 10 : 20, NEED_GOLD = 5;
const KINDS = {
  color: { img: ["fish_color", "fish_color2"], w: 130, h: 65, v: [45, 70], val: 0 },
  silver: { img: ["fish_silver"], w: 160, h: 70, v: [120, 160], val: 1 },
  gold: { img: ["fish_gold"], w: 190, h: 82, v: [250, 320], val: 2 },
};

// ---------- canvas ----------
const cv = $("cv"), cx = cv.getContext("2d"); const W = 720; let H = 1280, scale = 1;
function fit() { const dpr = Math.min(2, devicePixelRatio || 1); scale = innerWidth / W; H = Math.round(innerHeight / scale);
  cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr); cx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0); }
addEventListener("resize", fit); fit();
const IMG = {}; const NAMES = ["lake", "fish_color", "fish_color2", "fish_silver", "fish_gold", "bait", "splash", "catch_burst", "fisherman_back", "bucket"];
const loadImg = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
const ready = Promise.all(NAMES.map(async (n) => { IMG[n] = await loadImg(`img/fishjob/${n}.webp?v=1`); }));
const MAN = () => ({ x: W / 2, y: H - 170 });                        // where the fisherman stands (end of the pier)
const NEAR = () => MAN().y - 150, FAR = () => 130;                    // landing range (screen y)
const WATER_TOP = () => 110, WATER_BOT = () => MAN().y - 120;

// ---------- state ----------
let G = null, run = null;
const rnd = (a, b) => a + Math.random() * (b - a);
function spawn(kind, anyX) {
  const k = KINDS[kind], dir = Math.random() < .5 ? 1 : -1;
  return { kind, img: k.img[Math.floor(Math.random() * k.img.length)], w: k.w, h: k.h, dir,
    v: rnd(k.v[0], k.v[1]) * SPEED * (EXTREME ? 1.25 : 1), x: anyX ? rnd(0, W) : (dir > 0 ? -k.w : W + k.w),
    y: rnd(WATER_TOP() + 30, WATER_BOT()), wob: Math.random() * 6 };
}
function newFish() {
  const f = [];
  if (EXTREME) for (let i = 0; i < 4; i++) f.push(spawn("gold", true));
  else { for (let i = 0; i < 7; i++) f.push(spawn("color", true)); for (let i = 0; i < 3; i++) f.push(spawn("silver", true)); f.push(spawn("gold", true)); }
  return f;
}
function refill(f, kind) {          // a fish that left or was caught comes back as a new one (gold only sometimes, outside extreme)
  if (EXTREME) return spawn("gold");
  const r = Math.random(); return spawn(r < .1 ? "gold" : r < .35 ? "silver" : kind === "gold" ? "color" : kind);
}

// ---------- input ----------
addEventListener("pointerdown", (e) => { if (e.target.closest("a,button,.card")) return; e.preventDefault(); cast(); }, { passive: false });
addEventListener("touchstart", (e) => { if (!e.target.closest("a,button,.card")) e.preventDefault(); }, { passive: false });
addEventListener("contextmenu", (e) => e.preventDefault());
$("leaveBtn").onclick = () => { if (G && !G.done && !G.shot) end(); };

function cast() {
  if (!G || G.done || G.shot || G.casts >= CASTS) return;
  const p = G.p, ty = NEAR() - p * (NEAR() - FAR());
  // the catch is decided the moment you tap (the fish can't swim away while the bait flies); the flight is only a quick animation
  const tx = W / 2; let best = null;
  for (const f of G.fish) { if (Math.abs(f.x - tx) < f.w * .45 && Math.abs(f.y - ty) < f.h * .55 + 12) { if (!best || KINDS[f.kind].val > KINDS[best.kind].val) best = f; } }
  if (best) best.hooked = true;
  G.shot = { t: 0, dur: .14, p, ty: best ? best.y : ty, tx: best ? best.x : tx, best };
  G.casts++; hud(); try { SFX.button(); } catch (e) {}
}
function land() {
  const s = G.shot; G.shot = null;
  const best = s.best && G.fish.includes(s.best) ? s.best : null;
  G.fx.push({ img: "splash", x: s.tx, y: s.ty, t: 0, life: .6, size: 120 });
  if (best) {
    G.count[best.kind]++; G.fx.push({ img: "catch_burst", x: best.x, y: best.y, t: 0, life: .8, size: 200 });
    G.flying.push({ img: best.img, x: best.x, y: best.y, w: best.w, h: best.h, t: 0 });
    G.fish[G.fish.indexOf(best)] = refill(G.fish, best.kind);
    const v = VAL[KINDS[best.kind].val]; G.pop.push({ txt: "+" + fmt(v), x: best.x, y: best.y, t: 0, gold: best.kind === "gold" });
    try { best.kind === "gold" ? SFX.win(true) : SFX.coins(0.6); } catch (e) {}
  } else { G.pop.push({ txt: "פספוס", x: s.tx, y: s.ty, t: 0, miss: true }); try { SFX.error(); } catch (e) {} }
  hud();
  if (G.casts >= CASTS) setTimeout(end, 1100);
}
const total = () => G.count.color * VAL[0] + G.count.silver * VAL[1] + G.count.gold * VAL[2];
function hud() { $("hCast").textContent = `${G.casts}/${CASTS}`; $("hEarn").textContent = EXTREME ? `${G.count.gold}/${NEED_GOLD} 🐡` : fmt(total()); }

function step(dt) {
  const g = G; g.time += dt;
  if (!g.shot && !g.done) { g.ph += dt * BAR * Math.PI; g.p = (1 - Math.cos(g.ph)) / 2; }
  for (const f of g.fish) { if (f.hooked) continue; f.x += f.dir * f.v * dt; f.wob += dt * 4;
    if ((f.dir > 0 && f.x > W + f.w) || (f.dir < 0 && f.x < -f.w)) g.fish[g.fish.indexOf(f)] = refill(g.fish, f.kind); }
  if (g.shot) { g.shot.t += dt; if (g.shot.t >= g.shot.dur) land(); }
  for (const a of [g.fx, g.pop, g.flying]) for (let i = a.length - 1; i >= 0; i--) { a[i].t += dt; if (a[i].t > (a[i].life || 1.1)) a.splice(i, 1); }
}
function draw() {
  const g = G; const lake = IMG.lake;
  if (lake) { const s = Math.max(W / lake.width, H / lake.height), w = lake.width * s, h = lake.height * s; cx.drawImage(lake, (W - w) / 2, H - h, w, h); } else { cx.fillStyle = "#1d6e7a"; cx.fillRect(0, 0, W, H); }
  const img = (n, x, y, w, h, flip = false, a = 1) => { const i = IMG[n]; if (!i) return; cx.save(); cx.globalAlpha = a; cx.translate(x, y); if (flip) cx.scale(-1, 1); cx.drawImage(i, -w / 2, -h / 2, w, h); cx.restore(); };
  // aim line: where the bait will land with the current power
  if (!g.done) { const ty = NEAR() - g.p * (NEAR() - FAR()); cx.save(); cx.strokeStyle = "rgba(255,255,255,.35)"; cx.setLineDash([8, 10]); cx.lineWidth = 3;
    cx.beginPath(); cx.moveTo(W / 2, MAN().y - 60); cx.lineTo(W / 2, FAR()); cx.stroke(); cx.restore();
    if (!g.shot) { cx.strokeStyle = "rgba(255,226,122,.9)"; cx.lineWidth = 4; cx.beginPath(); cx.arc(W / 2, ty, 26, 0, Math.PI * 2); cx.stroke(); } }
  // fish (shadow + body)
  for (const f of g.fish) { const y = f.y + Math.sin(f.wob) * 3;
    cx.fillStyle = "rgba(0,30,40,.25)"; cx.beginPath(); cx.ellipse(f.x + 8, y + 12, f.w * .42, f.h * .32, 0, 0, Math.PI * 2); cx.fill();
    img(f.img, f.x, y, f.w, f.h, f.dir < 0);
    if (f.kind === "gold") { cx.save(); cx.globalAlpha = .25 + .15 * Math.sin(g.time * 6); cx.fillStyle = "#ffe27a"; cx.beginPath(); cx.ellipse(f.x, y, f.w * .55, f.h * .6, 0, 0, Math.PI * 2); cx.fill(); cx.restore(); } }
  // effects
  for (const e of g.fx) img(e.img, e.x, e.y, e.size * (1 + e.t), e.size * (1 + e.t), false, Math.max(0, 1 - e.t / e.life));
  // caught fish fly to the bucket
  const B = { x: W - 90, y: H - 110 };
  for (const f of g.flying) { const u = Math.min(1, f.t / 1); img(f.img, f.x + (B.x - f.x) * u, f.y + (B.y - f.y) * u - 120 * Math.sin(Math.PI * u), f.w * (1 - u * .6), f.h * (1 - u * .6)); }
  img("bucket", B.x, B.y, 120, 120);
  // fisherman + line + bait in the air
  const m = MAN(); img("fisherman_back", m.x, m.y, 230, 230);
  if (g.shot) { const s = g.shot, u = s.t / s.dur, by = m.y - 90 + (s.ty - (m.y - 90)) * u - 160 * Math.sin(Math.PI * u), bx = m.x + 40 + (s.tx - m.x - 40) * u;
    cx.strokeStyle = "rgba(255,255,255,.7)"; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(m.x + 70, m.y - 110); cx.quadraticCurveTo((m.x + bx) / 2, by - 60, bx, by); cx.stroke();
    img("bait", bx, by, 60, 60); }
  // power bar
  if (!g.done) { const x = 22, y0 = H - 360, h = 260; cx.fillStyle = "rgba(0,0,0,.45)"; cx.fillRect(x, y0, 26, h);
    const gr = cx.createLinearGradient(0, y0 + h, 0, y0); gr.addColorStop(0, "#3ad16f"); gr.addColorStop(.6, "#ffd34d"); gr.addColorStop(1, "#E5484D");
    cx.fillStyle = gr; cx.fillRect(x + 3, y0 + h - h * g.p, 20, h * g.p); cx.strokeStyle = "#F1D69A"; cx.lineWidth = 2; cx.strokeRect(x, y0, 26, h); }
  // floating numbers
  cx.textAlign = "center";
  for (const p of g.pop) { cx.globalAlpha = Math.max(0, 1 - p.t / 1.1); cx.font = `800 ${p.gold ? 44 : 32}px Inter, Heebo`; cx.fillStyle = p.miss ? "#ffb3b3" : p.gold ? "#ffe27a" : "#fff";
    cx.strokeStyle = "rgba(0,0,0,.6)"; cx.lineWidth = 5; cx.strokeText(p.txt, p.x, p.y - p.t * 70); cx.fillText(p.txt, p.x, p.y - p.t * 70); cx.globalAlpha = 1; }
}
let last = 0;
function loop(t) { const dt = Math.min(.05, (t - last) / 1000 || 0); last = t; if (G) { step(dt); draw(); } requestAnimationFrame(loop); }

// ---------- server ----------
async function begin() {
  $("startBox").hidden = true; try { SFX.button(); } catch (e) {}
  if (PREVIEW) run = { id: "p" };
  else { const { data, error } = await db.rpc("fish_start", { p_level: LEVEL }); if (error) { alert("לא הצלחנו לפתוח סשן. נסה שוב."); location.href = "jobs.html"; return; } run = data; }
  G = { time: 0, ph: 0, p: 0, casts: 0, shot: null, done: false, count: { color: 0, silver: 0, gold: 0 }, fish: newFish(), fx: [], pop: [], flying: [] };
  $("leaveBtn").hidden = false; hud(); setTimeout(() => { $("hint").style.opacity = "0"; }, 7000);
}
async function end() {
  if (G.done) return; G.done = true; $("leaveBtn").hidden = true;
  const out = EXTREME && G.count.gold < NEED_GOLD;
  let paid = out ? 0 : total(), lvl = null;
  if (!PREVIEW) { const { data, error } = await db.rpc("fish_finish", { p_id: run.id, p_color: G.count.color, p_silver: G.count.silver, p_gold: G.count.gold, p_casts: G.casts });
    if (error) paid = -1; else { paid = data.paid; lvl = data.level; } }
  try { if (paid > 0) SFX.win(paid >= VAL[2] * 2); } catch (e) {}
  const rows = EXTREME ? [["דגי זהב שנתפסו", `${G.count.gold}/${NEED_GOLD}`, fmt(G.count.gold * VAL[2])]]
    : [["🐟 צבעוניים", G.count.color, fmt(G.count.color * VAL[0])], ["🐠 כסופים", G.count.silver, fmt(G.count.silver * VAL[1])], ["🐡 דגי זהב", G.count.gold, fmt(G.count.gold * VAL[2])]];
  $("sumBox").innerHTML = `<div class="card"><h2>${out ? `❌ צריך ${NEED_GOLD} דגי זהב — נפסלת` : "🪣 סוף הדיג"}</h2>${rows.map(([a, b, c]) => `<div class="row"><span>${a} · ${b}</span><b>${c}</b></div>`).join("")}
    <div class="tot">${paid < 0 ? "שגיאה" : fmt(paid)}</div><p>${paid < 0 ? "התשלום לא עבר. נסה סשן נוסף." : paid > 0 ? "נכנס לבנק 🏦" : ""}${lvl ? ` · רמה ${lvl}` : ""}</p>
    <button class="go" id="againBtn">סשן נוסף</button><a class="btn ghost" href="jobs.html">חזרה לעבודות</a></div>`;
  $("sumBox").hidden = false; $("againBtn").onclick = () => location.reload();
}

(async () => {
  if (EXTREME) { $("stTitle").textContent = "🔥 דייג · אקסטרים"; $("stText").innerHTML = `במים יש רק <b>דגי זהב עם עיני יהלום</b>, והם מהירים. <b>10 הטלות</b> — צריך לתפוס לפחות <b>${NEED_GOLD}</b>, אחרת אין תשלום. כל דג זהב שווה ${fmt(VAL[2])}.`; }
  if (!PREVIEW) { const { data: { session } } = await db.auth.getSession(); if (!session) { location.href = "./"; return; } }
  await ready; try { GC_LOADER.done(); } catch (e) {}
  G = { time: 0, ph: 0, p: 0, casts: 0, shot: null, done: true, count: { color: 0, silver: 0, gold: 0 }, fish: newFish(), fx: [], pop: [], flying: [] };
  $("goBtn").onclick = begin; requestAnimationFrame(loop);
})();
