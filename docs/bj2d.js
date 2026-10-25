// Golan Casino · blackjack table (2D over the casino photo).
// All game logic and randomness live in the database (bj_deal / bj_action / bj_current).
// This file only draws the state and sends the player's choices.
const db = supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);
const $ = (id) => document.getElementById(id);
const fmt = (n) => "₪" + Number(n).toLocaleString("en-US");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));

// ---------- geometry, in photo pixels (1672x941) ----------
const SHOE = { x: 650, y: 360 };   // cards leave from the dealer's hand
const TRAY = { x: 846, y: 330 };
const SPOTS = [ { x: 838, y: 613 }, { x: 1153, y: 580 }, { x: 524, y: 580 }, { x: 1375, y: 497 }, { x: 300, y: 497 } ];
// small side-bet circles around the player's main circle (photo pixels)
const SIDE_SPOTS = { pp: { x: 718, y: 588, t: "PP" }, t3: { x: 958, y: 588, t: "21+3" }, ll: { x: 744, y: 668, t: "LL" }, bust: { x: 932, y: 668, t: "BB" } };
const dealerPos = (i) => ({ x: 760 + i * 92, y: 352 });
const cardPos = (h, i) => ({ x: SPOTS[h].x - 60 + i * 34, y: SPOTS[h].y - 140 - i * 9 });
const SEATS = [ // where characters sit; index 0 is the player
  { x: 838, top: 700, w: 300 }, { x: 524, top: 665, w: 270 }, { x: 1153, top: 665, w: 270 }, { x: 300, top: 610, w: 230 }, { x: 1375, top: 610, w: 230 },
];

// ---------- fit the stage to the screen ----------
let PHONE = false;
function fit() {
  // landscape only on phones (portrait shows a rotate prompt). Short landscape screens get a side control panel.
  const W = innerWidth, H = innerHeight; PHONE = W / H < 1; const LAND = !PHONE && H < 560;
  document.body.classList.toggle("land", LAND);
  const st = $("stage"), acts = $("acts");
  let s, left, top;
  if (PHONE) { s = Math.min(W / 640, (H - 170) / 860); left = W / 2 - 838 * s; top = Math.max(44, (H - 120 - 900 * s) / 2); }
  else if (LAND) { const side = 190, avail = W - side; s = Math.min(avail / 1500, (H - 40) / 900); left = side + (avail - 1672 * s) / 2; top = 40 - 30 * s; }
  else { s = Math.min(W / 1672, (H - 150) / 941); left = (W - 1672 * s) / 2; top = Math.max(44, (H - 150 - 941 * s) / 2 + 44); }
  st.style.transform = `scale(${s})`; st.style.left = left + "px"; st.style.top = top + "px";
  const out = PHONE || LAND;
  if (out && acts.parentElement !== document.body) { document.body.appendChild(acts); acts.classList.add("phone"); }
  if (!out && acts.parentElement === document.body) { st.appendChild(acts); acts.classList.remove("phone"); }
}
addEventListener("resize", fit); fit();

// ---------- dealer poses ----------
const POSES = ["idle", "deal", "flip", "collect", "pay", "celebrate"];
POSES.forEach((p) => { const i = new Image(); i.src = `img/dealer/m_${p}.webp`; });
function pose(p) { $("dealer").src = `img/dealer/m_${p}.webp`; }

// ---------- drawing helpers ----------
const layer = $("layer");
function el(cls, x, y, html = "") { const d = document.createElement("div"); d.className = cls; d.style.left = x + "px"; d.style.top = y + "px"; d.innerHTML = html; layer.appendChild(d); return d; }
function faceUp(d, card) { d.classList.remove("back"); d.style.backgroundImage = `url(cards/${card}.svg)`; d.dataset.card = card; }
async function flyCard(card, to, fromHand = true) {
  if (fromHand) { pose("deal"); await sleep(220); }
  const d = el("card back", SHOE.x, SHOE.y);
  d.style.transform = "perspective(900px) rotateX(46deg) rotate(-35deg) scale(.7)";
  d.getBoundingClientRect();                                   // commit the start position before moving
  d.style.transition = reduced ? "none" : "left .62s cubic-bezier(.25,.6,.2,1), top .62s cubic-bezier(.25,.6,.2,1), transform .62s ease-out";
  d.style.left = to.x + "px"; d.style.top = to.y + "px"; d.style.transform = "perspective(900px) rotateX(46deg)";
  await sleep(640);
  if (card !== "??") { d.classList.add("flip"); await sleep(140); faceUp(d, card); await sleep(160); d.classList.remove("flip"); }
  pose("idle"); await sleep(180);
  return d;
}
function chipColor(v) { return v >= 1000 ? "#b07a1f" : v >= 500 ? "#6b2a8a" : v >= 100 ? "#222" : v >= 25 ? "#1f6b3e" : "#1d4f8a"; }
// A bet on the felt: a chip centred exactly on (x,y) with the amount written under it. Left/top = centre.
function chipStack(x, y, amount, key, small = false) {
  const old = layer.querySelector(`[data-k="${key}"]`); if (old) old.remove();
  if (!amount) return null;
  const w = el("cstack" + (small ? " small" : ""), x, y); w.dataset.k = key;
  const col = chipColor(amount);
  w.innerHTML = `<div class="chip3" style="background:${col};color:${col}"><span>${amount >= 1000 ? +(amount / 1000).toFixed(1) + "K" : amount}</span></div><div class="camt">${fmt(amount)}</div>`;
  w.title = fmt(amount); return w;
}
async function slide(node, x, y, ms = 500) {
  if (!node) return; node.style.transition = reduced ? "none" : `left ${ms}ms ease, top ${ms}ms ease, opacity ${ms}ms`;
  await new Promise(requestAnimationFrame); node.style.left = x + "px"; node.style.top = y + "px"; await sleep(ms);
}

// ---------- characters at the table ----------
let me = null, members = [], urls = {};
async function loadSeats() {
  const { data } = await db.from("leaderboard").select("id,nickname,character_key,wealth").order("wealth", { ascending: false });
  members = data || [];
  const keys = [...new Set(members.map((m) => m.character_key).filter(Boolean))];
  if (keys.length) {
    const { data: signed } = await db.storage.from("characters").createSignedUrls(keys.map((k) => k + ".webp"), 3600);
    (signed || []).forEach((s, i) => { if (s.signedUrl) urls[keys[i]] = s.signedUrl; });
  }
  drawSeats();
}
function drawSeats() {
  const others = [];  // solo game: only the player sits at the table
  const mine = members.find((m) => m.id === me.id) || { nickname: me.nickname, character_key: null, wealth: 0 };
  const list = [mine, ...others];
  $("seats").innerHTML = list.map((m, i) => {
    const s = SEATS[i], src = urls[m.character_key];
    const img = src ? `<img src="${esc(src)}" alt="">` : `<img src="img/dealer/idle.webp" alt="" style="visibility:hidden">`;
    return `<div class="char ${i === 0 ? "me" : ""} ${src ? "" : "ghost"}" id="seat${i}" style="left:${s.x}px;top:${s.top}px;width:${s.w}px">${img}
      <div class="tag"><div class="name">${esc(m.nickname)}${i === 0 ? "" : ""}</div><div class="b" data-bal="${i}">${fmt(m.wealth)}</div></div></div>`;
  }).join("");
}
function setMyBalance(v) { $("bal").textContent = fmt(v); const b = document.querySelector('[data-bal="0"]'); if (b) b.textContent = fmt(v); }

// ---------- round rendering ----------
let st = null, busy = false, dealerEls = [], handEls = [], totals = [], ring = null;
function clearRound() {
  layer.innerHTML = ""; dealerEls = []; handEls = []; totals = []; ring = null; st = null;
  $("seat0")?.classList.remove("jump", "sad"); pose("idle");
}
function label(txt, x, y, cls = "") { const t = el("total " + cls, x, y, esc(txt)); return t; }
function placeActs(h) { if (PHONE) return; const s = SPOTS[h] || SPOTS[0]; const a = $("acts"); a.style.left = s.x + "px"; a.style.top = (s.y + 39) + "px"; }

async function render(next) {
  busy = true; lockActs();
  const n = next.hands.length;
  // a split: move the second card of the split hand to its new spot
  while (handEls.length && handEls.length < n) {
    const i = handEls.findIndex((hc, k) => hc.length >= 2 && hc[1].dataset.card !== next.hands[k].cards[1]);
    if (i < 0) break;
    const moved = handEls[i].splice(1, 1)[0];
    handEls.splice(i + 1, 0, [moved]);
    const to = cardPos(i + 1, 0); await slide(moved, to.x, to.y, 320);
  }
  // initial deal: player, dealer, player, dealer
  if (!dealerEls.length && !handEls.length) {
    handEls = next.hands.map(() => []);
    for (const [who, i] of [["p", 0], ["d", 0], ["p", 1], ["d", 1]]) {
      if (who === "p") handEls[0].push(await flyCard(next.hands[0].cards[i], cardPos(0, i)));
      else dealerEls.push(await flyCard(next.dealer[i], dealerPos(i)));
      await sleep(80);
    }
  }
  // bets on each hand
  next.hands.forEach((h, i) => chipStack(SPOTS[i].x, SPOTS[i].y, h.bet, "hand" + i));
  // new player cards
  for (let h = 0; h < n; h++) {
    handEls[h] ||= [];
    for (let c = handEls[h].length; c < next.hands[h].cards.length; c++) { handEls[h].push(await flyCard(next.hands[h].cards[c], cardPos(h, c))); await sleep(250); }
  }
  // dealer reveals the hole card, then draws
  if (dealerEls[1] && !dealerEls[1].dataset.card && next.dealer[1] !== "??") {
    pose("flip"); await sleep(260); faceUp(dealerEls[1], next.dealer[1]); await sleep(420); pose("idle");
  }
  for (let c = dealerEls.length; c < next.dealer.length; c++) { dealerEls.push(await flyCard(next.dealer[c], dealerPos(c))); await sleep(450); }
  // totals
  totals.forEach((t) => t.remove()); totals = [];
  const OUT = { win: "ניצחון", blackjack: "בלאק ג׳ק!", push: "תיקו", lose: "הפסד", bust: "נשרף", surrender: "ויתור" };
  next.hands.forEach((h, i) => {
    const o = next.result?.hands?.[i]?.outcome;
    const cls = o === "win" || o === "blackjack" ? "win" : o && o !== "push" ? "lose" : "";
    totals.push(label(o ? `${h.total} · ${OUT[o]}` : h.total, SPOTS[i].x + 46, SPOTS[i].y - 74, cls));
  });
  totals.push(label(next.dealer_total, 905 + Math.max(0, next.dealer.length - 2) * 60, 384));
  // highlight the active hand when split
  if (ring) { ring.remove(); ring = null; }
  if (next.status === "playing" && n > 1) { const s = SPOTS[next.active]; ring = el("ring", s.x - 75, s.y - 31); }
  st = next; setMyBalance(next.balance);
  if (next.status === "done") await finish(next);
  busy = false; showControls();
}

const SIDE_NAME = { pp: "זוג מושלם", t3: "21+3", ll: "ליידיז מזל", bust: "באסטר", insurance: "ביטוח" };
async function finish(r) {
  const net = r.result.net, outs = r.result.hands.map((h) => h.outcome);
  let head = net > 0 ? `ניצחת ${fmt(net)}` : net < 0 ? `הפסדת ${fmt(-net)}` : "יצאת באפס";
  if (outs.length === 1 && outs[0] === "blackjack") head = `בלאק ג׳ק! ${fmt(net)}`;
  const sides = Object.entries(r.result.side || {}).filter(([, v]) => v && v !== 0).map(([k, v]) => `${SIDE_NAME[k]}${typeof v === "number" ? " " + v + ":1" : ""}`);
  showMsg(head, r.result.dealer_blackjack ? "לדילרית יש בלאק ג׳ק" : sides.length ? "זכייה: " + sides.join(" · ") : "");
  const won = net > 0;
  $("seat0")?.classList.add(won ? "jump" : net < 0 ? "sad" : "x");
  pose(outs.includes("blackjack") ? "celebrate" : won ? "pay" : net < 0 ? "collect" : "idle");
  // chips: losers go to the tray, winners get paid next to their bet
  await Promise.all(outs.map(async (o, i) => {
    const c = layer.querySelector(`[data-k="hand${i}"]`); if (!c) return;
    if (o === "lose" || o === "bust") { c.style.opacity = "0"; await slide(c, TRAY.x, TRAY.y, 600); }
    else if (o === "win" || o === "blackjack") {
      const pay = chipStack(TRAY.x, TRAY.y, r.hands[i].bet, "pay" + i);
      await slide(pay, SPOTS[i].x + 70, SPOTS[i].y - 6, 600);
    }
  }));
  await sleep(1200); pose("idle");
}
let msgT; function showMsg(t, sub) { const m = $("msg"); m.innerHTML = esc(t) + (sub ? `<small>${esc(sub)}</small>` : ""); m.classList.add("show"); clearTimeout(msgT); msgT = setTimeout(() => m.classList.remove("show"), 3600); }

// ---------- betting: pick a chip, then tap the main circle or a side-bet circle ----------
let chip = 25; const bets = { main: 0, pp: 0, t3: 0, ll: 0, bust: 0 }; let lastBets = null;
document.querySelectorAll(".betui .chip").forEach((b) => b.onclick = () => { chip = +b.dataset.v; document.querySelectorAll(".betui .chip").forEach((x) => x.setAttribute("aria-pressed", x === b)); });
function drawBetSpots() {
  document.querySelectorAll(".spot").forEach((n) => n.remove());
  const stage = $("stage");
  const mk = (k, x, y, w, h, label) => {
    const b = document.createElement("button"); b.className = "spot" + (k === "main" ? " main" : ""); b.dataset.k = k;
    b.style.left = x - w / 2 + "px"; b.style.top = y - h / 2 + "px"; b.style.width = w + "px"; b.style.height = h + "px";
    b.innerHTML = label ? `<span>${label}</span>` : ""; b.setAttribute("aria-label", k === "main" ? "הימור ראשי" : SIDE_NAME[k]);
    b.onclick = () => addBet(k); stage.appendChild(b);
  };
  mk("main", SPOTS[0].x, SPOTS[0].y, 170, 92, "");
  for (const [k, p] of Object.entries(SIDE_SPOTS)) mk(k, p.x, p.y, 76, 48, p.t);
}
function setSpotsVisible(v) { document.querySelectorAll(".spot").forEach((n) => n.hidden = !v); }
function addBet(target) {
  if (st && st.status !== "done") return;
  if (st?.status === "done") { clearRound(); }
  const next = bets[target] + chip;
  if (target === "main" && next > 50000) return err("ההימור הראשי המקסימלי הוא ₪50,000.");
  if (target !== "main" && next > bets.main) return err("הימור צדדי לא יכול להיות גבוה מההימור הראשי. שים קודם צ׳יפ על העיגול הגדול.");
  bets[target] = next; err(""); renderBets();
}
function renderBets() {
  chipStack(SPOTS[0].x, SPOTS[0].y, bets.main, "hand0");
  for (const [k, p] of Object.entries(SIDE_SPOTS)) chipStack(p.x, p.y, bets[k], "side_" + k, true);
  $("dealBtn").disabled = !bets.main; $("rebetBtn").disabled = !lastBets;
  $("betSum").textContent = Object.values(bets).some(Boolean) ? "סה״כ " + fmt(Object.values(bets).reduce((a, b) => a + b, 0)) : "בחר צ׳יפ ולחץ על העיגול הגדול. העיגולים הקטנים הם הימורים צדדיים: PP זוג מושלם · 21+3 · LL ליידיז מזל · BB באסטר";
}
$("clearBtn").onclick = () => { Object.keys(bets).forEach((k) => bets[k] = 0); renderBets(); };
$("rebetBtn").onclick = () => { if (!lastBets) return; if (st?.status === "done") clearRound(); Object.assign(bets, lastBets); renderBets(); };
$("dealBtn").onclick = async () => {
  if (busy || !bets.main) return;
  if (st?.status === "done") clearRound();
  err(""); busy = true; $("dealBtn").disabled = true;
  let data, error;
  try { ({ data, error } = await db.rpc("bj_deal", { p_main: bets.main, p_pp: bets.pp, p_t3: bets.t3, p_ll: bets.ll, p_bust: bets.bust, p_ref: newRef() })); }
  catch (ex) { error = { message: String(ex && ex.message || ex), code: "JS" }; }
  busy = false;
  if (error) { renderBets(); return err(errText(error)); }
  lastBets = { ...bets }; Object.keys(bets).forEach((k) => bets[k] = 0);
  $("betUI").hidden = true; setSpotsVisible(false);
  layer.querySelectorAll('[data-k^="side_"]').forEach((n) => n.remove());
  await render(data);
};
document.querySelectorAll("#acts .a").forEach((b) => b.onclick = async () => {
  if (busy || !st) return;
  busy = true; lockActs();
  const { data, error } = await db.rpc("bj_action", { p_round: st.id, p_action: b.dataset.a });
  busy = false;
  if (error) { showControls(); return err(errText(error)); }
  await render(data);
});
function lockActs() { document.querySelectorAll("#acts .a").forEach((b) => b.disabled = true); }
function showControls() {
  const playing = st && st.status !== "done";
  $("acts").hidden = !playing; $("betUI").hidden = !!playing; setSpotsVisible(!playing);
  if (playing) { placeActs(st.active); document.querySelectorAll("#acts .a").forEach((b) => { b.hidden = !st.actions.includes(b.dataset.a); b.disabled = busy; }); }
  $("rebetBtn").disabled = !lastBets; $("dealBtn").disabled = !bets.main;
}
function err(t) { $("err").textContent = t; }
function errText(e) {
  const m = e.message || "";
  if (m.includes("insufficient_funds")) return "אין מספיק שקלים משחקיים להימור הזה. הקטן את ההימור.";
  if (m.includes("invalid_side_bet")) return "הימור צדדי לא יכול להיות גבוה מההימור הראשי.";
  if (m.includes("invalid_main_bet")) return "ההימור הראשי חייב להיות בין ₪10 ל־₪50,000.";
  if (m.includes("illegal_action")) return "הפעולה הזאת לא אפשרית כרגע.";
  if (m.includes("round_in_progress")) { resume(); return "יש לך יד פתוחה. ממשיכים ממנה."; }
  console.error("rpc error", e);
  return "משהו השתבש (" + (e.code || "") + " " + m.slice(0, 80) + "). צלם לי את המסך.";
}
function newRef() { try { return crypto.randomUUID(); } catch { return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); } }
$("rulesBtn").onclick = () => $("rules").showModal();

// ---------- start ----------
async function resume() { const { data } = await db.rpc("bj_current"); if (data) { clearRound(); $("betUI").hidden = true; await render(data); } }
(async () => {
  const { data: { session } } = await db.auth.getSession();
  if (!session && location.hash === "#preview") {   // visual check only: no server, no wallet, no member images
    me = { id: "p", nickname: "שחקן לדוגמה" }; members = [{ id: "p", nickname: "שחקן לדוגמה", wealth: 10250 }, { id: "a", nickname: "חבר", wealth: 8900 }, { id: "b", nickname: "חבר", wealth: 12400 }];
    GC_LOADER.done(); drawSeats(); setMyBalance(10250); drawBetSpots(); renderBets(); if (location.search.includes("bet")) { showControls(); return; } $("betUI").hidden = true; setSpotsVisible(false);
    await render({ id: "x", status: "playing", active: 0, actions: ["hit", "stand", "double"], balance: 10250, dealer_total: 10,
      dealer: ["KH", "??"], hands: [{ cards: ["AS", "9D"], bet: 100, total: 20 }] });
    return;
  }
  if (!session) { location.href = "./"; return; }
  GC_GUIDE.init({ game: "blackjack", db, mount: document.querySelector(".top"), steps: GC_STEPS.blackjack() });
  const { data: prof } = await db.from("profiles").select("id,nickname").eq("id", session.user.id).single();
  me = prof || { id: session.user.id, nickname: "אני" };
  const { data: w } = await db.from("wallets").select("balance").eq("user_id", me.id).single();
  await loadSeats();
  if (w) setMyBalance(w.balance);
  drawBetSpots(); renderBets(); await resume(); showControls();
  await Promise.all([...document.querySelectorAll("#stage img, #seats img")].map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
  GC_LOADER.done();
})();
