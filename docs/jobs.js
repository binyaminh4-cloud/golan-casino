/* Golan Casino · jobs: small paid tasks. The server makes each puzzle and checks the answer. */
const $ = (id) => document.getElementById(id);
const fmt = (n) => { n = Number(n); const a = Math.abs(n); return a >= 1e12 ? "₪" + +(n / 1e12).toFixed(2) + "T" : a >= 1e9 ? "₪" + +(n / 1e9).toFixed(2) + "B" : a >= 1e6 ? "₪" + +(n / 1e6).toFixed(2) + "M" : "₪" + n.toLocaleString("en-US"); };   // ₪1.58M · ₪2.4B · ₪1T
const PREVIEW = /[?#&]preview/.test(location.href);
const db = PREVIEW ? null : supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);
const PAY = { driver: [200000, 300000, 400000], dealer: [170000, 250000, 330000] };
const LVL = ["⭐ קל", "⭐⭐ בינוני", "⭐⭐⭐ קשה"];
const LVL_TXT = {
  driver: ["2 נוסעים, מפה קטנה", "3 נוסעים, תקציב צפוף יותר", "4 נוסעים, כמעט בלי מרווח"],
  dealer: ["4 ידיים של 2 קלפים, 15 שניות", "5 ידיים של 3–4 קלפים, 30 שניות", "6 ידיים ארוכות, הרבה אסים, 35 שניות"],
};
let balance = 0, earned = 0, job = null, tick = null, sending = false;

function showBal() { $("bal").textContent = fmt(balance); $("earned").textContent = earned ? `הרווחת היום ${fmt(earned)}` : ""; }

// ---------- pick screen ----------
document.querySelectorAll(".job").forEach((card) => {
  const g = card.dataset.game;
  card.querySelector(".levels").innerHTML = [0, 1, 2].map((i) =>
    `<button class="lvl l${i + 1}" data-l="${i + 1}"><span class="st">${LVL[i]}</span><span class="ds">${LVL_TXT[g][i]}</span><b class="num">${fmt(PAY[g][i])}</b></button>`).join("");
  card.querySelectorAll(".lvl").forEach((b) => b.onclick = () => start(g, +b.dataset.l));
});

// ---------- server ----------
async function rpc(name, args) {
  if (PREVIEW) return { data: fake(name, args) };
  return db.rpc(name, args);
}
let FAKE = null;
function fake(name, a) {          // preview only: local puzzles, no money
  if (name === "job_start") {
    const R = (n) => Math.floor(Math.random() * n);
    if (a.p_game === "dealer") { const hands = Array.from({ length: [4, 5, 6][a.p_level - 1] }, () => Array.from({ length: a.p_level === 1 ? 2 : 3 + R(2) }, () => "A23456789TJQK"[R(13)] + "SHDC"[R(4)]));
      FAKE = { values: hands.map(handValue) }; return { id: "p", puzzle: { hands }, seconds: [15, 30, 35][a.p_level - 1], pay: PAY.dealer[a.p_level - 1] }; }
    const sz = [6, 7, 8][a.p_level - 1], n = [2, 3, 4][a.p_level - 1], used = new Set(), pt = () => { let p; do p = [R(sz), R(sz)]; while (used.has(p + "")); used.add(p + ""); return p; };
    const start = pt(), stops = Array.from({ length: 2 * n }, pt), best = bestRoute(start, stops);
    FAKE = { max: Math.floor(best * [1.5, 1.25, 1.1][a.p_level - 1]) };
    return { id: "p", puzzle: { size: sz, start, stops, max: FAKE.max, best }, seconds: [45, 45, 40][a.p_level - 1], pay: PAY.driver[a.p_level - 1] };
  }
  const ok = job.game === "dealer" ? JSON.stringify(a.p_answer) === JSON.stringify(FAKE.values) : routeLen(job.puzzle.start, job.puzzle.stops, a.p_answer) <= FAKE.max;
  balance += ok ? job.pay : 0;
  return { ok, paid: ok ? job.pay : 0, why: ok ? "" : job.game === "dealer" ? "wrong" : "long", balance, values: FAKE.values };
}
function handValue(h) { let s = 0, a = false; for (const c of h) { const r = c[0]; s += r === "A" ? 1 : "TJQK".includes(r) ? 10 : +r; if (r === "A") a = true; } return a && s + 10 <= 21 ? s + 10 : s; }
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
function routeLen(start, stops, order) { let p = start, l = 0; for (const i of order) { l += dist(p, stops[i]); p = stops[i]; } return l; }
function bestRoute(start, stops) {
  const n = stops.length / 2; let best = Infinity;
  (function go(p, mask, l) { if (l >= best) return; if (mask === (1 << 2 * n) - 1) { best = l; return; }
    for (let i = 0; i < 2 * n; i++) if (!(mask & 1 << i) && (i % 2 === 0 || mask & 1 << (i - 1))) go(stops[i], mask | 1 << i, l + dist(p, stops[i])); })(start, 0, 0);
  return best;
}

// ---------- play ----------
async function start(game, level) {
  $("result").hidden = true;
  const { data, error } = await rpc("job_start", { p_game: game, p_level: level });
  if (error) return alert((error.message || "").includes("slow_down") ? "רגע, לאט. נסו שוב בעוד דקה." : "לא הצלחנו להתחיל משימה.");
  job = { ...data, game, level, t0: performance.now() };
  $("pick").hidden = true; $("play").hidden = false;
  $("jobTitle").innerHTML = `${game === "driver" ? "🚐 נהג הסעות" : "🃏 דילר מתלמד"} · ${LVL[level - 1]} · <b class="num">${fmt(data.pay)}</b>`;
  (game === "driver" ? drawDriver : drawDealer)();
  clearInterval(tick); tick = setInterval(timer, 100); timer();
}
function timer() {
  const left = job.seconds - (performance.now() - job.t0) / 1000;
  $("timeLeft").textContent = Math.max(0, Math.ceil(left));
  $("timeBar").style.width = Math.max(0, left / job.seconds * 100) + "%";
  $("timeBar").classList.toggle("low", left < 8);
  // final countdown: last 10 seconds (5 on the easy level), big number + tick
  const fin = job.level === 1 ? 5 : 10, sec = Math.ceil(left);
  let cd = $("cd");
  if (left > 0 && left <= fin) {
    if (!cd) { cd = document.createElement("div"); cd.id = "cd"; cd.className = "cd"; document.body.appendChild(cd); }
    if (cd.textContent !== String(sec)) { cd.textContent = sec; cd.classList.remove("pop"); void cd.offsetWidth; cd.classList.add("pop"); try { SFX.chip(); } catch (e) {} }
  } else if (cd) cd.remove();
  if (left <= 0) { clearInterval(tick); finish(null); }
}
async function finish(answer) {
  if (sending) return; sending = true; clearInterval(tick); $("cd")?.remove();
  let res;
  if (answer === null) res = { ok: false, paid: 0, why: "time" };
  else { const { data, error } = await rpc("job_finish", { p_id: job.id, p_answer: answer }); res = error ? { ok: false, why: "error" } : data; }
  sending = false;
  if (res.balance != null) balance = res.balance;
  if (res.ok) { earned += res.paid; try { SFX.win(job.level === 3); } catch (e) {} } else { try { SFX.lose(); } catch (e) {} }
  showBal();
  const why = { time: "נגמר הזמן ⏱️", wrong: "יש טעות בחישוב", long: "המסלול ארוך מדי", route: "הסדר לא תקין", too_fast: "מהר מדי 🤨", error: "תקלה בחיבור" }[res.why] || "";
  const r = $("result");
  r.innerHTML = `<div class="card ${res.ok ? "ok" : "no"}"><div class="big">${res.ok ? "💰 שולם " + fmt(res.paid) : "❌ לא שולם"}</div><div class="why">${res.ok ? "עבודה טובה!" : why}</div>
    ${job.game === "dealer" && !res.ok && res.values ? `<div class="vals">התשובות: <span class="num">${res.values.join(" · ")}</span></div>` : ""}
    <div class="row"><button class="go" id="again">עוד משמרת</button><button class="ghost" id="back">החלף עבודה</button></div></div>`;
  r.hidden = false;
  $("again").onclick = () => start(job.game, job.level);
  $("back").onclick = () => { r.hidden = true; $("play").hidden = true; $("pick").hidden = false; };
  if (job.game === "dealer" && !res.ok && res.values) markDealer(res.values);
}

// ---------- dealer ----------
const SUIT = { S: "♠", H: "♥", D: "♦", C: "♣" };
function cardHtml(c) { return `<span class="pc img" style="background-image:url(cards3/${c}.webp)"></span>`; }
function drawDealer() {
  const hands = job.puzzle.hands;
  $("stage").innerHTML = `<div class="hands">${hands.map((h, i) => `<div class="hand"><div class="cards">${h.map(cardHtml).join("")}</div>
    <input class="num" inputmode="numeric" pattern="[0-9]*" maxlength="2" data-i="${i}" aria-label="ערך יד ${i + 1}"></div>`).join("")}</div>`;
  $("actions").innerHTML = `<button class="go" id="send">מסור לבדיקה</button>`;
  const ins = [...$("stage").querySelectorAll("input")];
  ins.forEach((el, i) => el.addEventListener("input", () => { el.value = el.value.replace(/\D/g, "").slice(0, 2);
    if (el.value.length === 2 || (el.value.length === 1 && +el.value >= 4)) {          // jump to the next EMPTY box, wherever it is
      const next = ins.slice(i + 1).find((x) => !x.value) || ins.find((x) => !x.value); if (next) next.focus(); else el.blur(); } }));
  ins.forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") $("send").click(); }));
  ins[0].focus();
  $("send").onclick = () => { if (ins.some((x) => !x.value)) { ins.find((x) => !x.value).focus(); return; } finish(ins.map((x) => +x.value)); };
}
function markDealer(vals) { $("stage").querySelectorAll("input").forEach((el, i) => el.classList.add(+el.value === vals[i] ? "right" : "wrongv")); }

// ---------- driver ----------
let route = [];
function drawDriver() {
  route = []; const P = job.puzzle;
  $("actions").innerHTML = `<div class="km">קילומטרים <b class="num" id="km">0</b> / <b class="num">${P.max}</b></div><button class="ghost" id="undo">בטל תחנה</button>`;
  $("undo").onclick = () => { route.pop(); renderMap(); };
  renderMap();
}
function renderMap() {
  const P = job.puzzle, n = P.size, C = 100 / n, done = new Set(route), last = route.length ? P.stops[route[route.length - 1]] : P.start;
  const xy = (p) => [(p[0] + 0.5) * C, (p[1] + 0.5) * C];
  let path = `M${xy(P.start).join(" ")}`; let pp = P.start;
  for (const i of route) { const q = P.stops[i], m = [q[0], pp[1]]; path += ` L${xy(m).join(" ")} L${xy(q).join(" ")}`; pp = q; }
  let grid = ""; for (let i = 0; i <= n; i++) grid += `<line x1="${i * C}" y1="0" x2="${i * C}" y2="100"/><line x1="0" y1="${i * C}" x2="100" y2="${i * C}"/>`;
  const stops = P.stops.map((p, i) => {
    const pax = i >> 1, pick = i % 2 === 0, can = !done.has(i) && (pick || done.has(i - 1)), [x, y] = xy(p);
    return `<g class="stop ${pick ? "pick" : "drop"} ${done.has(i) ? "done" : can ? "can" : "wait"} c${pax}" data-i="${i}" transform="translate(${x} ${y})">
      <circle r="${C * 0.42}"/><text y="${C * 0.14}" font-size="${C * 0.42}">${pick ? "🧍" : "🏠"}</text><text class="lab" x="${C * 0.3}" y="${-C * 0.22}" font-size="${C * 0.3}">${pax + 1}</text></g>`;
  }).join("");
  const [vx, vy] = xy(last);
  $("stage").innerHTML = `<svg class="map" viewBox="-1 -1 102 102">${`<g class="grid">${grid}</g>`}<path class="route" d="${path}"/>${stops}
    <text class="van" x="${vx}" y="${vy + C * 0.15}" font-size="${C * 0.55}">🚐</text></svg>
    <div class="legend">🧍 = לאסוף נוסע · 🏠 = להוריד אותו (אותו מספר). קודם אוספים, אחר כך מורידים.</div>`;
  const len = routeLen(P.start, P.stops, route); $("km").textContent = len; $("km").classList.toggle("over", len > P.max);
  $("stage").querySelectorAll(".stop.can").forEach((g) => g.addEventListener("click", () => {
    route.push(+g.dataset.i); try { SFX.chip(); } catch (e) {}
    renderMap(); if (route.length === P.stops.length) finish(route.slice());
  }));
}

// ---------- boot ----------
(async function boot() {
  if (PREVIEW) { balance = 10000; showBal(); GC_LOADER.done(); GC_GUIDE.init({ game: "jobs", db: null, mount: document.querySelector(".top"), steps: GC_STEPS.jobs(), auto: !/noguide/.test(location.search) }); return; }
  const { data: { session } } = await db.auth.getSession();
  if (!session) { location.href = "./"; return; }
  const w = await db.from("wallets").select("balance").eq("user_id", session.user.id).single();
  if (!w.error) balance = w.data.balance; showBal();
  GC_LOADER.done();
  GC_GUIDE.init({ game: "jobs", db, mount: document.querySelector(".top"), steps: GC_STEPS.jobs() });
})();
