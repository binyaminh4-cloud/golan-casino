/* Golan Casino · roulette table (betting layout, flow, camera). The wheel itself lives in rl_wheel.js. */
const $ = (id) => document.getElementById(id);
const fmt = (n) => "₪" + Number(n).toLocaleString("en-US");
const PREVIEW = /[?#&]preview/.test(location.href);
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
try { zoom = +localStorage.getItem("rl_zoom") || 1; } catch (e) {}
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
    return `<div class="chip ${chipClass(v)}${st}" style="left:${p.x}px;top:${p.y}px">${chipLabel(v)}</div>`;
  }).join("");
  const tot = [...bets.values()].reduce((s, v) => s + v, 0);
  $("total").textContent = fmt(tot);
  $("spinBtn").disabled = busy || tot === 0; $("undoBtn").disabled = busy || !undoStack.length;
  $("clearBtn").disabled = busy || !bets.size; $("dblBtn").disabled = busy || !bets.size;
  $("rebetBtn").disabled = busy || !lastBets || bets.size > 0;
}
const undoStack = [];
function place(key, amt) {
  if (!key || busy) return;
  const cur = bets.get(key) || 0;
  if (cur + amt > 50000) return err("מקסימום ₪50,000 על הימור אחד.");
  const tot = [...bets.values()].reduce((s, v) => s + v, 0);
  if (tot + amt > 100000) return err("מקסימום ₪100,000 לסיבוב.");
  if (!PREVIEW && tot + amt > balance) return err("אין מספיק שקלים להימור הזה.");
  undoStack.push(new Map(bets)); bets.set(key, cur + amt); err(""); drawChips();
}
function placeMany(list) {             // list of [key, amount]; one undo step
  if (busy || !list.length) return;
  const next = new Map(bets);
  for (const [k, a] of list) { if (!LEGAL.has(k)) return; next.set(k, (next.get(k) || 0) + a); }
  if ([...next.values()].some((v) => v > 50000)) return err("מקסימום ₪50,000 על הימור אחד.");
  const tot = [...next.values()].reduce((s, v) => s + v, 0);
  if (tot > 100000) return err("מקסימום ₪100,000 לסיבוב.");
  if (!PREVIEW && tot > balance) return err("אין מספיק שקלים להימור הזה.");
  undoStack.push(new Map(bets)); bets = next; err(""); drawChips();
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
function setView(v) { VIEW = v; $("viewTable").setAttribute("aria-pressed", v === "table"); $("viewRace").setAttribute("aria-pressed", v === "race");
  $("nbrBox").hidden = v !== "race"; drawBoard(); }
$("viewTable").onclick = () => setView("table"); $("viewRace").onclick = () => setView("race");
$("nMinus").onclick = () => { NB = Math.max(0, NB - 1); $("nVal").textContent = NB; };
$("nPlus").onclick = () => { NB = Math.min(4, NB + 1); $("nVal").textContent = NB; };
function setZoom(z) { zoom = Math.max(0.7, Math.min(2, Math.round(z * 10) / 10)); try { localStorage.setItem("rl_zoom", zoom); } catch (e) {} drawBoard(); layoutWheel(); }
$("zIn").onclick = () => setZoom(zoom + 0.15); $("zOut").onclick = () => setZoom(zoom - 0.15);

$("chips").innerHTML = CHIPS.map(([v, c]) => `<button class="chip ${c}" data-v="${v}" aria-pressed="${v === chipVal}">${chipLabel(v)}</button>`).join("");
$("chips").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; chipVal = +b.dataset.v;
  $("chips").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); };
$("undoBtn").onclick = () => { if (undoStack.length) { bets = undoStack.pop(); drawChips(); } };
$("clearBtn").onclick = () => { undoStack.push(new Map(bets)); bets.clear(); drawChips(); };
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
  if (cine) { const s = Math.min(innerWidth * 0.98, innerHeight * 1.05); host.style.width = host.style.height = s + "px"; }
  else { const r = $("wheelSlot").getBoundingClientRect(); const s = Math.min(r.width, r.height) - 8; host.style.width = host.style.height = Math.max(120, s) + "px"; }
}
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (x) => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x);
function shot(t, ball) {          // target camera for time t of the spin
  const T = R.T;
  if (t < 0.9) return { z: lerp(1, 1.05, ease(t / 0.9)), tilt: 48, f: 0 };
  if (t < T.drop - 0.6) return { z: lerp(1.05, 1.3, ease((t - 0.9) / (T.drop - 1.5))), tilt: lerp(48, 52, ease(t / T.drop)), f: 0 };
  if (t < T.hit) return { z: lerp(1.3, 2.0, ease((t - T.drop + 0.6) / (T.hit - T.drop + 0.6))), tilt: 50, f: 0.55 };
  if (t < T.settle) return { z: lerp(2.0, 2.7, ease((t - T.hit) / (T.settle - T.hit))), tilt: lerp(50, 42, ease((t - T.hit) / 2)), f: 0.8 };
  if (t < T.settle + 2.4) return { z: lerp(2.7, 3.5, ease((t - T.settle) / 1.2)), tilt: lerp(42, 30, ease((t - T.settle) / 1.2)), f: 1 };
  return { z: 1, tilt: 48, f: 0 };
}
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (W) {
    if (plan) {
      const t = (now - t0) / 1000, s = plan.at(t);
      W.rotor = s.rotor; W.ball = { phi: s.phi, r: s.r, lift: s.lift };
      const b = W.pose(), sh = shot(t, b), k = 1 - Math.pow(0.002, dt);   // smooth camera
      W.cam.z = lerp(W.cam.z, sh.z, k); W.cam.tilt = lerp(W.cam.tilt, sh.tilt, k);
      W.cam.fx = lerp(W.cam.fx, lerp(600, b.x, sh.f), k); W.cam.fy = lerp(W.cam.fy, lerp(600, b.y, sh.f), k);
      onTime(t);
    } else { W.idle(dt); W.cam.z = lerp(W.cam.z, 1, 0.1); W.cam.tilt = lerp(W.cam.tilt, 48, 0.1);
             W.cam.fx = lerp(W.cam.fx, 600, 0.1); W.cam.fy = lerp(W.cam.fy, 600, 0.1); }
    W.camera(hostSize());
  }
  requestAnimationFrame(frame);
}

// ---------- the spin ----------
let spinRes = null, marks = {};
function setCine(on) {
  cine = on; const c = $("cine");
  if (on) { c.hidden = false; c.appendChild(host); requestAnimationFrame(() => c.classList.add("on")); }
  else { c.classList.remove("on"); $("wheelSlot").appendChild(host); setTimeout(() => { if (!cine) c.hidden = true; }, 500); }
  layoutWheel();
}
function onTime(t) {
  const T = R.T;
  if (!marks.nmb && t > T.drop - 1.2) { marks.nmb = 1; $("cineMsg").textContent = "אין עוד הימורים"; $("cineMsg").classList.add("show"); }
  if (!marks.hide && t > T.hit) { marks.hide = 1; $("cineMsg").classList.remove("show"); }
  if (!marks.res && t > T.settle + 0.5) { marks.res = 1; showResult(); }
  if (!marks.end && t > T.end) { marks.end = 1; finish(); }
}
function showResult() {
  const n = spinRes.result, c = R.color(n), name = { red: "אדום", black: "שחור", green: "ירוק" }[c];
  const net = spinRes.payout - spinRes.total;
  const card = $("resultCard");
  card.className = "result " + c;
  card.innerHTML = `<div class="rn num">${n}</div><div class="rc">${name}${n ? " · " + (n % 2 ? "אי־זוגי" : "זוגי") + " · " + (n <= 18 ? "1–18" : "19–36") : ""}</div>` +
    (spinRes.payout > 0 ? `<div class="rw">זכית ${fmt(spinRes.payout)}</div>` : `<div class="rl">לא הפעם</div>`);
  card.hidden = false;
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
  if (spinRes.payout > 0) err("");
  setTimeout(() => {                         // croupier clears the layout
    lastBets = new Map(bets); bets.clear(); undoStack.length = 0; busy = false;
    d.hidden = true; board.querySelectorAll(".winner").forEach((x) => x.classList.remove("winner")); drawChips();
  }, 2600);
}
function newRef() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2)); }
$("spinBtn").onclick = async () => {
  if (busy || !bets.size) return;
  busy = true; drawChips(); err("");
  const payload = [...bets].map(([k, v]) => ({ nums: k.split(",").map(Number), amt: v }));
  let res;
  try {
    if (PREVIEW) {
      const forced = new URLSearchParams(location.search).get("n");
      const n = forced !== null ? +forced : Math.floor(Math.random() * 37);
      const total = payload.reduce((s, b) => s + b.amt, 0);
      const payout = payload.filter((b) => b.nums.includes(n)).reduce((s, b) => s + Math.floor(b.amt * 36 / b.nums.length), 0);
      balance = (balance || 10000); res = { result: n, total, payout, balance: balance - total + payout };
    } else {
      const { data, error } = await db.rpc("rl_spin", { p_bets: payload, p_ref: newRef() });
      if (error) throw error; res = data;
    }
  } catch (e) { busy = false; drawChips(); return err(errText(e)); }
  spinRes = res; showBal(res.balance - res.payout);
  marks = {}; setCine(true);
  plan = R.plan(res.result, W.rotor); t0 = performance.now();
};
function errText(e) {
  const m = (e && e.message) || "";
  if (m.includes("insufficient_funds")) return "אין מספיק שקלים משחקיים. הקטן את ההימור.";
  if (m.includes("table_limit")) return "מקסימום ₪100,000 לסיבוב.";
  if (m.includes("invalid_amount")) return "כל הימור בין ₪1 ל־₪50,000.";
  if (m.includes("not_signed_in")) { location.href = "./"; return ""; }
  console.error("rpc error", e);
  return "משהו השתבש (" + ((e && e.code) || "") + " " + m.slice(0, 80) + "). צלם לי את המסך.";
}

// ---------- boot ----------
addEventListener("resize", () => { drawBoard(); layoutWheel(); });
(async function boot() {
  drawBoard(); layoutWheel();
  W = await R.mount(host, "img/roulette/"); requestAnimationFrame(frame);
  if (PREVIEW) { balance = 10000; showBal(balance); history = [17, 0, 32, 5, 26, 11, 30, 2, 19, 4, 21, 36]; drawHist(); return; }
  const { data: { session } } = await db.auth.getSession();
  if (!session) { location.href = "./"; return; }
  const [w, h] = await Promise.all([db.from("wallets").select("balance").eq("user_id", session.user.id).single(), db.rpc("rl_history")]);
  if (!w.error) { balance = w.data.balance; showBal(balance); }
  if (!h.error && Array.isArray(h.data)) { history = h.data; drawHist(); }
  drawChips();
})();
window.__rl = { setView, setZoom, neighbours, ANNOUNCED, betAt, anchor, LEGAL, OUTSIDE, get W() { return W; }, get plan() { return plan; }, toXY, fromXY };
