// Golan Casino · blackjack table (2D over the casino photo).
// All game logic and randomness live in the database (bj_deal / bj_action / bj_current).
// This file only draws the state and sends the player's choices.
const db = supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);
const $ = (id) => document.getElementById(id);
const fmt = (n) => { n = Number(n); const a = Math.abs(n); return a >= 1e12 ? "₪" + +(n / 1e12).toFixed(2) + "T" : a >= 1e9 ? "₪" + +(n / 1e9).toFixed(2) + "B" : a >= 1e6 ? "₪" + +(n / 1e6).toFixed(2) + "M" : "₪" + n.toLocaleString("en-US"); };   // ₪1.58M · ₪2.4B · ₪1T
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MODE = new URLSearchParams(location.search).get("mode") === "lightning" ? "lightning" : "classic";
const CH_ID = new URLSearchParams(location.search).get("ch");      // a challenge run: chips instead of the wallet
let CH = null;
const LIT = MODE === "lightning";
// shared table: friends play together against one dealer (?table=1). Solo game otherwise.
const TABLE = !LIT && !CH_ID ? (+new URLSearchParams(location.search).get("table") || 0) : 0;
let STRIKES = {};          // Fisher's strikes for this hand: {"A": 5, "7": 3}
const RANK = (r) => r === "T" ? "10" : r;
const sleep = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));

// ---------- geometry, in photo pixels (1672x941) ----------
const SHOE = { x: 650, y: 360 }, HAND = { x: 704, y: 333 };   // cards leave from the dealer's hand
const TRAY = { x: 846, y: 330 };
const SPOTS = [ { x: 838, y: 613 }, { x: 1153, y: 580 }, { x: 524, y: 580 }, { x: 1375, y: 497 }, { x: 300, y: 497 } ];
// small side-bet circles around the player's main circle (photo pixels)
const SIDE_SPOTS = { pp: { x: 718, y: 588, t: "PP" }, t3: { x: 958, y: 588, t: "21+3" }, ll: { x: 744, y: 668, t: "LL" }, bust: { x: 932, y: 668, t: "BB" } };
const dealerPos = (i) => ({ x: 760 + i * 92, y: 352 });
// my hand spots; at the shared table the other seats belong to friends, so my split hands stay around my seat
const spot = (h) => !TABLE || !h ? (SPOTS[h] || SPOTS[0]) : { x: SPOTS[0].x + (h % 2 ? 175 : -175) * Math.ceil(h / 2), y: SPOTS[0].y + 20 };
const cardPos = (h, i) => ({ x: spot(h).x - 60 + i * 34, y: spot(h).y - 140 - i * 9 });
const SEAT2SPOT = [0, 2, 1, 4, 3];   // SEATS[k] sits behind SPOTS[SEAT2SPOT[k]]
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
  else if (LAND) { s = Math.min(W / 1560, (H - 40) / 880); left = (W - 1672 * s) / 2; top = 40 - 40 * s; }
  else { s = Math.min(W / 1672, (H - 150) / 941); left = (W - 1672 * s) / 2; top = Math.max(44, (H - 150 - 941 * s) / 2 + 44); }
  st.style.transform = `scale(${s})`; st.style.left = left + "px"; st.style.top = top + "px";
  const out = PHONE || LAND;
  if (acts.classList.contains("zoombar")) return;
  if (out) { if (acts.parentElement !== document.body) document.body.appendChild(acts); acts.classList.add("phone"); }   // also after leaving the zoom bar
  if (!out && acts.parentElement === document.body) { st.appendChild(acts); acts.classList.remove("phone"); }
}
addEventListener("resize", fit); fit();

// ---------- dealer poses ----------
const FR = ["i01","i02","i03","d01_reach","d02_pull","d03_lift","d04_slide","d05_release","d06_return","f01_touch","f02_turn","f03_done","p01_pay","p02_back","c01_collect","c02_rest"];
FR.forEach((f) => { const i = new Image(); i.src = `img/dealer2/${f}.webp?v=2`; }); { const i = new Image(); i.src = "img/dealer/m_celebrate.webp?v=2"; }
let poseTok = 0, curFrame = "i01";
function frame(f) { curFrame = f; $("dealer").src = f === "celebrate" ? "img/dealer/m_celebrate.webp?v=2" : `img/dealer2/${f}.webp?v=2`; }
async function seq(list) { const tok = ++poseTok; for (const [f, ms] of list) { if (tok !== poseTok) return false; frame(f); await sleep(ms); } return tok === poseTok; }
function pose(p) {
  if (p === "pay") return seq([["p01_pay", 900], ["p02_back", 700], ["i01", 0]]);
  if (p === "collect") return seq([["c01_collect", 900], ["c02_rest", 900], ["i01", 0]]);
  if (p === "flip") return seq([["f01_touch", 130], ["f02_turn", 0]]);
  poseTok++; frame(p === "celebrate" ? "celebrate" : p === "deal" ? "d04_slide" : "i01");
}
// a little life while waiting: she blinks, and now and then winks
let lifeN = 0; setInterval(() => { if (curFrame !== "i01" || document.hidden) return; const tok = poseTok; lifeN++;
  const f = lifeN % 5 === 0 ? ["i03", 900] : ["i02", 150]; frame(f[0]); setTimeout(() => { if (tok === poseTok && curFrame === f[0]) frame("i01"); }, f[1]); }, 3200);

// ---------- drawing helpers ----------
const layer = $("layer");
function el(cls, x, y, html = "") { const d = document.createElement("div"); d.className = cls; d.style.left = x + "px"; d.style.top = y + "px"; d.innerHTML = html; layer.appendChild(d); return d; }
function faceUp(d, card) { d.classList.remove("back"); d.style.backgroundImage = `url(cards3/${card}.webp)`; d.dataset.card = card;
  if (LIT && STRIKES[card[0]]) { d.classList.add("struck"); d.dataset.mx = "×" + STRIKES[card[0]]; } }
async function flyCard(card, to, fromHand = true) {
  // the dealer reaches to the shoe, draws the card and slides it out from her hand
  if (fromHand) await seq([["d01_reach", 100], ["d02_pull", 100], ["d03_lift", 80], ["d04_slide", 0]]);
  const from = fromHand ? HAND : SHOE, d = el("card back", from.x, from.y);
  d.style.transform = "perspective(900px) rotateX(46deg) rotate(-24deg) scale(.62)";
  d.getBoundingClientRect();                                   // commit the start position before moving
  d.style.transition = reduced ? "none" : "left .42s cubic-bezier(.2,.7,.25,1), top .42s cubic-bezier(.2,.7,.25,1), transform .42s cubic-bezier(.2,.7,.25,1)";
  d.style.left = to.x + "px"; d.style.top = to.y + "px"; d.style.transform = "perspective(900px) rotateX(46deg) rotate(" + ((Math.random() - .5) * 3).toFixed(1) + "deg)";
  if (fromHand) setTimeout(() => { if (curFrame === "d04_slide") frame("d05_release"); }, 90);
  await sleep(390); SFX.card(); await sleep(45);             // the sound when the card touches the felt
  if (card !== "??") { SFX.cardFlip(); d.classList.add("flip"); await sleep(105); faceUp(d, card); await sleep(120); d.classList.remove("flip"); }
  if (fromHand) { await seq([["d06_return", 105], ["i01", 0]]); } else pose("idle");
  return d;
}
function chipColor(v) { return v >= 1000 ? "#b07a1f" : v >= 500 ? "#6b2a8a" : v >= 100 ? "#222" : v >= 25 ? "#1f6b3e" : "#1d4f8a"; }
// A bet on the felt: a chip centred exactly on (x,y) with the amount written under it. Left/top = centre.
function chipStack(x, y, amount, key, small = false) {
  const old = layer.querySelector(`[data-k="${key}"]`); if (old) old.remove();
  if (!amount) return null;
  const w = el("cstack" + (small ? " small" : ""), x, y); w.dataset.k = key;
  const col = chipColor(amount);
  const gc = GC_CHIP(amount);
  w.innerHTML = `<div class="chip3 gcchip${gc.exact ? "" : " txt"}" style="background-image:url(${gc.url});color:#fff"><span>${String(fmt(amount)).slice(1)}</span></div><div class="camt">${fmt(amount)}</div>`;
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
  members.forEach((m) => { if (m.character_key?.startsWith("animal_")) urls[m.character_key] = "img/animals/" + m.character_key + ".svg"; if (m.character_key?.startsWith("pub_")) urls[m.character_key] = "img/chars/" + m.character_key + ".webp"; });
  const keys = [...new Set(members.map((m) => m.character_key).filter((k) => k && !k.startsWith("animal_") && !k.startsWith("pub_")))];
  if (keys.length) {
    const { data: signed } = await db.storage.from("characters").createSignedUrls(keys.map((k) => k + ".webp"), 3600);
    (signed || []).forEach((s, i) => { if (s.signedUrl) urls[keys[i]] = s.signedUrl; });
  }
  drawSeats();
}
function drawSeats() {
  const others = TABLE ? tOthers() : [];  // solo game: only the player sits at the table
  const mine = members.find((m) => m.id === me.id) || { nickname: me.nickname, character_key: null, wealth: 0 };
  const list = [mine, ...others];
  $("seats").innerHTML = list.map((m, i) => {
    const s = SEATS[i], src = urls[m.character_key];
    const img = src ? `<img src="${esc(src)}" alt="">` : `<img src="img/dealer/idle.webp" alt="" style="visibility:hidden">`;
    return `<div data-u="${m.id}" class="char ${i === 0 ? "me" : ""} ${src ? "" : "ghost"}" id="seat${i}" style="left:${s.x}px;top:${s.top}px;width:${s.w}px">${img}
      <div class="tag"><div class="name">${esc(m.nickname)}${i === 0 ? "" : ""}</div><div class="b" data-bal="${i}">${fmt(m.wealth)}</div></div></div>`;
  }).join("");
}
function setMyBalance(v) { if (!CH) { myBal = +v || 0; drawRack(); GC_LIMIT(Object.values(bets).reduce((a, b) => a + b, 0), maxBet(), myBal, fmt); } if (CH) v = CH.chips; $("bal").textContent = fmt(v); const b = document.querySelector('[data-bal="0"]'); if (b) b.textContent = fmt(v); }

// ---------- round rendering ----------
let st = null, busy = false, dealerEls = [], handEls = [], totals = [], ring = null;
function clearRound() {
  layer.innerHTML = ""; dLab = null; dealerEls = []; handEls = []; totals = []; ring = null; st = null;
  $("seat0")?.classList.remove("jump", "sad"); pose("idle");
}
function label(txt, x, y, cls = "") { const t = el("total " + cls, x, y, esc(txt)); return t; }
function placeActs(h) { if (PHONE || $("acts").classList.contains("zoombar")) return; const s = spot(h); const a = $("acts"); a.style.left = s.x + "px"; a.style.top = (s.y + 62) + "px"; }

let dLab = null;
function dTot(cards) { let t = 0, a = 0; for (const c of cards) { if (!c || c === "??") continue; const r = c.slice(0, -1); if (r === "A") { t += 11; a++; } else t += /[JQKT]|10/.test(r) ? 10 : +r; } while (t > 21 && a) { t -= 10; a--; } return t; }
function dLabel(cards) { if (!dLab && totals.length) totals.pop().remove(); if (dLab) dLab.remove(); dLab = label(dTot(cards), 905 + Math.max(0, cards.length - 2) * 60, 384); }
async function render(next) { try { return await render1(next); } finally { if (busy) { busy = false; showControls(); } } }
async function render1(next) {
  busy = true; lockActs();
  if (LIT && next.strikes && JSON.stringify(next.strikes) !== JSON.stringify(STRIKES)) { STRIKES = next.strikes; drawBoost(); }
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
      await sleep(60);
    }
  }
  // bets on each hand
  next.hands.forEach((h, i) => chipStack(spot(i).x, spot(i).y, h.bet, "hand" + i));
  for (const [k, p] of Object.entries(SIDE_SPOTS)) { const a = +(next.side?.[k] || 0); if (a && !layer.querySelector(`[data-k="side_${k}"]`)) chipStack(p.x, p.y, a, "side_" + k, true); }
  // new player cards
  for (let h = 0; h < n; h++) {
    handEls[h] ||= [];
    for (let c = handEls[h].length; c < next.hands[h].cards.length; c++) { handEls[h].push(await flyCard(next.hands[h].cards[c], cardPos(h, c))); await sleep(190); }
  }
  // dealer reveals the hole card, then draws
  if (dealerEls[1] && !dealerEls[1].dataset.card && next.dealer[1] !== "??") {
    await pose("flip"); SFX.cardFlip(); faceUp(dealerEls[1], next.dealer[1]); dLabel(next.dealer.slice(0, 2)); await seq([["f03_done", 420], ["i01", 0]]);
  }
  for (let c = dealerEls.length; c < next.dealer.length; c++) { dealerEls.push(await flyCard(next.dealer[c], dealerPos(c))); dLabel(next.dealer.slice(0, c + 1)); await sleep(340); }
  if (dLab) { dLab.remove(); dLab = null; }
  // totals
  totals.forEach((t) => t.remove()); totals = [];
  const OUT = { win: "ניצחון", blackjack: "בלאק ג׳ק!", push: "תיקו", lose: "הפסד", bust: "נשרף", surrender: "ויתור" };
  next.hands.forEach((h, i) => {
    const o = next.result?.hands?.[i]?.outcome;
    const cls = o === "win" || o === "blackjack" ? "win" : o && o !== "push" ? "lose" : "";
    totals.push(label(o ? `${h.total} · ${OUT[o]}` : h.total, spot(i).x + 46, spot(i).y - 74, cls));
  });
  totals.push(label(next.dealer_total, 905 + Math.max(0, next.dealer.length - 2) * 60, 384));
  // highlight the active hand when split
  if (ring) { ring.remove(); ring = null; }
  if (next.status === "playing" && n > 1) { const s = spot(next.active); ring = el("ring", s.x - 75, s.y - 31); }
  st = next; if (next.ch) { CH = { ...CH, ...next.ch }; drawCH(); } setMyBalance(next.balance);
  if (next.status === "done") await finish(next);
  busy = false; showControls();
}

const SIDE_NAME = { pp: "זוג מושלם", t3: "21+3", ll: "ליידיז מזל", bust: "באסטר", insurance: "ביטוח" };
async function finish(r) {
  const net = r.result.net, outs = r.result.hands.map((h) => h.outcome);
  let head = net > 0 ? `ניצחת ${fmt(net)}` : net < 0 ? `הפסדת ${fmt(-net)}` : "יצאת באפס";
  if (outs.length === 1 && outs[0] === "blackjack") head = `בלאק ג׳ק! ${fmt(net)}`;
  const sides = Object.entries(r.result.side || {}).filter(([, v]) => v && v !== 0).map(([k, v]) => `${SIDE_NAME[k]}${typeof v === "number" ? " " + v + ":1" : ""}`);
  const sd = r.result.side || {};
  if (LIT) {
    const ex = sd.strike_extra || 0, hm = (sd.hand_mults || []).filter((m, i) => m > 1 && (outs[i] === "win" || outs[i] === "blackjack"));
    showMsg(head, ex > 0 ? `⚡ הברק של פישר ×${Math.max(...hm)} הוסיף ${fmt(ex)}` : r.result.dealer_blackjack ? "לדילרית יש בלאק ג׳ק" : "");
    if (ex > 0) { GC_BONUS(`⚡ בונוס ברק ×${Math.max(...hm)}`, net, "הברק של פישר הכפיל את הרווח"); djPose("celebrate", 2200); djBurst(); SFX.drop(); const fl = document.createElement("div"); fl.className = "bjflash"; document.body.appendChild(fl); setTimeout(() => fl.remove(), 900); }
    else if ((sd.hand_mults || []).some((m) => m > 1)) djPose("shrug", 1600);
  } else
  showMsg(head, r.result.dealer_blackjack ? "לדילרית יש בלאק ג׳ק" : sides.length ? "זכייה: " + sides.join(" · ") : "");
  const won = net > 0; if (won) SFX.win(net >= r.staked * 5); else if (net < 0) SFX.lose();
  $("seat0")?.classList.add(won ? "jump" : net < 0 ? "sad" : "x");
  pose(outs.includes("blackjack") ? "celebrate" : won ? "pay" : net < 0 ? "collect" : "idle");
  // chips: losers go to the tray, winners get paid next to their bet
  await Promise.all(outs.map(async (o, i) => {
    const c = layer.querySelector(`[data-k="hand${i}"]`); if (!c) return;
    if (o === "lose" || o === "bust") { c.style.opacity = "0"; await slide(c, TRAY.x, TRAY.y, 600); }
    else if (o === "win" || o === "blackjack") {
      const pay = chipStack(TRAY.x, TRAY.y, r.hands[i].bet, "pay" + i);
      await slide(pay, spot(i).x + 70, spot(i).y - 6, 600);
    }
  }));
  // side bets: winners get a gold tag with the payout, losers slide to the tray
  const placed = r.side || {}, res = r.result.side || {};
  await Promise.all(Object.keys(SIDE_SPOTS).filter((k) => +placed[k] > 0).map(async (k) => {
    const c = layer.querySelector(`[data-k="side_${k}"]`); if (!c) return;
    const m = +res[k] || 0, p = SIDE_SPOTS[k];
    if (m > 0) { const t = el("sidewin", p.x, p.y - 46, `${SIDE_NAME[k]} +${fmt(placed[k] * m)}`); setTimeout(() => t.remove(), 3500); }
    else { const t = el("sidelose", p.x, p.y - 40, `${SIDE_NAME[k]} ✕`); setTimeout(() => t.remove(), 2200); c.style.opacity = "0"; await slide(c, TRAY.x, TRAY.y, 600); }
  }));
  await sleep(1200); pose("idle");
  const rid = r.id;   // a few seconds later the dealer clears the felt by herself
  setTimeout(() => { if (st && st.id === rid && st.status === "done" && !busy) { clearRound(); renderBets(); showControls(); if (TABLE) drawOthers(); } }, 4500);
}
let msgT; function showMsg(t, sub) { const m = $("msg"); m.innerHTML = esc(t) + (sub ? `<small>${esc(sub)}</small>` : ""); m.classList.add("show"); clearTimeout(msgT); msgT = setTimeout(() => m.classList.remove("show"), 3600); }

// ---------- betting: pick a chip, then tap the main circle or a side-bet circle ----------
let chip = 25; const bets = { main: 0, pp: 0, t3: 0, ll: 0, bust: 0 }; let lastBets = null;
// chips grow with the wallet: a chip shows once the wallet holds 20× its value; 5 chips on screen
const BJ_CHIPS = [10, 25, 100, 500, ...[1e3, 1e6, 1e9].flatMap((m) => [1, 5, 25, 100, 500].map((c) => c * m)), 1e12, 5e12], BJ_CC = ["c10", "c25", "c100", "c500", "c1000"];
let myBal = 0, rackKey = "";
const stepMax = (b) => { if (b < 500000) return 50000; let v = 500000, k = 0; for (;;) { const m = k % 3 === 1 ? 2.5 : 2; if (v * m > b) break; v *= m; k++; } return v / 5; };
const maxBet = () => stepMax(myBal);   // same steps as the server
function drawRack() {
  const ok = BJ_CHIPS.filter((v, i) => i < 5 || v * 20 <= myBal), show = ok.slice(-5), k = show.join(",");
  if (k === rackKey) return; rackKey = k; if (!show.includes(chip)) chip = show[1];
  const lab = (v) => v >= 1e12 ? +(v / 1e12).toFixed(1) + "T" : v >= 1e9 ? +(v / 1e9).toFixed(1) + "B" : v >= 1e6 ? +(v / 1e6).toFixed(1) + "M" : v >= 1000 ? +(v / 1000).toFixed(1) + "K" : v;
  document.querySelector(".betui .row").innerHTML = show.map((v, i) => `<button class="chip ${BJ_CC[BJ_CHIPS.indexOf(v) % 5]}" data-v="${v}" aria-pressed="${v === chip}">${lab(v)}</button>`).join("");
  document.querySelectorAll(".betui .chip").forEach((b) => GC_CHIPIFY(b, +b.dataset.v));
  document.querySelectorAll(".betui .chip").forEach((b) => b.onclick = () => { chip = +b.dataset.v; document.querySelectorAll(".betui .chip").forEach((x) => x.setAttribute("aria-pressed", x === b)); });
}
drawRack();
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
  if (!LIT && !CH_ID) for (const [k, p] of Object.entries(SIDE_SPOTS)) mk(k, p.x, p.y, 76, 48, p.t);
  drawBoost();
}
function setSpotsVisible(v) { document.querySelectorAll(".spot").forEach((n) => n.hidden = !v); }
function addBet(target) {
  if (st && st.status !== "done") return;
  if (TABLE && (!T || T.phase !== "betting" || T.my_bet)) return err(T && T.my_bet ? "ההימור שלך כבר על השולחן." : "ההימורים סגורים. הסיבוב הבא יתחיל עוד רגע.");
  if (st?.status === "done") { clearRound(); }
  const next = bets[target] + chip;
  if (target === "main" && next > maxBet()) return err(`ההימור הראשי המקסימלי הוא ${fmt(maxBet())}.`);
  if (target !== "main" && next > bets.main) return err("הימור צדדי לא יכול להיות גבוה מההימור הראשי. שים קודם צ׳יפ על העיגול הגדול.");
  bets[target] = next; err(""); renderBets(); SFX.chip();
}
// DJ Fisher (multiplier game): his poses come from the private "characters" bucket
const DJ = {}; let djEl = null, djT = null;
async function loadDJ() {
  if (!LIT) return;
  const poses = ["idle", "build", "drop", "shrug", "celebrate"];
  poses.forEach((p) => { DJ[p] = `img/lightning/dj_${p}.webp`; });   // public by the owner's choice
  if (!DJ.celebrate) DJ.celebrate = DJ.drop;
  if (!DJ.idle) return;
  Object.values(DJ).forEach((u) => { const i = new Image(); i.src = u; });
  djEl = document.createElement("div"); djEl.className = "dj";
  djEl.innerHTML = `<img alt="די־ג׳יי פישר" src="${DJ.idle}"><div class="waves"></div>`; $("stage").appendChild(djEl);
}
function djPose(p, back) { if (!djEl || !DJ[p]) return; djEl.querySelector("img").src = DJ[p]; djEl.className = "dj p-" + p;
  clearTimeout(djT); if (back) djT = setTimeout(() => djPose("idle"), back); }
function djBurst() { if (!djEl) return; const b = document.createElement("div"); b.className = "djburst"; djEl.appendChild(b); setTimeout(() => b.remove(), 1000); }
function drawBoost() {               // the strikes board next to the bet circle
  document.querySelectorAll(".boost").forEach((n) => n.remove()); if (!LIT) return;
  const e = Object.entries(STRIKES).sort((x, y) => y[1] - x[1]);
  const b = document.createElement("div"); b.className = "boost" + (e.length ? " on" : "");
  b.style.left = SPOTS[0].x - 215 + "px"; b.style.top = SPOTS[0].y + 10 + "px";
  b.innerHTML = e.length ? `<small>⚡ ברקים ביד הזאת</small><div class="sk">${e.map(([r, m]) => `<span><b class="num">${RANK(r)}</b><i class="num">×${m}</i></span>`).join("")}</div>`
                         : `⚡<small>פישר יפיל ברקים<br>כשתחלק קלפים</small>`;
  $("stage").appendChild(b);
}
async function fisherDrop(strikes) {      // DJ Fisher builds up... drops lightning on 2-3 card values
  STRIKES = {}; drawBoost();
  if (DJ.idle) { djPose("build"); SFX.riser(0.9); await sleep(850); djPose("drop", 1800); djBurst(); }
  SFX.drop(); const fl = document.createElement("div"); fl.className = "bjflash"; document.body.appendChild(fl); setTimeout(() => fl.remove(), 900);
  STRIKES = strikes; drawBoost(); document.querySelector(".boost")?.classList.add("zap");
  const e = Object.entries(strikes).sort((x, y) => y[1] - x[1]);
  showMsg("⚡ " + e.map(([r, m]) => `${RANK(r)} ×${m}`).join(" · "), "נצח עם אחד הקלפים האלה ביד, והרווח מוכפל");
  await sleep(1300);
}
function renderBets() {
  GC_LIMIT(Object.values(bets).reduce((a, b) => a + b, 0), maxBet(), myBal, fmt);
  chipStack(SPOTS[0].x, SPOTS[0].y, bets.main, "hand0");
  for (const [k, p] of Object.entries(SIDE_SPOTS)) chipStack(p.x, p.y, bets[k], "side_" + k, true);
  $("dealBtn").disabled = !bets.main; $("rebetBtn").disabled = !lastBets;
  if (LIT) { let ft = $("feeTag"); if (!ft) { ft = document.createElement("div"); ft.id = "feeTag"; ft.className = "feetag"; $("stage").appendChild(ft); }
    ft.style.left = SPOTS[0].x + 150 + "px"; ft.style.top = SPOTS[0].y + "px"; ft.hidden = !bets.main;
    ft.innerHTML = `⚡ עמלת ברק<b class="num">+${fmt(Math.ceil(bets.main / 2))}</b><small>חצי מההימור</small>`; }
  if (LIT) { const f = Math.ceil(bets.main / 2); $("betSum").textContent = bets.main ? `הימור ${fmt(bets.main)} + עמלת ברק ${fmt(f)} = ${fmt(bets.main + f)}` : "בחר צ׳יפ ולחץ על העיגול. פישר מפיל ברקים על 2–3 קלפים, וניצחון עם קלף כזה ביד מכפיל את הרווח ×2 עד ×25."; return; }
  $("betSum").textContent = Object.values(bets).some(Boolean) ? "סה״כ " + fmt(Object.values(bets).reduce((a, b) => a + b, 0)) : "בחר צ׳יפ ולחץ על העיגול הגדול. העיגולים הקטנים הם הימורים צדדיים: PP זוג מושלם · 21+3 · LL ליידיז מזל · BB באסטר";
}
$("clearBtn").onclick = () => { Object.keys(bets).forEach((k) => bets[k] = 0); renderBets(); };
$("rebetBtn").onclick = () => { if (!lastBets) return; if (st?.status === "done") clearRound(); Object.assign(bets, lastBets); renderBets(); };
$("dealBtn").onclick = async () => {
  if ($("feeTag")) $("feeTag").hidden = true;
  engaged = true;
  if (busy || !bets.main) return;
  if (st?.status === "done") clearRound();
  if (TABLE) return tableBet();
  err(""); busy = true; $("dealBtn").disabled = true;
  let data, error;
  try { ({ data, error } = await db.rpc("bj_deal", { p_main: bets.main, p_pp: bets.pp, p_t3: bets.t3, p_ll: bets.ll, p_bust: bets.bust, p_ref: newRef(), p_mode: MODE, p_run: CH ? CH.id : null })); }
  catch (ex) { error = { message: String(ex && ex.message || ex), code: "JS" }; }
  busy = false;
  if (error) { renderBets(); return err(errText(error)); }
  lastBets = { ...bets }; Object.keys(bets).forEach((k) => bets[k] = 0);
  $("betUI").hidden = true; setSpotsVisible(false);
  if (LIT) await fisherDrop(data.strikes || {});
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
function lockActs() { document.querySelectorAll("#acts .a").forEach((b) => b.disabled = true); stopClock(); }

// ---------- your turn: zoom in on your hand + 10-second decision clock ----------
const DECIDE_MS = 20000; let clockT = null, engaged = false;   // the clock only runs for hands this visit dealt
function zoomTo(h) {
  const f = $("fit"), st2 = $("stage"), s = spot(h);
  const a = $("acts");
  if (h == null) { f.style.transform = ""; a.classList.remove("zoombar"); fit(); return; }
  // while zoomed, the action buttons leave the scaled table and sit in a fixed bar at the bottom of the screen
  if (a.parentElement !== document.body) document.body.appendChild(a);
  a.classList.remove("phone"); a.classList.add("zoombar"); a.style.left = a.style.top = "";
  const m = new DOMMatrix(getComputedStyle(st2).transform), x = parseFloat(st2.style.left) + s.x * m.a, y = parseFloat(st2.style.top) + (s.y - 50) * m.d;
  f.style.transformOrigin = `${x}px ${y}px`; f.style.transform = "scale(2.1)";
}
function stopClock() { clearTimeout(clockT); clockT = null; const c = $("clock"); if (c) c.remove(); }
function startClock() {
  stopClock();
  const c = document.createElement("div"); c.id = "clock"; c.className = "clock";
  c.innerHTML = '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" class="bg"/><circle cx="20" cy="20" r="17" class="fg"/></svg><b>10</b>';
  $("acts").prepend(c);
  const t0 = performance.now();
  const tick = () => { if (!document.body.contains(c)) return; const left = Math.max(0, DECIDE_MS - (performance.now() - t0));
    const sec = Math.ceil(left / 1000); if (c.dataset.s !== String(sec)) { c.dataset.s = sec; if (sec <= 9) SFX.tick(sec <= 3); }
    c.querySelector("b").textContent = sec; c.classList.toggle("hurry", left < 3500);
    if (left > 0) requestAnimationFrame(tick); };
  c.querySelector(".fg").style.animationDuration = DECIDE_MS + "ms"; requestAnimationFrame(tick);
  clockT = setTimeout(() => {             // time's up: the house plays the safe move for you
    const pick = st && st.actions.includes("no_insurance") ? "no_insurance" : "stand";
    const b = document.querySelector(`#acts .a[data-a="${pick}"]`); if (b && !b.hidden) { showMsg("נגמר הזמן", pick === "stand" ? "עמדת אוטומטית" : "בלי ביטוח"); b.click(); }
  }, DECIDE_MS);
}
function showControls() {
  if (TABLE) return tControls();
  const playing = st && st.status !== "done";
  $("acts").hidden = !playing; $("betUI").hidden = !!playing; setSpotsVisible(!playing);
  if (playing) { placeActs(st.active); document.querySelectorAll("#acts .a").forEach((b) => { b.hidden = !st.actions.includes(b.dataset.a); b.disabled = busy; });
    if (!busy && st.actions.length && engaged) { zoomTo(st.active); startClock(); } }
  else { zoomTo(null); stopClock(); }
  $("rebetBtn").disabled = !lastBets; $("dealBtn").disabled = !bets.main;
}
function err(t) { $("err").textContent = t; }
function errText(e) {
  const m = e.message || "";
  if (m.includes("insufficient_funds")) return "אין מספיק שקלים משחקיים להימור הזה. הקטן את ההימור.";
  if (m.includes("invalid_side_bet")) return "הימור צדדי לא יכול להיות גבוה מההימור הראשי.";
  if (m.includes("invalid_main_bet")) return `ההימור הראשי חייב להיות בין ₪10 ל־${fmt(maxBet())}.`;
  if (m.includes("illegal_action")) return "הפעולה הזאת לא אפשרית כרגע.";
  if (m.includes("betting_closed")) return "ההימורים לסיבוב הזה נסגרו. חכה לסיבוב הבא.";
  if (m.includes("already_bet")) return "ההימור שלך כבר על השולחן.";
  if (m.includes("table_full")) return "השולחן מלא (5 שחקנים). חכה לסיבוב הבא.";
  if (m.includes("round_in_progress")) { resume(); return "יש לך יד פתוחה. ממשיכים ממנה."; }
  console.error("rpc error", e);
  return "משהו השתבש (" + (e.code || "") + " " + m.slice(0, 80) + "). צלם לי את המסך.";
}
function newRef() { try { return crypto.randomUUID(); } catch { return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); } }
$("rulesBtn").onclick = () => $("rules").showModal();

if (LIT) {
  document.body.classList.add("lit"); document.title = "בלאק ג׳ק הכפולות של פישר · גולן קזינו";
  const r = $("rules"); r.querySelector("h2").textContent = "בלאק ג׳ק הכפולות של פישר · חוקים";
  r.querySelector("h2").insertAdjacentHTML("afterend", "<p><b>⚡ איך זה עובד:</b></p><p>1. שמים הימור. כל יד עולה <b>הימור + עמלת ברק של חצי מההימור</b> (₪100 + ₪50).</p><p>2. לפני החלוקה די־ג׳יי פישר <b>מפיל ברקים על 2–3 ערכי קלפים</b>, כל אחד עם מכפיל ×2 עד ×25. למשל: A ×5 · 7 ×3. הקלפים האלה זוהרים בזהב כשהם יוצאים.</p><p>3. משחקים בלאק ג׳ק רגיל. <b>אם ניצחת ויש לך ביד קלף מוכה ברק, הרווח מוכפל מיד</b> במכפיל הכי גבוה שביד. ₪100 רווח עם אס ×5 = ₪500. בלאק ג׳ק (₪150) עם ×5 = ₪750.</p><p>אין הימורים צדדיים. החזר משוער לשחקן: כ־98%.</p>");
}
// ---------- start ----------
// ---------- challenge HUD: hand count, challenge chips, the score to beat ----------
function drawCH() {
  if (!CH) return; let h = $("chHud");
  if (!h) { h = document.createElement("div"); h.id = "chHud"; h.className = "chhud"; document.body.appendChild(h); document.querySelector(".top span").firstChild.textContent = "צ׳יפים של אתגר "; }
  const name = CH.kind === "fisher" ? "🎧 הסט של פישר" : "🃏 החפיסה של עידו";
  h.innerHTML = `<b>${name}</b><span>יד <b class="num">${Math.min(CH.hands + (st && st.status !== "done" ? 1 : 0), CH.max)}/${CH.max}</b></span>` +
    (CH.target != null ? `<span>לעבור: <b class="num">${fmt(CH.target)}</b></span>` : CH.opponent ? `<span>נגד ${esc(CH.opponent)}</span>` : "");
  if (CH.status === "done" && !$("chEnd")) setTimeout(chEnd, 2600);
}
async function chEnd() {
  const { data } = await db.rpc("ch_run_info", { p_run: CH.id }); const c = data || CH;
  const o = document.createElement("div"); o.id = "chEnd"; o.className = "chend";
  const res = c.kind === "fisher" ? `סיימת עם <b class="num">${fmt(c.chips)}</b><br>${c.points > 0 ? `+${c.points} נקודות לעונה` : "בלי נקודות הפעם"}`
    : c.target != null ? (c.chips > c.target ? `ניצחת! <b class="num">${fmt(c.chips)}</b> מול ${fmt(c.target)}` : c.chips === c.target ? "תיקו!" : `הפסדת: <b class="num">${fmt(c.chips)}</b> מול ${fmt(c.target)}`)
    : `סיימת עם <b class="num">${fmt(c.chips)}</b>. עכשיו תור ${esc(c.opponent || "החבר")}.`;
  o.innerHTML = `<div class="box"><div class="t">${c.kind === "fisher" ? "🎧 הסט נגמר" : "🃏 החפיסה נגמרה"}</div><div class="r">${res}</div><a class="btn" href="challenges.html">חזרה לאתגרים</a></div>`;
  document.body.appendChild(o);
}
// coming back to the page (other tab, phone unlocked, back button): fetch the hand again so the buttons are always there
addEventListener("pageshow", (e) => { if (e.persisted) location.reload(); });
document.addEventListener("visibilitychange", () => { if (document.hidden || busy || !$("acts").hidden) return;
  if (TABLE) { if (typeof tPoll === "function") tPoll(); } else resume0().then(showControls).catch(() => {}); });
// safety net: a hand is waiting for me but no buttons are showing → show them
setInterval(() => { if (TABLE || busy || !st || st.status === "done" || !st.actions || !st.actions.length) return; const a = $("acts"); if (a.hidden || !a.offsetParent && getComputedStyle(a).position !== "fixed") showControls(); }, 1500);
async function resume() { if (TABLE) return; return resume0(); }
async function resume0() { const { data } = await db.rpc("bj_current"); if (data) { clearRound(); $("betUI").hidden = true; await render(data); } }
(async () => {
  const { data: { session } } = await db.auth.getSession();
  if (!session && location.hash === "#preview") {   // visual check only: no server, no wallet, no member images
    me = { id: "p", nickname: "שחקן לדוגמה" }; members = [{ id: "p", nickname: "שחקן לדוגמה", wealth: 10250 }, { id: "a", nickname: "חבר", wealth: 8900 }, { id: "b", nickname: "חבר", wealth: 12400 }];
    GC_LOADER.done(); if (LIT) { STRIKES = { A: 5, 7: 3 }; await loadDJ(); } drawSeats(); setMyBalance(10250); drawBetSpots(); renderBets(); if (location.search.includes("bet")) { showControls(); return; } $("betUI").hidden = true; setSpotsVisible(false);
    await render({ id: "x", status: "playing", active: 0, actions: ["hit", "stand", "double"], balance: 10250, dealer_total: 10,
      dealer: ["KH", "??"], hands: [{ cards: ["AS", "9D"], bet: 100, total: 20 }] });
    return;
  }
  if (!session) { location.href = "./"; return; }
  GC_GUIDE.init({ game: LIT ? "lightning_bj" : "blackjack", db, mount: document.querySelector(".top"), steps: LIT ? GC_STEPS.lightningBJ() : GC_STEPS.blackjack() });
  me = { id: session.user.id, nickname: "אני" };   // the three first loads run together, not one after another
  const [{ data: prof }, { data: w }] = await Promise.all([db.from("profiles").select("id,nickname").eq("id", session.user.id).single(),
    db.from("wallets").select("balance").eq("user_id", session.user.id).single(), loadSeats()]);
  if (prof) me = prof;
  if (CH_ID) { const { data: ci } = await db.rpc("ch_run_info", { p_run: CH_ID }); if (!ci || ci.status !== "playing") { location.href = "challenges.html"; return; } CH = ci; drawCH(); }
  if (w) setMyBalance(w.balance);
  if (LIT) await loadDJ();
  drawBetSpots(); renderBets(); await resume(); showControls();
  if (TABLE) tableStart();
  await Promise.all([...document.querySelectorAll("#stage img, #seats img")].map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
  GC_LOADER.done();
  setTimeout(() => { for (const r of "A23456789TJQK") for (const u of "SHDC") { const i = new Image(); i.src = `cards3/${r}${u}.webp`; } }, 400);   // cards ready before the first deal
})();

// ---------- shared table: everyone bets in the same window, plays at the same time, one dealer ----------
let T = null, tSkew = 0, tLastRound = null, tOthersKey = "", tBusy = false, tTimer = null;
function tOthers() {
  if (!T) return [];
  const seen = new Map();
  for (const p of T.players) if (p.id !== me.id) seen.set(p.id, p);
  for (const p of T.present) if (p.id !== me.id && !seen.has(p.id)) seen.set(p.id, p);
  return [...seen.values()].slice(0, 4).map((p) => ({ id: p.id, nickname: p.name, character_key: p.char,
    wealth: (members.find((m) => m.id === p.id) || {}).wealth || 0 }));
}
function tNow() { return Date.now() + tSkew; }
function tBar() {
  let b = $("tbar"); if (!b) { b = document.createElement("div"); b.id = "tbar"; b.className = "tbar"; document.body.appendChild(b); }
  if (!T) return;
  const sec = (ms) => Math.max(0, Math.ceil((ms - tNow()) / 1000));
  const n = T.players.length;
  let txt;
  if (T.phase === "betting") txt = T.bet_until ? `⏳ ההימורים נסגרים בעוד <b class="num">${sec(T.bet_until)}</b> · ${n} מהמרים` : "שימו הימור כדי להתחיל סיבוב · כל מי שבשולחן משחק יחד";
  else if (T.phase === "playing") txt = T.my_bet ? `🃏 כולם משחקים עכשיו · <b class="num">${sec(T.play_until)}</b>` : "סיבוב רץ. תצטרף בסיבוב הבא";
  else txt = `הסיבוב הבא בעוד <b class="num">${sec(T.next_at)}</b>`;
  b.innerHTML = txt;
}
function drawOthers() {
  layer.querySelectorAll(".ot").forEach((n) => n.remove());
  if (!T) return;
  const list = tOthers();
  list.forEach((o, k) => {
    const p = T.players.find((x) => x.id === o.id); if (!p) return;
    const sp = SPOTS[SEAT2SPOT[k + 1]];
    const c = chipStack(sp.x, sp.y, p.bet, "o_" + p.id); if (c) c.classList.add("ot");
    (p.hands || []).forEach((h, hi) => {
      const ox = sp.x - 50 + hi * 70;
      h.cards.forEach((card, i) => { const d = el("card ot small", ox + i * 26, sp.y - 120 - i * 7); faceUp(d, card); });
      const o2 = p.out?.[hi]?.outcome, OUT = { win: "ניצחון", blackjack: "בלאק ג׳ק!", push: "תיקו", lose: "הפסד", bust: "נשרף", surrender: "ויתור" };
      el("total ot " + (o2 === "win" || o2 === "blackjack" ? "win" : o2 && o2 !== "push" ? "lose" : ""), ox + 40, sp.y - 150, esc(o2 ? `${h.total} · ${OUT[o2]}` : h.total));
    });
    if (p.status === "waiting") el("total ot", sp.x - 10, sp.y + 40, "עומד ✓");
  });
  // a spectator (no bet this round) still sees the dealer
  if (!T.me && T.dealer.length) T.dealer.forEach((card, i) => { const d = el("card ot" + (card === "??" ? " back" : ""), dealerPos(i).x, dealerPos(i).y); if (card !== "??") faceUp(d, card); });
}
function tControls() {
  const mine = st && st.id && T && T.me && st.id === T.me.id;
  const acting = mine && (st.status === "playing" || st.status === "insurance") && st.actions.length;
  $("acts").hidden = !acting;
  const canBet = T && T.phase === "betting" && !T.my_bet;
  $("betUI").hidden = !canBet; setSpotsVisible(!!canBet);
  if (acting) { placeActs(st.active); document.querySelectorAll("#acts .a").forEach((b) => { b.hidden = !st.actions.includes(b.dataset.a); b.disabled = busy; });
    if (!busy && engaged && !clockT) { zoomTo(st.active); startClock(); } }
  else { zoomTo(null); stopClock(); }
  $("rebetBtn").disabled = !lastBets; $("dealBtn").disabled = !bets.main || !canBet;
}
async function tableBet() {
  err(""); busy = true; $("dealBtn").disabled = true; engaged = true;
  let data, error;
  try { ({ data, error } = await db.rpc("bjt_bet", { p_t: TABLE, p_main: bets.main, p_pp: bets.pp, p_t3: bets.t3, p_ll: bets.ll, p_bust: bets.bust, p_ref: newRef() })); }
  catch (ex) { error = { message: String(ex && ex.message || ex), code: "JS" }; }
  busy = false;
  if (error) { renderBets(); return err(errText(error)); }
  lastBets = { ...bets }; Object.keys(bets).forEach((k) => bets[k] = 0);
  showMsg("ההימור על השולחן", "ממתינים לשאר השחקנים");
  await tApply(data);
}
async function tApply(data) {
  if (!data) return;
  T = data; tSkew = data.now - Date.now();
  setMyBalance(data.balance);
  if (tLastRound !== null && data.round !== tLastRound && (!st || st.status === "done") && !busy) { clearRound(); renderBets(); }
  tLastRound = data.round;
  const key = tOthers().map((o) => o.id).join(","); if (key !== tOthersKey) { tOthersKey = key; drawSeats(); }
  drawOthers(); tBar();
  const m = data.me;
  if (m && !busy) {
    if (!st || st.id !== m.id) { if (st || layer.querySelector(".card:not(.ot)")) { clearRound(); drawOthers(); } $("betUI").hidden = true; setSpotsVisible(false); await render(m); }
    else if (st.status !== m.status || st.dealer.length !== m.dealer.length || JSON.stringify(st.hands) !== JSON.stringify(m.hands)) await render(m);
  }
  tControls();
}
async function tPoll() {
  if (tBusy || document.hidden) return; tBusy = true;
  try { const { data, error } = await db.rpc("bjt_state", { p_t: TABLE }); if (!error) await tApply(data); } catch (e) {}
  tBusy = false;
}
function tableStart() {
  document.body.classList.add("tablemode"); $("dealBtn").textContent = "שלח הימור";
  document.title = "בלאק ג׳ק ביחד · גולן קזינו";
  tPoll(); tTimer = setInterval(tPoll, 2000); setInterval(tBar, 250);   // every 2 s (was 1 s): half the traffic, the table still feels live
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tPoll(); });
}
