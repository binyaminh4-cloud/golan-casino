/* Golan Casino · job "נהג מיניבוס": hold to brake, stop inside the yellow box, the friends get on and pay.
   The server opens the shift (route seed) and pays at the end; the client only reports what happened. */
const $ = (id) => document.getElementById(id);
const fmt = (n) => { n = Math.round(Number(n) || 0); const a = Math.abs(n); return a >= 1e9 ? "₪" + +(n / 1e9).toFixed(2) + "B" : a >= 1e6 ? "₪" + +(n / 1e6).toFixed(2) + "M" : a >= 1e3 ? "₪" + +(n / 1e3).toFixed(1) + "K" : "₪" + n; };
const PREVIEW = /[?#&]preview/.test(location.href);
const LEVEL = Math.min(4, Math.max(1, +(new URLSearchParams(location.search).get("l")) || 1));
const db = PREVIEW ? null : supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);

// ---------- tuning ----------
const CRUISE = [0, 430, 540, 650, 780][LEVEL];          // world px per second
const ZONE = [0, 170, 135, 105, 82][LEVEL];            // length of the yellow box
const OBST = [0, 0.55, 0.75, 0.95, 1][LEVEL];
const EXTREME = LEVEL === 4;                       // extreme: a missed stop ends the shift with nothing         // chance of an obstacle between two stops
const ACC = 320, BRAKE = 950, STOPS = 8;
const LINES = [
  ["עידו", "תעצור ליד הכספומט, יש לי הרגשה שהיום זה היום"],
  ["אביחי", "יש פה מקום לשייקר? זה 40 גרם חלבון, הוא נוסע איתי"],
  ["פישר", "סע לאט, אני מחכה לדקה ה־90 ממילא"],
  ["יואב", "שמרתי לכולם מכפילים, רק לא לך"],
  ["רועי", "אני משלם בצ׳יפים, זה בסדר?"],
  ["אריאל", "נהג! תעצור בקו, זו פקודה"],
  ["בנימין", "מי נתן לך את המפתחות של המיניבוס שלי?!"],
];
const MISS_LINE = "היי! עברת אותי! אני כותב לך ביקורת בגוגל", PERFECT_LINES = ["עצרת כל כך מדויק, שהתחנה התנצלה שהיא לא באמצע", "מדויק ברמה שה־GPS ביקש ממך שיעורים", "אפילו המכונית האוטונומית של טסלה מקנאה עכשיו", "סרגל? לא צריך. יש לנו אותך"];

// ---------- canvas ----------
const cv = $("cv"), cx = cv.getContext("2d");
const W = 720; let H = 1280, scale = 1;
function fit() { const dpr = Math.min(2, devicePixelRatio || 1); scale = innerWidth / W; H = Math.round(innerHeight / scale);
  cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr); cx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0); }
addEventListener("resize", fit); fit();
const IMG = {}; const NAMES = ["road", "minibus", "cow", "sheep", "tractor", "puddle", "stop", "stop_zone", "depot", "coin_pop"];
const loadImg = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
const ready = Promise.all(NAMES.map(async (n) => { IMG[n] = await loadImg(`img/bus/${n}.webp?v=1`); }));

// road geometry (from the road picture): asphalt 34%–66% of the width, we drive in the right lane
const ROAD_L = 244, ROAD_R = 475, LANE_X = 418, BUS_W = 92, BUS_L = 184;
const busY = () => H * 0.7;                       // screen y of the bus centre
const sy = (at) => busY() - (at - G.d);           // world distance → screen y

// ---------- state ----------
let G = null, holding = false, run = null, people = [], me = null;
function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function build(seed) {
  const R = rng(seed), gap = CRUISE * 5.2, stops = [], obs = [];
  for (let i = 0; i < STOPS; i++) {
    const at = 1100 + i * gap + (R() - .5) * gap * .2;
    stops.push({ at, who: null, state: "wait" });
    if (i > 0 && R() < OBST) {
      const t = ["cow", "sheep", "tractor", "puddle"][Math.floor(R() * 4)];
      obs.push({ type: t, at: at - gap * (.45 + R() * .15), x: t === "tractor" ? LANE_X : t === "puddle" ? LANE_X : W + 60, state: "idle", t0: 0 });
    }
  }
  return { stops, obs, end: stops[STOPS - 1].at + gap * .9 };
}

// ---------- input ----------
const down = (e) => { if (e.target.closest && e.target.closest("a,button,.card")) return; holding = true; e.preventDefault && e.preventDefault(); };
const up = () => { holding = false; };
addEventListener("pointerdown", down, { passive: false }); addEventListener("pointerup", up); addEventListener("pointercancel", up);
addEventListener("touchstart", (e) => { if (!e.target.closest("a,button,.card")) e.preventDefault(); }, { passive: false });
addEventListener("contextmenu", (e) => e.preventDefault());

// ---------- bubbles / effects ----------
function bubble(name, text, ms = 1800, left = false) {
  const b = document.createElement("div"); b.className = "bub"; b.innerHTML = `<small>${name}</small>${text}`;
  document.body.appendChild(b); const r = cv.getBoundingClientRect();
  b.style.left = Math.max(8, (W * (left ? .2 : .62)) * scale - b.offsetWidth / 2) + "px"; b.style.top = Math.max(60, (busY() - (left ? 120 : 250)) * scale) + "px";
  if (left) { b.style.background = "#ffe27a"; b.style.maxWidth = "44vw"; }
  setTimeout(() => b.remove(), ms);
}
function flash() { const f = document.createElement("div"); f.className = "flash"; document.body.appendChild(f); setTimeout(() => f.remove(), 600); try { navigator.vibrate && navigator.vibrate(120); } catch (e) {} }
function horn() { try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(), g = a.createGain(); o.type = "square"; o.frequency.value = 330;
  g.gain.value = .06; o.connect(g).connect(a.destination); o.start(); o.frequency.setValueAtTime(260, a.currentTime + .15); o.stop(a.currentTime + .4); } catch (e) {} }
const coins = [];

// ---------- game loop ----------
function hud() { $("hStop").textContent = `${G.ok}/${STOPS}`; $("hEarn").textContent = fmt(earnNow()); }
const earnNow = () => Math.max(0, G.ok * run.rate + Math.floor(G.perfect * run.rate * .3) - Math.floor(G.hits * run.rate * .25));
function pickWho(i) { if (!people.length) return { name: "נוסע", img: null, line: "תודה נהג!" }; return people[i % people.length]; }

function step(dt) {
  const g = G;
  if (g.pause > 0) { g.pause -= dt; if (g.pause <= 0 && g.after) { const f = g.after; g.after = null; f(); } return; }
  if (g.done) return;
  // speed
  if (holding) g.v = Math.max(0, g.v - BRAKE * dt); else g.v = Math.min(CRUISE, g.v + ACC * dt);
  g.d += g.v * dt;
  // stops
  for (const s of g.stops) {
    if (s.state !== "wait") continue;
    const off = g.d - s.at;
    if (g.v < 6 && Math.abs(off) < ZONE / 2) {           // stopped inside the box
      const who = pickWho(g.stops.indexOf(s)), perfect = Math.abs(off) < ZONE * .14;
      s.state = "board"; s.who = who; g.ok++; if (perfect) g.perfect++;
      coins.push({ x: LANE_X + 90, y: s.at, t: 0 });
      try { SFX.fx("bus_brake", { vol: 0.6 }); setTimeout(() => { SFX.fx("bus_door", { vol: 0.7 }); setTimeout(() => SFX.fx("bus_fare", { vol: 0.8 }), 650); }, 350); } catch (e) {}
      bubble(who.name, who.line, 1900);
      if (perfect) setTimeout(() => bubble("⭐ חניה מדויקת!", PERFECT_LINES[Math.floor(Math.random() * PERFECT_LINES.length)], 2300, true), 250);
      g.pause = 1.5; g.after = () => { s.state = "gone"; hud(); };
      hud(); return;
    }
    if (off > ZONE / 2 + 30) { s.state = "missed"; const who = pickWho(g.stops.indexOf(s)); bubble(who.name, MISS_LINE, 1700); try { SFX.error(); } catch (e) {}
      if (EXTREME) { g.done = true; g.out = true; g.ok = 0; g.perfect = 0; flash(); setTimeout(finish, 1400); return; } }
  }
  // obstacles
  for (const o of g.obs) {
    if (o.state === "gone" || o.state === "hit") continue;
    const dist = o.at - g.d;                       // how far ahead of the bus centre
    if (o.state === "idle" && dist < CRUISE * 2.2) { o.state = "move"; o.t0 = g.time; }
    if (o.state === "move") {
      if (o.type === "cow" || o.type === "sheep") { o.x -= (o.type === "cow" ? 95 : 120) * dt; if (o.x < ROAD_L - 160) o.state = "gone"; }
      if (o.type === "tractor") { o.at += CRUISE * .35 * dt; if (g.time - o.t0 > 3.6) { o.x += 140 * dt; if (o.x > ROAD_R + 120) o.state = "gone"; } }
    }
    // collision with the bus (front of the bus reaches the obstacle while it is in our lane)
    const inLane = Math.abs(o.x - LANE_X) < (o.type === "sheep" ? 120 : 95);
    const ahead = o.at - g.d, reach = BUS_L / 2 + (o.type === "tractor" ? 140 : 50);
    if (inLane && ahead < reach && ahead > -BUS_L / 2) {
      if (o.type === "puddle") { if (g.v > CRUISE * .55) { g.hits++; flash(); bubble("שלולית", "ספלאש! הנוסעים רטובים. פחות טיפים", 1400); } o.state = "gone"; hud(); continue; }
      if (g.v > 25) { o.state = "hit"; g.hits++; g.v = 0; flash(); try { SFX.fx("bus_bump", { vol: 0.9 }); SFX.fx(o.type === "cow" ? "bus_moo" : o.type === "sheep" ? "bus_baa" : "bus_horn", { vol: 0.8 }); } catch (e) { horn(); } bubble("אאוץ׳", o.type === "tractor" ? "נכנסת בטרקטור! פחות טיפים" : "בלמת מאוחר! פחות טיפים", 1500); hud(); }
      else if (o.type === "tractor") { g.d = Math.min(g.d, o.at - reach); g.v = Math.min(g.v, CRUISE * .35); }
      else g.v = 0;                                // waiting for the animals to cross
    }
  }
  // end of the route
  if (g.d >= g.end) { g.done = true; finish(); }
  g.time += dt;
}

function draw() {
  const g = G; cx.fillStyle = "#3b3a33"; cx.fillRect(0, 0, W, H);
  const road = IMG.road; if (road) { const th = W * road.height / road.width; let y0 = ((g.d % th) + th) % th - th; for (let y = y0; y < H; y += th) cx.drawImage(road, 0, y, W, th + 1); }
  const img = (n, x, y, w, h, rot = 0) => { const i = IMG[n]; if (!i) return; cx.save(); cx.translate(x, y); if (rot) cx.rotate(rot); cx.drawImage(i, -w / 2, -h / 2, w, h); cx.restore(); };
  // depot
  if (IMG.depot) { const y = sy(g.end + 260); if (y > -500 && y < H + 300) img("depot", W / 2, y, W, W * .65); }
  // stops
  for (const s of g.stops) {
    const y = sy(s.at); if (y < -250 || y > H + 250) continue;
    cx.globalAlpha = s.state === "missed" ? .45 : 1;
    img("stop_zone", LANE_X, y, ZONE + 10, 118, Math.PI / 2);
    img("stop", ROAD_R + 92, y, 190, 190, Math.PI / 2);
    if (s.state === "wait" || s.state === "board") { const p = pickWho(g.stops.indexOf(s)); const px = ROAD_R + (s.state === "board" ? 30 - (1.5 - Math.max(0, g.pause)) * 40 : 100);
      if (p.imgEl) cx.drawImage(p.imgEl, px - 34, y - 70, 68, 68 * p.imgEl.height / p.imgEl.width); else { cx.font = "48px serif"; cx.textAlign = "center"; cx.fillText("🧍", px, y); } }
    cx.globalAlpha = 1;
  }
  // obstacles
  for (const o of g.obs) { if (o.state === "gone") continue; const y = sy(o.at); if (y < -300 || y > H + 300) continue;
    cx.globalAlpha = o.state === "hit" ? .5 : 1;
    if (o.type === "cow") img("cow", o.x, y, 150, 150); else if (o.type === "sheep") img("sheep", o.x, y, 190, 142);
    else if (o.type === "tractor") img("tractor", o.x, y, 104, 156); else img("puddle", o.x, y, 150, 112);
    cx.globalAlpha = 1; }
  // the bus
  const by = busY(); img("minibus", LANE_X, by, BUS_W, BUS_L);
  if (holding && g.v > 0 || g.v < 5) { for (const dx of [-30, 30]) { const gr = cx.createRadialGradient(LANE_X + dx, by + BUS_L / 2 - 6, 2, LANE_X + dx, by + BUS_L / 2 - 6, 26);
    gr.addColorStop(0, "rgba(255,40,40,.95)"); gr.addColorStop(1, "rgba(255,0,0,0)"); cx.fillStyle = gr; cx.fillRect(LANE_X + dx - 30, by + BUS_L / 2 - 36, 60, 60); } }
  // coins
  for (const c of coins) { c.t += 1 / 60; const y = sy(c.y) - c.t * 160; cx.globalAlpha = Math.max(0, 1 - c.t / 1.1); img("coin_pop", c.x, y, 70, 70); cx.globalAlpha = 1; }
  // speedometer
  const sp = g.v / CRUISE; cx.fillStyle = "rgba(0,0,0,.45)"; cx.fillRect(20, H - 150, 14, 110); cx.fillStyle = sp > .8 ? "#3ad16f" : sp > .3 ? "#ffd34d" : "#E5484D"; cx.fillRect(20, H - 40 - 110 * sp, 14, 110 * sp);
}

let last = 0;
function loop(t) { const dt = Math.min(.05, (t - last) / 1000 || 0); last = t; if (G && !G.paused) { step(dt); draw(); } requestAnimationFrame(loop); }

// ---------- server ----------
async function begin() {
  $("startBox").hidden = true; try { SFX.fx("bus_horn", { vol: 0.7 }); stopEngine(); stopEngine = SFX.fx("bus_engine", { vol: 0.18, loop: true }); } catch (e) {}
  if (PREVIEW) run = { id: "p", seed: 12345, stops: STOPS, rate: [0, 70000, 105000, 140000, 1750000][LEVEL] };
  else { const { data, error } = await db.rpc("bus_start", { p_level: LEVEL }); if (error) { alert("לא הצלחנו לפתוח משמרת. נסה שוב."); location.href = "jobs.html"; return; } run = data; }
  G = { d: 0, v: 0, time: 0, ok: 0, perfect: 0, hits: 0, pause: 0, done: false, ...build(run.seed) };
  hud(); setTimeout(() => { $("hint").style.opacity = "0"; }, 6000);
}
let stopEngine = () => {};
async function finish() { try { stopEngine(); } catch (e) {}
  let paid = earnNow(), lvl = null;
  if (!PREVIEW) { const { data, error } = await db.rpc("bus_finish", { p_id: run.id, p_ok: G.ok, p_perfect: G.perfect, p_hits: G.hits });
    if (error) paid = 0; else { paid = data.paid; lvl = data.level; } }
  try { if (paid > 0) SFX.win(paid > run.rate * 8); } catch (e) {}
  const rows = [["נוסעים שעלו", `${G.ok}/${STOPS}`, fmt(G.ok * run.rate)], ["עצירות מושלמות", G.perfect, "+" + fmt(Math.floor(G.perfect * run.rate * .3))], ["פגיעות בדרך", G.hits, "−" + fmt(Math.floor(G.hits * run.rate * .25))]];
  $("sumBox").innerHTML = `<div class="card"><h2>${G.out ? "❌ נפסלת! פספסת תחנה באקסטרים" : "🏁 סוף המשמרת"}</h2>${rows.map(([a, b, c]) => `<div class="row"><span>${a} · ${b}</span><b>${c}</b></div>`).join("")}
    <div class="tot">${fmt(paid)}</div>${lvl ? `<p>רמה ${lvl}</p>` : ""}
    <button class="go" id="againBtn">משמרת נוספת</button><a class="btn ghost" href="jobs.html">חזרה לעבודות</a></div>`;
  $("sumBox").hidden = false; $("againBtn").onclick = () => location.reload();
}

// friends at the bus stops: their own characters from the site
async function loadPeople() {
  if (PREVIEW) { people = LINES.slice(0, 6).map(([n, l]) => ({ name: n, line: l, imgEl: null })); return; }
  const { data: { session } } = await db.auth.getSession(); if (!session) { location.href = "./"; return; }
  me = session.user.id;
  const { data } = await db.from("leaderboard").select("id,nickname,character_key");
  const list = (data || []).filter((m) => m.id !== me && m.character_key);
  const urls = {}; const keys = list.map((m) => m.character_key).filter((k) => !k.startsWith("animal_") && !k.startsWith("pub_"));
  list.forEach((m) => { if (m.character_key.startsWith("animal_")) urls[m.character_key] = "img/animals/" + m.character_key + ".svg"; if (m.character_key.startsWith("pub_")) urls[m.character_key] = "img/chars/" + m.character_key + ".webp"; });
  if (keys.length) { const { data: signed } = await db.storage.from("characters").createSignedUrls(keys.map((k) => k + ".webp"), 3600); (signed || []).forEach((s, i) => { if (s.signedUrl) urls[keys[i]] = s.signedUrl; }); }
  people = await Promise.all(list.map(async (m) => { const L = LINES.find(([n]) => (m.nickname || "").includes(n)); return { name: m.nickname, line: L ? L[1] : "תודה נהג! סע בזהירות", imgEl: urls[m.character_key] ? await loadImg(urls[m.character_key]) : null }; }));
  for (let i = people.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [people[i], people[j]] = [people[j], people[i]]; }
}

(async () => {
  await Promise.all([ready, loadPeople().catch(() => {})]);
  try { GC_LOADER.done(); } catch (e) {}
  G = { d: 0, v: 0, time: 0, ok: 0, perfect: 0, hits: 0, pause: 0, done: true, ...build(1) }; draw();
  $("goBtn").onclick = begin;
  requestAnimationFrame(loop);
})();
