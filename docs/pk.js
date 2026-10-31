/* Golan Casino · Texas Hold'em. Everything is decided on the server (poker_state / poker_act); this file draws and polls. */
const $ = (id) => document.getElementById(id);
const fmt = (n) => { n = Number(n); const a = Math.abs(n); return a >= 1e12 ? "₪" + +(n / 1e12).toFixed(2) + "T" : a >= 1e9 ? "₪" + +(n / 1e9).toFixed(2) + "B" : a >= 1e6 ? "₪" + +(n / 1e6).toFixed(2) + "M" : "₪" + n.toLocaleString("en-US"); };   // ₪1.58M · ₪2.4B · ₪1T
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PREVIEW = /[?#&]preview/.test(location.href);
const db = PREVIEW ? null : supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);
let T = new URLSearchParams(location.search).get("t");
const BOTS = new URLSearchParams(location.search).has("bots");   // poker against the bots: my own private table
// seat spots on the 1920x1080 table photo, position 0 = bottom centre (always me when seated)
const SPOT = [{ x: 1040, y: 905 }, { x: 330, y: 880 }, { x: 330, y: 530 }, { x: 960, y: 395 }, { x: 1590, y: 530 }, { x: 1590, y: 880 }];
const BETAT = (p) => ({ x: p.x + (960 - p.x) * 0.42, y: p.y + (640 - p.y) * 0.42 });
let S = null, ME = null, busy = false, lastHand = -1, AV = {};

// ---------- fit ----------
function fit() {
  // the room above the table is cropped: the visible window is y 330..1080 of the photo
  const W = innerWidth, H = innerHeight - 44, s = Math.min(W / 1920, H / 760), st = $("stage");
  st.style.transform = `scale(${s})`; st.style.left = (W - 1920 * s) / 2 + "px"; st.style.top = 44 - 320 * s + Math.max(0, (H - 760 * s) / 2) + "px";
}
addEventListener("resize", fit);

// ---------- picker ----------
async function pick() {
  $("pick").hidden = false; GC_LOADER.done(); try { GC_GUIDE.init({ game: "poker", db, mount: document.querySelector(".top"), steps: GC_STEPS.poker() }); } catch (e) {}
  const { data } = PREVIEW ? { data: [{ id: "x", name: "מתחילים", sb: 10, bb: 20, min: 1000, max: 4000, players: ["דני"] }] } : await db.rpc("poker_tables_list");
  const ICON = ["🟢", "🔵", "🔴", "⚫", "👑"];
  $("tables").innerHTML = (data || []).map((t, i) => `<a class="tbl" href="poker.html?t=${t.id}"><span class="ic">${ICON[i] || "♠️"}</span>
    <div><b>${esc(t.name)}</b><small>בליינדים <span class="num">${fmt(t.sb)} / ${fmt(t.bb)}</span> · כניסה <span class="num">${fmt(t.min)}–${fmt(t.max)}</span></small></div>
    <span class="pl">${t.players.length ? `${t.players.length}/6 · ${t.players.map(esc).join(", ")}` : "שולחן ריק"}</span></a>`).join("");
}

// ---------- table ----------
const card = (c, cls = "") => c ? `<div class="pc ${cls}" style="background-image:url(cards3/${c}.webp)"></div>` : `<div class="pc back ${cls}"></div>`;
function rel(seat) { return ME == null ? seat : (seat - ME + 6) % 6; }
async function avatar(uid) {
  if (AV[uid] !== undefined || PREVIEW) return; AV[uid] = null;
  const c = await GC_CHAR(db, uid); AV[uid] = c.url || null; if (S) draw();
}
function chipLabel(n) { return n >= 1e6 ? +(n / 1e6).toFixed(1) + "M" : n >= 1000 ? +(n / 1000).toFixed(1) + "K" : n; }
function draw() {
  const s = S; if (!s) return;
  ME = s.me; const TN = s.tourney;
  $("tname").innerHTML = TN ? `🎡 טורניר ג׳קפוט · פרס <span class="num">${fmt(TN.prize)}</span> · בליינדים <span class="num">${s.table.sb}/${s.table.bb}</span>`
                            : `${esc(s.table.name)} · <span class="num">${fmt(s.table.sb)}/${fmt(s.table.bb)}</span>`;
  if (TN && !wheelShown) { wheelShown = true; wheel(TN); }
  if (TN && TN.status === "done" && !$("tnEnd")) tnEnd(TN);
  $("bal").textContent = fmt(s.balance); $("leaveBtn").hidden = ME == null; $("leaveBtn").textContent = s.tourney ? "פרוש מהטורניר" : "קום מהשולחן";
  // seats
  let h = "";
  for (let seat = 0; seat < 6; seat++) {
    const p = s.seats[seat], pos = SPOT[rel(seat)], turn = s.to_act === seat && s.street !== "done" && s.street !== "idle";
    if (!p) { h += ME == null && !s.tourney ? `<button class="sit" style="left:${pos.x}px;top:${pos.y}px" data-seat="${seat}">שב כאן</button>` : ""; continue; }
    if (p.bot) AV[p.user] = `img/ch/bot_${p.bot}.webp?v=1`; else if (p.user && AV[p.user] === undefined) avatar(p.user);
    const won = s.result && s.result.won && s.result.won[seat];
    const hole = p.hole ? p.hole.map((c) => card(c, seat === ME ? "big" : "")).join("") : p.in_hand && !p.folded ? card(null) + card(null) : "";
    const hand = s.result && s.result.hands && s.result.hands[seat];
    h += `<div class="seat ${seat === ME ? "me" : ""} ${p.folded ? "folded" : ""} ${turn ? "turn" : ""} ${won ? "won" : ""}" style="left:${pos.x}px;top:${pos.y}px">
      <div class="cards">${hole}</div>
      <div class="av">${AV[p.user] ? `<img src="${AV[p.user]}" alt="">` : `<span>${esc((p.name || "?")[0])}</span>`}${turn ? `<svg class="ring" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18"/></svg>` : ""}</div>
      <div class="tag"><b>${esc(p.name)}<i class="lvu" data-u="${p.user}"></i></b><span class="num">${p.leaving && TN ? "הודח" : p.away && TN && s.hand_no ? "מנותק ⏳" : p.allin ? "אול־אין" : fmt(p.stack)}</span></div>
      ${hand ? `<div class="hand">${esc(hand)}</div>` : ""}${won ? `<div class="wonamt num">+${fmt(won)}</div>` : ""}</div>`;
    if (p.bet > 0) { const b = BETAT(pos); h += `<div class="bet" style="left:${b.x}px;top:${b.y}px"><img src="img/poker/chip_stack.webp" alt=""><b class="num">${chipLabel(p.bet)}</b></div>`; }
  }
  // only touch the DOM when something changed (redrawing 4×/s made avatars and badges flicker)
  if (h === draw.lastSeats) { /* unchanged */ } else { draw.lastSeats = h; $("seats").innerHTML = h; }
  $("seats").querySelectorAll(".sit").forEach((b) => b.onclick = () => buyIn(+b.dataset.seat));
  // timer ring on the player to act
  const ring = document.querySelector(".ring circle");
  if (ring && s.deadline) { const left = Math.max(0, new Date(s.deadline) - (Date.now() + skew)); ring.style.strokeDashoffset = 113 * (1 - left / 25000); }
  // dealer button, board, pot
  if (s.dealer != null && s.street !== "idle") { const p = SPOT[rel(s.dealer)], d = $("dbtn"); d.hidden = false; d.style.left = p.x + (p.x < 960 ? 120 : -120) + "px"; d.style.top = p.y - 70 + "px"; } else $("dbtn").hidden = true;
  const bh = (s.board || []).map((c) => card(c, "brd")).join(""); if (bh !== draw.lastBoard) { draw.lastBoard = bh; $("board").innerHTML = bh; }
  const ph = s.pot ? `קופה <b class="num">${fmt(s.pot)}</b>` : ""; if (ph !== draw.lastPot) { draw.lastPot = ph; $("pot").innerHTML = ph; }
  let mt = s.street === "idle" ? (Object.keys(s.seats).length < 2 ? "מחכים לשחקן נוסף…" : "יד חדשה מתחילה…") : "";
  if (TN && TN.status === "running" && !s.hand_no) { const away = Object.values(s.seats).filter((p) => p.away).map((p) => p.name);
    const left = Math.max(0, Math.ceil((new Date(TN.join_until) - (Date.now() + skew)) / 1000));
    mt = away.length ? `מחכים ש${away.join(" ו")} יתחברו · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "כולם כאן! מתחילים…"; }
  $("msg").textContent = mt;
  // my actions
  const mine = ME != null && s.to_act === ME && ["preflop", "flop", "turn", "river"].includes(s.street);
  $("acts").hidden = !mine;
  if (mine) {
    const me = s.seats[ME], toCall = Math.max(0, s.current_bet - me.bet), all = me.stack + me.bet;
    const q = (a) => $("acts").querySelector(`[data-a="${a}"]`);
    q("check").hidden = toCall > 0; q("call").hidden = toCall === 0; q("call").textContent = `קול ${fmt(Math.min(toCall, me.stack))}`;
    const minR = Math.min(all, s.current_bet + Math.max(s.min_raise, s.table.bb)), R = $("raiseR");
    document.querySelector(".raise").hidden = all <= s.current_bet || minR >= all;
    R.min = minR; R.max = all; R.step = s.table.sb; if (+R.value < minR || +R.value > all || R.dataset.hand != s.hand_no + s.street) { R.value = minR; R.dataset.hand = s.hand_no + s.street; }
    $("raiseV").textContent = fmt(+R.value); q("raise").textContent = s.current_bet ? "העלה ל־" : "הימור";
    q("allin").textContent = `אול־אין ${fmt(me.stack)}`;
  }
  if (s.hand_no !== lastHand && ["preflop"].includes(s.street)) { lastHand = s.hand_no; try { SFX.card(); } catch (e) {} }
}
// the prize wheel: spins once when you first see a tournament table, lands on the server's multiplier
let wheelShown = false;
function wheel(tn) {
  if (tn.status !== "running" || (S && S.hand_no > 2)) return;
  const SEG = [1.5, 2, 5, 10, 25, 50].map((m) => ["×" + m, m]);
  const idx = Math.max(0, SEG.findIndex(([, m]) => Math.abs(m * 1000000 - tn.prize) < 1 || +tn.mult === m));
  SEG.forEach((x) => { x[1] = x[1] * 1000000; });
  const o = document.createElement("div"); o.className = "wheel";
  const segs = SEG.map(([m, v], i) => `<div class="seg" style="transform:rotate(${i * 60}deg)"><span>${m}<br><small>${fmt(v)}</small></span></div>`).join("");
  o.innerHTML = `<div class="wt">🎡 גלגל הפרס</div><div class="wwrap"><div class="wd" id="wd">${segs}</div><div class="wptr">▼</div></div><div class="wres" id="wres"></div>`;
  document.body.appendChild(o);
  const end = 360 * 6 - idx * 60;
  requestAnimationFrame(() => requestAnimationFrame(() => { $("wd").style.transform = `rotate(${end}deg)`; }));
  try { SFX.fx("ch_wheel", { vol: 0.8 }) || SFX.roll(4); } catch (e) {}
  setTimeout(() => { $("wres").innerHTML = `הפרס בטורניר: <b class="num">${fmt(tn.prize)}</b>`; try { SFX.win(tn.mult >= 10); } catch (e) {} }, 4300);
  setTimeout(() => o.remove(), 7000);
}
function tnEnd(tn) {
  const me = S.me, mine = (tn.places || []).find((p) => p.place === 1);
  const o = document.createElement("div"); o.id = "tnEnd"; o.className = "tnend";
  o.innerHTML = `<div class="box"><div class="t">🎡 הטורניר נגמר</div><div class="r">${mine ? "המנצח לוקח " + fmt(tn.prize) : ""}</div><a class="btn" href="challenges.html">חזרה לאתגרים</a></div>`;
  document.body.appendChild(o);
}
$("raiseR").oninput = () => { $("raiseV").textContent = fmt(+$("raiseR").value); };
let skew = 0;
let polling = false;
async function poll() {
  if (busy || polling || document.hidden || PREVIEW) return;
  polling = true; let data, error;
  try { ({ data, error } = await db.rpc("poker_state", { p_table: T })); } catch (e) { error = e; } finally { polling = false; }
  if (busy) return;
  if (error) { if ((error.message || "").includes("not_signed_in")) location.href = "./"; return; }
  skew = new Date(data.now) - Date.now(); const turnBefore = S && S.to_act === S.me; S = data; draw();
  if (!turnBefore && S.to_act === S.me && S.me != null && ["preflop", "flop", "turn", "river"].includes(S.street)) { try { SFX.chip(); navigator.vibrate && navigator.vibrate(60); } catch (e) {} }
}
$("acts").addEventListener("click", async (e) => {
  const b = e.target.closest(".a"); if (!b || busy) return;
  busy = true; const a = b.dataset.a;
  const { data, error } = await db.rpc("poker_act", { p_table: T, p_action: a, p_amount: a === "raise" ? +$("raiseR").value : 0, p_hand: S.hand_no });
  busy = false; if (!error) { S = data; draw(); try { SFX.chip(); } catch (er) {} } else poll();
});
// ---------- buy in / leave ----------
let buySeat = null;
function buyIn(seat) {
  buySeat = seat; const t = S.table, R = $("buyR");
  R.min = t.min; R.max = Math.min(t.max, Math.max(t.min, S.balance)); R.step = t.bb; R.value = Math.min(t.max, Math.max(t.min, Math.min(S.balance, t.min * 2)));
  $("buyInfo").innerHTML = `בליינדים ${fmt(t.sb)} / ${fmt(t.bb)} · כניסה ${fmt(t.min)} עד ${fmt(t.max)}`; $("buyV").textContent = fmt(+R.value); $("buyErr").textContent = "";
  $("buy").showModal();
}
$("buyR").oninput = () => { $("buyV").textContent = fmt(+$("buyR").value); };
$("buyNo").onclick = () => $("buy").close();
$("buyYes").onclick = async () => {
  const { data, error } = await db.rpc("poker_sit", { p_table: T, p_seat: buySeat, p_amount: +$("buyR").value });
  if (error) { const m = error.message || ""; $("buyErr").textContent = m.includes("insufficient") ? "אין מספיק בארנק." : m.includes("seat_taken") ? "הכיסא נתפס." : m.includes("already_seated") ? "אתה כבר יושב בשולחן אחר. קום ממנו קודם." : "לא הצלחנו להושיב אותך."; return; }
  $("buy").close(); S = data; draw();
};
$("leaveBtn").onclick = async () => { busy = true; await db.rpc("poker_leave", { p_table: T }); busy = false; poll(); };

// ---------- boot ----------
(async function boot() {
  if (!PREVIEW) { const { data: { session } } = await db.auth.getSession(); if (!session) { location.href = "./"; return; } }
  if (new URLSearchParams(location.search).has("fr") && !PREVIEW) { const { data, error } = await db.rpc("poker_friends_table", { p_bb: +new URLSearchParams(location.search).get("bb") || 20000 }); if (error || !data) { location.href = "./"; return; } T = data.table; }
  if (BOTS && !PREVIEW) { const Q = new URLSearchParams(location.search), shared = Q.get("bots") === "2";
    const { data, error } = shared ? await db.rpc("poker_bot_shared", { p_bb: +Q.get("bb") || 20000 }) : await db.rpc("poker_bot_table", { p_bb: +Q.get("bb") || null }); if (error || !data) { location.href = "./"; return; } T = data.table; }
  if (!T) return pick();
  const ls = document.createElement("script"); ls.src = "landscape.js?v=1"; document.head.appendChild(ls);
  document.body.classList.add("at-table"); $("fit").hidden = false; fit();
  if (PREVIEW) {
    S = { table: { name: "חבר׳ה", sb: 50, bb: 100, min: 5000, max: 20000 }, hand_no: 3, street: "flop", board: ["AH", "7D", "KS"], dealer: 2, to_act: 0, me: 0, current_bet: 400, min_raise: 300, pot: 1750,
      deadline: new Date(Date.now() + 14000).toISOString(), now: new Date().toISOString(), balance: 84000,
      seats: { 0: { name: "בנימין", stack: 9600, bet: 0, in_hand: true, hole: ["AS", "KD"] }, 2: { name: "דני", stack: 12000, bet: 400, in_hand: true }, 4: { name: "פישר", stack: 0, bet: 0, in_hand: true, folded: true }, 5: { name: "עידו", stack: 7300, bet: 400, in_hand: true } } };
    draw(); GC_LOADER.done(); return;
  }
  await poll(); GC_LOADER.done(); try { GC_GUIDE.init({ game: "poker", db, mount: document.querySelector(".top"), steps: GC_STEPS.poker() }); } catch (e) {}
  setInterval(poll, 1000); setInterval(() => S && draw(), 250);
})();
