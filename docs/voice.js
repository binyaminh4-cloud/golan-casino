/* Golan Casino · voice chat (audio only) through a Daily.co room.
   One shared room for all the friends. Joins only after the player taps the button; the "on" state is kept in
   localStorage so the next page (another game) reconnects by itself (a second or two of silence in between).
   Needs: GC_VOICE.room set below to the room link Binyamin creates in the Daily dashboard. */
(function () {
  if (/[?#&]preview/.test(location.href) || !window.supabase || !window.GC_CONFIG) return;
  const ROOM = "https://golancasino.daily.co/golan-voice-8k3x";   // <- Binyamin's Daily room link goes here
  const KEY = "gc_voice_on";
  const db = supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let call = null, state = "off", muted = false, panelOpen = false, loading = null;
  const audios = new Map();

  const css = document.createElement("style");
  css.textContent = `
  .gc-voice-btn{position:fixed;left:max(6px,env(safe-area-inset-left));top:max(100px,calc(env(safe-area-inset-top) + 96px));z-index:950;width:40px;height:40px;border-radius:50%;border:1px solid #C5A05A;background:rgba(23,18,15,.85);color:#f4e7c8;font-size:18px;padding:0;cursor:pointer;opacity:.62;transition:opacity .2s}
  .gc-voice-btn.on{opacity:1;background:#1f5a34;border-color:#7fe3a0;box-shadow:0 0 10px rgba(127,227,160,.5)}
  .gc-voice-btn.busy{opacity:1;animation:gcvp 1s infinite}@keyframes gcvp{50%{opacity:.4}}
  .gc-voice-panel{position:fixed;left:max(52px,calc(env(safe-area-inset-left) + 46px));top:max(100px,calc(env(safe-area-inset-top) + 96px));z-index:951;min-width:180px;max-width:min(260px,70vw);background:rgba(23,18,15,.96);border:1px solid #C5A05A;border-radius:14px;padding:10px 12px;color:#f4e7c8;font:600 14px Heebo,sans-serif;direction:rtl;box-shadow:0 6px 20px rgba(0,0,0,.6)}
  .gc-voice-panel[hidden]{display:none}.gc-voice-panel h4{margin:0 0 6px;font:800 14px Heebo,sans-serif;color:#e8c46a}
  .gc-voice-panel ul{list-style:none;margin:0 0 8px;padding:0;display:grid;gap:4px}
  .gc-voice-panel li{display:flex;align-items:center;gap:6px}.gc-voice-panel li i{width:9px;height:9px;border-radius:50%;background:#6b5a3a;flex:none}
  .gc-voice-panel li.talk i{background:#7fe3a0;box-shadow:0 0 8px #7fe3a0}.gc-voice-panel li.mute{opacity:.55}
  .gc-voice-panel .row{display:flex;gap:6px}.gc-voice-panel button{flex:1;font:700 13px Heebo,sans-serif;border-radius:10px;border:1px solid #8a6a2c;background:#2a2016;color:#f4e7c8;padding:7px 4px;cursor:pointer}
  .gc-voice-panel .x{position:absolute;top:4px;left:4px;width:26px;height:26px;flex:none;padding:0;border:0;background:transparent;color:#cdb98a;font-size:16px;line-height:1}.gc-voice-panel{position:fixed}.gc-voice-panel .msg{font-size:12px;color:#cdb98a;margin:0 0 6px}`;
  document.head.appendChild(css);

  const btn = document.createElement("button");
  btn.className = "gc-voice-btn"; btn.type = "button"; btn.textContent = "🎙"; btn.setAttribute("aria-label", "צ׳אט קולי");
  const panel = document.createElement("div");
  panel.className = "gc-voice-panel"; panel.hidden = true;
  panel.innerHTML = `<button type="button" class="x" data-a="close" aria-label="סגור">✕</button><h4>🎙 צ׳אט קולי</h4><p class="msg"></p><ul></ul><div class="row"><button type="button" data-a="mute">השתק אותי</button><button type="button" data-a="leave">התנתק</button></div>`;
  document.body.append(btn, panel);
  const $msg = panel.querySelector(".msg"), $list = panel.querySelector("ul"), $mute = panel.querySelector('[data-a="mute"]');

  const setBtn = () => { btn.classList.toggle("on", state === "on"); btn.classList.toggle("busy", state === "joining"); btn.textContent = state === "on" && muted ? "🔇" : "🎙"; };
  const msg = (t) => { $msg.textContent = t || ""; $msg.hidden = !t; };

  const CLOSED = "הצ׳אט הקולי סגור עד תחילת החודש הבא (נגמרו הדקות החינמיות).";
  let tickT = 0;
  const loadLib = () => loading || (loading = new Promise((res, rej) => {
    if (window.DailyIframe) return res();
    const s = document.createElement("script"); s.src = "https://unpkg.com/@daily-co/daily-js@0.89.1/dist/daily.js"; s.onload = res; s.onerror = () => { loading = null; rej(new Error("lib")); };
    document.head.appendChild(s);
  }));

  const drawList = () => {
    if (!call) { $list.innerHTML = ""; return; }
    const ps = Object.values(call.participants() || {});
    $list.innerHTML = ps.map((p) => `<li class="${p.audio ? "" : "mute"}${p.session_id === window.__gcVoiceSpeaker ? " talk" : ""}"><i></i>${esc(p.user_name || "חבר")}${p.local ? " (אני)" : ""}${p.audio ? "" : " 🔇"}</li>`).join("");
  };

  const attach = (p, track) => {
    if (!p || p.local || !track || track.kind !== "audio") return;
    let a = audios.get(p.session_id);
    if (!a) { a = document.createElement("audio"); a.autoplay = true; a.playsInline = true; audios.set(p.session_id, a); document.body.appendChild(a); }
    a.srcObject = new MediaStream([track]); a.play().catch(() => {});
  };
  const detach = (id) => { const a = audios.get(id); if (a) { a.srcObject = null; a.remove(); audios.delete(id); } };

  async function myName() {
    try {
      const { data: { session } } = await db.auth.getSession(); if (!session) return "חבר";
      const { data } = await db.from("profiles").select("nickname").eq("id", session.user.id).single();
      return (data && data.nickname) || "חבר";
    } catch (e) { return "חבר"; }
  }

  async function join() {
    if (state !== "off") return;
    if (/REPLACE-ME/.test(ROOM)) { panel.hidden = false; panelOpen = true; msg("הצ׳אט הקולי עדיין לא מוגדר (חסר קישור לחדר)."); return; }
    state = "joining"; setBtn(); msg("מתחבר…"); panel.hidden = false; panelOpen = true;
    try {
      // monthly cap (Daily bills past 10,000 free minutes): closed, or no answer from the server = no voice
      const st = await db.rpc("voice_status");
      if (st.error || !st.data || !st.data.open) { msg(st.error ? "לא הצלחנו להתחבר. נסה שוב." : CLOSED); cleanup(true); try { localStorage.removeItem(KEY); } catch (e) {} return; }
      await loadLib();
      call = window.DailyIframe.createCallObject({ audioSource: true, videoSource: false, subscribeToTracksAutomatically: true });
      call.on("joined-meeting", () => { state = "on"; muted = false; try { localStorage.setItem(KEY, "1"); } catch (e) {} setBtn(); msg(""); drawList(); tick(); clearInterval(tickT); tickT = setInterval(tick, 60000); });
      call.on("participant-joined", drawList);
      call.on("participant-updated", (e) => { drawList(); });
      call.on("participant-left", (e) => { if (e && e.participant) detach(e.participant.session_id); drawList(); });
      call.on("track-started", (e) => attach(e.participant, e.track));
      call.on("track-stopped", (e) => { if (e.participant && e.track && e.track.kind === "audio") detach(e.participant.session_id); });
      call.on("active-speaker-change", (e) => { window.__gcVoiceSpeaker = e && e.activeSpeaker && e.activeSpeaker.peerId; drawList(); });
      call.on("left-meeting", () => cleanup());
      call.on("error", (e) => { msg("שגיאה בחיבור הקולי. נסה שוב."); cleanup(true); });
      await call.join({ url: ROOM, userName: await myName(), startVideoOff: true, startAudioOff: false });
    } catch (e) {
      msg(/Permission|NotAllowed|denied/i.test(String(e && e.message)) ? "צריך לאשר גישה למיקרופון בדפדפן." : "לא הצלחנו להתחבר. נסה שוב.");
      cleanup(true);
    }
  }

  async function tick() {
    try { const { data, error } = await db.rpc("voice_tick"); if (!error && data && !data.open) { leave(); panel.hidden = false; panelOpen = true; msg(CLOSED); } } catch (e) {}
  }
  function cleanup(keepPanel) {
    clearInterval(tickT);
    audios.forEach((a, id) => detach(id));
    if (call) { try { call.destroy(); } catch (e) {} call = null; }
    state = "off"; muted = false; setBtn(); drawList();
    if (!keepPanel) { panel.hidden = true; panelOpen = false; }
  }
  function leave() { try { localStorage.removeItem(KEY); } catch (e) {} if (call) { try { call.leave(); } catch (e) {} } cleanup(); }

  btn.onclick = () => {
    if (state === "off" && !panelOpen) { join(); return; }
    panelOpen = !panelOpen; panel.hidden = !panelOpen;
  };
  panel.addEventListener("click", (e) => {
    const a = e.target.closest("[data-a]"); if (!a) return;
    if (a.dataset.a === "close") { panelOpen = false; panel.hidden = true; return; }
    if (a.dataset.a === "leave") leave();
    if (a.dataset.a === "mute" && call) { muted = !muted; call.setLocalAudio(!muted); $mute.textContent = muted ? "בטל השתקה" : "השתק אותי"; setBtn(); drawList(); }
  });
  addEventListener("pagehide", () => { if (call) { try { call.leave(); } catch (e) {} } });

  // came from another page with the voice on: reconnect (the mic permission is already granted)
  try { if (localStorage.getItem(KEY) === "1" && !/REPLACE-ME/.test(ROOM)) setTimeout(join, 1200); } catch (e) {}
  window.GC_VOICE = { ready: !/REPLACE-ME/.test(ROOM), join, leave };
})();
