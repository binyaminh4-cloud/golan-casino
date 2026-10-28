/* Golan Casino · text chat drawer. One room per area; polls the server (no realtime needed for a few friends). */
(function () {
  if (/[?#&]preview/.test(location.href) || !window.supabase || !window.GC_CONFIG) return;
  const page = location.pathname.split("/").pop() || "index.html";
  const ROOM = "lobby";                       // one room for the whole group
  const IN_GAME = /^(roulette|blackjack|slots|poker)/.test(page);
  const QUICK = ["זאוס, זה הזמן לברק 🙏", "עידו אמר לך 23 אחי", "לאן נעלם לי כל הכסף😱?", "עוד סיבוב אחד ואני הולך לישון 😴", "פישר אתה קמצן גדול", "יואב בוא לפוקר", "עדיף לשחק כבר בסיטי", "הראל אמר לשים על אדום כי יצא שחור", "עידו, תחזיר את הכסף לכספומט 🏧", "בנימין, תעשה משהו עם הדילרית הזאת 😤", "אמרתי לכם שיצא 8", "וואו! 🎉", "הולך לעבוד בשביל עוד בשר לרולטה 🥩", "לילה טוב חבר׳ה, נתראה מחר 👋"];
  const db = supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);
  let qStart = Math.floor(Math.random() * 14), me = null, last = 0, open = false, unread = 0, timer = null, busy = false;
  const seenKey = "gc_chat_seen_" + ROOM;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const css = document.createElement("style");
  css.textContent = `
.gc-chat-btn{position:fixed;left:max(6px,env(safe-area-inset-left));top:max(54px,calc(env(safe-area-inset-top) + 50px));opacity:.62;transition:opacity .2s;z-index:950!important;z-index:60;width:40px;height:40px;font-size:18px!important;padding:0;border-radius:50%;
  border:1px solid #C5A05A;background:rgba(11,9,8,.85);color:#F1D69A;font-size:20px;box-shadow:0 4px 12px rgba(0,0,0,.6);cursor:pointer}
.gc-chat-btn.lob{width:48px;height:48px;font-size:22px!important}.gc-chat-btn:hover,.gc-chat-btn:active,.gc-chat-btn.drag{opacity:1}
.gc-chat-btn .bdg{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:9px;background:#B3162A;color:#fff;font:700 11px Inter,sans-serif;display:grid;place-items:center;padding:0 4px}
.gc-chat{position:fixed;top:0;bottom:0;left:0;z-index:61;width:min(400px,92vw);display:flex;flex-direction:column;background:rgba(23,18,15,.97);border-right:1px solid #C5A05A;
  transform:translateX(-105%);transition:transform .25s ease;direction:rtl;font:14px Heebo,system-ui,sans-serif;color:#F5ECDD;padding-left:env(safe-area-inset-left)}
.gc-chat.on{transform:none}
.gc-chat h3{margin:0;padding:10px 12px;font:700 16px 'Frank Ruhl Libre',serif;color:#F1D69A;border-bottom:1px solid rgba(128,96,46,.6);display:flex;justify-content:space-between;align-items:center}
.gc-chat h3 button{background:none;border:0;color:#B9AA94;font-size:20px;cursor:pointer}
.gc-chat .log{flex:1;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:6px}
.gc-chat .m{max-width:88%;align-self:flex-start;background:#0b0806;border:1px solid rgba(128,96,46,.5);border-radius:10px;padding:5px 9px;word-wrap:break-word}
.gc-chat .m.mine{align-self:flex-end;background:rgba(197,160,90,.18);border-color:#C5A05A}
.gc-chat .m b{display:block;font-size:11px;color:#C5A05A}.gc-chat .m time{display:block;font:10px Inter,sans-serif;color:#8a7558;text-align:left;margin-top:1px}
.gc-chat-btn{touch-action:none}
.gc-bubble{position:fixed;z-index:9400;max-width:min(240px,60vw);background:#fff;color:#141414;border:2px solid #141414;border-radius:14px;padding:5px 10px;font:600 13px Heebo,sans-serif;direction:rtl;
  box-shadow:3px 3px 0 #141414;pointer-events:none;animation:gcbub .25s cubic-bezier(.2,1.6,.4,1)}
.gc-bubble b{display:block;font-size:10px;color:#80602E}
.gc-bubble::after{content:"";position:absolute;left:calc(var(--tail) - 8px);bottom:-10px;border:8px solid transparent;border-top:10px solid #141414;border-bottom:0}
.gc-bubble.below::after{bottom:auto;top:-10px;border-top:0;border-bottom:10px solid #141414}
.gc-bubble.out{opacity:0;transition:opacity .4s}
@keyframes gcbub{from{transform:scale(.4);opacity:0}}
.gc-chat .m.qk{background:linear-gradient(180deg,#14100b,#000);border:1px solid #F1D69A;color:#ffe27a;font-weight:700;text-shadow:0 0 8px rgba(255,214,110,.75);box-shadow:0 0 12px rgba(241,214,154,.35)}
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
  const title = "חדר צ׳אט לייב";
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
      if (m.id <= last) continue; const fresh = last > 0 && m.uid !== me; last = m.id;
      if (fresh) try { SFX.notify(); } catch (e) {}
      const d = document.createElement("div");
      d.className = "m" + (m.kind === "sys" ? " sys" : m.uid === me ? " mine" : "") + (QUICK.includes(m.body) ? " qk" : "");
      const at = m.at ? new Date(m.at) : null, today = at && at.toDateString() === new Date().toDateString();
      const ts = at ? `<time>${today ? "" : at.toLocaleDateString("he-IL", { day: "numeric", month: "numeric" }) + " "}${at.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}</time>` : "";
      d.innerHTML = (m.kind === "sys" ? esc(m.body) : (m.uid === me ? "" : `<b>${esc(m.name || "")}</b>`) + esc(m.body)) + ts;
      log.appendChild(d);
      if (!open && m.uid !== me && m.id > seen) unread++;
      if (!open && booted && m.kind !== "sys") bubble(m);
    }
    while (log.children.length > 80) log.firstChild.remove();
    if (open) { log.scrollTop = log.scrollHeight; try { localStorage.setItem(seenKey, last); } catch (e) {} }
    badge();
  }
  // while the chat is closed, a new message pops as a small comic speech bubble next to the sender's character for 3 s
  let booted = false;
  function bubble(m) {
    const who = document.querySelector(`[data-u="${m.uid}"]`);
    const r = (who && who.getClientRects().length ? who : btn).getBoundingClientRect();
    const b = document.createElement("div"); b.className = "gc-bubble";
    b.innerHTML = `<b>${esc(m.name || "")}</b>${esc(m.body)}`;
    document.body.appendChild(b);
    const w = b.offsetWidth, h = b.offsetHeight;
    let x = r.left + r.width / 2 - w / 2, y = r.top - h - 10, below = false;
    if (y < 4) { y = r.bottom + 10; below = true; }
    x = Math.max(6, Math.min(innerWidth - w - 6, x));
    b.style.left = x + "px"; b.style.top = y + "px"; b.classList.toggle("below", below);
    b.style.setProperty("--tail", Math.max(12, Math.min(w - 12, r.left + r.width / 2 - x)) + "px");
    setTimeout(() => b.classList.add("out"), 2700); setTimeout(() => b.remove(), 3100);
  }
  async function poll() {
    if (busy || document.hidden) return; busy = true;
    try { const { data, error } = await db.rpc("chat_since", { p_room: ROOM, p_after: last, p_where: (location.pathname.split("/").pop() || "index.html") + location.search }); if (!error && Array.isArray(data)) add(data); } catch (e) {}
    busy = false;
  }
  function schedule() { clearInterval(timer); timer = setInterval(poll, open ? 3000 : 15000); }
  function toggle(on) {
    open = on; box.classList.toggle("on", on);
    if (on) { qStart = (qStart + 3) % QUICK.length;   // each opening starts the quick messages somewhere else
      const q = box.querySelector(".quick"); q.innerHTML = QUICK.slice(qStart).concat(QUICK.slice(0, qStart)).map((t) => `<button type="button">${esc(t)}</button>`).join(""); q.scrollLeft = 0;
      unread = 0; badge(); log.scrollTop = log.scrollHeight; try { localStorage.setItem(seenKey, last); } catch (e) {} poll(); }
    schedule();
  }
  async function send(text) {
    text = text.trim(); if (!text) return; errEl.textContent = "";
    const { error } = await db.rpc("chat_send", { p_room: ROOM, p_body: text });
    if (error) { errEl.textContent = (error.message || "").includes("slow_down") ? "לאט לאט 🙂 נסו שוב בעוד כמה שניות." : "ההודעה לא נשלחה."; return; }
    input.value = ""; poll();
  }
  // the chat button floats: drag it anywhere; the spot is remembered per device
  let drag = null, moved = false;
  const POSK = "gc_chat_pos2_" + (IN_GAME ? "game" : "lobby");   // v2: new default spot (top-left, see-through) for everyone
  const putAt = (x, y) => { x = Math.max(4, Math.min(innerWidth - btn.offsetWidth - 4, x)); y = Math.max(4, Math.min(innerHeight - btn.offsetHeight - 4, y));
    Object.assign(btn.style, { left: x + "px", top: y + "px", bottom: "auto", right: "auto" }); return [x, y]; };
  let saved = null; try { saved = JSON.parse(localStorage.getItem(POSK) || "null"); if (saved) requestAnimationFrame(() => putAt(saved[0], saved[1])); } catch (e) {}
  // no saved spot: look for a place on this screen that covers no button, chip, card or seat
  function freeSpot() {
    if (saved) return; const s = btn.offsetWidth || 40, W = innerWidth, H = innerHeight;
    const busy = (x, y) => { const el = document.elementFromPoint(x, y); if (!el || el === btn || btn.contains(el)) return false;
      return !!el.closest("button,a,input,select,label,[role=button],.chip,.spot,.cell,.zone,.sitter,.char,.hero,.card,.panel,#actions,.bets,.ctl,.gc-limit,.bal,.top b,.lb li,.game,canvas#pitch,.board,.grid,.field"); };
    const C = [[W * .3, 4], [W * .45, 4], [W * .6, 4], [6, H * .5], [W - s - 6, H * .5], [6, H - s - 6], [W - s - 6, H - s - 6], [6, 60], [W - s - 6, 60], [W * .3, H - s - 6]];
    for (const [x, y] of C) { const pts = [[x + 2, y + 2], [x + s - 2, y + 2], [x + 2, y + s - 2], [x + s - 2, y + s - 2], [x + s / 2, y + s / 2]];
      if (!pts.some(([a, b]) => busy(a, b))) { putAt(x, y); return; } }
  }
  // default spot: top-left corner of every screen, half see-through so nothing under it is hidden
  btn.addEventListener("pointerdown", (e) => { const r = btn.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY }; moved = false; btn.setPointerCapture(e.pointerId); });
  btn.addEventListener("pointermove", (e) => { if (!drag) return; if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) > 8) moved = true;
    if (moved) { const p2 = putAt(e.clientX - drag.dx, e.clientY - drag.dy); try { localStorage.setItem(POSK, JSON.stringify(p2)); } catch (er) {} } });
  btn.addEventListener("pointerup", () => { drag = null; });
  btn.onclick = (e) => { if (moved) { moved = false; e.preventDefault(); return; } toggle(!open); };
  box.querySelector("h3 button").onclick = () => toggle(false);
  // a tap anywhere outside the open chat closes it
  document.addEventListener("pointerdown", (e) => { if (open && !box.contains(e.target) && !btn.contains(e.target)) toggle(false); }, true);
  box.querySelector("form").onsubmit = (e) => { e.preventDefault(); send(input.value); };
  box.querySelector(".quick").onclick = (e) => { const b = e.target.closest("button"); if (b) send(b.textContent); };

  (async function boot() {
    const { data: { session } } = await db.auth.getSession(); if (!session) return;
    me = session.user.id;
    document.body.append(btn, box);
    await poll(); booted = true; schedule();
  })();
  window.GC_CHAT = { toggle, room: ROOM };
})();
