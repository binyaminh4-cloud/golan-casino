/* Golan Casino · slots. The server picks the reel stops (sl_spin); this file only animates them. */
const $ = (id) => document.getElementById(id);
const fmt = (n) => { n = Number(n); const a = Math.abs(n); return a >= 1e12 ? "₪" + +(n / 1e12).toFixed(2) + "T" : a >= 1e9 ? "₪" + +(n / 1e9).toFixed(2) + "B" : a >= 1e6 ? "₪" + +(n / 1e6).toFixed(2) + "M" : "₪" + n.toLocaleString("en-US"); };   // ₪1.58M · ₪2.4B · ₪1T
const PREVIEW = /[?#&]preview/.test(location.href);
const db = PREVIEW ? null : supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);
const FO = new URLSearchParams(location.search).get("m") === "fortune";      // Golan Fortune: the friends' machine with two jackpots
const STRIP = FO
  ? ["CH","COIN","BAR","SEV","DIA","FISHER","BIN","ZEUS","FREE","CH","COIN","BAR","SEV","DIA","FISHER","BIN","FREE","CH","COIN","BAR","SEV","DIA","CH","COIN","BAR","SEV","CH","COIN","BAR","CH","COIN","CH"]
  : ["CH","LE","OR","GR","BE","BAR","SEV","DIA","CH","LE","OR","GR","BE","BAR","SEV","CH","LE","OR","GR","BE","BAR","CH","LE","OR","GR","BE","CH","LE","OR","GR","CH","LE"];
const N = STRIP.length;
const PAY = FO ? { ZEUS: "👑", FREE: "🎁", BIN: 400, FISHER: 200, DIA: 100, SEV: 50, BAR: 30, COIN: 12, CH: 6 } : { DIA: 1000, SEV: 300, BAR: 100, BE: 50, GR: 30, OR: 25, LE: 20, CH: 15 };
const NAME = { DIA: "יהלום", SEV: "שבע", BAR: "בר", BE: "פעמון", GR: "ענבים", OR: "תפוז", LE: "לימון", CH: "דובדבן", ZEUS: "זאוס · ג׳קפוט (בקו האמצעי)", BIN: "בנימין", FISHER: "פישר", COIN: "מטבע זהב", FREE: "10 סיבובים חינם (אחד בכל גלגל, בכל שורה)" };
// placeholder symbols drawn in code (replaced by the ChatGPT symbol pack when it arrives: img/slots/<SYM>.webp)
const GLYPH = { CH: "🍒", LE: "🍋", OR: "🍊", GR: "🍇", BE: "🔔", BAR: "<b class='bar'>BAR</b>", SEV: "<b class='sev'>7</b>", DIA: "💎" };
let ART = false;
const sym = (k) => k === "FREE" ? `<span class="freesym">FREE<br>SPINS</span>` : FO ? `<img src="img/slots/fortune/${k}.webp" alt="${NAME[k]}">` : ART ? `<img src="img/slots/${k}.webp" alt="${NAME[k]}">` : GLYPH[k];
const LINES = [[1, 1, 1], [0, 0, 0], [2, 2, 2], [0, 1, 2], [2, 1, 0]];
const CHIPS = [1, 5, 10, 25, 100, 500, 1000, 5000, 20000, 100000, 500000, 2000000, 10000000];   // per line; a spin is 5 lines
let lineBet = 10, balance = 0, busy = false;
const reels = [...document.querySelectorAll(".reel")];
const pos = [0, 0, 0];       // current top index of each reel

// ---------- reels ----------
const LOOPS = 6;             // strip repeated so a reel can travel far during the spin
function buildReel(r) {
  const el = reels[r]; let h = "";
  for (let l = 0; l < LOOPS; l++) for (let i = 0; i < N; i++) h += `<div class="sym s-${STRIP[i]}">${sym(STRIP[i])}</div>`;
  el.innerHTML = `<div class="strip">${h}</div>`; el.style.setProperty("--ch", cellH() + "px");
  setReel(r, pos[r], false);
}
function cellH() { return reels[0].clientHeight / 3; }
function setReel(r, idx, anim, ms) {
  const s = reels[r].firstChild; if (!s) return; s.style.transition = anim ? `transform ${ms}ms cubic-bezier(.15,.7,.25,1.04)` : "none";
  s.style.transform = `translateY(${-idx * cellH()}px)`;
}
// Smooth reels: they start the moment you tap (while the server answers), then each one eases into its symbol
// at the same speed it was running, so nothing jumps. Tap again to stop early; ⚡ toggles fast spins.
let FAST = false; try { FAST = localStorage.getItem("gc_sl_fast") === "1"; } catch (e) {}
const RS = [0, 1, 2].map(() => ({ off: 0, v: 0, run: false, stop: null }));
let rollRaf = 0, stopNow = false;
function rollFrame(now) {
  let any = false; const ch = cellH();
  RS.forEach((R, r) => {
    if (!R.run) return; any = true;
    const dt = Math.min(0.05, (now - (R.t || now)) / 1000); R.t = now;
    if (R.stop && R.stop.t0 == null) {          // cruise at full speed until the symbol is exactly one braking distance away
      R.off += R.v * dt;
      if (R.off >= R.stop.c) { R.stop.t0 = now; R.stop.o0 = R.off; }
    } else if (R.stop) {
      const k = Math.min(1, (now - R.stop.t0) / R.stop.d), e = 1 - Math.pow(1 - k, 3);
      R.off = R.stop.o0 + (R.stop.T - R.stop.o0) * e;
      if (k >= 1) { R.run = false; R.stop.done(); }
    } else { R.v = Math.min(R.v + dt * 60, FAST ? 26 : 20); R.off += R.v * dt; if (R.off >= 3 * N) R.off -= N; }
    reels[r].firstChild.style.transform = `translateY(${-R.off * ch}px)`;
    reels[r].classList.toggle("blur", R.run && !R.stop && R.v > 12);
  });
  rollRaf = any ? requestAnimationFrame(rollFrame) : 0;
}
function rollStart() {
  stopNow = false;
  RS.forEach((R, r) => { const s = reels[r].firstChild; s.style.transition = "none"; R.off = pos[r] + N; R.v = 4; R.run = true; R.stop = null; R.t = 0; });
  if (!rollRaf) rollRaf = requestAnimationFrame(rollFrame);
}
function landReel(r, top, d0) {
  return new Promise((res) => {
    const R = RS[r]; if (!R.run) { pos[r] = top; setReel(r, top + N, false); return res(); }
    while (R.off >= 2 * N) R.off -= N;
    const v = Math.max(R.v, 6), d = d0 / 1000, brake = v * d / 3;
    let T = R.off + brake; T = T + ((((top - T) % N) + N) % N);   // first spot ahead that shows our symbol on top
    R.stop = { c: T - brake, T, d: d0, t0: null, done: () => { SFX.flip(); pos[r] = top; setReel(r, top + N, false); reels[r].classList.remove("blur"); res(); } };
  });
}
async function spinTo(stops) {
  const tops = stops.map((stop) => ((stop - 1) % N + N) % N);
  const base = FAST ? 350 : 1100, gap = FAST ? 200 : 520, t0 = performance.now();
  for (let r = 0; r < 3; r++) {
    const wait = Math.max(0, base + r * gap - (performance.now() - t0));
    await new Promise((ok) => { const step = () => { if (stopNow || performance.now() - t0 >= base + r * gap) ok(); else setTimeout(step, 30); }; step(); });
    if (r < 2 && !stopNow) landReel(r, tops[r], FAST ? 420 : 900); else await Promise.all([landReel(r, tops[r], stopNow ? 380 : FAST ? 420 : 900)]);
    if (stopNow) { for (let k = r + 1; k < 3; k++) landReel(k, tops[k], 380); }
    if (stopNow) break;
  }
  await new Promise((ok) => { const chk = () => RS.some((R) => R.run) ? setTimeout(chk, 30) : ok(); chk(); });
}

// ---------- win lines ----------
function drawLines(wins) {
  const svg = $("paylines"); svg.innerHTML = "";
  document.querySelectorAll(".lines-l i, .lines-r i").forEach((i) => i.classList.remove("on"));
  for (const w of wins) {
    const L = LINES[w.line], pts = L.map((row, c) => `${50 + c * 100},${50 + row * 100}`).join(" ");
    svg.insertAdjacentHTML("beforeend", `<polyline points="${pts}" class="pl"/>`);
    document.querySelectorAll(`[data-l="${w.line}"]`).forEach((i) => i.classList.add("on"));
    L.forEach((row, c) => { const tile = reels[c].firstChild.children[pos[c] + N + row]; if (tile && w.pay >= 15) tile.classList.add("hit"); });
  }
}
function clearHits() { document.querySelectorAll(".sym.hit").forEach((t) => t.classList.remove("hit")); drawLines([]); }

// ---------- betting ----------
// bet per spin (5 lines). Bigger bets show once the wallet holds 20× the spin; the max spin follows the wallet like every game
let rackKey = "";
function drawRack(bal) {
  const max = ((b) => { if (b < 500000) return 50000; let v = 500000, k = 0; for (;;) { const m = k % 3 === 1 ? 2.5 : 2; if (v * m > b) break; v *= m; k++; } return v / 5; })(bal);
  const ok = CHIPS.filter((v, i) => i < 7 || (v * 5 * 20 <= bal && v * 5 <= max)), show = ok.slice(-7), k = show.join(",");
  if (k === rackKey) return; rackKey = k; if (!show.includes(lineBet) && FREE_LEFT === 0) { lineBet = show[0]; $("total").textContent = fmt(lineBet * 5); }
  const lab = (t) => String(fmt(t)).slice(1).replace(/,000$/, "K");
  $("chips").innerHTML = show.map((v) => `<button class="chip" data-v="${v}" aria-pressed="${v === lineBet}">${lab(v * 5)}</button>`).join("");
  $("chips").querySelectorAll(".chip").forEach((b) => GC_CHIPIFY(b, +b.dataset.v * 5));
}
drawRack(0);
$("chips").onclick = (e) => { const b = e.target.closest("button"); if (!b || busy || FREE_LEFT > 0) return; lineBet = +b.dataset.v; SFX.chip(); if (FO && JPS) jpState(JPS);
  $("chips").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); $("total").textContent = fmt(lineBet * 5); };
$("rulesBtn").onclick = () => $("rules").showModal();
{ const fb = document.createElement("button"); fb.type = "button"; fb.className = "fastbtn"; fb.title = "סיבוב מהיר";
  const set = () => { fb.textContent = FAST ? "⚡ מהיר" : "🐢 רגיל"; fb.setAttribute("aria-pressed", FAST); };
  fb.onclick = () => { FAST = !FAST; try { localStorage.setItem("gc_sl_fast", FAST ? "1" : "0"); } catch (e) {} set(); }; set(); $("spinBtn").after(fb); }
$("paytable").innerHTML = "<tr><th>שלושה בקו</th><th>משלם (פי ההימור לסיבוב)</th></tr>" + Object.entries(PAY).map(([k, v]) => `<tr><td>${sym(k)} ${sym(k)} ${sym(k)} <small>${NAME[k]}</small></td><td class="num">${typeof v === "number" ? "×" + (v / 5) : v === "🎁" ? "10 חינם" : "ג׳קפוט"}</td></tr>`).join("");
function showBal(v) { $("bal").textContent = fmt(v); drawRack(+v || 0); }
function err(t) { $("err").textContent = t; }
function newRef() { try { return crypto.randomUUID(); } catch { return Date.now().toString(36) + Math.random().toString(36).slice(2); } }

$("spinBtn").onclick = async () => {
  if (busy) { if (RS.some((R) => R.run)) stopNow = true; return; }
  busy = true; err(""); clearHits(); $("spinBtn").classList.add("stopper"); rollStart();
  $("winbar").textContent = "בהצלחה…"; $("winbar").className = "winbar";
  let res;
  try {
    if (PREVIEW) {
      const q = new URLSearchParams(location.search).get("stops");
      const stops = q ? q.split(",").map(Number) : [0, 1, 2].map(() => Math.floor(Math.random() * N));
      const grid = stops.map((s) => [0, 1, 2].map((r) => STRIP[((s - 1 + r) % N + N) % N]));
      const wins = []; let mult = 0;
      LINES.forEach((L, i) => { const [a, b, c] = L.map((row, k) => grid[k][row]); const p = a === b && b === c ? (+PAY[a] || 0) : a === "CH" && b === "CH" ? 3 : a === "CH" ? 1 : 0; if (p) { wins.push({ line: i, pay: p }); mult += p; } });
      balance = balance || 10000; balance -= lineBet * 5; balance += mult * lineBet;
      res = { stops, grid, wins, mult, total: lineBet * 5, payout: mult * lineBet, balance };
    } else {
      const { data, error } = await db.rpc(FO ? "fo_spin" : "sl_spin", { p_line_bet: lineBet, p_ref: newRef() });
      if (error) throw error; res = data;
    }
  } catch (e) {
    busy = false; $("spinBtn").classList.remove("stopper"); RS.forEach((R, r) => { R.run = false; setReel(r, pos[r] + N, false); reels[r].classList.remove("blur"); });
    const m = (e && e.message) || "";
    return err(m.includes("insufficient_funds") ? "אין מספיק שקלים משחקיים. הקטן את ההימור." : m.includes("not_signed_in") ? (location.href = "./", "") : "משהו השתבש. נסה שוב.");
  }
  showBal(res.balance - res.payout); SFX.roll(1.4 + 2 * 0.55);
  await spinTo(res.stops); $("spinBtn").classList.remove("stopper");
  showBal(res.balance); balance = res.balance;
  drawLines(res.wins);
  if (FO) { jpState(res); if (res.jackpot) return jackpotWin(res); }
  const net = res.payout - res.total;
  if (res.payout > 0) winToast(res.payout, res.mult >= 50);
  if (FO) freeState(res);
  if (res.payout > 0) {
    const big = res.mult >= 50;
    $("winbar").innerHTML = (big ? "💰 זכייה גדולה! " : "זכית ") + `<b class="num">${fmt(res.payout)}</b>` + (net < 0 ? ` <small>(על הימור של ${fmt(res.total)})</small>` : "");
    $("winbar").className = "winbar win" + (big ? " big" : ""); SFX.win(big);
  } else { $("winbar").textContent = FREE_LEFT > 0 ? "" : "לא הפעם"; if (!res.free_spin) SFX.lose(); }
  busy = false; $("spinBtn").disabled = false;
  if (FO && FREE_LEFT > 0 && !res.free) setTimeout(() => $("spinBtn").click(), 1200);   // free spins play themselves
};
function winToast(amount, big) {
  const t = document.createElement("div"); t.className = "wintoast" + (big ? " big" : ""); t.innerHTML = `${big ? "💰 זכייה גדולה!" : "זכית"}<b class="num">+${fmt(amount)}</b>`;
  document.querySelector(".window").appendChild(t); setTimeout(() => t.remove(), 2400);
}
// free spins: 3 FREE (one on each reel) = 10 spins at the same bet, nothing charged
let FREE_LEFT = 0;
function freeState(res) {
  if (res.free) GC_BONUS_INTRO("🎁 10 סיבובים חינם!", ["הסיבובים משחקים לבד, באותו הימור, בלי לחייב את הארנק.", "כל זכייה בסיבוב חינם נכנסת לארנק.", "גם הג׳קפוטים פתוחים בסיבובים החינם."], "img/slots/fortune/BIN.webp").then(() => { if (FREE_LEFT > 0 && !busy) $("spinBtn").click(); });
  setFree(res.free_left || 0);
}
// bonus buy (Binyamin's machine): 10 free spins at the chosen bet
if (FO) { const bb = document.createElement("button"); bb.type = "button"; bb.className = "fastbtn"; bb.textContent = "🛒 בונוס"; $("spinBtn").before(bb);
  bb.onclick = async () => {
    if (busy || FREE_LEFT > 0 || PREVIEW) return; const P = (await db.rpc("gc_buy_prices")).data || {};
    const k = await GC_BUYMENU([{ kind: "free", label: "10 סיבובים חינם", price: P["fortune:free"] || 10, desc: "10 סיבובים באותו הימור, כולל סיכוי לג׳קפוטים" }], lineBet * 5, fmt);
    if (!k) return; const { data, error } = await db.rpc("fo_buy", { p_line_bet: lineBet, p_ref: newRef() });
    if (error) return err((error.message || "").includes("insufficient") ? "אין מספיק שקלים." : "הקנייה נכשלה.");
    showBal(data.balance); freeState({ free: true, free_left: data.free_left });
  }; }
function setFree(n) {
  FREE_LEFT = n; $("spinBtn").textContent = n > 0 ? `חינם · ${n}` : "סובב"; $("spinBtn").classList.toggle("free", n > 0);
  $("chips").classList.toggle("locked", n > 0);
}

// ---------- Golan Fortune: jackpots ----------
let GRAND = 0, shownGrand = 0;
let JPS = null;   // jackpots shown for the current bet: ₪500 a spin = the full amount, ₪1,000 = double
function jpState(s) {
  if (!s || s.grand == null) return;
  JPS = s; GRAND = s.grand * lineBet / 100; $("mini").innerHTML = `💼 <b class="num">${fmt(Math.floor(s.mini * lineBet / 100))}</b><small>ג׳קפוט חייב לצאת אחת לשבועיים${s.mini_deadline ? " · עד " + new Date(s.mini_deadline).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" }) : ""}</small>`;
}
function tickGrand() {                     // the big number creeps up smoothly toward the server value
  const d = GRAND - shownGrand;
  shownGrand = Math.abs(d) < 1 ? GRAND : shownGrand + d * 0.08 + Math.sign(d) * 0.4;
  $("grand").textContent = fmt(Math.floor(shownGrand)); requestAnimationFrame(tickGrand);
}
async function jackpotWin(res) {
  const j = res.jackpot, grand = j.kind === "grand"; try { SFX.jackpot(); } catch (e) {}
  const o = document.createElement("div"); o.className = "jpwin " + j.kind;
  o.innerHTML = `<img src="img/slots/fortune/${grand ? "ZEUS" : "BIN"}.webp" alt=""><div class="t">${grand ? "⚡ ג׳קפוט של זאוס ⚡" : "💼 ג׳קפוט של בנימין"}</div><div class="a num">${fmt(j.amount)}</div><button class="spin">אסוף</button>`;
  document.body.appendChild(o); SFX.win(true); setTimeout(() => SFX.win(true), 900);
  $("winbar").innerHTML = `💰 ג׳קפוט! <b class="num">${fmt(res.payout)}</b>`; $("winbar").className = "winbar win big";
  await new Promise((r) => o.querySelector("button").onclick = r); o.remove();
  busy = false; $("spinBtn").disabled = false;
}
if (FO) {
  document.body.classList.add("fortune"); document.title = "מכונת האטרף של בנימין · גולן קזינו";
  document.querySelector(".marquee-top").innerHTML = `<div class="jp"><img src="img/slots/fortune/marquee.webp" alt=""><b id="grand" class="num">₪1,000,000</b></div><div class="mini" id="mini"></div>`;
  const r = $("rules"); r.querySelector("h2").textContent = "מכונת האטרף של בנימין · טבלת תשלומים";
  r.querySelector("p").innerHTML = "3 גלגלים, 3 שורות, 5 קווי זכייה. בוחרים הימור לסיבוב. התוצאה נקבעת בשרת.<br><b>🎁 סיבובים חינם:</b> FREE SPINS בכל אחד משלושת הגלגלים (בכל שורה) = 10 סיבובים חינם באותו הימור. יוצא בערך פעם ב־100 סיבובים.<br><b>👑 ג׳קפוט זאוס:</b> מתחיל ב־₪1,000,000, ו־1% מכל סיבוב של כל השחקנים נכנס אליו. 3 זאוסים <b>בקו האמצעי</b> זוכים בו. הפרס גדל עם ההימור: ₪500 לסיבוב = הקופה המלאה, ₪250 = חצי, ₪1,000 = כפול. המספר על המכונה מראה כמה תזכה בהימור שבחרת.<br><b>💼 ג׳קפוט בנימין:</b> ₪250,000 בהימור של ₪500 לסיבוב (ובאותו יחס לכל הימור), חייב לצאת לפחות פעם בשבועיים: השרת בוחר רגע סודי, והסיבוב הראשון אחריו זוכה, לא משנה מי מסובב.";
  setInterval(async () => { if (busy || document.hidden || PREVIEW) return; const { data } = await db.rpc("fo_state"); jpState(data); }, 6000);
}

// ---------- boot ----------
addEventListener("resize", () => reels.forEach((el, r) => { if (!el.firstChild) return; el.style.setProperty("--ch", cellH() + "px"); setReel(r, pos[r] + N, false); }));
(async function boot() {
  pos[0] = 3; pos[1] = 9; pos[2] = 17;
  // use the real symbol art if it has been added
  ART = await new Promise((r) => { const i = new Image(); i.onload = () => r(true); i.onerror = () => r(false); i.src = "img/slots/DIA.webp"; });
  reels.forEach((_, r) => { buildReel(r); setReel(r, pos[r] + N, false); });
  $("paytable").innerHTML = "<tr><th>שלושה בקו</th><th>משלם (פי ההימור לסיבוב)</th></tr>" + Object.entries(PAY).map(([k, v]) => `<tr><td><span class="pt">${sym(k)}${sym(k)}${sym(k)}</span> <small>${NAME[k]}</small></td><td class="num">${typeof v === "number" ? "×" + (v / 5) : v === "🎁" ? "10 חינם" : "ג׳קפוט"}</td></tr>`).join("");
  if (FO) { tickGrand(); if (PREVIEW) jpState({ grand: 1234567, mini: 250000, mini_deadline: new Date(Date.now() + 9 * 864e5).toISOString() }); }
  if (PREVIEW) { balance = 10000; showBal(balance); GC_LOADER.done(); return; }
  const { data: { session } } = await db.auth.getSession();
  if (!session) { location.href = "./"; return; }
  GC_GUIDE.init({ game: "slots", db, mount: document.querySelector(".top"), steps: GC_STEPS.slots() });
  const { data: w } = await db.from("wallets").select("balance").eq("user_id", session.user.id).single();
  if (w) { balance = w.balance; showBal(balance); }
  if (FO) { const { data } = await db.rpc("fo_state"); jpState(data); const fl = await db.rpc("fo_free_left"); if (!fl.error && fl.data > 0) { setFree(fl.data); setTimeout(() => $("spinBtn").click(), 1500); } }
  GC_LOADER.done();
})();
