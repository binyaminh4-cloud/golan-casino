/* Golan Casino · job "מאלף אריות אסייתיים לבקנים": drag to move the lion, catch falling gold balls, dodge bombs.
   Pay and difficulty mirror the fisher job. The server opens the session and pays the total into the bank at the end. */
const $ = (id) => document.getElementById(id);
const fmt = (n) => { n = Math.round(Number(n) || 0); const a = Math.abs(n); return a >= 1e9 ? "₪" + +(n / 1e9).toFixed(2) + "B" : a >= 1e6 ? "₪" + +(n / 1e6).toFixed(2) + "M" : a >= 1e3 ? "₪" + +(n / 1e3).toFixed(0) + "K" : "₪" + n; };
const PREVIEW = /[?#&]preview/.test(location.href);
const LEVEL = Math.min(4, Math.max(1, +(new URLSearchParams(location.search).get("l")) || 1));
const EXTREME = LEVEL === 4;
const db = PREVIEW ? null : supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);

// ---------- tuning (values must match fish_vals() on the server) ----------
const VAL = [null, [30000, 120000, 600000], [45000, 180000, 900000], [60000, 240000, 1200000], [0, 0, 2500000]][LEVEL];
const SPEED = [0, 1, 1.2, 1.4, 1.5][LEVEL] * (EXTREME ? 1.25 * 2.5 : 1);
const GAP = [0, 1.25, 1.15, 1.05, 1.0][LEVEL];                      // seconds between falling items
const BOMB = [0, 0.22, 0.28, 0.34, 0.36][LEVEL], SPIKY = [0, 0.04, 0.05, 0.06, 0.07][LEVEL];
const DROPS = EXTREME ? 10 : 20, NEED_RARE = 5, LIVES = EXTREME ? 1 : 3;
const KINDS = {
  plain: { img: "ball_gold", s: 78, val: 0 }, engraved: { img: "ball_engraved", s: 84, val: 1 }, rare: { img: "ball_rare", s: 92, val: 2 },
  bomb: { img: "bomb", s: 92 }, spiky: { img: "bomb_spiky", s: 100 },
};

// ---------- canvas ----------
const cv = $("cv"), cx = cv.getContext("2d"); const W = 720; let H = 1280, scale = 1;
function fit() { const dpr = Math.min(2, devicePixelRatio || 1); scale = innerWidth / W; H = Math.round(innerHeight / scale);
  cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr); cx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0); }
addEventListener("resize", fit); fit();
const IMG = {}; const NAMES = ["arena", "lion", "ball_gold", "ball_engraved", "ball_rare", "bomb", "bomb_spiky"];
const loadImg = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
const ready = Promise.all(NAMES.map(async (n) => { IMG[n] = await loadImg(`img/tamer/${n}.webp?v=1`); }));
const LION_W = 250, LION_H = 264;
const FLOOR = () => H - 70;                                            // lion's feet

// ---------- state ----------
let G = null, run = null;
const rnd = (a, b) => a + Math.random() * (b - a);
function pickKind() {
  const r = Math.random();
  if (r < SPIKY) return "spiky";
  if (r < SPIKY + BOMB) return "bomb";
  if (EXTREME) return "rare";
  const g = Math.random(); return g < .1 ? "rare" : g < .35 ? "engraved" : "plain";
}
function spawn() {
  let kind = pickKind();
  if (kind !== "bomb" && kind !== "spiky") { if (G.dropped >= DROPS) return; G.dropped++; }
  const k = KINDS[kind];
  G.items.push({ kind, x: rnd(70, W - 70), y: 120, s: k.s, v: rnd(330, 400) * SPEED, rot: rnd(0, 6), vr: rnd(-2, 2) });
}

// ---------- input: the lion follows the finger ----------
function aim(e) { if (!G || G.done) return; const r = cv.getBoundingClientRect(); G.target = Math.max(LION_W / 2 - 40, Math.min(W - LION_W / 2 + 40, (e.clientX - r.left) / scale)); }
addEventListener("pointerdown", (e) => { if (e.target.closest("a,button,.card")) return; e.preventDefault(); aim(e); }, { passive: false });
addEventListener("pointermove", (e) => { if (e.buttons || e.pointerType === "touch") aim(e); });
addEventListener("touchstart", (e) => { if (!e.target.closest("a,button,.card")) e.preventDefault(); }, { passive: false });
addEventListener("touchmove", (e) => { if (!e.target.closest("a,button,.card")) e.preventDefault(); }, { passive: false });
addEventListener("contextmenu", (e) => e.preventDefault());
$("leaveBtn").onclick = () => { if (G && !G.done) end(); };

const total = () => G.count.plain * VAL[0] + G.count.engraved * VAL[1] + G.count.rare * VAL[2];
function hud() {
  $("hDrop").textContent = `${G.dropped}/${DROPS}`;
  $("hLife").textContent = "❤".repeat(Math.max(0, LIVES - G.bombs)) + "🖤".repeat(Math.min(LIVES, G.bombs));
  $("hEarn").textContent = EXTREME ? `${G.count.rare}/${NEED_RARE}` : fmt(total());
}
function flash() { const d = document.createElement("div"); d.className = "flash"; document.body.appendChild(d); setTimeout(() => d.remove(), 600); }

function step(dt) {
  const g = G; g.time += dt;
  // lion moves toward the finger
  const dx = g.target - g.x, sp = 1400 * dt;
  g.x += Math.abs(dx) < sp ? dx : Math.sign(dx) * sp; if (Math.abs(dx) > 4) g.face = dx > 0 ? 1 : -1;
  if (!g.done) { g.next -= dt; if (g.next <= 0 && g.dropped < DROPS) { spawn(); g.next = GAP * rnd(.8, 1.2); hud(); } }
  const top = FLOOR() - LION_H * .72;
  for (let i = g.items.length - 1; i >= 0; i--) {
    const it = g.items[i]; it.y += it.v * dt; it.rot += it.vr * dt;
    const hit = !g.done && it.y > top && it.y < top + 70 && Math.abs(it.x - g.x) < LION_W * .42;
    if (hit) {
      g.items.splice(i, 1);
      if (it.kind === "spiky") { g.spiky = 1; flash(); try { SFX.fx("lose", { vol: 0.9 }); } catch (e) {} g.pop.push({ txt: "פסילה", x: it.x, y: it.y, t: 0, miss: true }); hud(); end(); return; }
      if (it.kind === "bomb") { g.bombs++; flash(); try { SFX.fx("error", { vol: 0.8 }); } catch (e) {} g.pop.push({ txt: "💥", x: it.x, y: it.y, t: 0, miss: true }); hud();
        if (g.bombs >= LIVES) { end(); return; } continue; }
      g.count[it.kind]++; const v = VAL[KINDS[it.kind].val];
      g.pop.push({ txt: "+" + fmt(v), x: it.x, y: it.y, t: 0, gold: it.kind === "rare" });
      try { SFX.fx("fish_catch", { vol: 0.8 }); if (it.kind === "rare") SFX.fx("fish_gold", { vol: 0.9 }); } catch (e) {}
      hud(); continue;
    }
    if (it.y > H + 80) g.items.splice(i, 1);
  }
  for (let i = g.pop.length - 1; i >= 0; i--) { g.pop[i].t += dt; if (g.pop[i].t > 1.1) g.pop.splice(i, 1); }
  // all balls have fallen and the stage is clear
  if (!g.done && g.dropped >= DROPS && !g.items.some((i) => i.kind in { plain: 1, engraved: 1, rare: 1 })) end();
}
function draw() {
  const g = G, bg = IMG.arena;
  if (bg) { const s = Math.max(W / bg.width, H / bg.height), w = bg.width * s, h = bg.height * s; cx.drawImage(bg, (W - w) / 2, H - h, w, h); } else { cx.fillStyle = "#3a1a14"; cx.fillRect(0, 0, W, H); }
  for (const it of g.items) { const i = IMG[KINDS[it.kind].img]; if (!i) continue;
    if (it.kind === "rare") { cx.save(); cx.globalAlpha = .3 + .15 * Math.sin(g.time * 6); cx.fillStyle = "#ffe27a"; cx.beginPath(); cx.arc(it.x, it.y, it.s * .65, 0, Math.PI * 2); cx.fill(); cx.restore(); }
    const h = it.s * i.height / i.width; cx.save(); cx.translate(it.x, it.y); if (it.kind === "bomb" || it.kind === "spiky") cx.rotate(Math.sin(it.rot) * .3); cx.drawImage(i, -it.s / 2, -h / 2, it.s, h); cx.restore(); }
  // lion + shadow
  cx.fillStyle = "rgba(0,0,0,.35)"; cx.beginPath(); cx.ellipse(g.x, FLOOR() - 4, LION_W * .42, 16, 0, 0, Math.PI * 2); cx.fill();
  if (IMG.lion) { cx.save(); cx.translate(g.x, FLOOR() - LION_H / 2); if (g.face < 0) cx.scale(-1, 1); cx.drawImage(IMG.lion, -LION_W / 2, -LION_H / 2, LION_W, LION_H); cx.restore(); }
  cx.textAlign = "center";
  for (const p of g.pop) { cx.globalAlpha = Math.max(0, 1 - p.t / 1.1); cx.font = `800 ${p.gold ? 44 : 32}px Inter, Heebo`; cx.fillStyle = p.miss ? "#ffb3b3" : p.gold ? "#ffe27a" : "#fff";
    cx.strokeStyle = "rgba(0,0,0,.6)"; cx.lineWidth = 5; cx.strokeText(p.txt, p.x, p.y - p.t * 70); cx.fillText(p.txt, p.x, p.y - p.t * 70); cx.globalAlpha = 1; }
}
let last = 0;
function loop(t) { const dt = Math.min(.05, (t - last) / 1000 || 0); last = t; if (G) { step(dt); draw(); } requestAnimationFrame(loop); }

// ---------- server ----------
const fresh = (done) => ({ time: 0, x: W / 2, target: W / 2, face: 1, next: 1, dropped: 0, items: [], pop: [], bombs: 0, spiky: 0, done, count: { plain: 0, engraved: 0, rare: 0 } });
async function begin() {
  $("startBox").hidden = true; try { SFX.button(); } catch (e) {}
  if (PREVIEW) run = { id: "p" };
  else { const { data, error } = await db.rpc("tamer_start", { p_level: LEVEL }); if (error) { alert("לא הצלחנו לפתוח סשן. נסה שוב."); location.href = "jobs.html"; return; } run = data; }
  G = fresh(false); $("leaveBtn").hidden = false; hud(); setTimeout(() => { $("hint").style.opacity = "0"; }, 7000);
}
async function end() {
  if (G.done) return; G.done = true; $("leaveBtn").hidden = true;
  const out = G.spiky > 0 || (EXTREME && (G.bombs > 0 || G.count.rare < NEED_RARE));
  let paid = out ? 0 : total(), lvl = null;
  if (!PREVIEW) { const { data, error } = await db.rpc("tamer_finish", { p_id: run.id, p_plain: G.count.plain, p_engraved: G.count.engraved, p_rare: G.count.rare,
      p_drops: G.dropped, p_bombs: G.bombs, p_spiky: G.spiky });
    if (error) paid = -1; else { paid = data.paid; lvl = data.level; } }
  try { if (paid > 0) SFX.win(paid >= VAL[2] * 2); } catch (e) {}
  const title = G.spiky ? "❌ פצצה עם קוצים — נפסלת" : EXTREME && G.bombs > 0 ? "❌ פגיעה בפצצה — נפסלת" : EXTREME && G.count.rare < NEED_RARE ? `❌ צריך ${NEED_RARE} כדורים נדירים — נפסלת` : G.bombs >= LIVES ? "💥 נגמרה הסבלנות" : "🦁 סוף המופע";
  const rows = EXTREME ? [["כדורים נדירים", `${G.count.rare}/${NEED_RARE}`, fmt(G.count.rare * VAL[2])]]
    : [["⚪ כדור זהב", G.count.plain, fmt(G.count.plain * VAL[0])], ["〰️ כדור מחורץ", G.count.engraved, fmt(G.count.engraved * VAL[1])], ["🟠 כדור נדיר", G.count.rare, fmt(G.count.rare * VAL[2])]];
  $("sumBox").innerHTML = `<div class="card"><h2>${title}</h2>${rows.map(([a, b, c]) => `<div class="row"><span>${a} · ${b}</span><b>${c}</b></div>`).join("")}
    <div class="tot">${paid < 0 ? "שגיאה" : fmt(paid)}</div><p>${paid < 0 ? "התשלום לא עבר. נסה סשן נוסף." : paid > 0 ? "נכנס לבנק 🏦" : ""}${lvl ? ` · רמה ${lvl}` : ""}</p>
    <button class="go" id="againBtn">סשן נוסף</button><a class="btn ghost" href="jobs.html">חזרה לעבודות</a></div>`;
  setTimeout(() => { $("sumBox").hidden = false; }, 700); $("againBtn").onclick = () => location.reload();
}

(async () => {
  if (EXTREME) { $("stTitle").textContent = "🔥 מאלף אריות · אקסטרים"; $("stText").innerHTML = `נופלים רק <b>כדורים נדירים</b>, והם מהירים. <b>10 כדורים</b> — צריך לתפוס לפחות <b>${NEED_RARE}</b>, אחרת אין תשלום. כל כדור נדיר שווה ${fmt(VAL[2])}.`;
    $("hDrop").textContent = "0/10"; $("hLife").textContent = "❤"; $("stRules").innerHTML = "באקסטרים, <b>פגיעה בפצצה רגילה או בפצצה עם קוצים פוסלת מיד — ללא תשלום</b>, גם אם כבר נאספו חמישה כדורים נדירים."; }
  if (!PREVIEW) { const { data: { session } } = await db.auth.getSession(); if (!session) { location.href = "./"; return; } }
  await ready; try { GC_LOADER.done(); } catch (e) {}
  G = fresh(true); $("goBtn").onclick = begin; requestAnimationFrame(loop);
})();
