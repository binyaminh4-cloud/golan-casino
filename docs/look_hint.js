// 3D tables: a quiet on-screen hint that the view can be dragged. Gone the moment the player drags even a little.
window.GC_LOOKHINT = function (canvas, opt) {
  opt = opt || {};
  const side = opt.side !== false;
  const css = `
  .lh{position:fixed;inset:0;pointer-events:none;z-index:40;opacity:0;transition:opacity .6s}
  .lh.on{opacity:1}.lh.off{opacity:0;transition:opacity .35s}
  .lh .pill{position:absolute;left:50%;top:58%;transform:translate(-50%,-50%);display:flex;align-items:center;gap:10px;
    background:rgba(8,6,4,.62);border:1px solid rgba(255,214,140,.45);border-radius:999px;padding:7px 16px 7px 12px;
    color:#ffe7b8;font:600 14px/1.2 Heebo,sans-serif;direction:rtl;white-space:nowrap;box-shadow:0 4px 18px rgba(0,0,0,.45)}
  .lh .hand{width:30px;height:30px;flex:none;animation:lhx 1.8s ease-in-out infinite}
  .lh .hand.v{animation:lhy 1.8s ease-in-out infinite}
  .lh .ar{position:absolute;color:rgba(255,226,170,.85);font:700 26px/1 sans-serif;text-shadow:0 2px 8px rgba(0,0,0,.7)}
  .lh .l{left:4%;top:50%;animation:lhl 1.8s ease-in-out infinite}.lh .r{right:4%;top:50%;animation:lhr 1.8s ease-in-out infinite}
  .lh .u{left:50%;top:22%;animation:lhu 1.8s ease-in-out infinite}.lh .d{left:50%;bottom:8%;animation:lhd 1.8s ease-in-out infinite}
  @keyframes lhx{0%,100%{transform:translateX(-9px)}50%{transform:translateX(9px)}}
  @keyframes lhy{0%,100%{transform:translateY(-6px)}50%{transform:translateY(6px)}}
  @keyframes lhl{0%,100%{transform:translate(0,-50%);opacity:.4}50%{transform:translate(-8px,-50%);opacity:1}}
  @keyframes lhr{0%,100%{transform:translate(0,-50%);opacity:.4}50%{transform:translate(8px,-50%);opacity:1}}
  @keyframes lhu{0%,100%{transform:translate(-50%,0);opacity:.4}50%{transform:translate(-50%,-8px);opacity:1}}
  @keyframes lhd{0%,100%{transform:translate(-50%,0);opacity:.4}50%{transform:translate(-50%,8px);opacity:1}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const hand = (v) => `<svg class="hand${v ? " v" : ""}" viewBox="0 0 24 24" fill="none" stroke="#ffe7b8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V4.5a1.5 1.5 0 0 1 3 0V10m0-.5V3.5a1.5 1.5 0 0 1 3 0V10m0-1.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.6a6 6 0 0 1-4.6-2.2L3.6 15.2a1.6 1.6 0 0 1 2.4-2.1L9 15"/></svg>`;
  const el = document.createElement("div"); el.className = "lh";
  el.innerHTML = (side ? '<div class="ar l">‹</div><div class="ar r">›</div>' : "") + '<div class="ar u">︿</div><div class="ar d">﹀</div>' +
    `<div class="pill">${hand(!side)}<span>${side ? "גררו ימינה, שמאלה, למעלה ולמטה כדי להסתכל מסביב" : "גררו למעלה ולמטה כדי להסתכל מסביב"}</span></div>`;
  document.body.appendChild(el);
  let gone = false, x0 = null, y0 = null;
  const bye = () => { if (gone) return; gone = true; el.classList.add("off"); setTimeout(() => el.remove(), 500); };
  setTimeout(() => { if (!gone) el.classList.add("on"); }, opt.delay || 1200);
  canvas.addEventListener("pointerdown", (e) => { x0 = e.clientX; y0 = e.clientY; });
  canvas.addEventListener("pointermove", (e) => { if (x0 !== null && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) bye(); });
  addEventListener("pointerup", () => { x0 = null; });
  return bye;
};
