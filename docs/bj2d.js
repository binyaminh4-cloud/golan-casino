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
const SHOE = { x: 1340, y: 330 };
const TRAY = { x: 846, y: 330 };
const SPOTS = [ { x: 838, y: 613 }, { x: 1153, y: 580 }, { x: 524, y: 580 }, { x: 1375, y: 497 }, { x: 300, y: 497 } ];
const dealerPos = (i) => ({ x: 782 + i * 60, y: 372 });
const cardPos = (h, i) => ({ x: SPOTS[h].x - 38 + i * 24, y: SPOTS[h].y - 86 - i * 7 });
const SEATS = [ // where characters sit; index 0 is the player
  { x: 838, top: 700, w: 300 }, { x: 524, top: 665, w: 270 }, { x: 1153, top: 665, w: 270 }, { x: 300, top: 610, w: 230 }, { x: 1375, top: 610, w: 230 },
];

// ---------- fit the stage to the screen ----------
function fit() {
  const s = Math.min(innerWidth / 1672, (innerHeight - 40) / 941) * (innerWidth < 760 ? 1 : 1);
  $("stage").style.transform = `scale(${s})`;
  $("fit").style.paddingTop = Math.max(0, (innerHeight - 941 * s) / 2 - 60) + "px";
}
addEventListener("resize", fit); fit();

// ---------- dealer poses ----------
const POSES = ["idle", "deal", "flip", "collect", "pay", "celebrate"];
POSES.forEach((p) => { const i = new Image(); i.src = `img/dealer/${p}.webp`; });
function pose(p) { $("dealer").src = `img/dealer/${p}.webp`; }

// ---------- drawing helpers ----------
const layer = $("layer");
function el(cls, x, y, html = "") { const d = document.createElement("div"); d.className = cls; d.style.left = x + "px"; d.style.top = y + "px"; d.innerHTML = html; layer.appendChild(d); return d; }
function faceUp(d, card) { d.classList.remove("back"); d.style.backgroundImage = `url(cards/${card}.svg)`; d.dataset.card = card; }
async function flyCard(card, to, fromHand = true) {
  if (fromHand) { pose("deal"); }
  const d = el("card back", SHOE.x, SHOE.y);
  d.style.transition = reduced ? "none" : "left .38s cubic-bezier(.2,.7,.2,1), top .38s cubic-bezier(.2,.7,.2,1), transform .38s";
  d.style.transform = "perspective(900px) rotateX(46deg) rotate(-30deg)";
  await new Promise(requestAnimationFrame);
  d.style.left = to.x + "px"; d.style.top = to.y + "px"; d.style.transform = "perspective(900px) rotateX(46deg)";
  await sleep(390);
  if (card !== "??") faceUp(d, card);
  pose("idle");
  return d;
}
function chipColor(v) { return v >= 1000 ? "#b07a1f" : v >= 500 ? "#6b2a8a" : v >= 100 ? "#222" : v >= 25 ? "#1f6b3e" : "#1d4f8a"; }
function chipStack(x, y, amount, key) {
  const old = layer.querySelector(`[data-k="${key}"]`); if (old) old.remove();
  if (!amount) return null;
  const c = el("chip", x - 26, y - 14); c.dataset.k = key; c.style.background = c.style.color = chipColor(amount);
  c.title = fmt(amount); return c;
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
  const others = members.filter((m) => m.id !== me.id).slice(0, 4);
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
function placeActs(h) { const s = SPOTS[h] || SPOTS[0]; const a = $("acts"); a.style.left = s.x + "px"; a.style.top = (s.y + 39) + "px"; }

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
    for (let c = handEls[h].length; c < next.hands[h].cards.length; c++) { handEls[h].push(await flyCard(next.hands[h].cards[c], cardPos(h, c))); await sleep(60); }
  }
  // dealer reveals the hole card, then draws
  if (dealerEls[1] && !dealerEls[1].dataset.card && next.dealer[1] !== "??") {
    pose("flip"); await sleep(260); faceUp(dealerEls[1], next.dealer[1]); await sleep(420); pose("idle");
  }
  for (let c = dealerEls.length; c < next.dealer.length; c++) { dealerEls.push(await flyCard(next.dealer[c], dealerPos(c))); await sleep(320); }
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
      await slide(pay, SPOTS[i].x + 4, SPOTS[i].y - 4, 600);
    }
  }));
  await sleep(1200); pose("idle");
}
let msgT; function showMsg(t, sub) { const m = $("msg"); m.innerHTML = esc(t) + (sub ? `<small>${esc(sub)}</small>` : ""); m.classList.add("show"); clearTimeout(msgT); msgT = setTimeout(() => m.classList.remove("show"), 3600); }

// ---------- betting ----------
let chip = 25, target = "main"; const bets = { main: 0, pp: 0, t3: 0, ll: 0, bust: 0 }; let lastBets = null;
document.querySelectorAll(".betui .chip").forEach((b) => b.onclick = () => { chip = +b.dataset.v; document.querySelectorAll(".betui .chip").forEach((x) => x.setAttribute("aria-pressed", x === b)); addBet(); });
document.querySelectorAll(".t").forEach((b) => b.onclick = () => { target = b.dataset.k; document.querySelectorAll(".t").forEach((x) => x.setAttribute("aria-pressed", x === b)); });
function addBet() {
  if (st && st.status !== "done") return;
  if (st?.status === "done") clearRound();
  const next = bets[target] + chip;
  if (target === "main" && next > 50000) return err("ההימור הראשי המקסימלי הוא ₪50,000.");
  if (target !== "main" && next > bets.main) return err("הימור צדדי לא יכול להיות גבוה מההימור הראשי. הנח קודם הימור ראשי.");
  bets[target] = next; err(""); renderBets();
}
function renderBets() {
  document.querySelectorAll("[data-sum]").forEach((b) => b.textContent = bets[b.dataset.sum] ? fmt(bets[b.dataset.sum]) : "");
  chipStack(SPOTS[0].x, SPOTS[0].y, bets.main, "hand0");
  $("dealBtn").disabled = !bets.main; $("rebetBtn").disabled = !lastBets;
}
$("clearBtn").onclick = () => { Object.keys(bets).forEach((k) => bets[k] = 0); renderBets(); };
$("rebetBtn").onclick = () => { if (!lastBets) return; if (st?.status === "done") clearRound(); Object.assign(bets, lastBets); renderBets(); };
$("dealBtn").onclick = async () => {
  if (busy || !bets.main) return;
  if (st?.status === "done") clearRound();
  err(""); busy = true; $("dealBtn").disabled = true;
  const { data, error } = await db.rpc("bj_deal", { p_main: bets.main, p_pp: bets.pp, p_t3: bets.t3, p_ll: bets.ll, p_bust: bets.bust, p_ref: crypto.randomUUID() });
  busy = false;
  if (error) { renderBets(); return err(errText(error)); }
  lastBets = { ...bets }; Object.keys(bets).forEach((k) => bets[k] = 0);
  document.querySelectorAll("[data-sum]").forEach((b) => b.textContent = "");
  $("betUI").hidden = true;
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
  $("acts").hidden = !playing; $("betUI").hidden = !!playing;
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
  return "משהו השתבש. בדוק חיבור ונסה שוב.";
}
$("rulesBtn").onclick = () => $("rules").showModal();

// ---------- start ----------
async function resume() { const { data } = await db.rpc("bj_current"); if (data) { clearRound(); $("betUI").hidden = true; await render(data); } }
(async () => {
  const { data: { session } } = await db.auth.getSession();
  if (!session && location.hash === "#preview") {   // visual check only: no server, no wallet, no member images
    me = { id: "p", nickname: "שחקן לדוגמה" }; members = [{ id: "p", nickname: "שחקן לדוגמה", wealth: 10250 }, { id: "a", nickname: "חבר", wealth: 8900 }, { id: "b", nickname: "חבר", wealth: 12400 }];
    drawSeats(); setMyBalance(10250); $("betUI").hidden = true;
    await render({ id: "x", status: "playing", active: 0, actions: ["hit", "stand", "double"], balance: 10250, dealer_total: 10,
      dealer: ["KH", "??"], hands: [{ cards: ["AS", "9D"], bet: 100, total: 20 }] });
    return;
  }
  if (!session) { location.href = "./"; return; }
  const { data: prof } = await db.from("profiles").select("id,nickname").eq("id", session.user.id).single();
  me = prof || { id: session.user.id, nickname: "אני" };
  const { data: w } = await db.from("wallets").select("balance").eq("user_id", me.id).single();
  await loadSeats();
  if (w) setMyBalance(w.balance);
  renderBets(); await resume(); showControls();
})();
