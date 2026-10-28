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
function spinTo(stops) {
  return Promise.all(stops.map((stop, r) => new Promise((res) => {
    const top = ((stop - 1) % N + N) % N;              // index shown in the top row
    const from = pos[r] % N; setReel(r, from, false);
    const target = N * (LOOPS - 2) + top;               // land on the next-to-last copy, far from the start
    const ms = 1400 + r * 550;
    requestAnimationFrame(() => requestAnimationFrame(() => setReel(r, target, true, ms)));
    setTimeout(() => { SFX.flip(); pos[r] = top; setReel(r, top + N, false); res(); }, ms + 30);
  })));
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
}
drawRack(0);
$("chips").onclick = (e) => { const b = e.target.closest("button"); if (!b || busy || FREE_LEFT > 0) return; lineBet = +b.dataset.v; SFX.chip();
  $("chips").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); $("total").textContent = fmt(lineBet * 5); };
$("rulesBtn").onclick = () => $("rules").showModal();
$("paytable").innerHTML = "<tr><th>שלושה בקו</th><th>משלם (פי ההימור לסיבוב)</th></tr>" + Object.entries(PAY).map(([k, v]) => `<tr><td>${sym(k)} ${sym(k)} ${sym(k)} <small>${NAME[k]}</small></td><td class="num">${typeof v === "number" ? "×" + (v / 5) : v === "🎁" ? "10 חינם" : "ג׳קפוט"}</td></tr>`).join("");
function showBal(v) { $("bal").textContent = fmt(v); drawRack(+v || 0); }
function err(t) { $("err").textContent = t; }
function newRef() { try { return crypto.randomUUID(); } catch { return Date.now().toString(36) + Math.random().toString(36).slice(2); } }

$("spinBtn").onclick = async () => {
  if (busy) return; busy = true; err(""); clearHits(); $("spinBtn").disabled = true;
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
    busy = false; $("spinBtn").disabled = false;
    const m = (e && e.message) || "";
    return err(m.includes("insufficient_funds") ? "אין מספיק שקלים משחקיים. הקטן את ההימור." : m.includes("not_signed_in") ? (location.href = "./", "") : "משהו השתבש. נסה שוב.");
  }
  showBal(res.balance - res.payout); SFX.roll(1.4 + 2 * 0.55);
  await spinTo(res.stops);
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
  if (FO && FREE_LEFT > 0) setTimeout(() => $("spinBtn").click(), res.free ? 4400 : 1200);   // free spins play themselves
};
function winToast(amount, big) {
  const t = document.createElement("div"); t.className = "wintoast" + (big ? " big" : ""); t.innerHTML = `${big ? "💰 זכייה גדולה!" : "זכית"}<b class="num">+${fmt(amount)}</b>`;
  document.querySelector(".window").appendChild(t); setTimeout(() => t.remove(), 2400);
}
// free spins: 3 FREE (one on each reel) = 10 spins at the same bet, nothing charged
let FREE_LEFT = 0;
function freeState(res) {
  if (res.free) GC_BONUS("🎁 בונוס! 10 סיבובים חינם", null, "הסיבובים משחקים לבד, באותו הימור");
  setFree(res.free_left || 0);
}
function setFree(n) {
  FREE_LEFT = n; $("spinBtn").textContent = n > 0 ? `חינם · ${n}` : "סובב"; $("spinBtn").classList.toggle("free", n > 0);
  $("chips").classList.toggle("locked", n > 0);
}

// ---------- Golan Fortune: jackpots ----------
let GRAND = 0, shownGrand = 0;
function jpState(s) {
  if (!s || s.grand == null) return;
  GRAND = s.grand; $("mini").innerHTML = `💼 <b class="num">${fmt(s.mini)}</b><small>ג׳קפוט חייב לצאת אחת לשבועיים${s.mini_deadline ? " · עד " + new Date(s.mini_deadline).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" }) : ""}</small>`;
}
function tickGrand() {                     // the big number creeps up smoothly toward the server value
  const d = GRAND - shownGrand;
  shownGrand = Math.abs(d) < 1 ? GRAND : shownGrand + d * 0.08 + Math.sign(d) * 0.4;
  $("grand").textContent = fmt(Math.floor(shownGrand)); requestAnimationFrame(tickGrand);
}
async function jackpotWin(res) {
  const j = res.jackpot, grand = j.kind === "grand";
  const o = document.createElement("div"); o.className = "jpwin " + j.kind;
  o.innerHTML = `<img src="img/slots/fortune/${grand ? "ZEUS" : "BIN"}.webp" alt=""><div class="t">${grand ? "⚡ ג׳קפוט של זאוס ⚡" : "💼 ג׳קפוט של בנימין"}</div><div class="a num">${fmt(j.amount)}</div>${grand && j.share < 1 ? `<small>${Math.round(j.share * 100)}% מהקופה (קופה מלאה בהימור של ₪500 לסיבוב)</small>` : ""}<button class="spin">אסוף</button>`;
  document.body.appendChild(o); SFX.win(true); setTimeout(() => SFX.win(true), 900);
  $("winbar").innerHTML = `💰 ג׳קפוט! <b class="num">${fmt(res.payout)}</b>`; $("winbar").className = "winbar win big";
  await new Promise((r) => o.querySelector("button").onclick = r); o.remove();
  busy = false; $("spinBtn").disabled = false;
}
if (FO) {
  document.body.classList.add("fortune"); document.title = "מכונת האטרף של בנימין · גולן קזינו";
  document.querySelector(".marquee-top").innerHTML = `<div class="jp"><img src="img/slots/fortune/marquee.webp" alt=""><b id="grand" class="num">₪1,000,000</b></div><div class="mini" id="mini"></div>`;
  const r = $("rules"); r.querySelector("h2").textContent = "מכונת האטרף של בנימין · טבלת תשלומים";
  r.querySelector("p").innerHTML = "3 גלגלים, 3 שורות, 5 קווי זכייה. בוחרים הימור לסיבוב. התוצאה נקבעת בשרת.<br><b>🎁 סיבובים חינם:</b> FREE SPINS בכל אחד משלושת הגלגלים (בכל שורה) = 10 סיבובים חינם באותו הימור. יוצא בערך פעם ב־100 סיבובים.<br><b>👑 ג׳קפוט זאוס:</b> מתחיל ב־₪1,000,000, ו־1% מכל סיבוב של כל השחקנים נכנס אליו. 3 זאוסים <b>בקו האמצעי</b> זוכים בו. בהימור של ₪500 לסיבוב ומעלה זוכים בכל הקופה, בהימור קטן יותר בחלק יחסי (₪250 = חצי).<br><b>💼 ג׳קפוט בנימין:</b> ₪250,000, חייב לצאת לפחות פעם בשבועיים: השרת בוחר רגע סודי, והסיבוב הראשון אחריו זוכה, לא משנה מי מסובב.";
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
