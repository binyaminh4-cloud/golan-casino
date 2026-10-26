/* Golan Casino · roulette table (betting layout, flow, camera). The wheel itself lives in rl_wheel.js. */
const $ = (id) => document.getElementById(id);
const fmt = (n) => "₪" + Number(n).toLocaleString("en-US");
const PREVIEW = /[?#&]preview/.test(location.href);
const MODE = (new URLSearchParams(location.search).get("mode") || "classic").replace(/[^a-z]/g, "");
const LIT = MODE === "lightning" || MODE === "xxx";
const LIVE = !PREVIEW && !/[?&]private/.test(location.search);   // shared live table (default) vs. private table
const DUEL = LIVE ? new URLSearchParams(location.search).get("duel") : null;   // Zeus's duel: duel chips instead of the wallet
let ZS = null;
let sent = new Map(), liveSt = null, clockOff = 0, animRound = -1, MY_ID = null;
const BASE_STRAIGHT = MODE === "xxx" ? 20 : MODE === "lightning" ? 30 : 36;
let LUCKY = {};
const db = PREVIEW ? null : supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);
const R = RLW;

// ---------- the 157 legal bets (mirror of rl_legal on the server) ----------
const LEGAL = new Map();     // key "a,b,c" -> kind
(function () {
  const add = (nums, kind) => LEGAL.set(nums.slice().sort((a, b) => a - b).join(","), kind);
  const range = (a, b, s = 1) => { const r = []; for (let i = a; i <= b; i += s) r.push(i); return r; };
  range(0, 36).forEach((n) => add([n], "straight"));
  range(1, 35).filter((n) => n % 3).forEach((n) => add([n, n + 1], "split"));
  range(1, 33).forEach((n) => add([n, n + 3], "split"));
  [1, 2, 3].forEach((n) => add([0, n], "split"));
  range(1, 34, 3).forEach((n) => add([n, n + 1, n + 2], "street"));
  add([0, 1, 2], "trio"); add([0, 2, 3], "trio");
  range(1, 32).filter((n) => n % 3).forEach((n) => add([n, n + 1, n + 3, n + 4], "corner"));
  add([0, 1, 2, 3], "first_four");
  range(1, 31, 3).forEach((n) => add(range(n, n + 5), "line"));
  [1, 2, 3].forEach((d) => add(range(d * 12 - 11, d * 12), "dozen"));
  [1, 2, 3].forEach((c) => add(range(1, 36).filter((x) => x % 3 === c % 3), "column"));
  add([...R.RED], "red"); add(range(1, 36).filter((x) => !R.RED.has(x)), "black");
  add(range(2, 36, 2), "even"); add(range(1, 35, 2), "odd"); add(range(1, 18), "low"); add(range(19, 36), "high");
})();
const OUTSIDE = {
  dozen1: { nums: "1,2,3,4,5,6,7,8,9,10,11,12", u: [0, 4], w: [-0.8, 0], label: "1–12" },
  dozen2: { u: [4, 8], w: [-0.8, 0], label: "13–24" }, dozen3: { u: [8, 12], w: [-0.8, 0], label: "25–36" },
  low: { u: [0, 2], w: [-1.6, -0.8], label: "1–18" }, even: { u: [2, 4], w: [-1.6, -0.8], label: "זוגי" },
  red: { u: [4, 6], w: [-1.6, -0.8], label: "◆", cls: "red" }, black: { u: [6, 8], w: [-1.6, -0.8], label: "◆", cls: "black" },
  odd: { u: [8, 10], w: [-1.6, -0.8], label: "אי־זוגי" }, high: { u: [10, 12], w: [-1.6, -0.8], label: "19–36" },
  col1: { u: [12, 13], w: [0, 1], label: "2:1" }, col2: { u: [12, 13], w: [1, 2], label: "2:1" }, col3: { u: [12, 13], w: [2, 3], label: "2:1" },
};
const keyOfKind = (kind, pick) => [...LEGAL].filter(([, k]) => k === kind).map(([key]) => key).find(pick);
OUTSIDE.dozen1.nums = keyOfKind("dozen", (k) => k.startsWith("1,2,"));
OUTSIDE.dozen2.nums = keyOfKind("dozen", (k) => k.startsWith("13,"));
OUTSIDE.dozen3.nums = keyOfKind("dozen", (k) => k.startsWith("25,"));
OUTSIDE.low.nums = keyOfKind("low", () => true); OUTSIDE.high.nums = keyOfKind("high", () => true);
OUTSIDE.even.nums = keyOfKind("even", () => true); OUTSIDE.odd.nums = keyOfKind("odd", () => true);
OUTSIDE.red.nums = keyOfKind("red", () => true); OUTSIDE.black.nums = keyOfKind("black", () => true);
OUTSIDE.col1.nums = keyOfKind("column", (k) => k.startsWith("1,4,"));
OUTSIDE.col2.nums = keyOfKind("column", (k) => k.startsWith("2,5,"));
OUTSIDE.col3.nums = keyOfKind("column", (k) => k.startsWith("3,6,"));

// ---------- layout geometry ----------
// Generic coordinates: u runs along the 12 columns of three (0..12, zero at -1..0, 2:1 boxes at 12..13);
// w runs across (number n sits at w = (n-1)%3 .. +1; outside bets at negative w).
let VERT = false, U = 64;
const cellOf = (n) => ({ c: Math.floor((n - 1) / 3), w0: (n - 1) % 3 });
function toXY(u, w) { return VERT ? { x: (w + 1.6) * U, y: (u + 1) * U } : { x: (u + 1) * U, y: (3 - w) * U }; }
function fromXY(x, y) { return VERT ? { u: y / U - 1, w: x / U - 1.6 } : { u: x / U - 1, w: 3 - y / U }; }
function rect(u0, u1, w0, w1) {
  const a = toXY(u0, w0), b = toXY(u1, w1);
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}
function anchor(key) {
  const nums = key.split(",").map(Number), kind = LEGAL.get(key);
  const o = Object.values(OUTSIDE).find((x) => x.nums === key);
  if (o) return { u: (o.u[0] + o.u[1]) / 2, w: (o.w[0] + o.w[1]) / 2 };
  if (key === "0") return { u: -0.5, w: 1.5 };
  if (kind === "first_four") return { u: 0, w: 0 };
  const nz = nums.filter((n) => n > 0).map(cellOf);
  const mu = nz.reduce((s, c) => s + c.c + 0.5, 0) / nz.length, mw = nz.reduce((s, c) => s + c.w0 + 0.5, 0) / nz.length;
  if (nums.includes(0)) return { u: 0, w: mw };
  if (kind === "street" || kind === "line") return { u: mu, w: 0 };
  return { u: mu, w: mw };
}
// which bet a tap at (u,w) means
function betAt(u, w) {
  if (u >= 12 && u < 13 && w >= 0 && w < 3) return OUTSIDE["col" + (Math.floor(w) + 1)].nums;
  for (const o of Object.values(OUTSIDE)) if (u >= o.u[0] && u < o.u[1] && w >= o.w[0] && w < o.w[1] && o.w[0] < 0) return o.nums;
  if (u < -1 || u >= 12 || w < 0 || w > 3) return null;
  const T = 0.24, U0 = Math.round(u), W0 = Math.round(w);
  const nu = Math.abs(u - U0) < T, nw = Math.abs(w - W0) < T;
  const num = (c, r) => c * 3 + r + 1;                       // column c (0..11), row r (0..2)
  const pick = (arr) => { const k = arr.slice().sort((a, b) => a - b).join(","); return LEGAL.has(k) ? k : null; };
  if (u < 0) { if (u > -T && nw && W0 >= 1 && W0 <= 2) return pick([0, num(0, W0 - 1), num(0, W0)]);
               if (u > -T && W0 === 0 && nw) return "0,1,2,3";
               if (u > -T) return pick([0, num(0, Math.min(2, Math.floor(w)))]);
               return "0"; }
  const c = Math.min(11, Math.floor(u)), r = Math.min(2, Math.floor(w));
  if (nu && nw && U0 >= 0 && U0 <= 12) {
    if (U0 === 0) { if (W0 === 0) return "0,1,2,3"; if (W0 < 3) return pick([0, num(0, W0 - 1), num(0, W0)]); }
    else if (U0 < 12) {
      if (W0 === 0) return pick([...Array(6)].map((_, i) => num(U0 - 1, 0) + i));
      if (W0 < 3) return pick([num(U0 - 1, W0 - 1), num(U0 - 1, W0), num(U0, W0 - 1), num(U0, W0)]);
    }
  }
  if (nu && U0 === 0) return pick([0, num(0, r)]);
  if (nu && U0 > 0 && U0 < 12) return pick([num(U0 - 1, r), num(U0, r)]);
  if (nw && W0 === 0) return pick([num(c, 0), num(c, 1), num(c, 2)]);
  if (nw && W0 > 0 && W0 < 3) return pick([num(c, W0 - 1), num(c, W0)]);
  return String(num(c, r));
}

// ---------- board rendering ----------
const board = $("board");
let bets = new Map(), lastBets = null, history = [], chipVal = 25, busy = false, balance = 0;
const CHIPS = [[1, "c1"], [5, "c5"], [25, "c25"], [100, "c100"], [500, "c500"], [1000, "c1k"], [5000, "c5k"]];
const chipLabel = (v) => v >= 1000 ? v / 1000 + "K" : String(v);
const chipClass = (v) => (CHIPS.slice().reverse().find(([c]) => v >= c) || CHIPS[0])[1];

let zoom = 1, VIEW = "table", NB = 2;
try { localStorage.removeItem("rl_zoom"); } catch (e) {}      // everyone starts from the same default layout
const ANNOUNCED = {
  voisins: { name: "וואזן", fr: "Voisins du zéro", bets: [["0,2,3", 2], ["4,7", 1], ["12,15", 1], ["18,21", 1], ["19,22", 1], ["25,26,28,29", 2], ["32,35", 1]] },
  tiers: { name: "טייר", fr: "Tiers du cylindre", bets: [["5,8", 1], ["10,11", 1], ["13,16", 1], ["23,24", 1], ["27,30", 1], ["33,36", 1]] },
  orphelins: { name: "אורפלן", fr: "Orphelins", bets: [["1", 1], ["6,9", 1], ["14,17", 1], ["17,20", 1], ["31,34", 1]] },
  zero: { name: "זרו", fr: "Jeu zéro", bets: [["0,3", 1], ["12,15", 1], ["26", 1], ["32,35", 1]] },
};
const neighbours = (n) => { const i = R.IDX[n], out = []; for (let d = -NB; d <= NB; d++) out.push(R.ORDER[(i + d + 37) % 37]); return out; };
// racetrack: the 37 numbers in wheel order around a stadium shape
function racePos(k) {
  const Ls = 10 * U, r = 1.75 * U, P = 2 * Ls + 2 * Math.PI * r, x0 = 2 * U, y0 = 0.55 * U;
  const zeroAt = Ls + Math.PI * r / 2;                         // 0 sits at the middle of the right-hand curve
  let s = ((zeroAt + (k * P) / 37) % P + P) % P;
  if (s < Ls) return { x: x0 + s, y: y0 };
  s -= Ls; if (s < Math.PI * r) { const a = s / r; return { x: x0 + Ls + r * Math.sin(a), y: y0 + r - r * Math.cos(a) }; }
  s -= Math.PI * r; if (s < Ls) return { x: x0 + Ls - s, y: y0 + 2 * r };
  s -= Ls; const a = s / r; return { x: x0 - r * Math.sin(a), y: y0 + r + r * Math.cos(a) };
}
function drawBoard() {
  const slot = $("boardScroll").getBoundingClientRect();
  VERT = false;
  const gw = 14, gh = 4.6;
  const fitU = Math.floor(Math.min((slot.width - 28) / gw, (slot.height - 24) / gh));
  U = Math.max(20, Math.min(Math.round(fitU * zoom), 140));
  board.style.width = gw * U + "px"; board.style.height = gh * U + "px";
  board.style.setProperty("--u", U + "px"); board.classList.toggle("race", VIEW === "race");
  $("boardScroll").classList.toggle("zoomed", zoom > 1.01);
  let h = "";
  const cell = (r, cls, label, key, extra = "") =>
    `<div class="cell ${cls}" data-k="${key}" style="left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px" ${extra}><span>${label}</span></div>`;
  if (VIEW === "table") {
    h += cell(rect(-1, 0, 0, 3), "zero green", "0", "0");
    for (let n = 1; n <= 36; n++) { const { c, w0 } = cellOf(n); h += cell(rect(c, c + 1, w0, w0 + 1), "num " + R.color(n), n, String(n), `data-n="${n}"`); }
    for (const [name, o] of Object.entries(OUTSIDE)) h += cell(rect(o.u[0], o.u[1], o.w[0], o.w[1]), "out " + (o.cls || "") + " " + name, o.label, o.nums);
  } else {
    const d = 0.74 * U;
    R.ORDER.forEach((n, k) => { const p = racePos(k);
      h += `<div class="rc ${R.color(n)}" data-n="${n}" style="left:${p.x - d / 2}px;top:${p.y - d / 2}px;width:${d}px;height:${d}px"><span>${n}</span><i class="amt"></i></div>`; });
    const zx = [2.2, 5.0, 7.8, 10.6], zw = 2.6;
    ["tiers", "orphelins", "voisins", "zero"].forEach((z, i) =>
      h += `<button class="zone" data-z="${z}" style="left:${zx[i] * U - 0.2 * U}px;top:${1.35 * U}px;width:${zw * U}px;height:${1.9 * U}px"><b>${ANNOUNCED[z].name}</b><small>${ANNOUNCED[z].fr}</small></button>`);
  }
  h += `<div id="chipLayer" class="chiplayer"></div><img id="dolly" class="dolly" src="img/roulette/marker.webp" alt="" hidden>`;
  board.innerHTML = h;
  for (const [k, m] of Object.entries(LUCKY)) markLucky(k, m, false);
  drawChips();
}
function drawChips(win) {
  const layer = $("chipLayer"); if (!layer) return;
  if (VIEW === "race") {
    layer.innerHTML = "";
    const per = {}; for (const [k, v] of bets) if (!k.includes(",")) per[k] = v;      // straight-up amount on each number
    board.querySelectorAll(".rc").forEach((c) => { const a = per[c.dataset.n]; const i = c.querySelector(".amt"); i.textContent = a ? chipLabel(Math.round(a)) : ""; c.classList.toggle("has", !!a); });
  } else layer.innerHTML = [...bets].map(([k, v]) => {
    const a = anchor(k), p = toXY(a.u, a.w), st = win ? (win.has(k) ? " won" : " lost") : "";
    return `<div class="chip ${chipClass(v)}${st}" style="left:${p.x}px;top:${p.y}px"><b>${chipLabel(v)}</b></div>`;
  }).join("");
  const tot = [...bets.values()].reduce((s, v) => s + v, 0);
  $("total").textContent = fmt(tot);
  $("spinBtn").disabled = busy || tot === 0; $("undoBtn").disabled = busy || !undoStack.length;
  $("clearBtn").disabled = busy || !bets.size; $("dblBtn").disabled = busy || !bets.size;
  $("rebetBtn").disabled = busy || !lastBets || bets.size > 0;
  if (LIVE) { liveButtons(tot); drawPlayers(); }
}
const undoStack = [];
let ERASE = false;                    // eraser: tap a bet on the layout to take it back
function place(key, amt) {
  if (!key || busy) return;
  if (ERASE) { if (!bets.has(key) || (sent.get(key) || 0) > 0) return; undoStack.push(new Map(bets)); bets.delete(key); err(""); drawChips(); SFX.chip(); return; }
  const cur = bets.get(key) || 0;
  if (cur + amt > 50000) return err("מקסימום ₪50,000 על הימור אחד.");
  const tot = [...bets.values()].reduce((s, v) => s + v, 0);
  if (tot + amt > 100000) return err("מקסימום ₪100,000 לסיבוב.");
  if (!PREVIEW && tot + amt > balance) return err("אין מספיק שקלים להימור הזה.");
  undoStack.push(new Map(bets)); bets.set(key, cur + amt); err(""); drawChips(); SFX.chip();
}
function placeMany(list) {             // list of [key, amount]; one undo step
  if (busy || !list.length) return;
  const next = new Map(bets);
  for (const [k, a] of list) { if (!LEGAL.has(k)) return; next.set(k, (next.get(k) || 0) + a); }
  if ([...next.values()].some((v) => v > 50000)) return err("מקסימום ₪50,000 על הימור אחד.");
  const tot = [...next.values()].reduce((s, v) => s + v, 0);
  if (tot > 100000) return err("מקסימום ₪100,000 לסיבוב.");
  if (!PREVIEW && tot > balance) return err("אין מספיק שקלים להימור הזה.");
  undoStack.push(new Map(bets)); bets = next; err(""); drawChips(); SFX.chip();
}
function err(t) { $("err").textContent = t; }

function evPoint(e) { const r = board.getBoundingClientRect(), s = r.width / board.offsetWidth;
  return fromXY((e.clientX - r.left) / s, (e.clientY - r.top) / s); }
board.addEventListener("click", (e) => {
  if (VIEW === "race") {
    const z = e.target.closest(".zone"); if (z) return placeMany(ANNOUNCED[z.dataset.z].bets.map(([k, m]) => [k, m * chipVal]));
    const c = e.target.closest(".rc"); if (c) return placeMany(neighbours(+c.dataset.n).map((n) => [String(n), chipVal]));
    return;
  }
  const p = evPoint(e); place(betAt(p.u, p.w), chipVal);
});
board.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  if (VIEW === "race") {
    const c = e.target.closest(".rc"), z = e.target.closest(".zone");
    const set = new Set(c ? neighbours(+c.dataset.n).map(String) : z ? ANNOUNCED[z.dataset.z].bets.flatMap(([k]) => k.split(",")) : []);
    board.querySelectorAll(".rc").forEach((x) => x.classList.toggle("hl", set.has(x.dataset.n))); return;
  }
  const p = evPoint(e), k = betAt(p.u, p.w), set = new Set(k ? k.split(",") : []);
  board.querySelectorAll(".cell").forEach((c) => c.classList.toggle("hl", c.dataset.n !== undefined ? set.has(c.dataset.n) : c.dataset.k === "0" && set.has("0")));
});
board.addEventListener("pointerleave", () => board.querySelectorAll(".hl").forEach((c) => c.classList.remove("hl")));
function setView(v) { document.body.classList.toggle("race", v === "race"); setTimeout(() => { lastBox = ""; relayout(); }, 60); VIEW = v; $("viewTable").setAttribute("aria-pressed", v === "table"); $("viewRace").setAttribute("aria-pressed", v === "race");
  $("nbrBox").hidden = v !== "race"; drawBoard(); }
$("viewTable").onclick = () => setView("table"); $("viewRace").onclick = () => setView("race");
$("nMinus").onclick = () => { NB = Math.max(0, NB - 1); $("nVal").textContent = NB; };
$("nPlus").onclick = () => { NB = Math.min(4, NB + 1); $("nVal").textContent = NB; };
function setZoom(z) { zoom = Math.max(0.7, Math.min(2, Math.round(z * 10) / 10)); drawBoard(); layoutWheel(); }
$("zIn").onclick = () => setZoom(zoom + 0.15); $("zOut").onclick = () => setZoom(zoom - 0.15);

$("chips").innerHTML = CHIPS.map(([v, c]) => `<button class="chip ${c}" data-v="${v}" aria-pressed="${v === chipVal}">${chipLabel(v)}</button>`).join("");
$("chips").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; chipVal = +b.dataset.v;
  $("chips").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); };
$("undoBtn").onclick = () => { if (undoStack.length) { bets = undoStack.pop(); drawChips(); } };
$("clearBtn").onclick = () => { undoStack.push(new Map(bets)); bets = new Map(sent); drawChips(); };
$("dblBtn").onclick = () => { const tot = [...bets.values()].reduce((s, v) => s + v, 0);
  if ([...bets.values()].some((v) => v * 2 > 50000) || tot * 2 > 100000) return err("ההכפלה עוברת את מגבלת השולחן.");
  undoStack.push(new Map(bets)); bets = new Map([...bets].map(([k, v]) => [k, v * 2])); drawChips(); };
$("rebetBtn").onclick = () => { if (lastBets) { undoStack.push(new Map(bets)); bets = new Map(lastBets); drawChips(); } };
$("rulesBtn").onclick = () => $("rules").showModal();

// ---------- history & balance ----------
function drawHist() {
  $("hist").innerHTML = history.slice(0, 14).map((n, i) => `<div class="mrow ${R.color(n)}${i ? "" : " last"}"><span class="num">${n}</span></div>`).join("") || '<div class="empty">עוד אין סיבובים</div>';
  const h = history, c = (f) => h.length ? Math.round(100 * h.filter(f).length / h.length) : 0;
  $("pct").innerHTML = h.length ? `<span class="p red">${c((n) => R.color(n) === "red")}%</span><span class="p green">${c((n) => n === 0)}%</span><span class="p black">${c((n) => R.color(n) === "black")}%</span>` : "";
}
function showBal(v) { $("bal").textContent = fmt(v); }

// ---------- wheel + camera ----------
let W, plan = null, t0 = 0, last = performance.now(), cine = false;
const host = $("wheelHost");
function hostSize() { return host.getBoundingClientRect().width || 300; }
function layoutWheel() {
  if (cine) { if (W && W.is3d) { host.style.width = innerWidth + "px"; host.style.height = innerHeight + "px"; } else { const s = Math.min(innerWidth * 0.98, innerHeight * 1.05); host.style.width = host.style.height = s + "px"; } }
  else { const r = $("wheelSlot").getBoundingClientRect(); const s = Math.min(r.width, r.height) - 8; host.style.width = host.style.height = Math.max(120, s) + "px"; }
}
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (x) => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x);
// Camera: the wheel stays still in frame for the whole spin. Only at the end we zoom in on the ball,
// and the last second plays in slow motion (see warp()).
const SLOW_FROM = () => R.T.settle - 1.1, SLOW_TO = () => R.T.settle + 0.3, SLOW = 0.38;
function warp(real) {                 // real seconds since launch -> animation seconds
  const a = SLOW_FROM(), b = SLOW_TO(), span = (b - a) / SLOW;
  if (real < a) return real;
  if (real < a + span) return a + (real - a) * SLOW;
  return b + (real - a - span);
}
function shot(t, ball) {
  const T = R.T, z0 = SLOW_FROM() - 0.2;
  if (t < z0) return { z: 1, tilt: 48, f: 0 };
  if (t < T.settle + 2.4) { const p = ease((t - z0) / (T.settle + 0.4 - z0)); return { z: lerp(1, 3.3, p), tilt: lerp(48, 36, p), f: p }; }
  return { z: 1, tilt: 48, f: 0 };
}
let lastIdleDraw = 0;
function frame(now) {
  if (document.hidden) { last = now; return requestAnimationFrame(frame); }
  if (!plan && !cine && now - lastIdleDraw < 33) return requestAnimationFrame(frame);
  if (!plan && !cine) lastIdleDraw = now;
  if (window.__hold && W) { W.camera(hostSize()); return requestAnimationFrame(frame); }
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (W) {
    if (plan) {
      const t = warp((now - t0) / 1000), s = plan.at(t);
      W.rotor = s.rotor; W.ball = { phi: s.phi, r: s.r, lift: s.lift };
      const b = W.pose(), sh = shot(t, b), k = 1 - Math.pow(0.002, dt);   // smooth camera
      W.cam.z = lerp(W.cam.z, sh.z, k); W.cam.tilt = lerp(W.cam.tilt, sh.tilt, k);
      W.cam.fx = lerp(W.cam.fx, lerp(600, b.x, sh.f), k); W.cam.fy = lerp(W.cam.fy, lerp(600, b.y, sh.f), k);
      if (t > R.T.hit && t < R.T.settle && lastLift <= prevLift && lastLift <= s.lift && lastLift < 0.2 && t - lastTick > 0.12) { SFX.pocket(); lastTick = t; }
      prevLift = lastLift; lastLift = s.lift;
      onTime(t);
    } else { W.idle(dt); W.cam.z = lerp(W.cam.z, 1, 0.1); W.cam.tilt = lerp(W.cam.tilt, 48, 0.1);
             W.cam.fx = lerp(W.cam.fx, 600, 0.1); W.cam.fy = lerp(W.cam.fy, 600, 0.1); }
    W.camera(hostSize());
  }
  requestAnimationFrame(frame);
}

// ---------- the spin ----------
let lastLift = 0, prevLift = 0, lastTick = 0; let spinRes = null, marks = {}, ME_URL = null;
function setCine(on) {
  cine = on; const c = $("cine");
  if (on) { c.hidden = false; c.appendChild(host); requestAnimationFrame(() => c.classList.add("on")); drawLuckyList(); }
  else { $("luckyList").hidden = true; c.classList.remove("on"); $("wheelSlot").appendChild(host); setTimeout(() => { if (!cine) c.hidden = true; }, 500); }
  layoutWheel();
}
// lightning: the struck numbers and their multipliers, listed beside the close-up of the wheel
function drawLuckyList() {
  const L = $("luckyList"), e = Object.entries(LUCKY);
  if (!LIT || !e.length) { L.hidden = true; return; }
  const mine = new Set([...bets.keys()].filter((k) => !k.includes(",")));
  e.sort((a, b) => b[1] - a[1]);
  L.innerHTML = '<div class="ll-h">⚡ ברקים</div>' + e.map(([n, m], i) =>
    `<div class="ll-row ${R.color(+n)}${mine.has(n) ? " mine" : ""}" style="animation-delay:${i * 0.12}s"><span class="ll-n num">${n}</span><b class="ll-m num${m >= 1000 ? " mega" : ""}">${m}x</b></div>`).join("");
  L.hidden = false;
}
function onTime(t) {
  const T = R.T;
  if (!marks.nmb && t > T.drop - 1.2) { marks.nmb = 1; $("cineMsg").textContent = "אין עוד הימורים"; $("cineMsg").classList.add("show"); if (!LIVE) noMoreBets(); }
  if (!marks.hide && t > T.hit) { marks.hide = 1; $("cineMsg").classList.remove("show"); }
  if (!marks.res && t > T.settle + 0.5) { marks.res = 1; showResult();
    const hit = $("luckyList").querySelector(`.ll-row .ll-n`) && [...$("luckyList").querySelectorAll(".ll-row")].find((x) => x.querySelector(".ll-n").textContent === String(spinRes.result));
    if (hit) hit.classList.add("hit"); }
  if (!marks.end && t > T.end) { marks.end = 1; finish(); }
}
function showResult() {
  const n = spinRes.result, c = R.color(n), name = { red: "אדום", black: "שחור", green: "ירוק" }[c];
  const net = spinRes.payout - spinRes.total;
  const card = $("resultCard");
  card.className = "result " + c + (spinRes.payout > 0 ? " won" : "");
  const zc = LUCKY[n] && ZEUS.celebrate && [...bets.keys()].includes(String(n));
  card.innerHTML = (zc ? `<img class="rme zc" src="${ZEUS.celebrate}" alt="">` : ME_URL ? `<img class="rme" src="${ME_URL}" alt="">` : "") + `<div class="rn num">${n}</div><div class="rc">${name}${n ? " · " + (n % 2 ? "אי־זוגי" : "זוגי") + " · " + (n <= 18 ? "1–18" : "19–36") : ""}</div>` +
    (LUCKY[n] ? `<div class="rbolt">⚡ ברק ${LUCKY[n]}x</div>` : "") +
    (spinRes.payout > 0 ? `<div class="rw">זכית ${fmt(spinRes.payout)}</div>` : spinRes.total ? `<div class="rl">לא הפעם</div>` : "");
  card.hidden = false;
  if (spinRes.payout > 0) SFX.win(spinRes.payout >= spinRes.total * 10); else if (spinRes.total) SFX.lose();
  if (W.under() !== n) console.error("wheel/result mismatch", W.under(), n);   // never expected; checked by tests
}
function finish() {
  const n = spinRes.result, win = new Set([...bets.keys()].filter((k) => k.split(",").map(Number).includes(n)));
  plan = null; $("resultCard").hidden = true; setCine(false);
  history.unshift(n); drawHist();
  const cellEl = board.querySelector(VIEW === "table" ? `.cell[data-k="${n}"]` : `.rc[data-n="${n}"]`), d = $("dolly");
  if (cellEl) { d.style.left = cellEl.offsetLeft + cellEl.offsetWidth / 2 + "px"; d.style.top = cellEl.offsetTop + cellEl.offsetHeight / 2 + "px"; d.hidden = false;
    cellEl.classList.add("winner"); }
  drawChips(win);
  balance = spinRes.balance; showBal(balance);
  const me = $("me"); me.classList.remove("jump", "sad"); void me.offsetWidth;
  if (!spinRes.total) {} else if (spinRes.payout > 0) { me.classList.add("jump"); const f = document.createElement("div"); f.className = "float num"; f.textContent = "+" + fmt(spinRes.payout); me.appendChild(f); setTimeout(() => f.remove(), 2200); }
  else me.classList.add("sad");
  if (spinRes.payout > 0) err("");
  setTimeout(() => {                         // croupier clears the layout
    if (bets.size) lastBets = new Map(bets); bets.clear(); sent.clear(); undoStack.length = 0; busy = false;
    d.hidden = true; board.querySelectorAll(".winner").forEach((x) => x.classList.remove("winner")); clearLucky(); drawChips();
  }, 2600);
}
function newRef() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2)); }
$("spinBtn").onclick = async () => {
  if (LIVE) return liveConfirm();
  if (busy || !bets.size) return;
  busy = true; drawChips(); err("");
  const payload = [...bets].map(([k, v]) => ({ nums: k.split(",").map(Number), amt: v }));
  let res;
  try {
    if (PREVIEW) {
      const forced = new URLSearchParams(location.search).get("n");
      const n = forced !== null ? +forced : Math.floor(Math.random() * 37);
      const total = payload.reduce((s, b) => s + b.amt, 0);
      const lucky = {}; if (LIT) { const k = 1 + Math.floor(Math.random() * (MODE === "xxx" ? 8 : 5)); while (Object.keys(lucky).length < k) { const x = Math.floor(Math.random() * 37); lucky[x] = MODE === "xxx" && Math.random() < .2 ? [600, 800, 1000, 2000][Math.floor(Math.random() * 4)] : 50 * (1 + Math.floor(Math.random() * 10)); } if (new URLSearchParams(location.search).get("hit")) lucky[n] = +new URLSearchParams(location.search).get("hit"); }
      const payout = payload.filter((b) => b.nums.includes(n)).reduce((s, b) => s + (b.nums.length === 1 && LIT ? b.amt * (lucky[n] ? lucky[n] + 1 : BASE_STRAIGHT) : Math.floor(b.amt * 36 / b.nums.length)), 0);
      balance = (balance || 10000); res = { result: n, total, payout, balance: balance - total + payout, lucky };
    } else {
      const { data, error } = await db.rpc("rl_spin", { p_bets: payload, p_ref: newRef(), p_mode: MODE });
      if (error) throw error; res = data;
    }
  } catch (e) { busy = false; drawChips(); return err(errText(e)); }
  spinRes = res; showBal(res.balance - res.payout);
  if (LIT) await strike(res.lucky || {});
  marks = {}; setCine(true);
  plan = R.plan(res.result, W.rotor); t0 = performance.now(); SFX.roll(R.T.hit + 0.6); lastLift = prevLift = 1; lastTick = 0;
};
// ---------- lightning: strike the lucky numbers on the layout, then spin ----------
// Zeus (the owner's caricature, private bucket) throws a bolt at each lucky number
const ZEUS = {}; const PRE = (src) => { const i = new Image(); i.src = src; return i; };
async function loadZeus() {
  if (!LIT) return;
  const poses = ["idle", "charge", "strike", "celebrate"];
  try {
    poses.forEach((p) => ZEUS[p] = `img/lightning/zeus_${p}.webp`);   // public by the owner's choice
    Object.values(ZEUS).forEach(PRE); ["bolt", "impact"].forEach((n) => PRE(`img/lightning/${n}.webp`));
  } catch (e) {}
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function strike(lucky) {
  LUCKY = lucky; const keys = Object.keys(lucky);
  let z = null;
  if (ZEUS.idle) {
    z = document.createElement("img"); z.className = "zeus"; z.src = ZEUS.idle; z.alt = "זאוס"; document.body.appendChild(z);
    await wait(30); z.classList.add("in"); await wait(550);
  }
  const fl = document.createElement("div"); fl.className = "flash"; document.body.appendChild(fl);
  for (const k of keys) {
    const sel = VIEW === "table" ? `.cell[data-k="${k}"]` : `.rc[data-n="${k}"]`, c = board.querySelector(sel);
    if (z) { z.src = ZEUS.charge || ZEUS.idle; await wait(keys.length > 5 ? 160 : 300); z.src = ZEUS.strike || ZEUS.idle; }
    if (c) {
      const r = c.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const b = document.createElement("div"); b.className = "bolt";
      const top = z ? z.getBoundingClientRect().top + 40 : -20;
      Object.assign(b.style, { left: x + "px", top: top + "px", height: Math.max(40, y - top) + "px" });
      const im = document.createElement("div"); im.className = "impact"; Object.assign(im.style, { left: x + "px", top: y + "px" });
      document.body.append(b, im); setTimeout(() => { b.remove(); im.remove(); }, 650); SFX.zap(); SFX.thunder();
    }
    fl.classList.remove("go"); void fl.offsetWidth; fl.classList.add("go");
    markLucky(k, lucky[k], true);
    await wait(keys.length > 5 ? 260 : 420);
  }
  if (z) { z.src = ZEUS.idle; await wait(500); z.classList.remove("in"); setTimeout(() => z.remove(), 500); }
  await wait(500); fl.remove();
}
function markLucky(k, m, fresh) {
  const sel = VIEW === "table" ? `.cell[data-k="${k}"]` : `.rc[data-n="${k}"]`, c = board.querySelector(sel); if (!c) return;
  c.classList.add("lucky"); if (fresh) { c.classList.remove("zap"); void c.offsetWidth; c.classList.add("zap"); }
  if (!c.querySelector(".mx")) { const b = document.createElement("i"); b.className = "mx" + (m >= 1000 ? " mega" : ""); b.textContent = m + "x"; c.appendChild(b); }
}
function clearLucky() { LUCKY = {}; board.querySelectorAll(".lucky").forEach((c) => { c.classList.remove("lucky", "zap"); c.querySelector(".mx")?.remove(); }); }
function errText(e) {
  const m = (e && e.message) || "";
  if (m.includes("insufficient_funds")) return "אין מספיק שקלים משחקיים. הקטן את ההימור.";
  if (m.includes("table_limit")) return "מקסימום ₪100,000 לסיבוב.";
  if (m.includes("invalid_amount")) return "כל הימור בין ₪1 ל־₪50,000.";
  if (m.includes("not_signed_in")) { location.href = "./"; return ""; }
  console.error("rpc error", e);
  return "משהו השתבש (" + ((e && e.code) || "") + " " + m.slice(0, 80) + "). צלם לי את המסך.";
}


// ---------- live shared table: one wall-clock round every 48s for all three roulettes ----------
const SPIN_AFTER = 6000;                   // ms after betting closes: lightning strikes, then the ball
const srvNow = () => Date.now() + clockOff;
function pendingList() {
  const out = [];
  for (const [k, v] of bets) { const d = v - (sent.get(k) || 0); if (d > 0) out.push({ nums: k.split(",").map(Number), amt: d }); }
  return out;
}
function liveButtons(tot) {
  const open = liveSt && liveSt.open && srvNow() < liveSt.close;
  const pend = pendingList().reduce((s, b) => s + b.amt, 0);
  const sb = $("spinBtn");
  sb.textContent = pend ? "אשר הימור" : sent.size ? "ההימור נקלט ✓" : "אשר הימור";
  const duelOff = DUEL && (!ZS || ZS.status !== "active" || !(ZS.round >= 1 && ZS.round <= ZS.rounds));
  sb.disabled = busy || !open || !pend || duelOff;
  $("clearBtn").disabled = busy || bets.size === sent.size && pend === 0;
}
async function liveConfirm() {
  const list = pendingList(); if (!list.length || busy || !liveSt) return;
  const sb = $("spinBtn"); sb.disabled = true;
  try {
    const { data, error } = DUEL ? await db.rpc("zeus_bet", { p_duel: DUEL, p_round: liveSt.round, p_bets: list, p_ref: newRef() })
                                 : await db.rpc("rl_live_bet", { p_round: liveSt.round, p_mode: MODE, p_bets: list, p_ref: newRef() });
    if (error) throw error;
    if (DUEL) { ZS = data; drawDuel(); }
    sent = new Map(bets); undoStack.length = 0; balance = DUEL ? data.my_chips : data.balance; showBal(balance); err(""); SFX.chip(); lastFetch = 0; setTimeout(liveFetch, 50);
  } catch (e) { err(liveErr(e)); }
  drawChips();
}
function liveErr(e) { return ((e && e.message) || "").includes("betting_closed") ? "ההימורים לסיבוב הזה נסגרו. נסה בסיבוב הבא." : errText(e); }
function drawPlayers() {
  const el = $("players"); if (!el || !liveSt) return;
  const ps = liveSt.players || [];
  el.innerHTML = ps.length ? ps.map((p) => `<div class="pl${p.id === MY_ID ? " me" : ""}"><span>${String(p.name).replace(/[<>&]/g, "")}</span><b class="num">${fmt(p.total)}</b></div>`).join("")
    : '<div class="pl empty">עוד אין הימורים בסיבוב</div>';
  // other players' bets as faint markers on the layout
  const layer = $("chipLayer"); if (!layer || VIEW !== "table") return;
  layer.querySelectorAll(".gmark").forEach((g) => g.remove());
  for (const p of ps) { if (p.id === MY_ID) continue;
    for (const nums of p.nums || []) { const k = nums.slice().sort((a, b) => a - b).join(","); if (!LEGAL.has(k)) continue;
      const a = anchor(k), q = toXY(a.u, a.w), g = document.createElement("i"); g.className = "gmark"; g.title = p.name;
      g.style.left = q.x + "px"; g.style.top = q.y + "px"; g.textContent = String(p.name).slice(0, 1); layer.appendChild(g); } }
}
function drawBigClock(t) {          // countdown ring over the wheel: time left to bet before the next throw
  const b = $("bigClock"); if (!b || !liveSt) return; b.hidden = cine;
  const W = liveSt.close - liveSt.start, left = Math.max(0, liveSt.close - t), open = left > 0, sec = Math.ceil(left / 1000);
  b.className = "bigclock" + (open ? (sec <= 5 ? " hurry" : "") : " shut");
  b.querySelector(".fg").style.strokeDashoffset = open ? 113.1 * (1 - left / W) : 113.1;
  b.querySelector("b").textContent = open ? sec : "🎲";
  b.querySelector("small").textContent = open ? "להמר" : "מסתובב";
}
// the dealer's call when betting closes: banner + voice
let nmbRound = -1;
function noMoreBets() {
  const b = document.createElement("div"); b.className = "nmb"; b.innerHTML = "NO MORE BETS<small>אין עוד הימורים</small>"; document.body.appendChild(b);
  setTimeout(() => b.remove(), 1900);
  try { if (localStorage.getItem("gc_mute") !== "1" && window.speechSynthesis) { const u = new SpeechSynthesisUtterance("No more bets"); u.lang = "en-US"; u.rate = 0.95; speechSynthesis.speak(u); } } catch (e) {}
}
function drawClock() {
  const el = $("liveClock"); if (!el || !liveSt) return;
  if (srvNow() >= liveSt.close && nmbRound !== liveSt.round && srvNow() < liveSt.close + 3000) { nmbRound = liveSt.round; noMoreBets(); }
  drawBigClock(srvNow());
  const t = srvNow();
  if (t < liveSt.close) { const s = Math.ceil((liveSt.close - t) / 1000); el.textContent = `הימורים פתוחים · ${s}`; el.className = "liveclock" + (s <= 5 ? " hurry" : ""); }
  else { el.textContent = "אין עוד הימורים"; el.className = "liveclock shut"; }
}
let fetching = false, lastFetch = 0;
async function liveFetch() {
  if (fetching) return; fetching = true; lastFetch = Date.now();
  try {
    const { data, error } = await db.rpc("rl_live_state", { p_mode: MODE });
    if (error) throw error;
    clockOff = data.now - Date.now();
    if (DUEL) { const z = await db.rpc("zeus_state", { p_duel: DUEL }); if (!z.error) { ZS = z.data; data.mine = ZS.my_bets; data.balance = ZS.my_chips; data.payout = ZS.my_payout; drawDuel(); } }
    const newRound = !liveSt || liveSt.round !== data.round;
    liveSt = data;
    if (!busy && newRound) {                  // restore my confirmed bets after a reload mid-round
      const m = new Map(); for (const b of data.mine || []) { const k = b.nums.join(","); m.set(k, (m.get(k) || 0) + b.amt); }
      if (m.size) { sent = m; bets = new Map(m); }
    }
    if (!plan && !cine && animRound !== data.round) { history = data.history || []; drawHist(); }
    if (!plan && !cine) { balance = data.balance; showBal(balance); }
    drawChips(); drawPlayers();
    if (!data.open && data.result !== null && animRound !== data.round) liveRun(data);
  } catch (e) { console.error(e); }
  fetching = false;
}
async function liveRun(d) {
  animRound = d.round;
  if (DUEL) { const z = await db.rpc("zeus_state", { p_duel: DUEL }); if (!z.error) { ZS = z.data; d.payout = ZS.my_payout; d.balance = ZS.my_chips; drawDuel(); } }
  if (srvNow() > d.close + SPIN_AFTER + 1500) return;      // joined mid-spin: just wait for the next round
  busy = true; drawChips();
  const total = [...sent.values()].reduce((s, v) => s + v, 0);
  bets = new Map(sent);                               // unconfirmed chips don't play
  spinRes = { result: d.result, total, payout: d.payout || 0, balance: d.balance };
  showBal(d.balance - (d.payout || 0));
  if (LIT) await strike(d.lucky || {});
  const w = d.close + SPIN_AFTER - srvNow(); if (w > 0) await wait(w);
  marks = {}; setCine(true);
  plan = R.plan(d.result, W.rotor); t0 = performance.now(); SFX.roll(R.T.hit + 0.6); lastLift = prevLift = 1; lastTick = 0;
}
function liveTick() {
  drawClock(); if (liveSt) liveButtons();
  const t = srvNow();
  const due = !liveSt || t >= liveSt.end || (liveSt.open && t >= liveSt.close + 200) || (!liveSt.open && liveSt.result === null);
  if (due ? Date.now() - lastFetch > 700 : Date.now() - lastFetch > 2500) liveFetch();
}

// ---------- Zeus's duel HUD ----------
function drawDuel() {
  if (!ZS) return; let h = $("duelHud");
  if (!h) { h = document.createElement("div"); h.id = "duelHud"; h.className = "duelhud"; document.body.appendChild(h); document.querySelector(".bal").firstChild.textContent = "צ׳יפים של דו־קרב "; }
  const r = ZS.round, last = r === ZS.rounds;
  h.className = "duelhud" + (last ? " last" : "");
  h.innerHTML = `<b>⚡ הדו־קרב של זאוס</b><span>${r < 1 ? "מתחיל בסיבוב הבא" : r > ZS.rounds || ZS.status === "done" ? "נגמר" : `סיבוב <b class="num">${r}/${ZS.rounds}</b>`}</span>` +
    `<span>אתה <b class="num">${fmt(ZS.my_chips)}</b></span><span>${esc(ZS.them)} <b class="num">${fmt(ZS.their_chips)}</b></span>` + (last ? `<span class="x2">זאוס מכפיל הכול ×2</span>` : "");
  if (ZS.status === "done" && !$("duelEnd") && !plan && !cine) {
    const o = document.createElement("div"); o.id = "duelEnd"; o.className = "duelend";
    const res = !ZS.winner ? "תיקו! זאוס לא מרוצה." : ZS.winner === ZS.me ? "⚡ ניצחת! +30 נקודות לעונה" : `${esc(ZS.them)} ניצח הפעם`;
    o.innerHTML = `<div class="box"><div class="t">הדו־קרב נגמר</div><div class="r">${res}<br><b class="num">${fmt(ZS.my_chips)}</b> מול ${fmt(ZS.their_chips)}</div><a class="btn" href="challenges.html">חזרה לאתגרים</a></div>`;
    document.body.appendChild(o);
  }
}
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- boot ----------
// phones settle their size late (rotation, address bar, loader): redraw whenever the board area really changes size
let lastBox = "";
function placeTools() {            // short landscape (phones): the view/zoom buttons move under the wheel so the board gets the height
  const t = document.querySelector(".tools"), short = innerHeight < 560 && innerWidth > innerHeight;
  const home = short ? document.querySelector(".side") : $("boardSlot");
  if (t.parentElement !== home) { if (short) home.insertBefore(t, home.querySelector(".stats")); else home.insertBefore(t, $("boardScroll")); }
  document.body.classList.toggle("short", short);
}
function relayout() { placeTools(); const b = $("boardScroll").getBoundingClientRect(), key = Math.round(b.width) + "x" + Math.round(b.height);
  if (key !== lastBox) { lastBox = key; drawBoard(); layoutWheel(); } }
addEventListener("resize", relayout); addEventListener("orientationchange", () => setTimeout(relayout, 350));
if (window.ResizeObserver) new ResizeObserver(relayout).observe($("boardScroll"));
setInterval(relayout, 1000);
if (LIT) {
  document.body.classList.add("lit", "m-" + MODE);
  document.title = (MODE === "xxx" ? "רולטת ברקים XXX" : "רולטת ברקים") + " · גולן קזינו";
  const r = document.querySelector("#rules"); r.querySelector("h2").textContent = MODE === "xxx" ? "רולטת ברקים XXXtreme · חוקים" : "רולטת ברקים · חוקים";
  r.querySelector("h2").insertAdjacentHTML("afterend", MODE === "xxx"
    ? "<p><b>⚡ ברקים:</b> לפני כל סיבוב ברקים פוגעים ב־1 עד 5 מספרים עם מכפיל 50x עד 500x. לפעמים <b>שרשרת ברקים</b> מוסיפה מספרים (עד 10), ו<b>מכה כפולה</b> מקפיצה מספר ל־600x עד <b>2,000x</b>. הימור על מספר בודד שזוכה במספר מוכה ברק משלם את המכפיל. מספר בודד רגיל משלם 19:1. שאר ההימורים כרגיל.</p>"
    : "<p><b>⚡ ברקים:</b> לפני כל סיבוב ברקים פוגעים ב־1 עד 5 מספרים, וכל אחד מקבל מכפיל של 50x עד 500x. הימור על מספר בודד שזוכה במספר מוכה ברק משלם את המכפיל. מספר בודד רגיל משלם 29:1. שאר ההימורים כרגיל.</p>");
  r.querySelector("table tr:nth-child(2) td:last-child").textContent = MODE === "xxx" ? "19:1 · ברק 50–2000x" : "29:1 · ברק 50–500x";
}
(async function boot() {
  loadZeus();
  drawBoard(); layoutWheel();
  W = await R.mount(host, "img/roulette/"); W.pose(); W.camera(hostSize());     // one still frame; the render loop starts once the page is shown
  const startLoop = () => { if (!startLoop.on) { startLoop.on = true; last = performance.now(); requestAnimationFrame(frame); } };
  if (PREVIEW) { GC_LOADER.done(); setTimeout(startLoop, 650); GC_GUIDE.init({ game: LIT ? "lightning" : "roulette", db: null, mount: document.querySelector(".top"), steps: LIT ? GC_STEPS.lightning() : GC_STEPS.roulette(), auto: !/noguide/.test(location.search) }); balance = 10000; showBal(balance); history = [17, 0, 32, 5, 26, 11, 30, 2, 19, 4, 21, 36]; drawHist(); return; }
  const { data: { session } } = await db.auth.getSession();
  if (!session) { location.href = "./"; return; }
  GC_GUIDE.init({ game: LIT ? "lightning" : "roulette", db, mount: document.querySelector(".top"), steps: LIT ? GC_STEPS.lightning() : GC_STEPS.roulette() });
  const [w, h, ch] = await Promise.all([db.from("wallets").select("balance").eq("user_id", session.user.id).single(), LIVE ? Promise.resolve({}) : db.rpc("rl_history", { p_mode: MODE }), GC_CHAR(db, session.user.id)]);
  if (ch.url) { ME_URL = ch.url; $("meImg").src = ch.url; $("meName").textContent = ch.nick || ""; $("me").hidden = false; }
  if (!w.error) { balance = w.data.balance; showBal(balance); }
  if (!LIVE && !h.error && Array.isArray(h.data)) { history = h.data; drawHist(); }
  MY_ID = session.user.id;
  if (LIVE) { document.body.classList.add("live"); $("players").hidden = false; $("liveClock").hidden = false;
    $("wheelSlot").insertAdjacentHTML("beforeend", '<div id="bigClock" class="bigclock" hidden><svg viewBox="0 0 40 40"><circle class="bg" cx="20" cy="20" r="18"/><circle class="fg" cx="20" cy="20" r="18"/></svg><b class="num"></b><small></small></div>'); await liveFetch(); setInterval(liveTick, 250); }
  if (ch.url) await new Promise((res) => { const i = new Image(); i.onload = i.onerror = res; i.src = ch.url; });
  GC_LOADER.done(); setTimeout(startLoop, 650);
  drawChips();
})();
window.__rl = { shot, setCine, setView, setZoom, neighbours, ANNOUNCED, betAt, anchor, LEGAL, OUTSIDE, get W() { return W; }, get plan() { return plan; }, toXY, fromXY };
$("eraseBtn").onclick = () => { ERASE = !ERASE; $("eraseBtn").setAttribute("aria-pressed", ERASE); document.body.classList.toggle("erase", ERASE); err(ERASE ? "מצב מחיקה: לחץ על הימור כדי להסיר אותו. לחץ שוב על 🧽 לסיום." : ""); };
