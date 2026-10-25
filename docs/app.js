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
}
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("email").value.trim();
  const msg = $("loginMsg");
  if (!/^\S+@\S+\.\S+$/.test(email)) { msg.className = "msg err"; msg.textContent = "כתובת האימייל לא תקינה. בדוק ונסה שוב."; return; }
  $("sendBtn").disabled = true; msg.className = "msg"; msg.textContent = "שולח…";
  const { error } = await db.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  $("sendBtn").disabled = false;
  if (error) {
    msg.className = "msg err";
    msg.textContent = /database error|not_invited/i.test(error.message)
      ? "האימייל הזה לא הוזמן למועדון. בקש הזמנה ממנהל המועדון."
      : /rate|seconds/i.test(error.message) ? "ביקשת קישור לפני רגע. חכה דקה ונסה שוב." : "משהו השתבש בשליחה. נסה שוב בעוד רגע.";
    return;
  }
  msg.textContent = "שלחנו לך קישור כניסה למייל. פתח אותו מהמכשיר הזה.";
});
$("logout").onclick = () => db.auth.signOut();

// ---------- Lobby ----------
async function showLobby(user) {
  if (me && me.id === user.id) return;
  $("loginView").hidden = true; $("lobbyView").hidden = false;
  const { data: prof } = await db.from("profiles").select("id,nickname,is_admin").eq("id", user.id).single();
  me = prof || { id: user.id, nickname: user.email, is_admin: false };
  $("hdrName").textContent = me.nickname;
  $("hdrAv").textContent = (me.nickname || "?")[0].toUpperCase();
  $("adminPanel").hidden = !me.is_admin;
  $("charPanel").hidden = !me.is_admin;
  if (me.is_admin) { loadInvites(); loadCharacters(); }
  await refresh();
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

// ---------- Admin: invitations ----------
async function loadInvites() {
  const { data } = await db.from("invitations").select("email,accepted_at").order("invited_at");
  $("inviteList").innerHTML = (data || []).map((i) => `<li><span class="num">${esc(i.email)}</span> · ${i.accepted_at ? "הצטרף" : "ממתין"}</li>`).join("");
}
$("inviteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("inviteEmail").value.trim().toLowerCase(), msg = $("inviteMsg");
  if (!/^\S+@\S+\.\S+$/.test(email)) { msg.className = "msg err"; msg.textContent = "כתובת האימייל לא תקינה."; return; }
  const { error } = await db.from("invitations").insert({ email });
  msg.className = error ? "msg err" : "msg";
  msg.textContent = error ? (error.code === "23505" ? "החבר הזה כבר מוזמן." : "ההזמנה לא נשמרה. נסה שוב.") : `הוזמן. שלח לו את הקישור לאתר, והוא ייכנס עם ${email}.`;
  if (!error) { $("inviteEmail").value = ""; loadInvites(); }
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
