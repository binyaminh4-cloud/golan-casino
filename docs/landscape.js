/* Game pages are landscape-only on phones: a rotate prompt covers the page in portrait,
   and where the browser allows it (Android) we lock the screen to landscape on the first tap. */
(function () {
  const touch = matchMedia("(pointer: coarse)").matches;
  if (!touch) return;
  const o = document.createElement("div");
  o.className = "rotate-gate";
  o.innerHTML = '<div class="rg-ico">📱</div><div class="rg-t">סובב את הטלפון לרוחב</div><div class="rg-s">המשחקים בגולן קזינו משוחקים לרוחב, כמו שולחן אמיתי.</div>';
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(o));
  const st = document.createElement("style");
  st.textContent = `.rotate-gate{position:fixed;inset:0;z-index:999;display:none;place-content:center;justify-items:center;gap:14px;text-align:center;padding:24px;
    background:#0B0908 url(img/brand/login_bg_mobile.jpg) center/cover;color:#F5ECDD;font-family:Heebo,sans-serif}
    .rotate-gate::before{content:"";position:absolute;inset:0;background:rgba(11,9,8,.82)}
    .rotate-gate>*{position:relative}.rg-ico{font-size:64px;animation:rg 1.8s ease-in-out infinite}
    .rg-t{font:700 26px 'Frank Ruhl Libre',serif;color:#F1D69A}.rg-s{color:#B9AA94;max-width:280px}
    @keyframes rg{0%,20%{transform:rotate(0)}50%,80%{transform:rotate(-90deg)}100%{transform:rotate(0)}}
    @media (orientation: portrait){.rotate-gate{display:grid}}`;
  document.head.appendChild(st);
  const lock = async () => {
    try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: "hide" });
          if (screen.orientation && screen.orientation.lock) await screen.orientation.lock("landscape"); } catch (e) {}
  };
  addEventListener("pointerdown", lock, { once: true });
})();
