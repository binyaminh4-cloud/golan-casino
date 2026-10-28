/* Golan Casino · owner's admin page */
const $ = (id) => document.getElementById(id);
const fmt = (n) => "₪" + Number(n).toLocaleString("en-US");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const db = supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);
const GAMES = [["blackjack", "בלאק ג׳ק"], ["lightning_bj", "בלאק ג׳ק הכפולות של פישר"], ["roulette", "רולטה"], ["lightning", "רולטת ברקים"], ["xxx", "רולטת ברקים XXX"],
  ["slots", "מכונות מזל"], ["fortune", "מכונת האטרף של בנימין"], ["poker", "פוקר"], ["jobs", "עבודות"]];
let SET = null;
function say(id, t, bad) { const m = $(id); m.className = bad ? "msg err" : "msg"; m.textContent = t; }
async function set(key, value) { const { data, error } = await db.rpc("admin_set", { p_key: key, p_value: value }); if (!error) { SET = data; drawSettings(); } return !error; }
function drawSettings() {
  $("chOn").checked = SET.challenges === true; $("soonOn").checked = SET.soon_open === true;
  $("chInfo").textContent = SET.challenges ? (SET.season ? `עונה ${SET.season.no} רצה, עד ${new Date(SET.season.ends_at).toLocaleDateString("he-IL")}.` : "העונה תיפתח ברגע שמישהו ייכנס לאתגרים.") : "האתגרים בהשהיה: החברים לא רואים אותם בלובי.";
  $("games").innerHTML = GAMES.map(([k, n]) => `<div class="sw"><span>${n}</span><label class="tog"><input type="checkbox" data-g="${k}" ${SET.games[k] !== false ? "checked" : ""}><i></i></label></div>`).join("");
  $("games").querySelectorAll("input").forEach((i) => i.onchange = () => set("games", { [i.dataset.g]: i.checked }));
  $("salW").value = SET.salary_weekly; $("salM").value = SET.salary_monthly; $("startBal").value = SET.starting_balance;
}
$("chOn").onchange = async () => { await set("challenges", $("chOn").checked); };
$("soonOn").onchange = async () => { if ($("soonOn").checked && !confirm("לפתוח את כל משחקי ה״בקרוב״ לכל החברים?")) { $("soonOn").checked = false; return; } await set("soon_open", $("soonOn").checked); };
$("seasonRestart").onclick = async () => {
  if (!confirm("לסגור את העונה הנוכחית בלי פרסים ולהתחיל עונה חדשה מאפס?")) return;
  const { data, error } = await db.rpc("admin_season_restart");
  say("chMsg", error ? "לא הצלחנו." : `עונה ${data.season} התחילה.`, !!error); loadSettings();
};
$("saveNums").onclick = async () => {
  const ok = await set("salary_weekly", +$("salW").value) && await set("salary_monthly", +$("salM").value) && await set("starting_balance", +$("startBal").value);
  say("numsMsg", ok ? "נשמר." : "השמירה נכשלה.", !ok);
};
async function loadSettings() { const { data, error } = await db.rpc("admin_settings"); if (error) { location.href = "./"; return; } SET = data; drawSettings(); }
async function loadMembers() {
  const { data } = await db.rpc("admin_members");
  $("members").innerHTML = (data || []).map((m) => `<div class="mrow"><div><b>${esc(m.name)}</b>${m.admin ? " 👑" : ""}<small>${m.username ? "@" + esc(m.username) + " · " : ""}הצטרף ${new Date(m.joined).toLocaleDateString("he-IL")}${m.seated ? " · יושב בפוקר: " + esc(m.seated) : ""}</small></div>
    <span class="num">${fmt(m.balance)}</span><button class="btn ghost sm" data-reset="${esc(m.username || m.name)}">קישור כניסה חדש</button></div>`).join("") || '<p class="msg">עוד אין חברים.</p>';
  $("members").querySelectorAll("[data-reset]").forEach((b) => b.onclick = () => { $("inviteName").value = b.dataset.reset; $("inviteForm").requestSubmit(); $("inviteName").scrollIntoView({ behavior: "smooth", block: "center" }); });
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
  const link = location.origin + location.pathname.replace(/admin\.html$/, "") + "?join=" + encodeURIComponent(name) + "&code=" + data;
  const text = `${name}, הוזמנת לגולן קזינו 🎰\nלחץ על הקישור, בחר סיסמה ואתה בפנים:\n${link}\n(הקישור אישי, תקף 7 ימים)`;
  out.innerHTML = `<div class="msg">ההזמנה של <b>${esc(name)}</b> מוכנה:</div><a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">📲 שלח בוואטסאפ</a>
    <button type="button" class="btn ghost" id="copyInv">העתק קישור</button><div class="msg" style="direction:ltr;word-break:break-all;font-size:12px">${esc(link)}</div>`;
  $("copyInv").onclick = async () => { try { await navigator.clipboard.writeText(text); $("copyInv").textContent = "הועתק ✓"; } catch (e) {} };
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
  if (!(amt >= 1 && amt <= 100000000)) { m.className = "msg err"; m.textContent = "סכום בין ₪1 ל־₪100,000,000."; return; }
  const name = who ? $("grantWho").selectedOptions[0].textContent : "כל החברים";
  if (!confirm(`לטעון ${fmt(amt)} ל${who ? "־" + name : "כל החברים"}?`)) return;
  const { data, error } = await db.rpc("admin_grant", { p_user: who, p_amount: amt });
  m.className = error ? "msg err" : "msg";
  m.textContent = error ? "הטעינה נכשלה. נסה שוב." : `נטען ${fmt(amt)} ל־${data} ${data === 1 ? "חבר" : "חברים"}.`;
  if (!error) loadMembers();
});

// ---------- Admin: assign characters (stored in the private "characters" bucket) ----------
const CHAR_KEYS = Array.from({ length: 8 }, (_, i) => "char_" + String(i).padStart(2, "0"));
const ANIMALS = ["animal_1", "animal_2", "animal_3", "animal_4", "animal_5"];   // public, any number of members may share one
let charUrls = {};
async function loadCharacters() {
  if (!Object.keys(charUrls).length) {
    const { data } = await db.storage.from("characters").createSignedUrls(CHAR_KEYS.map((k) => k + ".webp"), 3600);
    (data || []).forEach((s, i) => { if (s.signedUrl) charUrls[CHAR_KEYS[i]] = s.signedUrl; });
  }
  const { data: people } = await db.from("profiles").select("id,nickname,character_key").order("created_at");
  const taken = new Set((people || []).map((p) => p.character_key).filter((k) => k && !k.startsWith("animal_")));
  ANIMALS.forEach((k) => { charUrls[k] = "img/animals/" + k + ".svg"; });
  $("charList").innerHTML = (people || []).map((p) => `
    <div class="crow">
      <div class="cname">${esc(p.nickname)}</div>
      <div class="cpick">${[...CHAR_KEYS, ...ANIMALS].map((k) => `<button class="cthumb${p.character_key === k ? " on" : ""}${taken.has(k) && p.character_key !== k ? " taken" : ""}"
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


(async function boot() {
  const { data: { session } } = await db.auth.getSession(); if (!session) { location.href = "./"; return; }
  await loadSettings(); loadMembers(); loadInvites(); loadGrantList(); loadCharacters();
  GC_LOADER.done();
})();
