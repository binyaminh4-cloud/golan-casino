/* Golan Casino · text chat drawer. One room per area; polls the server (no realtime needed for a few friends). */
(function () {
  if (/[?#&]preview/.test(location.href) || !window.supabase || !window.GC_CONFIG) return;
  const page = location.pathname.split("/").pop() || "index.html";
  const ROOM = "lobby";                       // one room for the whole group
  const IN_GAME = /^(roulette|blackjack|slots|poker)/.test(page);
  const QUICK = ["זאוס, זה הזמן לברק 🙏", "עידו היה מהמר על אדום", "מישהו ראה את הכסף שלי?", "עוד סיבוב אחד ואני הולך לישון 😴", "פישר, תעלה את הווליום 🎧", "כמה הג׳קפוט עכשיו?", "הבית תמיד מנצח… חוץ מהיום", "מי בא לדו־קרב?"];
  const db = supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);
  let me = null, last = 0, open = false, unread = 0, timer = null, busy = false;
  const seenKey = "gc_chat_seen_" + ROOM;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const css = document.createElement("style");
  css.textContent = `
.gc-chat-btn{position:fixed;left:calc(56px + env(safe-area-inset-left));top:max(3px,env(safe-area-inset-top));z-index:60;width:34px;height:34px;font-size:16px!important;padding:0;border-radius:50%;
  border:1px solid #C5A05A;background:rgba(11,9,8,.85);color:#F1D69A;font-size:20px;box-shadow:0 4px 12px rgba(0,0,0,.6);cursor:pointer}
.gc-chat-btn.lob{top:auto;bottom:max(16px,env(safe-area-inset-bottom));left:max(14px,env(safe-area-inset-left));width:52px;height:52px;font-size:24px!important}
.gc-chat-btn .bdg{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:9px;background:#B3162A;color:#fff;font:700 11px Inter,sans-serif;display:grid;place-items:center;padding:0 4px}
.gc-chat{position:fixed;top:0;bottom:0;left:0;z-index:61;width:min(320px,82vw);display:flex;flex-direction:column;background:rgba(23,18,15,.97);border-right:1px solid #C5A05A;
  transform:translateX(-105%);transition:transform .25s ease;direction:rtl;font:14px Heebo,system-ui,sans-serif;color:#F5ECDD;padding-left:env(safe-area-inset-left)}
.gc-chat.on{transform:none}
.gc-chat h3{margin:0;padding:10px 12px;font:700 16px 'Frank Ruhl Libre',serif;color:#F1D69A;border-bottom:1px solid rgba(128,96,46,.6);display:flex;justify-content:space-between;align-items:center}
.gc-chat h3 button{background:none;border:0;color:#B9AA94;font-size:20px;cursor:pointer}
.gc-chat .log{flex:1;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:6px}
.gc-chat .m{max-width:88%;align-self:flex-start;background:#0b0806;border:1px solid rgba(128,96,46,.5);border-radius:10px;padding:5px 9px;word-wrap:break-word}
.gc-chat .m.mine{align-self:flex-end;background:rgba(197,160,90,.18);border-color:#C5A05A}
.gc-chat .m b{display:block;font-size:11px;color:#C5A05A}
.gc-chat .m.sys{align-self:center;background:none;border:0;color:#ffe27a;font-weight:700;text-align:center}
.gc-chat .quick{display:flex;gap:5px;flex-wrap:nowrap;overflow-x:auto;padding:0 10px 6px;scrollbar-width:none}.gc-chat .quick button{flex:none;white-space:nowrap}
.gc-chat .quick button{border:1px solid rgba(197,160,90,.7);background:none;color:#F1D69A;border-radius:99px;padding:3px 9px;font:13px Heebo;cursor:pointer}
.gc-chat form{display:flex;gap:6px;padding:8px 10px max(8px,env(safe-area-inset-bottom));border-top:1px solid rgba(128,96,46,.6)}
.gc-chat input{flex:1;min-width:0;height:38px;border-radius:8px;border:1px solid #80602E;background:#0b0806;color:#F5ECDD;padding:0 10px;font:15px Heebo}
.gc-chat form button{height:38px;border-radius:8px;border:1px solid #C5A05A;background:linear-gradient(180deg,#F1D69A,#C5A05A);color:#0B0908;font-weight:700;padding:0 12px;cursor:pointer}
.gc-chat .err{color:#E89A9F;font-size:12px;padding:0 10px}`;
  document.head.appendChild(css);

  const btn = document.createElement("button");
  btn.className = "gc-chat-btn" + (IN_GAME ? "" : " lob"); btn.type = "button"; btn.setAttribute("aria-label", "צ׳אט"); btn.innerHTML = "💬";
  const box = document.createElement("aside");
  box.className = "gc-chat"; box.setAttribute("aria-label", "צ׳אט");
  const title = "צ׳אט החבורה";
  box.innerHTML = `<h3>${title}<button type="button" aria-label="סגור">✕</button></h3><div class="log" aria-live="polite"></div>
    <div class="quick"></div><div class="err"></div><form><input maxlength="200" placeholder="כתבו הודעה…" enterkeyhint="send"><button>שלח</button></form>`;
  const log = box.querySelector(".log"), input = box.querySelector("input"), errEl = box.querySelector(".err");
  box.querySelector(".quick").innerHTML = QUICK.map((q) => `<button type="button">${esc(q)}</button>`).join("");
  box.querySelector(".quick").hidden = !QUICK.length;

  function badge() {
    btn.querySelector(".bdg")?.remove();
    if (unread > 0 && !open) btn.insertAdjacentHTML("beforeend", `<span class="bdg">${unread > 9 ? "9+" : unread}</span>`);
  }
  function add(list) {
    const seen = +(localStorage.getItem(seenKey) || 0);
    for (const m of list) {
      if (m.id <= last) continue; last = m.id;
      const d = document.createElement("div");
      d.className = "m" + (m.kind === "sys" ? " sys" : m.uid === me ? " mine" : "");
      d.innerHTML = m.kind === "sys" ? esc(m.body) : (m.uid === me ? "" : `<b>${esc(m.name || "")}</b>`) + esc(m.body);
      log.appendChild(d);
      if (!open && m.uid !== me && m.id > seen) unread++;
    }
    while (log.children.length > 80) log.firstChild.remove();
    if (open) { log.scrollTop = log.scrollHeight; try { localStorage.setItem(seenKey, last); } catch (e) {} }
    badge();
  }
  async function poll() {
    if (busy || document.hidden) return; busy = true;
    try { const { data, error } = await db.rpc("chat_since", { p_room: ROOM, p_after: last }); if (!error && Array.isArray(data)) add(data); } catch (e) {}
    busy = false;
  }
  function schedule() { clearInterval(timer); timer = setInterval(poll, open ? 3000 : 15000); }
  function toggle(on) {
    open = on; box.classList.toggle("on", on);
    if (on) { unread = 0; badge(); log.scrollTop = log.scrollHeight; try { localStorage.setItem(seenKey, last); } catch (e) {} poll(); }
    schedule();
  }
  async function send(text) {
    text = text.trim(); if (!text) return; errEl.textContent = "";
    const { error } = await db.rpc("chat_send", { p_room: ROOM, p_body: text });
    if (error) { errEl.textContent = (error.message || "").includes("slow_down") ? "לאט לאט 🙂 נסו שוב בעוד כמה שניות." : "ההודעה לא נשלחה."; return; }
    input.value = ""; poll();
  }
  btn.onclick = () => toggle(!open);
  box.querySelector("h3 button").onclick = () => toggle(false);
  box.querySelector("form").onsubmit = (e) => { e.preventDefault(); send(input.value); };
  box.querySelector(".quick").onclick = (e) => { const b = e.target.closest("button"); if (b) send(b.textContent); };

  (async function boot() {
    const { data: { session } } = await db.auth.getSession(); if (!session) return;
    me = session.user.id;
    document.body.append(btn, box);
    await poll(); schedule();
  })();
  window.GC_CHAT = { toggle, room: ROOM };
})();
