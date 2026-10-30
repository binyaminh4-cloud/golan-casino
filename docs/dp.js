/* Golan Casino · poker against the dealer: Three Card Poker (tcp), Ultimate Texas Hold'em (uth), Caribbean Stud (csp).
   Live table with friends (t=1) or a private table (t=0). The server deals, decides and pays; this page only shows it. */
const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const GAME = ["tcp", "uth", "csp"].includes(Q.get("g")) ? Q.get("g") : "tcp";
let T = Q.has("t") ? (+Q.get("t") ? 1 : 0) : null;
const PREVIEW = /[?#&]preview/.test(location.href);
const db = PREVIEW ? null : supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);
const fmt = (n) => { n = Math.round(Number(n) || 0); const a = Math.abs(n), s = n < 0 ? "-" : ""; return s + (a >= 1e9 ? "₪" + +(a / 1e9).toFixed(2) + "B" : a >= 1e6 ? "₪" + +(a / 1e6).toFixed(2) + "M" : a >= 1e4 ? "₪" + +(a / 1e3).toFixed(1) + "K" : "₪" + a.toLocaleString("en-US")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INFO = {
  tcp: { name: "פוקר 3 קלפים", en: "THREE CARD POKER", side: "פייר פלוס", sideKey: "PP", blind: false, raise: 1,
    sub: "3 קלפים לך, 3 לדילרית. משחקים או מוותרים." },
  uth: { name: "אולטימייט הולדם", en: "ULTIMATE TEXAS HOLD'EM", side: "טריפס", sideKey: "T", blind: true, raise: 4,
    sub: "אנטה + בליינד. מעלים ×4/×3 לפני הפלופ, ×2 בפלופ או ×1 בסוף." },
  csp: { name: "קריביאן סטאד", en: "CARIBBEAN STUD", side: null, blind: false, raise: 2,
    sub: "5 קלפים לך, 5 לדילרית (אחד גלוי). מעלים ×2 או מוותרים." },
}[GAME];
const CAT5 = ["קלף גבוה", "זוג", "שני זוגות", "שלישייה", "רצף", "צבע", "פול האוס", "רביעייה", "רצף צבע"];
const CAT3 = ["קלף גבוה", "זוג", "צבע", "רצף", "שלישייה", "רצף צבע"];
const catName = (c) => c == null ? "" : (GAME === "tcp" ? CAT3 : CAT5)[c] || "";

// ---------- stage ----------
const SW = 1672, SH = 941;
function fit() { const st = $("stage"), w = innerWidth, h = innerHeight; const s = Math.min(w / SW, (h - 10) / (SH - 60));
  st.style.transform = `scale(${s})`; st.style.left = (w - SW * s) / 2 + "px"; st.style.top = Math.min(0, h - SH * s) + 30 * s + "px"; }
addEventListener("resize", fit); fit();
$("feltName").hidden = true; document.querySelector(".bg").style.backgroundImage = `url(img/dp/table_${GAME}.webp?v=1)`; $("title").textContent = INFO.name; document.title = INFO.name + " · גולן קזינו";
const layer = $("layer");
const HAND = { x: 712, y: 340 };
const dealerPos = (i, n) => ({ x: 836 + (i - (n - 1) / 2) * 92, y: GAME === "uth" ? 230 : 250 });
const boardPos = (i) => ({ x: 836 + (i - 2) * 96, y: 352 });
const MY_Y = GAME === "uth" ? 462 : 440;
const myPos = (i, n) => ({ x: 836 + (i - (n - 1) / 2) * 92, y: MY_Y });
const SEATS = [{ x: 230, y: 470 }, { x: 1440, y: 470 }, { x: 430, y: 560 }, { x: 1240, y: 560 }, { x: 140, y: 650 }];
// betting spots sit on the circles printed on each table picture
const SPOTS = GAME === "uth" ? [["ante", "אנטה", 641, 610], ["blind", "בליינד", 836, 617], ["side", "טריפס", 1035, 610]]
  : GAME === "tcp" ? [["ante", "אנטה", 739, 617], ["side", "פייר פלוס", 840, 547]] : [["ante", "אנטה", 836, 575]];
const PLAY_SPOT = GAME === "uth" ? { x: 840, y: 537 } : GAME === "tcp" ? { x: 941, y: 617 } : { x: 836, y: 648 };

// ---------- dealer frames ----------
const FR = ["i01", "i02", "d01_reach", "d02_pull", "d03_lift", "d04_slide", "d05_release", "d06_return", "f01_touch", "f02_turn", "f03_done", "p01_pay", "p02_back", "c01_collect", "c02_rest"];
FR.forEach((f) => { const i = new Image(); i.src = `img/dealer2/${f}.webp?v=2`; });
let poseTok = 0; const frame = (f) => { $("dealer").src = `img/dealer2/${f}.webp?v=2`; };
async function seq(list) { const tok = ++poseTok; for (const [f, ms] of list) { if (tok !== poseTok) return; frame(f); await sleep(ms); } }
setInterval(() => { if ($("dealer").src.includes("i01")) { frame("i02"); setTimeout(() => { if ($("dealer").src.includes("i02")) frame("i01"); }, 150); } }, 3400);

// ---------- cards on the felt ----------
let EL = {}, roundId = null, dealing = Promise.resolve();
function cardEl(key, card, pos, small) {
  let o = EL[key];
  if (!o) {
    const d = document.createElement("div"); d.className = "card back" + (small ? " small" : ""); d.style.left = HAND.x + "px"; d.style.top = HAND.y + "px"; d.dataset.k = key; layer.appendChild(d);
    o = EL[key] = { el: d, card: "??", pos: null, fresh: true };
  }
  o.want = { card, pos }; return o;
}
function faceUp(o, card) { o.el.classList.remove("back"); o.el.style.backgroundImage = `url(cards3/${card}.webp)`; o.card = card; }
async function animate() {
  const list = Object.values(EL), news = list.filter((o) => o.fresh);
  if (news.length) seq([["d01_reach", 120], ["d02_pull", 120], ["d03_lift", 90], ["d04_slide", 340 + news.length * 160], ["d05_release", 160], ["d06_return", 140], ["i01", 0]]);
  for (const o of list) {
    if (o.fresh) { o.fresh = false; await sleep(160); }
    if (!o.pos || o.pos.x !== o.want.pos.x || o.pos.y !== o.want.pos.y) { o.el.style.left = o.want.pos.x + "px"; o.el.style.top = o.want.pos.y + "px"; o.pos = o.want.pos; if (o.card === "??") try { SFX.card(); } catch (e) {} }
  }
  await sleep(news.length ? 520 : 0);
  const flips = list.filter((o) => o.want.card !== "??" && o.card !== o.want.card);
  if (flips.length && flips.some((o) => o.want.pos.y < 320)) seq([["f01_touch", 120], ["f02_turn", 200], ["f03_done", 300], ["i01", 0]]);
  // the player's own cards flip quickly; the dealer's are revealed one by one, slowly, to keep the tension
  const dl = flips.filter((o) => o.el.dataset.k && o.el.dataset.k[0] === "d"), rest = flips.filter((o) => !dl.includes(o));
  for (const o of rest) { o.el.classList.add("flip"); try { SFX.cardFlip(); } catch (e) {} await sleep(145); faceUp(o, o.want.card); o.el.classList.remove("flip"); await sleep(95); }
  if (dl.length) await sleep(600);
  for (const o of dl) { o.el.style.top = o.want.pos.y - 14 + "px"; await sleep(450);
    o.el.classList.add("flip"); try { SFX.cardFlip(); } catch (e) {} await sleep(220); faceUp(o, o.want.card); o.el.classList.remove("flip");
    await sleep(150); o.el.style.top = o.want.pos.y + "px"; await sleep(650); }
  if (dl.length) await sleep(400);
}
function clearFelt() { layer.innerHTML = ""; EL = {}; }
function label(txt, x, y, cls = "") { const d = document.createElement("div"); d.className = "lab " + cls; d.textContent = txt; d.style.left = x + "px"; d.style.top = y + "px"; layer.appendChild(d); return d; }

// ---------- bets ----------
let S = null, bets = { ante: 0, side: 0 }, lastBets = null, chip = 0, target = "ante", busy = false, me = null, members = {}, urls = {};
const CHIPV = [5, 25, 100, 500, ...[1e3, 1e6, 1e9].flatMap((m) => [1, 5, 25, 100, 500].map((c) => c * m))];
const maxBet = () => (S && S.max_bet) || 50000;
function drawChips() {
  const usable = CHIPV.filter((v) => v <= maxBet() && v >= 10 || v === 25 && maxBet() < 100), show = usable.slice(-6);
  if (!show.includes(chip)) chip = show[Math.max(0, show.length - 3)];
  $("chips").innerHTML = show.map((v) => `<button data-v="${v}" aria-pressed="${v === chip}" aria-label="${fmt(v)}"><span>${fmt(v).slice(1)}</span></button>`).join("");
  $("chips").querySelectorAll("button").forEach((b) => GC_CHIPIFY(b, +b.dataset.v));
}
$("chips").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; chip = +b.dataset.v; drawChips(); };
function drawSpots(locked) {
  layer.querySelectorAll(".spot").forEach((n) => n.remove());
  for (const [k, name, x, y] of SPOTS) {
    if (k === "side" && !INFO.side) continue;
    const v = k === "blind" ? bets.ante : bets[k];
    const d = document.createElement("div"); d.className = "spot" + (target === k && !locked ? " sel" : "") + (k === "blind" || locked ? " dim" : ""); d.dataset.k = k;
    d.style.left = x + "px"; d.style.top = y + "px";
    d.innerHTML = v ? `<i class="chip"></i><small>${fmt(v)}</small>` : "";
    if (v) GC_CHIPIFY(d.querySelector(".chip"), v);
    if (!locked && k !== "blind") d.onclick = () => { target = k; addChip(); };
    layer.appendChild(d);
  }
}
function playChip(v) { const d = document.createElement("div"); d.className = "spot dim"; d.style.left = PLAY_SPOT.x + "px"; d.style.top = PLAY_SPOT.y + "px"; d.innerHTML = `<i class="chip"></i><small>${fmt(v)}</small>`; GC_CHIPIFY(d.querySelector(".chip"), v); layer.appendChild(d); }
function need() { return bets.ante * (INFO.blind ? 2 : 1) + bets.side + bets.ante * INFO.raise; }
function addChip() {
  err(""); const bal = (S && S.balance) || 0;
  if (target === "ante") { if (bets.ante + chip > maxBet()) return err(`הגעת למקסימום ${fmt(maxBet())} לאנטה.`); bets.ante += chip; }
  else { if (!bets.ante) return err("שים קודם אנטה."); if (bets.side + chip > bets.ante) return err(`${INFO.side} לא יכול להיות גבוה מהאנטה.`); bets.side += chip; }
  if (need() > bal) err(`צריך בארנק ${fmt(need())} (כולל ההעלאה המקסימלית). יש ${fmt(bal)}.`);
  try { SFX.chip(); } catch (e) {} drawSpots(false); betButtons();
}
$("clearBtn").onclick = () => { bets = { ante: 0, side: 0 }; err(""); drawSpots(false); betButtons(); };
$("rebetBtn").onclick = () => { if (!lastBets) return; if (lastBets.ante > maxBet()) return err(`ההימור הקודם מעל המקסימום ${fmt(maxBet())}.`); bets = { ...lastBets }; drawSpots(false); betButtons(); };
function betButtons() { $("dealBtn").disabled = busy || !bets.ante || need() > ((S && S.balance) || 0); $("rebetBtn").disabled = !lastBets; $("clearBtn").disabled = !bets.ante;
  $("dealBtn").textContent = T === 1 ? "הנח הימור" : "חלק קלפים"; }
$("dealBtn").onclick = async () => {
  if (busy || !bets.ante) return; busy = true; betButtons(); err("");
  const { data, error } = await rpc("dp_bet", { p_game: GAME, p_t: T, p_ante: bets.ante, p_side: bets.side, p_ref: crypto.randomUUID ? crypto.randomUUID() : Date.now() + "" + Math.random() });
  busy = false;
  if (error) { const m = error.message || ""; err(m.includes("insufficient") ? "אין מספיק בארנק להימור ולהעלאה." : m.includes("betting_closed") ? "ההימורים לסיבוב הזה נסגרו. חכה לסיבוב הבא." : m.includes("table_full") ? "השולחן מלא." : "ההימור לא עבר. נסה שוב."); betButtons(); return; }
  lastBets = { ...bets }; await apply(data);
};

// ---------- decisions ----------
const ACTS = {
  tcp: { d1: [["fold", "ויתור", "fold"], ["play", `שחק ×1`, "go"]] },
  csp: { d1: [["fold", "ויתור", "fold"], ["play", `העלה ×2`, "go"]] },
  uth: { d1: [["check", "צ׳ק", "check"], ["raise3", "העלה ×3", "go"], ["raise4", "העלה ×4", "go"]], d2: [["check", "צ׳ק", "check"], ["raise2", "העלה ×2", "go"]], d3: [["fold", "ויתור", "fold"], ["raise1", "העלה ×1", "go"]] },
}[GAME];
function myHand() { return S && (S.hands || []).find((h) => h.me); }
function drawActs() {
  const h = myHand(), ok = h && h.status === "act" && h.acted !== S.phase && ACTS[S.phase] && !busy;
  if (!ok) { $("acts").hidden = true; return; }
  const list = ACTS[S.phase], neg = list.filter((a) => a[2] !== "go"), pos = list.filter((a) => a[2] === "go");
  const btn = ([a, t, c]) => `<button class="${c}" data-a="${a}">${t}${c === "go" ? `<br><small>${fmt(h.ante * +(a.match(/\d/) || [GAME === "csp" ? 2 : 1])[0])}</small>` : ""}</button>`;
  $("acts").innerHTML = `<div class="grp">${pos.map(btn).join("")}</div><div class="grp">${neg.map(btn).join("")}</div>`;   // RTL: raises on the right, check/fold on the left
  $("acts").hidden = false;
  $("acts").querySelectorAll("button").forEach((b) => b.onclick = () => act(b.dataset.a));
}
async function act(a) {
  if (busy) return; busy = true; $("acts").hidden = true;
  const { data, error } = await rpc("dp_act", { p_round: S.id, p_action: a });
  busy = false;
  if (error) { err((error.message || "").includes("insufficient") ? "אין מספיק בארנק להעלאה." : "הפעולה לא עברה."); drawActs(); return; }
  await apply(data);
}

// ---------- drawing a state ----------
function err(t) { $("err").textContent = t || ""; }
function showMsg(t, sub, cls) { const m = $("msg"); m.className = "msg " + (cls || ""); m.innerHTML = `${t}${sub ? `<small>${sub}</small>` : ""}`; m.hidden = false; }
let shownDone = null;
// end of hand: the dealer sweeps the cards back to her side
let sweptId = null;
async function sweep() {
  sweptId = S && S.id;
  const cards = [...layer.querySelectorAll(".card")]; if (!cards.length) return;
  seq([["c01_collect", 700], ["c02_rest", 500], ["i01", 0]]);
  cards.forEach((c, i) => setTimeout(() => { c.style.left = HAND.x + "px"; c.style.top = (HAND.y - 40) + "px"; c.style.opacity = "0"; c.style.transition += ",opacity .5s"; }, i * 50));
  layer.querySelectorAll(".lab").forEach((n) => n.remove()); $("msg").hidden = true;
  await sleep(700 + cards.length * 50); cards.forEach((c) => c.remove()); EL = {};
}
async function apply(st) {
  if (!st) return; const prevId = S && S.id; S = st;
  $("bal").textContent = fmt(st.balance); drawChips();
  if (st.id !== roundId) { roundId = st.id; clearFelt(); $("msg").hidden = true; shownDone = null; }
  const hands = st.hands || [], mine = hands.find((h) => h.me), others = hands.filter((h) => !h.me);
  // cards (not again once the dealer has swept this finished hand)
  if (st.id === sweptId) { $("betUI").hidden = !(T === 0 || st.phase === "betting"); betButtons(); return; }
  if (st.dealer && st.dealer.length) st.dealer.forEach((c, i) => cardEl("d" + i, c, dealerPos(i, st.dealer.length)));
  (st.board || []).forEach((c, i) => cardEl("b" + i, c, boardPos(i)));
  if (mine && mine.cards) mine.cards.forEach((c, i) => cardEl("m" + i, c, myPos(i, mine.cards.length)));
  others.forEach((h, k) => { const s = SEATS[k % SEATS.length]; (h.cards || []).forEach((c, i) => cardEl(`o${h.id}_${i}`, c, { x: s.x + (i - ((h.cards.length - 1) / 2)) * 40, y: s.y - 70 }, true)); });
  dealing = dealing.then(animate); await dealing;
  // seats of the friends at the live table
  layer.querySelectorAll(".seat,.lab").forEach((n) => n.remove());
  others.forEach((h, k) => { const s = SEATS[k % SEATS.length], d = document.createElement("div"); d.className = "seat"; d.style.left = s.x + "px"; d.style.top = s.y + "px";
    const st2 = h.status === "fold" ? "ויתר" : h.status === "wait" ? "העלה ✔" : h.result ? (h.result.net > 0 ? "+" + fmt(h.result.net) : h.result.net < 0 ? fmt(h.result.net) : "תיקו") : "חושב…";
    d.innerHTML = `${urls[h.char] ? `<img src="${urls[h.char]}" alt="">` : ""}<div class="nm">${h.name}<i class="lvu" data-u="${h.id}"></i></div><div class="bt">${fmt(h.ante)}</div><div class="st">${st2}</div>`; layer.appendChild(d); });
  // my bet spots
  if (mine) { bets = { ante: mine.ante, side: mine.side }; drawSpots(true); if (mine.play) playChip(mine.play); }
  else if (st.phase === "betting" || st.phase === "idle" || st.phase === "done") drawSpots(false);
  // hand names
  if (mine && mine.best != null) label(catName(mine.best), 836 + (mine.cards.length * 46) + 90, MY_Y, "");
  if (st.phase === "done" && st.dcat != null) label("דילרית: " + catName(st.dcat), 836 + st.dealer.length * 46 + 130, dealerPos(0, 1).y, "");
  // bet bar / decisions / result
  const canBet = T === 0 ? !["d1", "d2", "d3"].includes(st.phase) : st.phase === "betting" && !mine;
  $("betUI").hidden = !canBet; betButtons();
  drawActs();
  if (st.phase === "done" && mine && mine.result && shownDone !== st.id) {
    shownDone = st.id; const r = mine.result, net = r.net;
    const why = r.folded ? "ויתרת על היד" : r.dq === false ? "הדילרית לא העפילה" : r.win > 0 ? "ניצחת את הדילרית" : r.win === 0 ? "תיקו" : "הדילרית ניצחה";
    const extra = [r.bonus > 0 ? `בונוס ${fmt(r.bonus)}` : "", r.side_pay > 0 ? `${INFO.side} ${fmt(r.side_pay)}` : ""].filter(Boolean).join(" · ");
    showMsg(net > 0 ? `+${fmt(net)}` : net < 0 ? fmt(net) : "החזר", why + (extra ? " · " + extra : ""), net > 0 ? "win" : net < 0 ? "lose" : "");
    try { net > 0 ? SFX.win(net >= mine.ante * 5) : null; } catch (e) {}
    if (net > 0) seq([["p01_pay", 900], ["p02_back", 600], ["i01", 0]]); else if (net < 0) seq([["c01_collect", 900], ["c02_rest", 700], ["i01", 0]]);
    setTimeout(() => { if (S && S.id === st.id) sweep(); }, T === 0 ? 3500 : 5500);
  }
  if (st.phase === "betting" && !mine) $("msg").hidden = true;
}

// ---------- live clock + polling ----------
let skew = 0;
setInterval(() => {
  if (!S || T !== 1) { $("clock").hidden = true; return; }
  const now = Date.now() + skew, until = S.phase === "betting" ? S.bet_until : S.phase === "done" ? S.next_at : S.until;
  if (!until) { $("clock").hidden = !(S.phase === "betting"); $("clockBar").style.width = "100%"; $("clockTxt").textContent = "ממתין להימור ראשון"; return; }
  const left = Math.max(0, until - now), tot = S.phase === "betting" ? 15000 : S.phase === "done" ? 8000 : 15000;
  $("clock").hidden = false; $("clockBar").style.width = Math.min(100, 100 * left / tot) + "%";
  $("clockTxt").textContent = (S.phase === "betting" ? "הימורים" : S.phase === "done" ? "סיבוב חדש בעוד" : "זמן להחליט") + " · " + Math.ceil(left / 1000);
}, 250);
async function poll() { if (T !== 1 || document.hidden || busy) return; const { data } = await rpc("dp_state", { p_game: GAME, p_t: 1 }); if (data) { skew = data.now - Date.now(); await apply(data); } }

// ---------- rules ----------
const RULES = {
  tcp: `<h3>פוקר 3 קלפים</h3>שמים אנטה (ואם רוצים פייר פלוס). מקבלים 3 קלפים, הדילרית 3 סגורים. <b>שחק</b> = מניחים עוד סכום כמו האנטה, או <b>ויתור</b> ומפסידים את האנטה.<br>
    הדילרית <b>מעפילה</b> עם מלכה ומעלה. לא העפילה: האנטה משלמת 1:1 וההעלאה חוזרת. העפילה: מנצחים = שניהם 1:1.
    <h3>בונוס אנטה (גם כשהדילרית מנצחת)</h3><table><tr><td>רצף צבע</td><td>5:1</td></tr><tr><td>שלישייה</td><td>4:1</td></tr><tr><td>רצף</td><td>1:1</td></tr></table>
    <h3>פייר פלוס</h3><table><tr><td>רצף צבע</td><td>40:1</td></tr><tr><td>שלישייה</td><td>30:1</td></tr><tr><td>רצף</td><td>6:1</td></tr><tr><td>צבע</td><td>4:1</td></tr><tr><td>זוג</td><td>1:1</td></tr></table>
    <p>ב־3 קלפים רצף חזק מצבע.</p>`,
  csp: `<h3>קריביאן סטאד</h3>שמים אנטה, מקבלים 5 קלפים, לדילרית קלף אחד גלוי. <b>העלה</b> = מניחים פי 2 מהאנטה, או <b>ויתור</b>.<br>
    הדילרית מעפילה עם אס־מלך ומעלה. לא העפילה: אנטה 1:1, ההעלאה חוזרת. העפילה וניצחת: אנטה 1:1 וההעלאה לפי היד:
    <table><tr><td>רויאל פלאש</td><td>100:1</td></tr><tr><td>רצף צבע</td><td>50:1</td></tr><tr><td>רביעייה</td><td>20:1</td></tr><tr><td>פול האוס</td><td>7:1</td></tr><tr><td>צבע</td><td>5:1</td></tr><tr><td>רצף</td><td>4:1</td></tr><tr><td>שלישייה</td><td>3:1</td></tr><tr><td>שני זוגות</td><td>2:1</td></tr><tr><td>זוג / קלף גבוה</td><td>1:1</td></tr></table>`,
  uth: `<h3>אולטימייט טקסס הולדם</h3>שמים אנטה ובליינד שווים (ואם רוצים טריפס). מקבלים 2 קלפים.<br>לפני הפלופ: <b>צ׳ק</b> או <b>העלה ×3/×4</b>. אחרי הפלופ: צ׳ק או <b>×2</b>. בסוף: <b>×1</b> או ויתור. מעלים פעם אחת בלבד.<br>
    מנצחים: ההעלאה 1:1, האנטה 1:1 (חוזרת אם הדילרית לא העפילה — זוג ומעלה), הבליינד לפי היד:
    <table><tr><td>רויאל פלאש</td><td>500:1</td></tr><tr><td>רצף צבע</td><td>50:1</td></tr><tr><td>רביעייה</td><td>10:1</td></tr><tr><td>פול האוס</td><td>3:1</td></tr><tr><td>צבע</td><td>3:2</td></tr><tr><td>רצף</td><td>1:1</td></tr><tr><td>פחות מרצף</td><td>חוזר</td></tr></table>
    <h3>טריפס</h3><table><tr><td>רויאל</td><td>50:1</td></tr><tr><td>רצף צבע</td><td>40:1</td></tr><tr><td>רביעייה</td><td>30:1</td></tr><tr><td>פול האוס</td><td>8:1</td></tr><tr><td>צבע</td><td>7:1</td></tr><tr><td>רצף</td><td>4:1</td></tr><tr><td>שלישייה</td><td>3:1</td></tr></table>`,
}[GAME];
$("rulesTxt").innerHTML = RULES + `<button class="go" style="width:100%;margin-top:12px;padding:12px;border:0;border-radius:12px;font:800 16px Heebo" onclick="this.closest('.rulesbox').hidden=true">הבנתי</button>`;
$("rulesBtn").onclick = () => { $("rulesBox").hidden = false; };

// ---------- server ----------
async function rpc(name, args) {
  if (!PREVIEW) return db.rpc(name, args);
  return { data: { id: "p", game: GAME, t: T, phase: "idle", balance: 5000000, max_bet: 100000, hands: [], dealer: [], board: [] } };
}
async function loadMembers() {
  const { data } = await db.from("leaderboard").select("id,nickname,character_key"); (data || []).forEach((m) => { members[m.id] = m; });
  const keys = [...new Set((data || []).map((m) => m.character_key).filter((k) => k && !k.startsWith("animal_") && !k.startsWith("pub_")))];
  (data || []).forEach((m) => { const k = m.character_key; if (k && k.startsWith("animal_")) urls[k] = "img/animals/" + k + ".svg"; if (k && k.startsWith("pub_")) urls[k] = "img/chars/" + k + ".webp"; });
  if (keys.length) { const { data: s } = await db.storage.from("characters").createSignedUrls(keys.map((k) => k + ".webp"), 3600); (s || []).forEach((x, i) => { if (x.signedUrl) urls[keys[i]] = x.signedUrl; }); }
}
async function start(t) {
  T = t; $("pick").hidden = true; $("modeTag").textContent = T === 1 ? "👥 שולחן לייב" : "🎩 שולחן פרטי";
  try { history.replaceState(null, "", `dp.html?g=${GAME}&t=${T}`); } catch (e) {}
  const { data } = await rpc("dp_state", { p_game: GAME, p_t: T }); if (data) { skew = (data.now || Date.now()) - Date.now(); await apply(data); }
  if (T === 1) setInterval(poll, 1500);
}
(async () => {
  if (!PREVIEW) { const { data: { session } } = await db.auth.getSession(); if (!session) { location.href = "./"; return; } me = session.user.id; loadMembers().catch(() => {}); }
  try { GC_LOADER.done(); } catch (e) {}
  $("pickTitle").textContent = INFO.name; $("pickSub").textContent = INFO.sub;
  $("pick").querySelectorAll("button").forEach((b) => b.onclick = () => start(+b.dataset.t));
  if (T === null) $("pick").hidden = false; else start(T);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && T !== null) rpc("dp_state", { p_game: GAME, p_t: T }).then((r) => r.data && apply(r.data)); });
})();
