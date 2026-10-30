const { createClient } = supabase;
const db = createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);
const $ = (id) => document.getElementById(id);
const fmt = (n) => { n = Number(n); const a = Math.abs(n); return a >= 1e12 ? "₪" + +(n / 1e12).toFixed(2) + "T" : a >= 1e9 ? "₪" + +(n / 1e9).toFixed(2) + "B" : a >= 1e6 ? "₪" + +(n / 1e6).toFixed(2) + "M" : "₪" + n.toLocaleString("en-US"); };   // ₪1.58M · ₪2.4B · ₪1T
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let me = null, timer = null;

async function boot() {
  const { data: { session } } = await db.auth.getSession();
  session ? showLobby(session.user) : showLogin();
}
db.auth.onAuthStateChange((_e, session) => { session ? showLobby(session.user) : showLogin(); });

// ---------- Login ----------
function showLogin() {
  clearInterval(timer); me = null;
  $("lobbyView").hidden = true; $("loginView").hidden = false;
  const bg = new Image(); bg.onload = bg.onerror = () => GC_LOADER.done();
  bg.src = innerWidth < innerHeight ? "img/brand/login_bg_mobile.jpg" : "img/brand/login_bg_desktop.jpg";
}
function loginMsg(t, bad) { const m = $("loginMsg"); m.className = bad ? "g-msg err" : "g-msg"; m.textContent = t; }
let codeMode = false;
$("codeBtn").onclick = () => {
  codeMode = !codeMode;
  $("codeField").hidden = !codeMode;
  $("passLabel").textContent = codeMode ? "בחר סיסמה (לפחות 6 תווים)" : "סיסמה";
  $("pass").autocomplete = codeMode ? "new-password" : "current-password";
  $("loginBtn").textContent = codeMode ? "קבע סיסמה וכנס" : "כניסה למועדון";
  $("codeBtn").textContent = codeMode ? "חזרה לכניסה רגילה" : "יש לי קוד · כניסה ראשונה או סיסמה חדשה";
  loginMsg(""); if (codeMode) $("code").focus();
};
// a personal invite link (?join=name&code=123456): only the password is left to choose
(function inviteLink() {
  const q = new URLSearchParams(location.search), name = q.get("join"), code = q.get("code");
  if (!name || !code) return;
  if (!codeMode) $("codeBtn").click();
  $("uname").value = name; $("code").value = code;
  $("uname").closest(".field").hidden = true; $("codeField").hidden = true; $("codeBtn").hidden = true;
  loginMsg(`ברוך הבא ${name}! בחר סיסמה (לפחות 6 תווים) ואתה בפנים 🎰`);
  setTimeout(() => $("pass").focus(), 300);
})();
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = $("uname").value.trim(), password = $("pass").value;
  if (user.length < 2) return loginMsg("כתוב את שם המשתמש שלך.", true);
  if (password.length < 6) return loginMsg("הסיסמה צריכה להיות לפחות 6 תווים.", true);
  $("loginBtn").disabled = true; loginMsg(codeMode ? "בודק את הקוד…" : "נכנס…");
  try {
    let email;
    if (codeMode) {
      const code = $("code").value.trim();
      if (!/^\d{6}$/.test(code)) throw new Error("code_format");
      const r = await db.rpc("redeem_code", { p_username: user, p_code: code, p_password: password });
      if (r.error) throw r.error;
      if (!r.data) throw new Error("wrong_code");
      email = r.data;
    } else {
      const r = await db.rpc("login_email", { p_username: user });
      if (r.error) throw r.error;
      if (!r.data) throw new Error("no_user");
      email = r.data;
    }
    GC_LOADER.show();
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (!error && codeMode) history.replaceState(null, "", location.pathname);   // drop the one-time code from the address bar
    if (error) GC_LOADER.done();
    if (error) throw new Error(/invalid/i.test(error.message) ? "bad_password" : error.message);
  } catch (err) {
    GC_LOADER.done();
    const m = err.message || "";
    loginMsg(m.includes("code_format") ? "הקוד הוא 6 ספרות." :
      m.includes("wrong_code") || m.includes("bad_code") ? "הקוד לא נכון או שפג תוקפו. בדוק את הקוד שקיבלת." :
      m.includes("code_locked") ? "יותר מדי ניסיונות. בקש מבנימין קוד חדש." :
      m.includes("username_taken") ? "שם המשתמש הזה כבר תפוס." :
      m.includes("no_user") ? "לא מצאנו משתמש בשם הזה. בדוק את השם, או בקש קוד מבנימין." :
      m.includes("bad_password") ? "הסיסמה לא נכונה. שכחת? בקש מבנימין קוד חדש." :
      "הכניסה נכשלה. נסה שוב בעוד רגע.", true);
  } finally { $("loginBtn").disabled = false; }
});
$("logout").onclick = () => { GC_LOADER.show(); db.auth.signOut().finally(() => setTimeout(GC_LOADER.done, 400)); };

// ---------- Lobby ----------
async function showLobby(user) {
  if (me && me.id === user.id) return;
  $("loginView").hidden = true; $("lobbyView").hidden = false;
  const { data: prof } = await db.from("profiles").select("id,nickname,is_admin").eq("id", user.id).single();
  me = prof || { id: user.id, nickname: user.email, is_admin: false };
  $("hdrName").innerHTML = esc(me.nickname) + `<i class="lvu" data-u="${me.id}"></i>`;
  $("hdrAv").textContent = (me.nickname || "?")[0].toUpperCase();
  GC_CHAR(db, user.id).then((c) => { if (c.url) $("hdrAv").innerHTML = `<img src="${esc(c.url)}" alt="" style="width:100%;height:100%;object-fit:cover;object-position:50% 8%;border-radius:50%">`; });
  $("adminLink").hidden = !me.is_admin;
  applyPublic();
  try { const { data: sal } = await db.rpc("salary_claim");
    if (sal && (sal.weekly || sal.monthly)) salaryToast(sal); } catch (e) {}
  await refresh();
  GC_LOADER.done();
  soundAsk(); liveStrips();
  if (!document.querySelector(".top-guide")) { const m = document.createElement("div"); m.className = "top-guide"; document.querySelector("#lobbyView header .me").append(m);
    // whoever skipped saving the app gets the save-to-home-screen popup again, before Ido's tour
    (async () => { let s = null; try { s = localStorage.getItem("gc_install_seen"); } catch (e) {}
      if (window.GC_INSTALL && !GC_INSTALL.standalone() && s !== "done") await GC_INSTALL.show("again");
      GC_GUIDE.init({ game: "lobby", db, mount: m, steps: GC_STEPS.lobby() }); })(); }
  clearInterval(timer); timer = setInterval(() => { if (!document.hidden) refresh(); }, 20000);
}

const LBAV = {};          // members' characters for the leaderboard (signed links, fetched once)
async function lbAvatars(list) {
  for (const m of list) { if (m.id in LBAV) continue; LBAV[m.id] = "";
    GC_CHAR(db, m.id).then((c) => { if (!c.url) return; LBAV[m.id] = c.url; const el = document.querySelector(`.lb .av[data-u="${m.id}"]`); if (el) el.innerHTML = `<img src="${esc(c.url)}" alt="">`; }); }
}
// money from the house (admin grant): a popup the first time the member sees it
async function grantNote() {
  const { data } = await db.from("bank_tx").select("id,amount").eq("kind", "gift").order("id", { ascending: false }).limit(5);
  if (!data || !data.length) return;
  let seen = 0; try { seen = +(localStorage.getItem("gc_bank_gift_seen") || 0); } catch (e) {}
  const fresh = data.filter((t) => t.id > seen); try { localStorage.setItem("gc_bank_gift_seen", data[0].id); } catch (e) {}
  if (!seen || !fresh.length) return;   // first visit on this device: just remember where we are
  const sum = fresh.reduce((a, t) => a + Number(t.amount), 0);
  if (window.GC_BONUS) GC_BONUS("💸 קיבלת כסף מבעל הבית", sum, "נכנס לבנק");
  else alert("💸 קיבלת " + fmt(sum) + " מבעל הבית");
}
let refreshing = false;
async function refresh() { if (refreshing) return; refreshing = true; try { await refresh0(); } finally { refreshing = false; } }
async function refresh0() {
  grantNote().catch(() => {});
  const [w, lb, on] = await Promise.all([
    db.from("wallets").select("balance").eq("user_id", me.id).single(),
    db.from("leaderboard").select("id,nickname,wealth").order("wealth", { ascending: false }),
    db.rpc("gc_online").then((r) => r, () => ({})),
  ]);
  const ON = (on && on.data) || {};
  const dot = (id) => { const s = id === me.id ? 0 : ON[id]; const [c, t] = s == null || s > 1800 ? ["off", "מנותק"] : s < 90 ? ["on", "מחובר"] : ["away", "היה לאחרונה"];
    return `<i class="ondot ${c}" title="${t}"></i>`; };
  const seenTxt = (id) => { const s = ON[id]; if (id === me.id || s == null || s < 90) return "";
    const d = new Date(Date.now() - s * 1000), now = new Date(), day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.floor((day0 - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    const t = days === 0 ? d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) : days === 1 ? "אתמול" : days === 2 ? "לפני יומיים"
      : days < 7 ? "ביום " + d.toLocaleDateString("he-IL", { weekday: "long" }).replace("יום ", "") : days < 14 ? "לפני שבוע" : days < 30 ? "לפני שבועיים"
      : days < 60 ? "לפני חודש" : days < 365 ? `לפני ${Math.floor(days / 30)} חודשים` : "לפני יותר משנה";
    return `<small class="seen">נראה לאחרונה ${t}</small>`; };
  if (!w.error) { $("hdrBal").textContent = fmt(w.data.balance); $("walBal").textContent = fmt(w.data.balance); $("walSub").textContent = w.data.balance === 0 ? "נגמרו השקלים. מנהל המועדון יכול לאפס." : "יתרה בשרת · מתעדכנת אוטומטית"; }
  const box = $("lbBox");
  if (lb.error) { box.innerHTML = '<p class="msg err">לא הצלחנו לטעון את הטבלה. בדוק חיבור ונסה שוב.</p>'; return; }
  if (!lb.data.length) { box.innerHTML = '<p class="msg">עוד אין חברים במועדון.</p>'; return; }
  box.innerHTML = "<ol>" + lb.data.map((m, i) =>
    `<li class="${m.id === me.id ? "you" : ""}"><span class="rk num">${i < 3 ? `<img src="img/lobby/medal_${i + 1}.webp" alt="${i + 1}">` : i + 1}</span><span class="avatar av" data-u="${m.id}">${LBAV[m.id] ? `<img src="${esc(LBAV[m.id])}" alt="">` : esc((m.nickname || "?")[0].toUpperCase())}</span><span class="nm"><span class="nmt">${esc(m.nickname)}<i class="lvu" data-u="${m.id}"></i>${dot(m.id)}</span>${m.id === me.id ? '<small class="you-t">(אתה)</small>' : ""}${seenTxt(m.id)}</span><span class="w num"><img class="wc" src="img/lobby2/ic_coins.png" alt="">${fmt(m.wealth)}</span><span class="fav" data-u="${m.id}">${FAV[m.id] ? "🎮 " + favName(FAV[m.id]) : ""}</span></li>`
  ).join("") + "</ol>";
  lbAvatars(lb.data);
  if (!FAV._t) { FAV._t = 1; db.rpc("gc_fav_games").then(({ data }) => { if (!data) return; Object.assign(FAV, data);
    document.querySelectorAll(".lb .fav[data-u]").forEach((s) => { const g = FAV[s.dataset.u]; s.textContent = g ? "🎮 " + favName(g) : ""; }); }); }
}
// most-played game per member (lobby top 3)
const FAV = {};
const FAVN = { roulette: "רולטה", lightning_roulette: "רולטת הברק", xxx_roulette: "רולטת XXX", blackjack: "בלאק ג׳ק", poker: "פוקר", slots: "מכונות מזל",
  fortune_slots: "מכונת האטרף", fortune: "מכונת האטרף", dragons: "דרקוני הגולן", wild_west: "המערב הפרוע", kinneret: "על האש בכינרת", pachinko: "מכונת השירותים",
  protein_miner: "שולה החלבון", ido_fishing: "גלגל הדגים של עידו", ido_chicken: "עידו חוצה את הכביש", fisher90: "פישר בדקה ה־90" };
function favName(g) { return FAVN[g] || g; }

boot();
// lobby art: every game box gets its poster; the text sits on the calm right side (the art leaves it free)
const TILE = { "blackjack.html": "blackjack", "blackjack.html?table=1": "bj_together", "blackjack.html?mode=lightning": "bj_fisher", "roulette.html": "roulette",
  "roulette.html?mode=lightning": "roulette_lightning", "roulette.html?mode=xxx": "roulette_xxx", "roulette.html?mode=xxx&skin=fish": "roulette_fish", "slots.html": "slots",
  "slots.html?m=fortune": "fortune", "poker.html": "poker", "jobs.html": "jobs", "fishing.html": "fishing", "fisher90.html": "fisher90", "protein.html": "protein",
  "pachinko.html": "pachinko", "kinneret.html": "kinneret", "wildwest.html": "wildwest", "dragons.html": "dragons", "chicken.html": "chicken" };
document.querySelectorAll(".games .game[href]").forEach((g) => { const t = TILE[g.getAttribute("href")]; if (t) { g.classList.add("art"); g.style.setProperty("--art", `url(img/tiles/tile_${t}.webp)`); } });
// what's new: once per release, after the sound question and the guide are out of the way
(async function whatsNew() {
  let wn; try { wn = await (await fetch("whatsnew.json?t=" + Date.now(), { cache: "no-store" })).json(); } catch (e) { return; }
  let seen = null; try { seen = localStorage.getItem("gc_wn"); } catch (e) {}
  if (!wn || seen === wn.v) return;
  if (seen === null) { try { localStorage.setItem("gc_wn", wn.v); } catch (e) {} return; }   // brand-new members skip old news
  while (document.querySelector(".soundask, .gc-sit, .gd, #gcLoad")) await new Promise((r) => setTimeout(r, 700));
  const o = document.createElement("div"); o.className = "wn";
  o.innerHTML = `<div class="wnbox"><h2>${esc(wn.title)}</h2><div class="wnlist">${wn.items.map((i) => `<section><h3>${esc(i.t)}</h3><p>${esc(i.d)}</p>${i.img ? `<img src="${esc(i.img)}" alt="" loading="lazy">` : ""}</section>`).join("")}</div><button type="button">יאללה, לשחק</button></div>`;
  o.querySelector("button").onclick = () => { o.remove(); try { localStorage.setItem("gc_wn", wn.v); } catch (e) {} };
  document.body.appendChild(o);
})();
// "coming soon" games: closed to members; the owner's test code opens them on this device
document.addEventListener("click", (e) => { const g = e.target.closest(".game[data-soon]"); if (!g) return;
  let dev = false; try { dev = localStorage.getItem("gc_dev") === "1"; } catch (er) {}
  if (dev) return;
  e.preventDefault(); e.stopPropagation();
  const c = prompt("המשחק הזה עוד בבנייה ויפתח בקרוב 🔒\nקוד בדיקה:");
  if (c && c.trim() === "456123") { try { localStorage.setItem("gc_dev", "1"); } catch (er) {} location.href = g.getAttribute("href"); }
}, true);
// private roulette table: a button inside the live-table card
document.addEventListener("click", (e) => { const b = e.target.closest(".priv"); if (!b) return; e.preventDefault(); e.stopPropagation(); location.href = b.dataset.go; }, true);

// salary landed: a short gold toast
function salaryToast(s) {
  const parts = []; if (s.monthly) parts.push(`משכורת חודשית ${fmt(s.monthly)}`); if (s.weekly) parts.push(`משכורת שבועית ${fmt(s.weekly)}`);
  const t = document.createElement("div"); t.className = "sal-toast"; t.innerHTML = `🏦 נכנסה לבנק ${parts.join(" + ")}`;
  document.body.appendChild(t); requestAnimationFrame(() => t.classList.add("on")); try { SFX && SFX.win && SFX.win(false); } catch (e) {}
  setTimeout(() => { t.classList.remove("on"); setTimeout(() => t.remove(), 500); }, 5000);
}

// ---------- lobby categories: tap a category, then pick a game inside it ----------
(function cats() {
  const NAME = { bj: "בלאק ג׳ק", rl: "רולטה", sl: "מכונות מזל", poker: "פוקר", jobs: "עבודות" };
  const box = $("gamesBox"), cs = $("cats"); if (!box || !cs) return;
  cs.querySelectorAll(".cat").forEach((b) => {
    const n = box.querySelectorAll(`.game[data-cat="${b.dataset.c}"]`).length, open = box.querySelectorAll(`.game[data-cat="${b.dataset.c}"]:not(.soon)`).length;
    b.querySelector("small").textContent = b.dataset.c === "jobs" ? "דילר מתלמד · ועוד בדרך" : open ? (n === 1 ? "משחק אחד" : `${n} משחקים`) : "בקרוב";
    if (!open) b.classList.add("soon");
    b.onclick = () => { if (b.dataset.c === "jobs") { location.href = "jobs.html"; return; } show(b.dataset.c); };
  });
  function show(c) {
    if (c) box.querySelectorAll(".game").forEach((g) => g.hidden = g.dataset.cat !== c);
    box.hidden = !c; cs.hidden = !!c; $("catBack").hidden = !c;
    // games page: the whole screen belongs to this category's games; tabs on top switch category
    document.body.classList.toggle("gpage", !!c); $("gTabs").hidden = !c;
    $("gTabs").querySelectorAll("button").forEach((t) => t.classList.toggle("on", t.dataset.c === c)); box.scrollLeft = 0;
    document.querySelectorAll(".lx-nav [data-nav]").forEach((t) => t.classList.toggle("on", t.dataset.nav === (c ? "games" : "home")));
    $("roomsH").textContent = c ? NAME[c] : "חדרי המשחק";
    try { c ? sessionStorage.setItem("gc_cat", c) : sessionStorage.removeItem("gc_cat"); } catch (e) {}
  }
  $("catBack").onclick = () => show(null);
  $("gTabs").onclick = (e) => { const t = e.target.closest("button"); if (t) show(t.dataset.c); };
  window.GC_SHOWCAT = show;
  try { const c = sessionStorage.getItem("gc_cat"); if (c && NAME[c]) show(c); } catch (e) {}
})();

// owner's settings: hide games he switched off, and the challenges banner while challenges are paused
async function applyPublic() {
  try {
    const { data } = await db.rpc("gc_public"); if (!data) return;
    document.querySelector(".chbanner").hidden = !data.challenges;
    // the owner opened every "coming soon" game for everyone
    try { if (data.soon_open) localStorage.setItem("gc_open", "1"); else localStorage.removeItem("gc_open"); } catch (er) {}
    if (data.soon_open) document.querySelectorAll(".game[data-soon]").forEach((g) => { g.removeAttribute("data-soon"); g.classList.remove("soon"); const t = g.querySelector(".tag"); if (t && /בקרוב/.test(t.textContent)) t.textContent = "חדש ✨"; });
    document.querySelectorAll(".cat.soon").forEach((c) => { if (document.querySelector(`.games .game[data-cat="${c.dataset.c}"]:not(.soon)`)) c.classList.remove("soon"); });
    const map = { "blackjack.html": "blackjack", "blackjack.html?table=1": "blackjack", "blackjack.html?mode=lightning": "lightning_bj", "roulette.html": "roulette", "roulette.html?mode=lightning": "lightning",
      "roulette.html?mode=xxx": "xxx", "slots.html": "slots", "slots.html?m=fortune": "fortune", "poker.html": "poker", "jobs.html": "jobs" };
    document.querySelectorAll(".games .game[href]").forEach((g) => { const k = map[g.getAttribute("href")]; if (k && data.games && data.games[k] === false) g.remove(); });
    document.querySelectorAll(".cat").forEach((c) => { const n = document.querySelectorAll(`.games .game[data-cat="${c.dataset.c}"]`).length; if (!n) c.hidden = true;
      else if (c.dataset.c !== "jobs") c.querySelector("small").textContent = n === 1 ? "משחק אחד" : `${n} משחקים`; });
  } catch (e) {}
}

// sound choice: asked once per device; the tap also wakes the phone's audio
function soundAsk() {
  try { if (localStorage.getItem("gc_sound_chosen")) return; } catch (e) { return; }
  const o = document.createElement("div"); o.className = "soundask";
  o.innerHTML = `<img class="dj" src="img/lightning/dj_idle.webp" alt="די־ג׳יי פישר"><div class="box"><h3>דיג׳יי פישר מבקש רשות</h3><p>להדליק את הסאונד, או שגם הפעם הוא ינגן לעצמו?</p>
    <div class="row"><button class="btn" data-s="on">🎧 תן בראש, פישר</button><button class="btn ghost" data-s="off">🔇 תודה, פישר</button></div></div>`;
  document.body.appendChild(o);
  o.querySelectorAll("button").forEach((b) => b.addEventListener("pointerup", () => {      // close at once: no extra audio setup on this tap
    const on = b.dataset.s === "on";
    try { localStorage.setItem("gc_sound_chosen", "1"); localStorage.setItem("gc_mute", on ? "0" : "1"); } catch (e) {}
    o.remove();
  }, { once: true }));
}

// live roulette: last 5 numbers on each roulette card; tap them for the last 500 (20 per row, newest first)
const RL_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const rlCol = (n) => n === 0 ? "g" : RL_RED.has(n) ? "r" : "b";
const ball = (h) => `<i class="rb ${rlCol(h.n)}${h.x ? " x" : ""}" title="${h.x ? "⚡ " + h.x + "x" : ""}">${h.n}</i>`;
async function liveStrips() {
  for (const [href, mode] of [["roulette.html", "classic"], ["roulette.html?mode=lightning", "lightning"], ["roulette.html?mode=xxx", "xxx"]]) {
    const card = document.querySelector(`.games .game[href="${href}"]`); if (!card) continue;
    const { data } = await db.rpc("rl_live_recent", { p_mode: mode, p_limit: 5 }); if (!data) continue;
    let st = card.querySelector(".rstrip");
    if (!st) { st = document.createElement("button"); st.type = "button"; st.className = "rstrip"; card.querySelector("h3").after(st);
      st.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); rlHistory(mode, card.querySelector("h3").textContent); }); }
    st.innerHTML = `<small>לייב · אחרונים</small>${data.map(ball).join("")}<span class="more">500 ←</span>`;
  }
}
async function rlHistory(mode, title) {
  const o = document.createElement("div"); o.className = "rlhist";
  o.innerHTML = `<div class="box"><div class="hd"><b>${esc(title)} · 500 מספרים אחרונים</b><button type="button" aria-label="סגור">✕</button></div>
    <p class="msg">מהחדש לישן, 20 בשורה.${mode !== "classic" ? " ⚡ מסגרת זהב = נחת על מספר שנפגע מברק." : ""}</p><div class="grid">טוען…</div></div>`;
  document.body.appendChild(o);
  o.querySelector("button").onclick = () => o.remove(); o.onclick = (e) => { if (e.target === o) o.remove(); };
  const { data } = await db.rpc("rl_live_recent", { p_mode: mode, p_limit: 500 });
  const d = data || [], c = (f) => d.filter(f).length;
  o.querySelector(".grid").innerHTML = d.map(ball).join("");
  o.querySelector(".msg").insertAdjacentHTML("beforeend", `<br>🔴 ${c((h) => rlCol(h.n) === "r")} · ⚫ ${c((h) => rlCol(h.n) === "b")} · 🟢 ${c((h) => h.n === 0)}${mode !== "classic" ? ` · ⚡ ${c((h) => h.x)}` : ""}`);
}

// who is playing right now: a small "live" strip on each game tile (sits on the tile's top edge, never over its art)
async function liveNow() {
  try { const { data } = await db.rpc("gc_live"); if (!data) return;
    document.querySelectorAll(".games .game[href]").forEach((g) => { const ppl = data[g.getAttribute("href")] || []; let s = g.querySelector(".livenow");
      if (!ppl.length) { if (s) s.remove(); return; }
      if (!s) { s = document.createElement("span"); s.className = "livenow"; g.appendChild(s); }
      const names = ppl.map((p) => p.name).filter(Boolean); s.textContent = `🟢 ${names.length === 1 ? names[0] + " משחק עכשיו" : names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "") + " משחקים עכשיו"}`; });
  } catch (e) {}
}
liveNow(); setInterval(() => { if (!document.hidden) liveNow(); }, 30000);
