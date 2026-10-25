/* Golan Casino · loading screen. Loaded in <head>: hides the page until it is ready, so nothing appears half-built.
   Each page calls GC_LOADER.done() when its data and graphics are in place (fallback: 15s). */
(function () {
  const d = document.documentElement;
  d.classList.add("gc-loading");
  const st = document.createElement("style");
  st.textContent = `html.gc-loading{background:#0B0908}html.gc-loading body{visibility:hidden}
  #gcLoad{position:fixed;inset:0;z-index:10000;display:grid;place-content:center;justify-items:center;gap:14px;text-align:center;
    background:radial-gradient(ellipse at 50% 40%,#1c1410,#0B0908 70%);color:#F5ECDD;font-family:Heebo,system-ui,sans-serif;transition:opacity .5s}
  #gcLoad.out{opacity:0;pointer-events:none}
  #gcLoad .med{width:min(56vmin,250px);height:auto;overflow:visible;filter:drop-shadow(0 10px 24px rgba(0,0,0,.8))}#gcLoad .orb{transform-origin:100px 100px;animation:gcOrb 3.2s ease-in-out infinite}@keyframes gcOrb{to{transform:rotate(360deg)}}
  #gcLoad .wm{width:min(62vw,320px)}
  #gcLoad .bar{width:min(60vw,280px);height:3px;background:rgba(197,160,90,.2);border-radius:3px;overflow:hidden;margin-top:6px}
  #gcLoad .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#C5A05A,#F1D69A);transition:width .4s ease-out}
  #gcLoad .tip{min-height:1.4em;font-size:14px;color:#B9AA94;letter-spacing:.03em;transition:opacity .3s}
  @keyframes gcPulse{50%{transform:scale(1.04);filter:drop-shadow(0 10px 30px rgba(241,214,154,.25))}}
  @media (prefers-reduced-motion:reduce){#gcLoad .orb{animation:none}}`;
  document.head.appendChild(st);
  const o = document.createElement("div"); o.id = "gcLoad"; o.setAttribute("role", "status"); o.setAttribute("aria-label", "טוען");
  o.innerHTML = `<svg class="med" viewBox="-14 -14 228 228" aria-hidden="true"><defs><linearGradient id="gcGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF1C1"/><stop offset=".45" stop-color="#D9B26A"/><stop offset=".7" stop-color="#9C7330"/><stop offset="1" stop-color="#F1D69A"/></linearGradient>
<radialGradient id="gcDia" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#dfe8f5"/><stop offset="1" stop-color="#8fa3bf"/></radialGradient></defs>
<circle cx="100" cy="100" r="88" fill="none" stroke="url(#gcGold)" stroke-width="1"/><circle cx="100" cy="100" r="84" fill="none" stroke="url(#gcGold)" stroke-width=".5" stroke-dasharray="1 3"/>
<ellipse cx="67.1" cy="161.8" rx="2.4" ry="6" transform="rotate(238 67.1 161.8)" fill="url(#gcGold)"/><ellipse cx="53.2" cy="152.0" rx="2.4" ry="6" transform="rotate(252 53.2 152.0)" fill="url(#gcGold)"/><ellipse cx="42.0" cy="139.1" rx="2.4" ry="6" transform="rotate(266 42.0 139.1)" fill="url(#gcGold)"/><ellipse cx="34.2" cy="123.9" rx="2.4" ry="6" transform="rotate(280 34.2 123.9)" fill="url(#gcGold)"/><ellipse cx="30.4" cy="107.3" rx="2.4" ry="6" transform="rotate(294 30.4 107.3)" fill="url(#gcGold)"/><ellipse cx="30.7" cy="90.3" rx="2.4" ry="6" transform="rotate(308 30.7 90.3)" fill="url(#gcGold)"/><ellipse cx="35.1" cy="73.8" rx="2.4" ry="6" transform="rotate(322 35.1 73.8)" fill="url(#gcGold)"/><ellipse cx="43.4" cy="58.9" rx="2.4" ry="6" transform="rotate(336 43.4 58.9)" fill="url(#gcGold)"/><ellipse cx="55.0" cy="46.4" rx="2.4" ry="6" transform="rotate(350 55.0 46.4)" fill="url(#gcGold)"/><ellipse cx="132.9" cy="38.2" rx="2.4" ry="6" transform="rotate(58 132.9 38.2)" fill="url(#gcGold)"/><ellipse cx="146.8" cy="48.0" rx="2.4" ry="6" transform="rotate(72 146.8 48.0)" fill="url(#gcGold)"/><ellipse cx="158.0" cy="60.9" rx="2.4" ry="6" transform="rotate(86 158.0 60.9)" fill="url(#gcGold)"/><ellipse cx="165.8" cy="76.1" rx="2.4" ry="6" transform="rotate(100 165.8 76.1)" fill="url(#gcGold)"/><ellipse cx="169.6" cy="92.7" rx="2.4" ry="6" transform="rotate(114 169.6 92.7)" fill="url(#gcGold)"/><ellipse cx="169.3" cy="109.7" rx="2.4" ry="6" transform="rotate(128 169.3 109.7)" fill="url(#gcGold)"/><ellipse cx="164.9" cy="126.2" rx="2.4" ry="6" transform="rotate(142 164.9 126.2)" fill="url(#gcGold)"/><ellipse cx="156.6" cy="141.1" rx="2.4" ry="6" transform="rotate(156 156.6 141.1)" fill="url(#gcGold)"/><ellipse cx="145.0" cy="153.6" rx="2.4" ry="6" transform="rotate(170 145.0 153.6)" fill="url(#gcGold)"/><path d="M83.9,1.3 A100,100 0 0 1 116.1,1.3 L111.6,28.9 A72,72 0 0 0 88.4,28.9Z" fill="#151211" stroke="url(#gcGold)" stroke-width="1.2"/><text x="100.0" y="19.0" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="15" fill="#F5ECDD">8</text><path d="M116.1,198.7 A100,100 0 0 1 83.9,198.7 L88.4,171.1 A72,72 0 0 0 111.6,171.1Z" fill="#A8162A" stroke="url(#gcGold)" stroke-width="1.2"/><text x="100.0" y="191.0" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="15" fill="#F5ECDD">23</text><g transform="translate(100,64) scale(.8)"><path d="M-16,6 L-18,-8 L-8,-1 L0,-12 L8,-1 L18,-8 L16,6Z" fill="url(#gcGold)" stroke="#6b4e1e" stroke-width=".6"/><rect x="-16" y="6" width="32" height="4" rx="1" fill="url(#gcGold)"/></g>
<text x="100" y="118" text-anchor="middle" font-family="Didot,'Bodoni 72',Georgia,serif" font-size="38" fill="url(#gcGold)" letter-spacing="3">GC</text>
<g class="orb"><g transform="translate(100,-6) scale(.6)"><path d="M0,-10 L7,-3 L0,10 L-7,-3Z" fill="url(#gcDia)" stroke="#fff" stroke-width=".4"/><path d="M-7,-3 H7 M0,-10 L-2.5,-3 L0,10 L2.5,-3Z" fill="none" stroke="#9fb3cf" stroke-width=".4"/></g></g></svg><img class="wm" src="img/brand/wordmark.webp" alt="גולן קזינו">
    <div class="bar"><i></i></div><div class="tip"></div>`;
  d.appendChild(o);
  const tips = ["מערבבים את החפיסות…", "מצחצחים את הגלגל…", "סופרים צ׳יפים…", "מדליקים את הנברשות…", "עידו מחפש חניה…", "מסדרים את השולחן…"];
  let ti = Math.floor(Math.random() * tips.length), p = 8, finished = false;
  const tip = o.querySelector(".tip"), bar = o.querySelector(".bar i");
  const setTip = () => { tip.style.opacity = 0; setTimeout(() => { tip.textContent = tips[ti++ % tips.length]; tip.style.opacity = 1; }, 250); };
  setTip(); const tipT = setInterval(setTip, 1800);
  const progT = setInterval(() => { p += (92 - p) * 0.08; bar.style.width = p + "%"; }, 200);
  function done() {
    if (finished) return; finished = true;
    clearInterval(progT); bar.style.width = "100%";
    setTimeout(() => { d.classList.remove("gc-loading"); o.classList.add("out"); clearInterval(tipT); setTimeout(() => o.remove(), 600); }, 250);
  }
  window.GC_LOADER = { done };
  setTimeout(done, 15000);           // never leave anyone stuck behind the loader
})();
