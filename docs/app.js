const { createClient } = supabase;
const db = createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);
const $ = (id) => document.getElementById(id);
const fmt = (n) => "₪" + Number(n).toLocaleString("en-US");
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
  $("hdrName").textContent = me.nickname;
  $("hdrAv").textContent = (me.nickname || "?")[0].toUpperCase();
  GC_CHAR(db, user.id).then((c) => { if (c.url) $("hdrAv").innerHTML = `<img src="${esc(c.url)}" alt="" style="width:100%;height:100%;object-fit:cover;object-position:50% 8%;border-radius:50%">`; });
  $("adminPanel").hidden = !me.is_admin;
  $("charPanel").hidden = !me.is_admin;
  $("grantPanel").hidden = !me.is_admin;
  if (me.is_admin) { loadInvites(); loadCharacters(); loadGrantList(); }
  await refresh();
  GC_LOADER.done();
  if (!document.querySelector(".top-guide")) { const m = document.createElement("div"); m.className = "top-guide"; document.querySelector("#lobbyView header .me").prepend(m);
    GC_GUIDE.init({ game: "lobby", db, mount: m, steps: GC_STEPS.lobby() }); }
  clearInterval(timer); timer = setInterval(refresh, 15000);
}

async function refresh() {
  const [w, lb] = await Promise.all([
    db.from("wallets").select("balance").eq("user_id", me.id).single(),
    db.from("leaderboard").select("id,nickname,wealth").order("wealth", { ascending: false }),
  ]);
  if (!w.error) { $("hdrBal").textContent = fmt(w.data.balance); $("walBal").textContent = fmt(w.data.balance); $("walSub").textContent = w.data.balance === 0 ? "נגמרו השקלים. מנהל המועדון יכול לאפס." : "יתרה בשרת · מתעדכנת אוטומטית"; }
  const box = $("lbBox");
  if (lb.error) { box.innerHTML = '<p class="msg err">לא הצלחנו לטעון את הטבלה. בדוק חיבור ונסה שוב.</p>'; return; }
  if (!lb.data.length) { box.innerHTML = '<p class="msg">עוד אין חברים במועדון.</p>'; return; }
  box.innerHTML = "<ol>" + lb.data.map((m, i) =>
    `<li class="${m.id === me.id ? "you" : ""}"><span class="rk num">${i + 1}</span><span class="avatar av">${esc((m.nickname || "?")[0].toUpperCase())}</span><span class="nm">${esc(m.nickname)}${m.id === me.id ? " (אתה)" : ""}</span><span class="w num">${fmt(m.wealth)}</span></li>`
  ).join("") + "</ol>";
}

// ---------- Admin: access codes (no email) ----------
async function loadInvites() {
  const { data } = await db.rpc("admin_pending_codes");
  $("inviteList").innerHTML = (data || []).map((i) => `<li>${esc(i.username)} · ${i.reset ? "ממתין לסיסמה חדשה" : "ממתין להצטרפות"}</li>`).join("");
}
$("inviteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("inviteName").value.trim(), msg = $("inviteMsg"), out = $("codeOut");
  if (name.length < 2) { msg.className = "msg err"; msg.textContent = "שם משתמש של 2 עד 20 תווים."; return; }
  const { data, error } = await db.rpc("admin_issue_code", { p_username: name });
  if (error) { msg.className = "msg err"; msg.textContent = /invalid_username/.test(error.message) ? "רק אותיות, ספרות, רווח, נקודה וקו תחתון. 2 עד 20 תווים." : "הקוד לא נוצר. נסה שוב."; return; }
  const link = location.origin + location.pathname;
  const text = `הוזמנת לגולן קזינו 🎰\n${link}\nשם משתמש: ${name}\nקוד: ${data}\nלחץ "יש לי קוד", הכנס את השם והקוד ובחר סיסמה.`;
  out.innerHTML = `<div class="msg">הקוד של <b>${esc(name)}</b>:</div><div class="big">${data}</div><a href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">שלח בוואטסאפ</a>`;
  out.hidden = false; msg.textContent = ""; $("inviteName").value = ""; loadInvites();
});

// ---------- Admin: load play money ----------
async function loadGrantList() {
  const { data } = await db.from("profiles").select("id,nickname").order("nickname");
  $("grantWho").innerHTML = `<option value="">כל החברים</option>` + (data || []).map((p) => `<option value="${p.id}">${esc(p.nickname)}</option>`).join("");
}
$("grantForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const amt = Math.floor(+$("grantAmt").value), who = $("grantWho").value || null, m = $("grantMsg");
  if (!(amt >= 1 && amt <= 10000000)) { m.className = "msg err"; m.textContent = "סכום בין ₪1 ל־₪10,000,000."; return; }
  const name = who ? $("grantWho").selectedOptions[0].textContent : "כל החברים";
  if (!confirm(`לטעון ${fmt(amt)} ל${who ? "־" + name : "כל החברים"}?`)) return;
  const { data, error } = await db.rpc("admin_grant", { p_user: who, p_amount: amt });
  m.className = error ? "msg err" : "msg";
  m.textContent = error ? "הטעינה נכשלה. נסה שוב." : `נטען ${fmt(amt)} ל־${data} ${data === 1 ? "חבר" : "חברים"}.`;
  if (!error) refresh();
});

// ---------- Admin: assign characters (stored in the private "characters" bucket) ----------
const CHAR_KEYS = Array.from({ length: 8 }, (_, i) => "char_" + String(i).padStart(2, "0"));
let charUrls = {};
async function loadCharacters() {
  if (!Object.keys(charUrls).length) {
    const { data } = await db.storage.from("characters").createSignedUrls(CHAR_KEYS.map((k) => k + ".webp"), 3600);
    (data || []).forEach((s, i) => { if (s.signedUrl) charUrls[CHAR_KEYS[i]] = s.signedUrl; });
  }
  const { data: people } = await db.from("profiles").select("id,nickname,character_key").order("created_at");
  const taken = new Set((people || []).map((p) => p.character_key).filter(Boolean));
  $("charList").innerHTML = (people || []).map((p) => `
    <div class="crow">
      <div class="cname">${esc(p.nickname)}</div>
      <div class="cpick">${CHAR_KEYS.map((k) => `<button class="cthumb${p.character_key === k ? " on" : ""}${taken.has(k) && p.character_key !== k ? " taken" : ""}"
        data-u="${p.id}" data-k="${k}" title="${k}" aria-pressed="${p.character_key === k}"><img src="${esc(charUrls[k] || "")}" alt="${k}"></button>`).join("")}
        <button class="cthumb none" data-u="${p.id}" data-k="" title="בלי דמות">✕</button></div>
    </div>`).join("") || '<p class="msg">עוד אין חברים רשומים.</p>';
  $("charList").querySelectorAll(".cthumb").forEach((b) => b.onclick = async () => {
    const { error } = await db.rpc("admin_set_character", { p_user: b.dataset.u, p_key: b.dataset.k || null });
    $("charMsg").className = error ? "msg err" : "msg";
    $("charMsg").textContent = error ? "השיבוץ לא נשמר. נסה שוב." : "נשמר.";
    if (!error) loadCharacters();
  });
}

boot();
