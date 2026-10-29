/* Lobby and other non-game pages are portrait-only on phones: in landscape a "turn the phone" screen covers the page.
   Where the browser allows it (installed app on Android) the screen is also locked to portrait on the first tap. */
(function () {
  if (!matchMedia("(pointer: coarse)").matches) return;
  const o = document.createElement("div"); o.className = "portrait-gate";
  o.innerHTML = '<div class="pg-ico">📱</div><div class="pg-t">סובב את הטלפון לאורך</div><div class="pg-s">הלובי בנוי לאורך. המשחקים עצמם נפתחים לרוחב.</div>';
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(o));
  const st = document.createElement("style");
  st.textContent = `.portrait-gate{position:fixed;inset:0;z-index:99999;display:none;place-content:center;justify-items:center;gap:12px;text-align:center;padding:20px;
    background:#0B0908 url(img/brand/login_bg_mobile.jpg) center/cover;color:#F5ECDD;font-family:Heebo,sans-serif}
    .portrait-gate::before{content:"";position:absolute;inset:0;background:rgba(11,9,8,.84)}.portrait-gate>*{position:relative}
    .pg-ico{font-size:56px;transform:rotate(-90deg);animation:pg 1.8s ease-in-out infinite}.pg-t{font:700 24px 'Frank Ruhl Libre',serif;color:#F1D69A}.pg-s{color:#B9AA94;max-width:320px}
    @keyframes pg{0%,20%{transform:rotate(-90deg)}50%,80%{transform:rotate(0)}100%{transform:rotate(-90deg)}}
    @media (orientation: landscape){.portrait-gate{display:grid}}`;
  document.head.appendChild(st);
  addEventListener("pointerdown", () => { try { if (screen.orientation && screen.orientation.lock && matchMedia("(display-mode: standalone)").matches) screen.orientation.lock("portrait").catch(() => {}); } catch (e) {} }, { once: true });
})();
