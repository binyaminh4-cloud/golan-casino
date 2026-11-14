/* Golan Casino · רולטת האטרף של בנימין XXX — a shared live roulette with bonus pockets (plan: claude/BONUS_ROULETTE_PLAN.md).
   The server (migration 0133, atf_*) decides everything: the clock, the pockets, the result, the bonus and the money.
   The page only shows it, in step with the server clock. Table, chips and wheel come from the roulette (rl.js, copied in below). */
const $ = (id) => document.getElementById(id);
const fmt = (n) => { n = Number(n); const a = Math.abs(n); return a >= 1e12 ? "₪" + +(n / 1e12).toFixed(2) + "T" : a >= 1e9 ? "₪" + +(n / 1e9).toFixed(2) + "B" : a >= 1e6 ? "₪" + +(n / 1e6).toFixed(2) + "M" : "₪" + n.toLocaleString("en-US"); };
const PREVIEW = /[?#&]preview/.test(location.href);
const LIT = false, LIVE = true, DUEL = null, MODE = "aterf";
let landed = -1, sent = new Map(), liveSt = null, clockOff = 0, animRound = null, MY_ID = null;
let LUCKY = {};
const db = PREVIEW ? null : supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);
const R = RLW;

// ---------- copied from rl.js (table, chips, board, wheel, camera) ----------
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
// chip series keeps going (×5 / ×4); a chip shows once the wallet holds 20× its value; 7 chips on screen
const CHIP_V = [5, 25, 100, 500, ...[1e3, 1e6, 1e9].flatMap((m) => [1, 5, 25, 100, 500].map((c) => c * m)), 1e12, 5e12];   // 21 chips: 5 … 5T
const CHIP_C = CHIP_V.map((v, i) => ["c5", "c25", "c100", "c500", "c1k", "c5k"][i % 6]);
const CHIPS = CHIP_V.map((v, i) => [v, CHIP_C[i]]);
const stepMax = (b) => { if (b < 500000) return 50000; let v = 500000, k = 0; for (;;) { const m = k % 3 === 1 ? 2.5 : 2; if (v * m > b) break; v *= m; k++; } return v / 5; };   // same steps as the server
const sentSum = () => [...sent.values()].reduce((s, v) => s + v, 0);
const maxBet = () => stepMax(balance + sentSum());   // fixed for the whole round: chips already sent still count as yours (same rule as the server)
let chipKey = "";
function drawChipRack() {
  const ok = CHIPS.filter(([v], i) => v <= balance && (i < 7 || v * 20 <= balance)), show = (ok.length ? ok : CHIPS.slice(0, 1)).slice(-7), k = show.map(([v]) => v).join(",");
  if (k === chipKey) return; chipKey = k;
  if (!show.some(([v]) => v === chipVal)) chipVal = show[Math.min(2, show.length - 1)][0];
  $("chips").innerHTML = show.map(([v, c]) => `<button class="chip ${c}${v >= 25000 ? " big" : ""}" data-v="${v}" aria-pressed="${v === chipVal}">${chipLabel(v)}</button>`).join("");
  $("chips").querySelectorAll(".chip").forEach((b) => GC_CHIPIFY(b, +b.dataset.v));
}
const chipLabel = (v) => v >= 1e12 ? +(v / 1e12).toFixed(1) + "T" : v >= 1e9 ? +(v / 1e9).toFixed(1) + "B" : v >= 1e6 ? +(v / 1e6).toFixed(1) + "M" : v >= 1000 ? +(v / 1000).toFixed(1) + "K" : String(v);
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
  drawPockets();
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
    const g = GC_CHIP(v);
    return `<div class="chip ${chipClass(v)}${st} gcchip${g.exact ? "" : " txt"}" style="left:${p.x}px;top:${p.y}px;background-image:url(${g.url})"><b>${chipLabel(v)}</b></div>`;
  }).join("");
  const tot = [...bets.values()].reduce((s, v) => s + v, 0);
  $("total").textContent = fmt(tot); GC_LIMIT(tot, maxBet(), balance, fmt, "לכל משבצת");
  $("spinBtn").disabled = busy || tot === 0; $("undoBtn").disabled = busy || !undoStack.length;
  $("clearBtn").disabled = busy || !bets.size; $("dblBtn").disabled = busy || !bets.size;
  $("rebetBtn").disabled = busy || !lastBets || bets.size > 0;
  if (LIVE) { liveButtons(tot); drawPlayers(); autoSend(); }
}
const undoStack = [];
let ERASE = false;
let SHOW_FRIENDS = true; try { SHOW_FRIENDS = localStorage.getItem("gc_rl_friends") !== "0"; } catch (e) {}                    // eraser: tap a bet on the layout to take it back
function place(key, amt) {
  if (!key || busy) return;
  if (ERASE) { if (!bets.has(key) || (sent.get(key) || 0) > 0) return; undoStack.push(new Map(bets)); bets.delete(key); err(""); drawChips(); SFX.chip(); return; }
  const cur = bets.get(key) || 0;
  const tot = [...bets.values()].reduce((s, v) => s + v, 0) - sentSum();   // chips already sent are already off the balance
  const room = maxBet() - cur, left = PREVIEW ? Infinity : balance - tot;
  if (room <= 0) return err(`הגעת למקסימום ${fmt(maxBet())} על המשבצת הזו.`);
  if (left <= 0) return err("אין יותר שקלים בארנק להימור.");
  amt = Math.min(amt, room, left);          // the last chip takes whatever is left (all-in) instead of failing
  undoStack.push(new Map(bets)); bets.set(key, cur + amt); err(amt < chipVal ? `שמתי ${fmt(amt)} — ${left <= room ? "כל מה שנשאר בארנק" : "עד המקסימום למשבצת"}.` : ""); drawChips(); SFX.chip();
}
function placeMany(list) {             // list of [key, amount]; one undo step
  if (busy || !list.length) return;
  const next = new Map(bets);
  for (const [k, a] of list) { if (!LEGAL.has(k)) return; next.set(k, (next.get(k) || 0) + a); }
  if ([...next.values()].some((v) => v > maxBet())) return err(`אי אפשר: יש משבצת מעל המקסימום ${fmt(maxBet())} למשבצת.`);
  const tot = [...next.values()].reduce((s, v) => s + v, 0) - sentSum();
  if (!PREVIEW && tot > balance) return err(`אי אפשר: צריך ${fmt(tot)} ויש בארנק ${fmt(balance)}.`);
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
let viewT = 0;
function setView(v) {                 // the board fades out, switches and fades back in (no jump)
  if (v === VIEW) return;
  $("viewTable").setAttribute("aria-pressed", v === "table"); $("viewRace").setAttribute("aria-pressed", v === "race");
  board.style.transition = "opacity .18s ease, transform .18s ease"; board.style.opacity = "0"; board.style.transform = "scale(.98)";
  clearTimeout(viewT); viewT = setTimeout(() => {
    document.body.classList.toggle("race", v === "race"); VIEW = v; $("nbrBox").hidden = v !== "race"; drawBoard();
    setTimeout(() => { lastBox = ""; relayout(); }, 60);
    requestAnimationFrame(() => { board.style.transition = "opacity .24s ease, transform .24s ease"; board.style.opacity = ""; board.style.transform = ""; });
  }, 180);
}
$("viewTable").onclick = () => setView("table"); $("viewRace").onclick = () => setView("race");
$("nMinus").onclick = () => { NB = Math.max(0, NB - 1); $("nVal").textContent = NB; };
$("nPlus").onclick = () => { NB = Math.min(4, NB + 1); $("nVal").textContent = NB; };
function setZoom(z) { zoom = Math.max(0.7, Math.min(2, Math.round(z * 10) / 10)); drawBoard(); layoutWheel(); }
$("zIn").onclick = () => setZoom(zoom + 0.15); $("zOut").onclick = () => setZoom(zoom - 0.15);

drawChipRack();
$("chips").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; chipVal = +b.dataset.v;
  $("chips").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); };
if (LIVE) { const eb = document.createElement("button"); eb.className = "btn ghost eyebtn"; eb.id = "eyeBtn"; eb.title = "הימורי החברים";
  const setEye = () => { eb.innerHTML = SHOW_FRIENDS ? "👁️ חברים" : "🙈 חברים"; eb.setAttribute("aria-pressed", SHOW_FRIENDS); $("chipLayer")?.classList.toggle("nofriends", !SHOW_FRIENDS); };
  eb.onclick = () => { SHOW_FRIENDS = !SHOW_FRIENDS; try { localStorage.setItem("gc_rl_friends", SHOW_FRIENDS ? "1" : "0"); } catch (e) {} setEye(); };
  setEye(); $("undoBtn").before(eb); }
$("undoBtn").onclick = () => { if (undoStack.length) { bets = undoStack.pop(); drawChips(); } };
$("clearBtn").onclick = () => { undoStack.push(new Map(bets)); bets = new Map(sent); drawChips(); };
$("dblBtn").onclick = () => { const tot = [...bets.values()].reduce((s, v) => s + v, 0);
  if ([...bets.values()].some((v) => v * 2 > maxBet())) return err("ההכפלה עוברת את מגבלת ההימור.");
  undoStack.push(new Map(bets)); bets = new Map([...bets].map(([k, v]) => [k, v * 2])); drawChips(); };
$("rebetBtn").onclick = () => { if (lastBets) placeMany([...lastBets]); };   // same checks as placing chips: explains why if it can't
$("rulesBtn").onclick = () => $("rules").showModal();

// ---------- history & balance ----------
function drawHist() {
  $("hist").innerHTML = history.slice(0, 14).map((n, i) => `<div class="mrow ${R.color(n)}${i ? "" : " last"}"><span class="num">${n}</span></div>`).join("") || '<div class="empty">עוד אין סיבובים</div>';
  const h = history, c = (f) => h.length ? Math.round(100 * h.filter(f).length / h.length) : 0;
  $("pct").innerHTML = h.length ? `<span class="p red">${c((n) => R.color(n) === "red")}%</span><span class="p green">${c((n) => n === 0)}%</span><span class="p black">${c((n) => R.color(n) === "black")}%</span>` : "";
}
function showBal(v) { $("bal").textContent = fmt(v); drawChipRack(); GC_LIMIT([...bets.values()].reduce((a, b) => a + b, 0), maxBet(), balance, fmt, "לכל משבצת"); }

// ---------- wheel + camera ----------
let W, plan = null, t0 = 0, last = performance.now(), cine = false, dropPlayed = false;
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
      // the recorded fret bounces start exactly when the ball first hits the frets; the synth ticks only when the file is missing
      if (t > R.T.hit && !dropPlayed) { dropPlayed = true; try { SFX.ballDrop(); } catch (er) {} }
      if (!SFX.hasSample?.("ball_drop") && t > R.T.hit && t < R.T.settle && lastLift <= prevLift && lastLift <= s.lift && lastLift < 0.2 && t - lastTick > 0.12) { SFX.pocket(); lastTick = t; }
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
  if (on) { c.hidden = false; c.appendChild(host); requestAnimationFrame(() => c.classList.add("on")); drawLuckyList(); if (S) potList(S.pockets, true); }
  else { $("luckyList").hidden = true; potList(null, false); c.classList.remove("on"); $("wheelSlot").appendChild(host); setTimeout(() => { if (!cine) c.hidden = true; }, 500); }
  layoutWheel();
}

// ======================================================================================================
// ---------- the live round (server state machine, see 0133_aterf_roulette.sql) ----------
// ======================================================================================================
function drawLuckyList() { $("luckyList").hidden = true; }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const srvNow = () => Date.now() + clockOff;
const fx = (name, vol = 0.8) => { try { SFX.fx(name, { vol }); } catch (e) {} };
const BONUS_NAME = { vip: "מטווח VIP", balls: "הכדורים של בנימין" };
const PK_IMG = { vip: "img/zlm/bet-red_target.webp", balls: "img/zlm/bet-three_balls.webp" };
const HOST = { idle: "img/aterf/bin_idle.webp?v=2", swing: "img/aterf/bin_swing.webp?v=2", point: "img/aterf/bin_point.webp?v=2", celebrate: "img/aterf/bin_celebrate.webp?v=2" };
Object.values(HOST).concat(Object.values(PK_IMG)).forEach((s) => { const i = new Image(); i.src = s; });
let S = null;              // last server state
let POCKETS = {};          // pockets shown on the layout now: {"17": {t:"vip", m:3}}
let grownRound = null, spunRound = null, doneRound = null, introRound = null, bonusKey = "";

// ---------- pockets on the layout: the symbol fills the whole cell (the number hides under it); a multiplier rides on top ----------
function pocketCell(k) { return board.querySelector(VIEW === "table" ? `.cell[data-k="${k}"]` : `.rc[data-n="${k}"]`); }
function markPocket(k, p, how) {
  const c = pocketCell(k); if (!c) return;
  c.classList.add("pocket", "pk-" + p.t);
  let im = c.querySelector(".pk"); if (!im) { im = document.createElement("img"); im.className = "pk"; im.alt = BONUS_NAME[p.t]; im.src = PK_IMG[p.t]; c.appendChild(im); }
  if (how === "grow") { c.classList.remove("grow"); void c.offsetWidth; c.classList.add("grow"); }
  if (p.m > 1 && how !== "nomult") { let b = c.querySelector(".pm"); if (!b) { b = document.createElement("i"); b.className = "pm" + (p.m >= 10 ? " big" : ""); b.textContent = "×" + p.m; c.appendChild(b); }
    if (how === "slam") { b.classList.remove("slam"); void b.offsetWidth; b.classList.add("slam"); } }
}
// potential table during the spin (like the lightning list): what each bonus pocket can pay at most
// balls: best colour is the top ladder value 1000; VIP: the best three targets add 100 + 50 + 25 = 175
const POT_TOP = { balls: 1000, vip: 175 };
function potList(P, show) {
  let L = $("bonusPot");
  if (!L) { L = document.createElement("div"); L.id = "bonusPot"; L.className = "pot"; L.hidden = true; document.body.appendChild(L); }
  const e = Object.entries(P || {}).filter(([, p]) => POT_TOP[p.t]);
  if (!show || !e.length) { L.hidden = true; winList(null); return; }
  e.sort((a, b) => b[1].m - a[1].m);
  L.innerHTML = '<div class="pot-h">🎯 בונוסים בסיבוב</div>' + e.map(([k, p]) =>
    `<div class="pot-row ${p.t}${p.m > 1 ? " mult" : ""}"><img src="${PK_IMG[p.t]}" alt=""><span class="pot-n num">${k}</span><span class="pot-name">${BONUS_NAME[p.t]}</span><b class="pot-m num">${p.m > 1 ? "×" + p.m : ""}</b><b class="pot-x num">עד ×${Math.min(10000, POT_TOP[p.t] * p.m)}</b></div>`).join("");
  L.hidden = false;
  winList(P);
}
// close-up only: who could win what on each bonus number (straight bets on it × the bonus top)
function winList(P) {
  let W = $("winPot"); if (!W) { W = document.createElement("div"); W.id = "winPot"; W.className = "pot winpot"; W.hidden = true; document.body.appendChild(W); }
  W.hidden = true; if (!P) return;
  const players = liveSt && (liveSt.players || []).length ? liveSt.players : [{ id: MY_ID, name: "אני", bets: [...bets].map(([k, v]) => ({ nums: k.split(",").map(Number), amt: v })) }];
  const rows = [];
  for (const [k, p] of Object.entries(P)) { if (!POT_TOP[p.t]) continue; const top = Math.min(10000, POT_TOP[p.t] * p.m);
    for (const pl of players) { const amt = (pl.bets || []).filter((b) => b.nums.length === 1 && b.nums[0] === +k).reduce((a, b) => a + Number(b.amt), 0);
      if (amt > 0) rows.push({ k, t: p.t, name: pl.name, win: amt * top, me: pl.id === MY_ID }); } }
  if (!rows.length) return;
  rows.sort((a, b) => b.win - a.win);
  W.innerHTML = '<div class="pot-h">💰 זכייה אפשרית (עד)</div>' + rows.slice(0, 8).map((r) =>
    `<div class="wp-row${r.me ? " me" : ""}"><img src="${PK_IMG[r.t]}" alt=""><span class="pot-n num">${r.k}</span><span class="wp-nm">${esc(r.name)}</span><b class="num" dir="ltr">${fmt(r.win)}</b></div>`).join("");
  W.hidden = false;
}
function drawPockets() { for (const [k, p] of Object.entries(POCKETS)) markPocket(k, p, "still"); }
function clearPockets() { POCKETS = {}; board.querySelectorAll(".pocket").forEach((c) => { c.classList.remove("pocket", "pk-vip", "pk-balls", "grow", "hitpk"); c.querySelectorAll(".pk,.pm").forEach((x) => x.remove()); }); }

// ---------- Binyamin the mad scientist: waves his stick and the bonuses grow out of the numbers ----------
let hostEl = null;
function hostPose(pose, show = true) {
  if (!hostEl) { hostEl = document.createElement("img"); hostEl.id = "host"; hostEl.className = "host"; hostEl.alt = "בנימין"; document.body.appendChild(hostEl); }
  hostEl.src = HOST[pose] || HOST.idle; hostEl.classList.toggle("in", show); return hostEl;
}
async function growShow(st) {
  const P = st.pockets || {}, keys = Object.keys(P);
  const plain = keys.filter((k) => !(P[k].m > 1)).sort(() => Math.random() - 0.5), mult = keys.filter((k) => P[k].m > 1);
  const t0 = Date.parse(st.phase_at), late = srvNow() - t0;
  if (late > 1500 || document.hidden) { POCKETS = P; drawPockets(); return; }            // joined late: just show them
  const h = hostPose("idle", true); fx("atf_laugh", 0.7);
  await wait(650);
  const per = Math.max(140, Math.min(420, 3300 / Math.max(1, keys.length)));
  for (const k of plain.concat(mult)) {
    if (spunRound === st.id) break;                                                      // the ball is already rolling
    h.src = HOST.swing; fx("atf_wand", 0.55);
    spark(k); await wait(per * 0.45);
    POCKETS[k] = P[k]; markPocket(k, P[k], "grow"); fx("atf_grow", 0.6);
    await wait(per * 0.55); h.src = HOST.idle;
  }
  POCKETS = P; drawPockets();
  for (const k of mult) { await wait(380); markPocket(k, P[k], "slam"); fx("atf_mult", 0.85); }
  h.src = HOST.celebrate; await wait(900); hostPose("celebrate", false);
}
function spark(k) {
  const c = pocketCell(k); if (!c || !hostEl) return;
  const a = hostEl.getBoundingClientRect(), b = c.getBoundingClientRect(), s = document.createElement("i");
  const sx = a.left + a.width * 0.12, sy = a.top + a.height * 0.5;
  s.className = "spk"; s.style.left = sx + "px"; s.style.top = sy + "px"; document.body.appendChild(s);
  requestAnimationFrame(() => { s.style.transform = `translate(${b.left + b.width / 2 - sx}px,${b.top + b.height / 2 - sy}px) scale(.5)`; s.style.opacity = "0.2"; });
  setTimeout(() => s.remove(), 600);
}

// ---------- the ball (same 3D wheel and camera as the roulette) ----------
function startSpin(st) {
  spunRound = st.id; animRound = st.id;
  const late = srvNow() - Date.parse(st.phase_at);
  spinRes = { result: st.result, total: [...sent.values()].reduce((s, v) => s + v, 0), round: st.id };
  if (late > 7000 || document.hidden || !W) { landed = st.id; markWinner(st.result); return; }   // came in mid-spin: no half animation
  busy = true; betFocus(false); drawChips();
  marks = {}; setCine(true);
  plan = R.plan(st.result, W.rotor); t0 = performance.now() - Math.max(0, late); SFX.roll(R.T.hit + 0.6); lastLift = prevLift = 1; lastTick = 0; dropPlayed = false;
}
function onTime(t) {
  const T = R.T;
  if (!marks.res && t > T.settle + 0.5) { marks.res = 1; showResult(); }
  if (!marks.end && t > T.end) { marks.end = 1; finish(); }
}
function showResult() {
  const n = spinRes.result, c = R.color(n), name = { red: "אדום", black: "שחור", green: "ירוק" }[c], pk = POCKETS[n];
  const card = $("resultCard");
  card.className = "result " + c + (pk ? " won" : "");
  card.innerHTML = `<div class="rn num">${n}</div><div class="rc">${name}${n ? " · " + (n % 2 ? "אי־זוגי" : "זוגי") + " · " + (n <= 18 ? "1–18" : "19–36") : ""}</div>` +
    (pk ? `<div class="rbolt"><img src="${PK_IMG[pk.t]}" alt=""> ${BONUS_NAME[pk.t]}${pk.m > 1 ? " ×" + pk.m : ""}!</div>` : "");
  card.hidden = false;
  if (pk) fx("atf_bonus", 0.85);
}
function markWinner(n) {
  const cellEl = board.querySelector(VIEW === "table" ? `.cell[data-k="${n}"]` : `.rc[data-n="${n}"]`), d = $("dolly");
  if (cellEl) { d.style.left = cellEl.offsetLeft + cellEl.offsetWidth / 2 + "px"; d.style.top = cellEl.offsetTop + cellEl.offsetHeight / 2 + "px"; d.hidden = false;
    cellEl.classList.add("winner"); if (POCKETS[n]) cellEl.classList.add("hitpk"); }
  history.unshift(n); drawHist(POCKETS[n] && POCKETS[n].t);
}
function finish() {
  landed = animRound; plan = null; $("resultCard").hidden = true; setCine(false);
  const n = spinRes.result; markWinner(n);
  drawChips(new Set([...bets.keys()].filter((k) => k.split(",").map(Number).includes(n))));
  // the wallet and the win show only at "summary" (after the server paid), never before the player saw the result
}

// ---------- end of round: the server has paid → now the wallet moves and the win shows ----------
function summary(st) {
  doneRound = st.id;
  const pay = Number(st.payout || 0), total = (st.mine || []).reduce((s, b) => s + b.amt, 0);
  balance = Number(st.balance); showBal(balance);
  const me = $("me"); me.classList.remove("jump", "sad"); void me.offsetWidth;
  if (pay > 0) { me.classList.add("jump"); const f = document.createElement("div"); f.className = "float num"; f.textContent = "+" + fmt(pay); me.appendChild(f); setTimeout(() => f.remove(), 2200);
    const b = st.bonus || {}, mine = b.eligible && b.type;
    if (mine) setTimeout(() => GC_BONUS(`${b.type === "vip" ? "🎯" : "🔮"} ${BONUS_NAME[b.type]} ×${Math.min(10000, b.profit * b.mult)}`, pay, "על " + st.result), 400);
    else if (pay >= total * 20) setTimeout(() => GC_BONUS("🧪 זכייה גדולה!", pay, "על " + st.result), 400);
    else { try { SFX.win(pay >= total * 5); } catch (e) {} say(`זכית ${fmt(pay)}`); }
  }
  else if (total) me.classList.add("sad");
  drawTicker(st);
  setTimeout(() => {                         // croupier clears the layout (never chips already placed on the next round)
    if (S && S.id === st.id) { if (bets.size) lastBets = new Map(bets); bets.clear(); sent.clear(); undoStack.length = 0; }
    $("dolly").hidden = true; board.querySelectorAll(".winner,.hitpk").forEach((x) => x.classList.remove("winner", "hitpk")); clearPockets(); drawChips();
  }, st.bonus && st.bonus.type ? 4200 : 3000);
}
function say(t) { let m = $("sayPill"); if (!m) { m = document.createElement("div"); m.id = "sayPill"; m.className = "saypill"; document.body.appendChild(m); }
  m.textContent = t; m.classList.add("show"); clearTimeout(say.t); say.t = setTimeout(() => m.classList.remove("show"), 2600); }
// everyone's winnings slide across the top, biggest first (until the next round's betting closes)
function drawTicker(st) {
  let T = $("winTicker"); if (!T) { T = document.createElement("div"); T.id = "winTicker"; T.className = "wticker"; T.innerHTML = '<div class="wt-in"></div>'; document.body.appendChild(T); }
  const ps = (st.players || []).filter((p) => p.payout != null); if (!ps.length) { T.hidden = true; return; }
  ps.sort((a, b) => b.payout - a.payout);
  T.querySelector(".wt-in").innerHTML = ps.map((p) => `<span class="${p.payout > 0 ? "up" : "dn"}">${esc(p.name)} <b class="num">${p.payout > 0 ? "▲ " + fmt(p.payout) : "▼ " + fmt(p.total)}</b></span>`).join("");
  T.querySelector(".wt-in").style.animationDuration = Math.max(8, ps.length * 3) + "s"; T.hidden = false; T.dataset.r = st.id;
}

// ======================================================================================================
// ---------- the shared bonus: everyone watches; players with a straight bet on the number play ----------
// ======================================================================================================
const PEOPLE = ["friend_01", "friend_02", "friend_03", "friend_04", "friend_05_yoav"];
const COLORS = ["green", "purple", "orange"], CN = ["ירוק", "סגול", "כתום"], CK = ["g", "p", "o"];
const zimg = (name, cls = "") => { const im = document.createElement("img"); im.src = "img/zlm/" + name + ".webp"; im.alt = ""; im.className = cls; im.draggable = false; return im; };
let lastBallKey = "", choosing = false;
function bonusOn(st) { return !!(st && st.bonus && st.bonus.type && ["intro", "choice", "reveal", "balls", "settle"].includes(st.phase)) || (st && st.phase === "summary" && st.bonus && st.bonus.type && srvNow() - Date.parse(st.phase_at) < 4000); }
function renderBonus(st) {
  const box = $("bonusBox"), b = st.bonus;
  const key = [st.id, st.phase, JSON.stringify(b.picks), JSON.stringify(b.shown_picks), (b.events || []).length, JSON.stringify(b.targets), b.profit, Math.min(5, revealOpen(st))].join("|");
  if (key === bonusKey) return; bonusKey = key;
  box.hidden = false; box.className = "bonusbox " + b.type + "-scene ph-" + st.phase;
  const mult = b.mult > 1 ? b.mult : 1;
  const who = (b.participants || []).map((p) => esc(p.name)).join(" · ");
  let h = `<div class="bxh"><img src="${PK_IMG[b.type]}" alt=""><h2>${BONUS_NAME[b.type]} <span class="num">על ${st.result}</span></h2>${mult > 1 ? `<b class="bmult num">×${mult}</b>` : ""}</div>`;
  h += `<p class="binfo">${b.eligible ? (st.phase === "choice" ? (b.type === "vip" ? `בחרו 3 מטרות · נבחרו ${b.picks.length} מתוך 3` : b.picks.length ? "הצבע שלך נשמר" : "בחרו צבע") : "אתם בבונוס!")
    : who ? `צופים בבונוס של ${who}` : `אף אחד לא הימר על ${st.result}. צופים בבונוס בכל זאת`}</p>`;
  box.innerHTML = h;
  if (st.phase === "intro") {
    const i = document.createElement("div"); i.className = "bintro"; i.innerHTML = `<img src="${HOST.celebrate}" alt=""><div class="bt">בונוס!</div>`; box.appendChild(i);
    if (introRound !== st.id) { introRound = st.id; fx("atf_laugh", 0.7); }
    return;
  }
  if (b.type === "vip") renderVip(st, box, mult); else renderBalls(st, box, mult);
  if ((b.participants || []).length && (["settle", "summary"].includes(st.phase) || (b.type === "vip" && st.phase === "reveal" && revealOpen(st) >= 5))) {
    const tot = Math.min(10000, (b.profit || 0) * mult), r = document.createElement("div"); r.className = "btotal";
    r.innerHTML = `${b.eligible ? "הזכייה שלך" : "התוצאה"}: <b class="num">×${tot}</b>${mult > 1 ? ` <small class="num">(${b.profit} × ${mult})</small>` : ""}`; box.appendChild(r);
  }
}
function renderVip(st, box, mult) {
  const b = st.bonus, sel = b.eligible ? b.picks : (st.phase === "choice" ? [] : b.shown_picks || []);
  const can = b.eligible && st.phase === "choice" && b.picks.length < 3;
  const g = document.createElement("div"); g.className = "targets";
  const n = revealOpen(st);
  if (n !== lastRevealN && st.phase === "reveal" && n <= 5) { lastRevealN = n; fx("atf_grow", 0.5); }
  (b.targets || []).forEach((t, idx) => {
    const open = t.open && idx < n;                          // the host opens the targets one by one during the reveal
    const bt = document.createElement("button"), mine = sel.includes(t.index);
    bt.type = "button"; bt.className = "target" + (mine ? " selected" : "") + (open ? " open" : "") + (mine && open ? " hit" : "");
    bt.disabled = !(can && !mine); bt.setAttribute("aria-label", open ? "מטרה " + (t.index + 1) + " · פי " + t.value * mult : "מטרה " + (t.index + 1));
    if (open) { bt.append(zimg("range-" + PEOPLE[t.person], "person")); const p = document.createElement("span"); p.className = "prize num"; p.textContent = "×" + t.value * mult; bt.append(p); }
    bt.append(zimg("range-cover", "cover")); bt.onclick = () => choose(t.index); g.append(bt);
  });
  box.appendChild(g);
}
// reveal: how many VIP targets are open now (one every REVEAL_STEP ms; all five once the reveal is over)
const REVEAL_STEP = 2200;
let lastRevealN = 0;
function revealOpen(st) { return st.phase !== "reveal" ? 99 : Math.floor((srvNow() - Date.parse(st.phase_at)) / REVEAL_STEP) + 1; }
function renderBalls(st, box, mult) {
  const b = st.bonus, levels = b.levels || [0, 0, 0], values = b.values || [5, 5, 5], events = b.events || [];
  const chosen = b.eligible ? b.picks[0] : (b.shown_picks || [])[0];
  const lay = document.createElement("div"); lay.className = "bx";
  const blacks = document.createElement("div"); blacks.className = "bx-blacks"; blacks.innerHTML = "<span>שחורים</span>" + [0, 1, 2, 3].map((i) => `<i class="${i < (b.black || 0) ? "lit" : ""}"></i>`).join(""); lay.append(blacks);
  const cards = document.createElement("div"); cards.className = "bx-cards";
  for (let c = 0; c < 3; c++) { const card = document.createElement("div"); card.className = "bx-card " + CK[c] + (chosen === c ? " sel" : "");
    card.innerHTML = `<small>${CN[c]}</small><b class="num" dir="ltr">×${values[c] * mult}</b><div class="bx-bar">${Array.from({ length: 12 }, (_, k) => `<i class="${k <= levels[c] ? "on" : ""}"></i>`).join("")}</div><small class="bx-max num" dir="ltr">max ×${Math.min(10000, 1000 * mult)}</small>` +
      (chosen === c ? `<span class="bx-mine">${b.eligible ? "הצבע שלך" : "הצבע של " + esc(b.shooter || "")}</span>` : ""); cards.append(card); }
  lay.append(cards);
  const stage = document.createElement("div"); stage.className = "bx-stage";
  const drum = document.createElement("div"); drum.className = "bx-drum"; const sw = document.createElement("div"); sw.className = "bx-swirl" + (st.phase === "balls" ? " on" : "");
  for (let i = 0; i < 14; i++) { const im = zimg("balls-ball_" + ["green", "purple", "orange", "black"][i % 4]); im.style.setProperty("--r", (70 + (i * 37) % 190) + "%"); im.style.animationDuration = (1.3 + (i % 5) * 0.27) + "s"; im.style.animationDelay = -(i * 0.31) + "s"; sw.append(im); }
  drum.append(sw, zimg("balls-drum", "bx-glass")); stage.append(drum, Object.assign(document.createElement("img"), { src: HOST.point, className: "bx-host", alt: "" }));
  const win = document.createElement("div"); win.className = "bx-next"; const hole = document.createElement("div"); hole.className = "bx-hole";
  if (events.length) { const v = events.at(-1), k = st.id + ":" + events.length; hole.append(zimg("balls-ball_" + (v === 0 ? "black" : COLORS[(v - 1) % 3]), lastBallKey !== k ? "pop" : ""));
    if (lastBallKey !== k) { lastBallKey = k; try { v === 0 ? SFX.tick() : SFX.chip(); } catch (e) {} }
    if (v > 3) hole.append(Object.assign(document.createElement("b"), { textContent: "×2" })); if (v === 0) hole.classList.add("black"); }
  win.append(hole, Object.assign(document.createElement("small"), { textContent: events.length ? "כדור " + events.length : "הכדורים מתערבבים" })); stage.append(win); lay.append(stage);
  box.appendChild(lay);
  if (b.eligible && st.phase === "choice" && chosen === undefined) {
    const o = document.createElement("div"); o.className = "ball-picker"; o.innerHTML = `<div class="ball-picker-panel"><h3>בחרו את צבע הכדור שלכם</h3><div class="ball-choices"></div></div>`;
    COLORS.forEach((color, c) => { const bt = document.createElement("button"); bt.type = "button"; bt.className = "ball-choice"; bt.append(zimg("balls-ball_" + color)); bt.append(Object.assign(document.createElement("span"), { textContent: CN[c] })); bt.onclick = () => choose(c); o.querySelector(".ball-choices").append(bt); });
    box.appendChild(o);
  }
}
async function choose(pick) {
  if (choosing || !S || S.phase !== "choice") return; choosing = true;
  try { const { data, error } = await api.rpc("atf_choose", { p_round: S.id, p_pick: pick }); if (error) throw error; accept(data); }
  catch (e) { err(liveErr(e)); } finally { choosing = false; }
}

// ======================================================================================================
// ---------- talking to the server ----------
// ======================================================================================================
function normalize(d) {
  d.balance = Number(d.balance || 0);
  d.mine = (d.mine || []).map((b) => ({ nums: b.nums, amt: Number(b.amt) }));
  d.players = (d.players || []).map((p) => ({ ...p, total: Number(p.total), payout: p.payout == null ? null : Number(p.payout), bets: (p.bets || []).map((b) => ({ nums: b.nums, amt: Number(b.amt) })) }));
  d.history = d.history || []; d.present = d.present || []; d.pockets = d.pockets || {};
  return d;
}
function accept(d) {
  if (!d || !d.id) return; normalize(d);
  clockOff = Date.parse(d.server_time) - Date.now();
  const newRound = !S || S.id !== d.id;
  S = d;
  potList(d.pockets, cine && ["grow", "spin"].includes(d.phase));   // only in the wheel close-up
  liveSt = { round: d.id, open: d.phase === "betting" && srvNow() < Date.parse(d.deadline), start: Date.parse(d.phase_at), close: d.phase === "betting" ? Date.parse(d.deadline) : Date.parse(d.phase_at),
             players: d.players, present: d.present, result: d.phase === "summary" ? d.result : null };
  if (newRound) {
    if (doneRound !== null || spunRound !== null) { busy = false; }
    if (d.phase === "betting") { $("winTicker") && ($("winTicker").hidden = true); if (!busy) { const m = new Map(); for (const b of d.mine) { const k = b.nums.join(","); m.set(k, (m.get(k) || 0) + b.amt); } if (bets.size && !m.size) lastBets = new Map(bets); sent = m; bets = new Map(m); undoStack.length = 0; drawChips(); } }   // a new round starts empty (auto-play refills it)
    if (d.phase === "betting") { clearPockets(); $("bonusBox").hidden = true; bonusKey = ""; }
  }
  if (!plan && !cine && (d.phase === "betting" || doneRound === d.id)) { balance = d.balance; showBal(balance); }
  if (d.phase === "betting" && !plan && !cine) { history = d.history.map((h) => h.n); drawHist(); }
  if (["grow", "spin"].includes(d.phase) || (d.phase !== "betting" && spunRound !== d.id)) { if (grownRound !== d.id) { grownRound = d.id; growShow(d); } }
  if (d.phase !== "betting" && d.phase !== "grow" && spunRound !== d.id) startSpin(d);
  if (bonusOn(d) && landed === d.id) renderBonus(d); else if (!bonusOn(d)) { $("bonusBox").hidden = true; }
  if (d.phase === "summary" && doneRound !== d.id && landed === d.id) summary(d);
  drawChips(); drawPlayers();
}
let fetching = false, lastFetch = 0;
async function liveFetch() {
  if (fetching) return; fetching = true; lastFetch = Date.now();
  try { const { data, error } = await api.rpc("atf_state"); if (error) throw error; accept(data); if (!pendingList().length) err(""); }
  catch (e) { err(liveErr(e)); }
  fetching = false;
}
function liveTick() {
  drawClock(); if (liveSt) liveButtons();
  if (S && landed === S.id && bonusOn(S)) renderBonus(S);
  if (S && S.phase === "summary" && doneRound !== S.id && landed === S.id) summary(S);
  if (document.hidden) return;
  const t = srvNow(), due = !S || t >= Date.parse(S.deadline) - 50;
  if (Date.now() - lastFetch > (due ? 500 : S && ["betting", "summary"].includes(S.phase) ? 2000 : 1000)) liveFetch();
}
function pendingList() {
  const out = [];
  for (const [k, v] of bets) { const d = v - (sent.get(k) || 0); if (d > 0) out.push({ nums: k.split(",").map(Number), amt: d }); }
  return out;
}
function liveButtons() {
  const open = liveSt && liveSt.open && srvNow() < liveSt.close, pend = pendingList().reduce((s, b) => s + b.amt, 0), sb = $("spinBtn");
  sb.textContent = pend ? "אשר הימור" : sent.size ? "ההימור נקלט ✓" : "אשר הימור";
  sb.disabled = busy || !open || !pend;
  $("clearBtn").disabled = busy || (bets.size === sent.size && pend === 0);
}
let sendT = null;
function autoSend() {           // chips go to the server by themselves a moment after you stop placing them
  clearTimeout(sendT);
  if (!pendingList().length || busy || !liveSt || !liveSt.open) return;
  sendT = setTimeout(liveConfirm, Math.max(0, Math.min(900, liveSt.close - srvNow() - 600)));
}
let confirming = false;
async function liveConfirm() {
  const list = pendingList(); if (!list.length || busy || !S || confirming) return;
  confirming = true; $("spinBtn").disabled = true;
  const snap = new Map(bets);
  try {
    const { data, error } = await api.rpc("atf_bet", { p_round: S.id, p_bets: list, p_request: newRef() });
    if (error) throw error;
    for (const [k, v] of snap) sent.set(k, v); undoStack.length = 0; err(""); accept(data);
  } catch (e) { err(liveErr(e)); if (/betting_closed/.test((e && e.message) || "")) { bets = new Map(sent); } }
  confirming = false; drawChips();
}
function newRef() { return (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => (Math.random() * 16 | 0).toString(16))); }
function errText(e) {
  const m = (e && e.message) || "";
  if (m.includes("insufficient_funds")) return "אין מספיק שקלים בארנק. הקטינו את ההימור.";
  if (m.includes("invalid_amount")) return `כל הימור עד ${fmt(maxBet())} למשבצת.`;
  if (m.includes("not_signed_in")) { location.href = "./"; return ""; }
  if (/atf_|schema cache|PGRST202/.test(m)) return "המשחק עוד לא הופעל בשרת.";
  if (m === "Failed to fetch") return "החיבור נותק. מתחברים מחדש…";
  console.error("rpc error", e); return "משהו השתבש. נסו שוב בעוד רגע.";
}
function liveErr(e) { const m = (e && e.message) || "";
  return m.includes("betting_closed") ? "ההימורים לסיבוב הזה נסגרו. נסו בסיבוב הבא." : m.includes("choice_closed") ? "זמן הבחירה נגמר. השרת בחר בשבילכם." : m.includes("not_participant") ? "" : errText(e); }
const PAV = {};
function drawPlayers() {
  const el = $("players"); if (!el || !liveSt) return;
  const ps = liveSt.players || [];
  ps.forEach((p) => { if (!(p.id in PAV) && db) { PAV[p.id] = null; GC_CHAR(db, p.id).then((c) => { PAV[p.id] = c.url || ""; drawPlayers(); }); } });
  const plH = ps.length ? ps.map((p) => `<div class="pl${p.id === MY_ID ? " me" : ""}">${PAV[p.id] ? `<img src="${PAV[p.id]}" alt="">` : `<i>${esc(String(p.name)[0] || "?")}</i>`}<span>${esc(p.name)}<i class="lvu" data-u="${p.id}"></i></span><b class="num">${fmt(p.total)}</b></div>`).join("")
    : '<div class="pl empty">עוד אין הימורים בסיבוב</div>'; if (plH !== el._h) { el._h = plH; el.innerHTML = plH; }
  const row = $("seatRow"), pres = liveSt.present || [];
  if (row) { row.hidden = !pres.length; const bet = {}; ps.forEach((p) => bet[p.id] = p.total);
    pres.forEach((p) => { if (!(p.id in PAV) && db) { PAV[p.id] = null; GC_CHAR(db, p.id).then((c) => { PAV[p.id] = c.url || ""; drawPlayers(); }); } });
    const rowH = pres.map((p) => `<div data-u="${p.id}" class="sitter${p.id === MY_ID ? " mine" : ""}${bet[p.id] ? " bet" : ""}">${PAV[p.id] ? `<img src="${PAV[p.id]}" alt="">` : `<i>${esc(String(p.name)[0] || "?")}</i>`}<span>${esc(p.name)}</span>${bet[p.id] ? `<b class="num">${fmt(bet[p.id])}</b>` : ""}</div>`).join("");
    if (rowH !== row._h) { row._h = rowH; row.innerHTML = rowH; } }
  const layer = $("chipLayer"); if (!layer || VIEW !== "table") return;           // friends' bets: faint markers on the layout
  layer.querySelectorAll(".gmark").forEach((g) => g.remove());
  for (const p of ps) { if (p.id === MY_ID) continue;
    const per = {}; for (const b of p.bets || []) { const k = b.nums.slice().sort((x, y) => x - y).join(","); per[k] = (per[k] || 0) + b.amt; }
    for (const [k, amt] of Object.entries(per)) { if (!LEGAL.has(k)) continue;
      const a = anchor(k), q = toXY(a.u, a.w), g = document.createElement("div"); g.className = `chip ${chipClass(amt || 5)} gmark`; g.title = p.name + " " + fmt(amt);
      GC_CHIPIFY(g, amt || 5); g.classList.add("txt"); g.style.left = q.x + 7 + "px"; g.style.top = q.y - 7 + "px"; g.innerHTML = `<b>${chipLabel(amt)}</b><em>${esc(String(p.name).slice(0, 1))}</em>`; layer.appendChild(g); } }
  layer.classList.toggle("nofriends", !SHOW_FRIENDS);
}
function drawBigClock(t) {
  const b = $("bigClock"); if (!b || !S) return; b.hidden = cine;
  const open = S.phase === "betting", W0 = Date.parse(S.deadline) - Date.parse(S.phase_at), left = Math.max(0, Date.parse(S.deadline) - t), sec = Math.ceil(left / 1000);
  b.className = "bigclock" + (open && left > 0 ? (sec <= 5 ? " hurry" : "") : " shut");
  b.querySelector(".fg").style.strokeDashoffset = open ? 113.1 * (1 - left / W0) : 113.1;
  b.querySelector("b").textContent = open && left > 0 ? sec : S.phase === "grow" ? "🪄" : bonusOn(S) ? "🎯" : "🎲";
  b.querySelector("small").textContent = open && left > 0 ? "להמר" : S.phase === "grow" ? "בונוסים" : bonusOn(S) ? "בונוס" : "מסתובב";
}
// countdown inside the bonus screen: the same ring as the big clock on the wheel
// choice = time to pick, reveal = time until the host finishes the targets, balls = time to the next ball (3 s)
function drawBonusClock(t) {
  const box = $("bonusBox"); if (!box || box.hidden || !S || !S.bonus || !S.bonus.type) return;
  const ph = S.phase, old = box.querySelector(".bxclock");
  if (!["choice", "reveal", "balls"].includes(ph)) { if (old) old.remove(); return; }
  let c = old;
  if (!c) { c = document.createElement("div"); c.className = "bxclock"; c.innerHTML = '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" class="bg"/><circle cx="32" cy="32" r="28" class="fg"/></svg><b></b><small></small>'; box.appendChild(c); }
  const end = Date.parse(S.deadline), W0 = ph === "balls" ? 3000 : Math.max(1, end - Date.parse(S.phase_at));
  const left = Math.max(0, end - t), sec = Math.ceil(left / 1000);
  c.querySelector(".fg").style.strokeDashoffset = 175.9 * (1 - Math.min(1, left / W0));   // 2 * pi * 28
  c.querySelector("b").textContent = sec;
  c.querySelector("small").textContent = ph === "choice" ? "לבחור" : ph === "reveal" ? "מטרות" : "כדור הבא";
  c.classList.toggle("hurry", sec <= 5);
}
let nmbRound = null;
function noMoreBets() {
  const b = document.createElement("div"); b.className = "nmb"; b.innerHTML = "NO MORE BETS<small>אין עוד הימורים</small>"; document.body.appendChild(b);
  setTimeout(() => b.remove(), 2400);
  try { SFX.fx("dealer_nmb", { vol: 1 }); } catch (e) {}
}
function drawClock() {
  const el = $("liveClock"); if (!el || !S) return;
  const t = srvNow();
  if (S.phase === "betting" && t >= Date.parse(S.deadline) && nmbRound !== S.id && t < Date.parse(S.deadline) + 2500) { nmbRound = S.id; busy = true; noMoreBets(); drawChips(); }
  drawBigClock(t);
  drawBonusClock(t);
  if (S.phase === "betting" && t < Date.parse(S.deadline)) { const s = Math.ceil((Date.parse(S.deadline) - t) / 1000); el.textContent = `הימורים פתוחים · ${s}`; el.className = "liveclock" + (s <= 5 ? " hurry" : ""); }
  else { el.textContent = S.phase === "grow" ? "בנימין מפזר בונוסים" : bonusOn(S) ? "בונוס!" : S.phase === "summary" ? "סיבוב חדש מתחיל" : "אין עוד הימורים"; el.className = "liveclock shut"; }
  if (S.phase === "betting" && t < Date.parse(S.deadline) && busy && !plan && !cine) { busy = false; drawChips(); }
}

// ======================================================================================================
// ---------- preview (?preview): the same rules played locally, for screenshots and tests. No money, no server. ----------
// ?force=vip|balls puts the ball on a pocket of that kind · ?fast shortens betting to 6 s
// ======================================================================================================
const FAKE = (() => {
  const q = new URLSearchParams(location.search), FORCE = q.get("force"), FAST = q.has("fast");
  const ri = (n) => Math.floor(Math.random() * n), pick = (v, w) => { let n = Math.random() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < v.length; i++) { n -= w[i]; if (n < 0) return v[i]; } return v[0]; };
  const shuf = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const ladder = [5, 10, 15, 20, 30, 50, 75, 100, 150, 250, 500, 1000];
  const ballsRes = (deck) => { const pos = [0, 0, 0]; let b = 0; for (const v of deck) { if (v === 0) b++; else { const c = (v - 1) % 3; pos[c] = Math.min(11, pos[c] + (v > 3 ? 2 : 1)); } if (b === 4) break; } return { black: b, levels: pos, values: pos.map((p) => ladder[p]) }; };
  let bal = 10000000, r = null, hist = [], seq = 0;
  const me = "preview-me";
  function newRound(t) { r = { id: "r" + (++seq), phase: "betting", phase_at: t, deadline: t + (FAST ? 6000 : 10000), bets: new Map(), pockets: {}, result: null, bonus: null, secret: {}, draws: 0, picks: [], profit: 0, paid: 0 }; }
  function step() {
    const t = Date.now(); if (!r) newRound(t);
    for (let k = 0; k < 50 && t >= r.deadline; k++) {
      const d = r.deadline;
      if (r.phase === "betting") {
        const K = pick([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], [3000, 2400, 1700, 1100, 700, 400, 250, 150, 100, 60, 25, 15]);
        const nums = shuf([...Array(37).keys()]).slice(0, K + 1), two = shuf([...Array(K + 1).keys()]).slice(0, 2);
        r.pockets = {}; nums.forEach((n, i) => r.pockets[n] = { t: i === 0 ? "balls" : "vip", m: two.includes(i) ? pick([2, 3, 4, 5, 7, 10, 15, 20], [40, 25, 13, 9, 6, 4, 2, 1]) : 1 });
        r.result = FORCE ? +Object.keys(r.pockets).find((n) => r.pockets[n].t === FORCE) : ri(37);
        Object.assign(r, { phase: "grow", phase_at: d, deadline: d + 6000 });
      } else if (r.phase === "grow") Object.assign(r, { phase: "spin", phase_at: d, deadline: d + 15000 });
      else if (r.phase === "spin") {
        const pk = r.pockets[r.result];
        if (!pk) Object.assign(r, { phase: "settle", phase_at: d });
        else { r.bonus = pk.t; r.eligible = r.bets.has(String(r.result));
          if (pk.t === "vip") { const arr = shuf([0, 1, 2, 3, 4]), vals = [10, 100, 20, 25, 50]; r.secret = { people: arr, values: arr.map((i) => vals[i]) }; }
          else { let deck = shuf([...Array(20).fill(0), ...[1, 2, 3].flatMap((c) => [...Array(27).fill(c), ...Array(3).fill(c + 3)])]); let b = 0, n = 0; for (n = 0; n < deck.length; n++) { if (deck[n] === 0) b++; if (b === 4) break; } r.secret = { deck: deck.slice(0, n + 1) }; }
          Object.assign(r, { phase: "intro", phase_at: d, deadline: d + 4000 }); }
      } else if (r.phase === "intro") Object.assign(r, { phase: "choice", phase_at: d, deadline: d + (r.bonus === "vip" ? 15000 : 10000) });
      else if (r.phase === "choice") {
        const n = r.eligible ? (r.bonus === "vip" ? 3 : 1) : 0; for (const i of shuf(r.bonus === "vip" ? [0, 1, 2, 3, 4] : [0, 1, 2])) { if (r.picks.length >= n) break; if (!r.picks.includes(i)) r.picks.push(i); }
        if (r.bonus === "vip") { r.profit = r.picks.reduce((s, i) => s + r.secret.values[i], 0); Object.assign(r, { phase: "reveal", phase_at: d, deadline: d + 12000 }); }
        else Object.assign(r, { phase: "balls", phase_at: d, deadline: d + 3000 });
      } else if (r.phase === "reveal") Object.assign(r, { phase: "settle", phase_at: d });
      else if (r.phase === "balls") { const n = Math.min(r.secret.deck.length, Math.floor((t - r.phase_at) / 3000));
        if (n >= r.secret.deck.length) { r.draws = n; r.profit = ballsRes(r.secret.deck).values[r.picks[0]] || 0; Object.assign(r, { phase: "settle", phase_at: r.phase_at + 3000 * n, deadline: r.phase_at + 3000 * n }); }
        else { r.draws = n; r.deadline = r.phase_at + 3000 * (n + 1); } }
      else if (r.phase === "settle") {
        const pk = r.pockets[r.result], m = pk ? pk.m : 1; let pay = 0;
        for (const [k, a] of r.bets) { const nums = k.split(",").map(Number); if (!nums.includes(r.result)) continue;
          pay += nums.length === 1 ? (pk ? a * (1 + Math.min(10000, r.profit * m)) : a * 20) : Math.floor(a * 36 / nums.length); }
        r.paid = pay; bal += pay; hist.unshift({ n: r.result, b: pk ? pk.t : null }); hist = hist.slice(0, 18);
        Object.assign(r, { phase: "summary", phase_at: d, deadline: d + 4000 });
      } else if (r.phase === "summary") newRound(d);
    }
  }
  function state() {
    step(); const t = Date.now(), ph = r.phase, B = r.bonus && ["intro", "choice", "reveal", "balls", "settle", "summary"].includes(ph);
    const mine = [...r.bets].map(([k, a]) => ({ nums: k.split(",").map(Number), amt: String(a) })), tot = [...r.bets.values()].reduce((s, v) => s + v, 0);
    let bonus = {};
    if (B) {
      const shown = ph === "choice" ? r.picks : r.picks;
      bonus = { type: r.bonus, eligible: r.eligible, picks: r.eligible ? r.picks : [], shown_picks: r.eligible ? r.picks : (ph === "choice" ? [] : shown), shooter: r.eligible ? "אני" : null,
        mult: r.pockets[r.result].m, profit: ["settle", "summary"].includes(ph) || (r.bonus === "vip" && ph === "reveal") ? r.profit : 0,
        participants: r.eligible ? [{ id: me, name: "אני", stake: String(r.bets.get(String(r.result))), picks: r.picks }] : [] };
      if (r.bonus === "vip") bonus.targets = [0, 1, 2, 3, 4].map((i) => { const o = ["reveal", "settle", "summary"].includes(ph); return o ? { index: i, open: true, person: r.secret.people[i], value: r.secret.values[i] } : { index: i, open: false }; });
      else { const ev = r.secret.deck.slice(0, ["settle", "summary"].includes(ph) ? 999 : ph === "balls" ? r.draws : 0); Object.assign(bonus, ballsRes(ev), { events: ev }); }
    }
    return { id: r.id, phase: ph, phase_at: new Date(r.phase_at).toISOString(), deadline: new Date(r.deadline).toISOString(), server_time: new Date(t).toISOString(),
      pockets: ph === "betting" ? {} : r.pockets, result: ["betting", "grow"].includes(ph) ? null : r.result, bonus, draws: r.draws, mine,
      payout: ph === "summary" ? String(r.paid) : null, players: tot ? [{ id: me, name: "אני", total: String(tot), bets: mine, payout: ph === "summary" ? String(r.paid) : null }] : [],
      history: hist, present: [{ id: me, name: "אני" }], balance: String(bal) };
  }
  return { rpc: async (fn, a = {}) => {
    await wait(60); step();
    if (fn === "atf_state") return { data: state(), error: null };
    if (fn === "atf_bet") { if (r.phase !== "betting" || Date.now() >= r.deadline) return { data: null, error: { message: "betting_closed" } };
      const tot = a.p_bets.reduce((s, b) => s + b.amt, 0); if (tot > bal) return { data: null, error: { message: "insufficient_funds" } };
      bal -= tot; for (const b of a.p_bets) { const k = b.nums.slice().sort((x, y) => x - y).join(","); r.bets.set(k, (r.bets.get(k) || 0) + b.amt); } return { data: state(), error: null }; }
    if (fn === "atf_choose") { if (r.phase !== "choice" || !r.eligible) return { data: null, error: { message: "choice_closed" } };
      if (!r.picks.includes(a.p_pick) && r.picks.length < (r.bonus === "vip" ? 3 : 1)) r.picks.push(a.p_pick); return { data: state(), error: null }; }
    return { data: null, error: { message: "unknown" } };
  } };
})();
const api = PREVIEW ? FAKE : db;

// ---------- boot ----------
let lastBox = "";
function placeTools() {
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
document.addEventListener("visibilitychange", () => { if (!document.hidden) { lastFetch = 0; liveFetch(); } });
$("enterGo").onclick = () => { $("enter").hidden = true; try { SFX.unlock && SFX.unlock(); } catch (e) {} fx("atf_laugh", 0.6); };
(async function boot() {
  drawBoard(); layoutWheel();
  W = await R.mount(host, "img/roulette/"); W.pose(); W.camera(hostSize());
  const startLoop = () => { if (!startLoop.on) { startLoop.on = true; last = performance.now(); requestAnimationFrame(frame); } };
  if (!PREVIEW) {
    const { data: { session } } = await db.auth.getSession();
    if (!session) { location.href = "./"; return; }
    MY_ID = session.user.id;
    const ch = await GC_CHAR(db, session.user.id);
    if (ch.url) { ME_URL = ch.url; $("meImg").src = ch.url; $("meName").textContent = ch.nick || ""; $("me").hidden = false; }
  } else MY_ID = "preview-me";
  document.body.classList.add("live"); $("players").hidden = false; $("liveClock").hidden = false;
  $("wheelSlot").insertAdjacentHTML("beforeend", '<div id="bigClock" class="bigclock" hidden><svg viewBox="0 0 40 40"><circle class="bg" cx="20" cy="20" r="18"/><circle class="fg" cx="20" cy="20" r="18"/></svg><b class="num"></b><small></small></div>');
  await liveFetch(); setInterval(liveTick, 250);
  GC_LOADER.done(); setTimeout(startLoop, 650); drawChips();
  GC_GUIDE.init({ game: "aterf", db: PREVIEW ? null : db, mount: document.querySelector(".top"), steps: GC_STEPS.aterf(), auto: !PREVIEW });
})();
window.__atf = { place: (k, a) => place(k, a), get S() { return S; }, get POCKETS() { return POCKETS; }, get busy() { return busy; }, get bets() { return bets; }, get sent() { return sent; }, betAt, toXY, anchor, LEGAL };

// auto-play: repeats the last bet each round (sent by itself)
{ const h = document.createElement("span"); $("spinBtn").before(h);
  GC_AUTO({ mount: h, spin: $("spinBtn"),
    busy: () => !S || S.phase !== "betting" || busy || sent.size > 0 || srvNow() > Date.parse(S.deadline) - 3000,
    err: () => (!lastBets && !bets.size) ? (err("קודם שימו הימור אחד, ואז האוטומטי יחזור עליו."), "x") : "",
    act: () => { if (!bets.size && lastBets) $("rebetBtn").click(); } }); }
// betting focus: tapping a chip or the layout spreads the table over the room; 3 s without a tap shrinks it back
let focusT = null;
function betFocus(on) { clearTimeout(focusT); const was = document.body.classList.contains("betfocus");
  if (on && busy) on = false;
  if (on !== was) { document.body.classList.toggle("betfocus", on); requestAnimationFrame(() => { drawBoard(); drawChips(); layoutWheel(); }); }
  if (on) focusT = setTimeout(() => betFocus(false), 3000); }
$("chips").addEventListener("click", () => betFocus(true));
board.addEventListener("click", () => betFocus(true), true);
$("eraseBtn").onclick = () => { ERASE = !ERASE; $("eraseBtn").setAttribute("aria-pressed", ERASE); document.body.classList.toggle("erase", ERASE); };
