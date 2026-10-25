/* Golan Casino · slots. The server picks the reel stops (sl_spin); this file only animates them. */
const $ = (id) => document.getElementById(id);
const fmt = (n) => "₪" + Number(n).toLocaleString("en-US");
const PREVIEW = /[?#&]preview/.test(location.href);
const db = PREVIEW ? null : supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);
const STRIP = ["CH","LE","OR","GR","BE","BAR","SEV","DIA","CH","LE","OR","GR","BE","BAR","SEV","CH","LE","OR","GR","BE","BAR","CH","LE","OR","GR","BE","CH","LE","OR","GR","CH","LE"];
const N = STRIP.length;
const PAY = { DIA: 1000, SEV: 300, BAR: 100, BE: 50, GR: 30, OR: 25, LE: 20, CH: 15 };
const NAME = { DIA: "יהלום", SEV: "שבע", BAR: "בר", BE: "פעמון", GR: "ענבים", OR: "תפוז", LE: "לימון", CH: "דובדבן" };
// placeholder symbols drawn in code (replaced by the ChatGPT symbol pack when it arrives: img/slots/<SYM>.webp)
const GLYPH = { CH: "🍒", LE: "🍋", OR: "🍊", GR: "🍇", BE: "🔔", BAR: "<b class='bar'>BAR</b>", SEV: "<b class='sev'>7</b>", DIA: "💎" };
let ART = false;
const sym = (k) => ART ? `<img src="img/slots/${k}.webp" alt="${NAME[k]}">` : GLYPH[k];
const LINES = [[1, 1, 1], [0, 0, 0], [2, 2, 2], [0, 1, 2], [2, 1, 0]];
const CHIPS = [1, 5, 10, 25, 100, 500, 1000];
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
  const s = reels[r].firstChild; s.style.transition = anim ? `transform ${ms}ms cubic-bezier(.15,.7,.25,1.04)` : "none";
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
$("chips").innerHTML = CHIPS.map((v) => `<button class="chip" data-v="${v}" aria-pressed="${v === lineBet}">${v >= 1000 ? v / 1000 + "K" : v}</button>`).join("");
$("chips").onclick = (e) => { const b = e.target.closest("button"); if (!b || busy) return; lineBet = +b.dataset.v; SFX.chip();
  $("chips").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); $("total").textContent = fmt(lineBet * 5); };
$("rulesBtn").onclick = () => $("rules").showModal();
$("paytable").innerHTML = "<tr><th>שלושה בקו</th><th>משלם</th></tr>" + Object.entries(PAY).map(([k, v]) => `<tr><td>${sym(k)} ${sym(k)} ${sym(k)} <small>${NAME[k]}</small></td><td class="num">${v}x</td></tr>`).join("");
function showBal(v) { $("bal").textContent = fmt(v); }
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
      LINES.forEach((L, i) => { const [a, b, c] = L.map((row, k) => grid[k][row]); const p = a === b && b === c ? PAY[a] : a === "CH" && b === "CH" ? 3 : a === "CH" ? 1 : 0; if (p) { wins.push({ line: i, pay: p }); mult += p; } });
      balance = balance || 10000; balance -= lineBet * 5; balance += mult * lineBet;
      res = { stops, grid, wins, mult, total: lineBet * 5, payout: mult * lineBet, balance };
    } else {
      const { data, error } = await db.rpc("sl_spin", { p_line_bet: lineBet, p_ref: newRef() });
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
  const net = res.payout - res.total;
  if (res.payout > 0) {
    const big = res.mult >= 50;
    $("winbar").innerHTML = (big ? "💰 זכייה גדולה! " : "זכית ") + `<b class="num">${fmt(res.payout)}</b>` + (net < 0 ? ` <small>(על הימור של ${fmt(res.total)})</small>` : "");
    $("winbar").className = "winbar win" + (big ? " big" : ""); SFX.win(big);
  } else { $("winbar").textContent = "לא הפעם"; SFX.lose(); }
  busy = false; $("spinBtn").disabled = false;
};

// ---------- boot ----------
addEventListener("resize", () => reels.forEach((el, r) => { el.style.setProperty("--ch", cellH() + "px"); setReel(r, pos[r] + N, false); }));
(async function boot() {
  pos[0] = 3; pos[1] = 9; pos[2] = 17;
  // use the real symbol art if it has been added
  ART = await new Promise((r) => { const i = new Image(); i.onload = () => r(true); i.onerror = () => r(false); i.src = "img/slots/DIA.webp"; });
  reels.forEach((_, r) => { buildReel(r); setReel(r, pos[r] + N, false); });
  $("paytable").innerHTML = "<tr><th>שלושה בקו</th><th>משלם</th></tr>" + Object.entries(PAY).map(([k, v]) => `<tr><td><span class="pt">${sym(k)}${sym(k)}${sym(k)}</span> <small>${NAME[k]}</small></td><td class="num">${v}x</td></tr>`).join("");
  if (PREVIEW) { balance = 10000; showBal(balance); GC_LOADER.done(); return; }
  const { data: { session } } = await db.auth.getSession();
  if (!session) { location.href = "./"; return; }
  GC_GUIDE.init({ game: "slots", db, mount: document.querySelector(".top"), steps: GC_STEPS.slots() });
  const { data: w } = await db.from("wallets").select("balance").eq("user_id", session.user.id).single();
  if (w) { balance = w.balance; showBal(balance); }
  GC_LOADER.done();
})();
