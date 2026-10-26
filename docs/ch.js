/* Golan Casino · seasons and challenges page */
const $ = (id) => document.getElementById(id);
const fmt = (n) => "₪" + Number(n).toLocaleString("en-US");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PREVIEW = /[?#&]preview/.test(location.href);
const db = PREVIEW ? null : supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);
let S = null;
const runUrl = (kind, run) => kind === "fisher" ? `blackjack.html?mode=lightning&ch=${run}` : `blackjack.html?ch=${run}`;
function err(t) { $("err").textContent = t || ""; }
function errText(e) {
  const m = (e && e.message) || "";
  if (m.includes("challenge_in_progress")) return "יש לך כבר אתגר פתוח. סיים אותו קודם.";
  if (m.includes("slow_down")) return "כבר אתגרת את החבר הזה פעמיים היום.";
  if (m.includes("challenge_closed")) return "האתגר הזה כבר נסגר.";
  return "משהו השתבש. נסה שוב.";
}
function left(ends) {
  const ms = new Date(ends) - Date.now(); if (ms <= 0) return "העונה מסתיימת עכשיו";
  const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5);
  return `נשארו ${d ? d + " ימים ו־" : ""}${h} שעות`;
}
function draw() {
  $("seasonTitle").textContent = "עונה " + S.season; $("left").textContent = left(S.ends_at);
  // open run
  const r = S.my_run; $("openRun").hidden = !r;
  if (r) $("openRun").innerHTML = `יש לך אתגר פתוח: ${r.kind === "fisher" ? "🎧 הסט של פישר" : "🃏 החפיסה של עידו"} · יד ${r.hands}/${r.max} · ${fmt(r.chips)} <a class="go" href="${runUrl(r.kind, r.id)}">המשך</a>`;
  // friends
  $("zopp").innerHTML = (S.members || []).map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join("") || "<option disabled>אין עוד חברים</option>";
  drawZeus();
  $("opp").innerHTML = (S.members || []).map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join("") || "<option disabled>אין עוד חברים</option>";
  // duels
  $("duels").innerHTML = (S.duels || []).slice(0, 8).map((d) => {
    const mine = d.challenger === S.me, other = esc(mine ? d.opponent_name : d.challenger_name);
    let st = "", act = "";
    if (d.status === "challenger") st = mine ? "אתה עוד משחק" : `${other} עוד משחק`;
    else if (d.status === "waiting" || d.status === "playing") {
      if (mine) st = `מחכה ל${other} · התוצאה שלך ${fmt(d.score_a)}`;
      else { st = `${other} אתגר אותך: לעבור ${fmt(d.score_a)}`; act = `<button class="go sm" data-acc="${d.id}">שחק עכשיו</button>`; }
    } else if (d.status === "done") st = d.winner === S.me ? `✅ ניצחת את ${other}` : d.winner ? `❌ ${other} ניצח` : `🤝 תיקו עם ${other}`;
    else st = `⌛ ${other} לא הספיק לשחק`;
    return `<div class="duel ${d.status}"><span>${st}</span>${act}</div>`;
  }).join("");
  $("duels").querySelectorAll("[data-acc]").forEach((b) => b.onclick = async () => {
    const { data, error } = await rpc("ch_accept_ido", { p_duel: b.dataset.acc }); if (error) return err(errText(error));
    location.href = runUrl("ido", data.run);
  });
  const tn = S.tourney;
  if (tn && tn.status === "running") { $("tnInfo").innerHTML = `🎡 הטורניר שלך רץ! פרס <b class="num">${fmt(tn.prize)}</b>`; $("tnBtn").textContent = "לשולחן"; $("tnBtn").dataset.go = `poker.html?t=${tn.table}`; }
  else if (tn) { $("tnInfo").innerHTML = `נרשמת · ${(tn.players || []).length}/3 שחקנים: ${(tn.players || []).map(esc).join(", ")}`; $("tnBtn").textContent = "בטל הרשמה"; $("tnBtn").dataset.go = "leave"; }
  else { $("tnInfo").innerHTML = S.tourney_open ? "יש טורניר שמחכה לשחקנים!" : "אין כרגע טורניר פתוח. פתח אחד!"; $("tnBtn").textContent = "הירשם · ₪10,000"; $("tnBtn").dataset.go = ""; }
  $("fBest").innerHTML = S.fisher_best ? `השיא שלך העונה: <b class="num">${fmt(S.fisher_best)}</b>` : "עוד לא שיחקת סט העונה";
  // vault
  const p = Math.min(100, S.vault / S.vault_target * 100);
  $("vaultBar").style.width = p + "%"; $("vaultTxt").textContent = `${fmt(S.vault)} / ${fmt(S.vault_target)}`;
  // board
  const b = (S.board || []).filter((x) => x.total > 0 || x.id === S.me);
  $("board").innerHTML = `<tr><th>#</th><th>שחקן</th><th>🎧</th><th>🃏</th><th>⚡</th><th>🎡</th><th>סה״כ</th></tr>` +
    (b.length ? b.map((x, i) => `<tr class="${x.id === S.me ? "me" : ""}"><td class="num">${i + 1}</td><td>${esc(x.name)}</td><td class="num">${x.fisher}</td><td class="num">${x.ido}</td><td class="num">${x.zeus}</td><td class="num">${x.tourney || 0}</td><td class="num tot">${x.total}</td></tr>`).join("")
             : `<tr><td colspan="7" class="empty">עוד אין נקודות בעונה הזאת. מי פותח?</td></tr>`);
  const L = S.last_results; $("last").innerHTML = L ? `🏆 עונה ${L.season} הסתיימה · הכספת: ${fmt(L.vault || 0)}${L.vault_hit ? " (התמלאה!)" : ""}` : "";
}
let Z = [];
function drawZeus() {
  $("zduels").innerHTML = Z.map((d) => {
    const them = esc(d.them); let st = "", act = "";
    if (d.status === "invited") { if (d.mine) st = `⏳ מחכה ש${them} יקבל`; else { st = `${them} מזמין אותך לדו־קרב!`; act = `<button class="go sm" data-zy="${d.id}">קבל</button><button class="ghost sm" data-zn="${d.id}">לא עכשיו</button>`; } }
    else if (d.status === "active") { st = `⚡ דו־קרב פעיל מול ${them}`; act = `<a class="go sm" href="roulette.html?mode=lightning&duel=${d.id}">היכנס</a>`; }
    else if (d.status === "done") st = d.winner === d.me ? `✅ ניצחת את ${them}` : d.winner ? `❌ ${them} ניצח` : `🤝 תיקו עם ${them}`;
    else if (d.status === "declined") st = d.mine ? `${them} לא היה זמין` : `דחית את ${them}`;
    else st = `⌛ ההזמנה ל${them} פגה`;
    return `<div class="duel ${d.status === "invited" || d.status === "active" ? "waiting" : ""}"><span>${st}</span><span class="acts">${act}</span></div>`;
  }).join("");
  $("zduels").querySelectorAll("[data-zy],[data-zn]").forEach((b) => b.onclick = async () => {
    const yes = !!b.dataset.zy, { error } = await rpc("zeus_answer", { p_duel: b.dataset.zy || b.dataset.zn, p_accept: yes });
    if (error) return err(errText(error)); if (yes) location.href = `roulette.html?mode=lightning&duel=${b.dataset.zy}`; else load();
  });
}
async function rpc(name, args) { if (PREVIEW) return { data: null, error: { message: "preview" } }; return db.rpc(name, args); }
async function load() {
  if (PREVIEW) { S = { season: 1, ends_at: new Date(Date.now() + 9.3 * 864e5).toISOString(), me: "a", vault: 1240000, vault_target: 3000000, fisher_best: 14350,
    members: [{ id: "b", name: "דני" }, { id: "c", name: "פישר" }], my_run: null,
    duels: [{ id: "1", status: "waiting", challenger: "b", challenger_name: "דני", opponent: "a", opponent_name: "בנימין", score_a: 12800 }, { id: "2", status: "done", challenger: "a", opponent_name: "פישר", challenger_name: "בנימין", winner: "a" }],
    board: [{ id: "a", name: "בנימין", fisher: 43, ido: 60, zeus: 0, total: 103 }, { id: "b", name: "דני", fisher: 20, ido: 30, zeus: 0, total: 50 }] }; draw(); return; }
  const [st, zl] = await Promise.all([db.rpc("ch_state"), db.rpc("zeus_list")]);
  if (st.error) return err(errText(st.error)); if (!zl.error) Z = zl.data || []; S = st.data; draw();
}
$("tnBtn").onclick = async () => {
  const g = $("tnBtn").dataset.go;
  if (g && g !== "leave") { location.href = g; return; }
  const { data, error } = await rpc(g === "leave" ? "tourney_leave" : "tourney_join");
  if (error) { const m = error.message || ""; return err(m.includes("insufficient") ? "אין מספיק בארנק לכניסה." : m.includes("already_seated") ? "אתה יושב בשולחן פוקר. קום ממנו קודם." : errText(error)); }
  if (data && data.status === "running") location.href = `poker.html?t=${data.table}`; else load();
};
$("zeusBtn").onclick = async () => { const o = $("zopp").value; if (!o) return; const { error } = await rpc("zeus_invite", { p_opponent: o }); if (error) return err(errText(error)); err(""); load(); };
$("fisherBtn").onclick = async () => { const { data, error } = await rpc("ch_start_fisher"); if (error) return err(errText(error)); location.href = runUrl(data.kind, data.run); };
$("idoBtn").onclick = async () => {
  const o = $("opp").value; if (!o) return;
  const { data, error } = await rpc("ch_challenge_ido", { p_opponent: o }); if (error) return err(errText(error)); location.href = runUrl("ido", data.run);
};
(async function boot() {
  if (!PREVIEW) {
    const { data: { session } } = await db.auth.getSession(); if (!session) { location.href = "./"; return; }
    const { data: w } = await db.from("wallets").select("balance").eq("user_id", session.user.id).single(); if (w) $("bal").textContent = fmt(w.balance);
  } else $("bal").textContent = fmt(10000);
  await load(); GC_LOADER.done();
  setInterval(() => { if (!document.hidden) load(); }, 8000);
})();
