// Lobby v2 behaviour: avatar menu, bottom bar, full leaderboard sheet, locked challenges. Uses the existing buttons and data only.
(function () {
  const $ = (id) => document.getElementById(id), menu = $("lxMenu"), me = $("meBtn");
  if (!menu || !me) return;
  me.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; me.setAttribute("aria-expanded", !menu.hidden); };
  document.addEventListener("pointerdown", (e) => { if (!menu.hidden && !menu.contains(e.target) && !me.contains(e.target) && !e.target.closest(".sfx-menu")) menu.hidden = true; });
  const nav = document.querySelector(".lx-nav"), mark = (k) => nav.querySelectorAll("[data-nav]").forEach((b) => b.classList.toggle("on", b.dataset.nav === k));
  const lbOff = () => document.body.classList.remove("lbfull");
  nav.onclick = (e) => {
    const b = e.target.closest("[data-nav]"); if (!b) return; const k = b.dataset.nav;
    if (k === "jobs") return;
    if (k === "more") { menu.hidden = false; me.setAttribute("aria-expanded", true); return; }
    if (k === "ch") { const on = document.querySelector(".chbanner") && !document.querySelector(".chbanner").hidden; if (on) location.href = "challenges.html"; else { $("lxLock").hidden = false; } return; }
    lbOff(); menu.hidden = true; if (k !== "lb") document.getElementById("frSheet")?.classList.remove("on");
    if (k === "lb") { const f = document.getElementById("frSheet"); if (f && f.classList.contains("on")) f.classList.remove("on"); else openFriends(); return; }
    if (k === "home") { if (!$("gamesBox").hidden) $("catBack").click(); mark("home"); return; }
    if (k === "games") { let c = "rl"; try { c = sessionStorage.getItem("gc_cat") || "rl"; } catch (er) {} window.GC_SHOWCAT && GC_SHOWCAT(c); }
  };
  $("lxLock").onclick = () => ($("lxLock").hidden = true);
  document.addEventListener("click", (e) => { if (document.body.classList.contains("lbfull") && !e.target.closest(".lb, .lx-nav")) { lbOff(); mark("home"); } });
  // the lock mark on "אתגרים" follows the owner's switch
  setInterval(() => { const c = document.querySelector(".chbanner"); $("navCh").classList.toggle("locked", !c || c.hidden); }, 1500);
})();

// home: rotating "coming soon" slideshow (as before) + swipe and dots. "בקרוב" slides are not tappable; a game that is open ("חדש") opens straight in.
(function promo() {
  const host = document.getElementById("promoSlides"), dots = document.getElementById("promoDots"); if (!host) return;
  let k = 0, timer = null;
  const go = (i) => { const s = host.children, n = s.length; if (!n) return; k = (i + n) % n;
    [...s].forEach((x, j) => x.classList.toggle("on", j === k)); [...dots.children].forEach((x, j) => x.classList.toggle("on", j === k)); };
  const auto = () => { clearInterval(timer); timer = setInterval(() => { if (!document.hidden && !document.body.classList.contains("gpage")) go(k + 1); }, 4500); };
  const build = () => {
    // the 6 newest games, newest first (owner's order of launch)
    const NEWEST = ["poker.html?bots=1", "dp.html?g=uth&t=1", "dp.html?g=tcp&t=1", "dp.html?g=csp&t=1", "chicken.html", "dragons.html", "fishing.html"];
    const list = NEWEST.map((h) => document.querySelector(`#gamesBox .game[href="${h}"]`)).filter(Boolean).slice(0, 6);
    host.innerHTML = list.map((g, i) => { const cs = getComputedStyle(g), art = cs.getPropertyValue("--poster") || cs.getPropertyValue("--art") || "", locked = g.classList.contains("soon");
      const t = g.querySelector("h3")?.textContent || "", p = g.querySelector("p")?.textContent || "";
      return `<${locked ? "div" : "a"} class="sl${i ? "" : " on"}" ${locked ? "" : `href="${g.getAttribute("href")}"`} style="background-image:linear-gradient(to left,rgba(10,7,5,.92),rgba(10,7,5,.55) 45%,rgba(10,7,5,0) 70%),${art}"><span><em>${locked ? "בקרוב 🔒" : "חדש"}</em><b>${t}</b><small>${p}</small></span></${locked ? "div" : "a"}>`; }).join("");
    dots.innerHTML = list.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("");
    k = 0; auto();
  };
  dots.onclick = (e) => { const d = e.target.closest("i"); if (d) { go([...dots.children].indexOf(d)); auto(); } };
  let x0 = null, moved = false;
  host.addEventListener("pointerdown", (e) => { x0 = e.clientX; moved = false; });
  host.addEventListener("pointerup", (e) => { if (x0 === null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 40) { moved = true; go(k + (dx < 0 ? -1 : 1)); auto(); } });
  host.addEventListener("click", (e) => { if (moved) { e.preventDefault(); moved = false; } }, true);
  setTimeout(build, 1200);
})();

// friends sheet: works from home and from the games page; closes with ✕, a tap outside, or Esc
function openFriends() {
  let o = document.getElementById("frSheet");
  if (!o) { o = document.createElement("div"); o.id = "frSheet"; o.innerHTML = `<div class="fr-box" role="dialog" aria-label="החברים"><div class="fr-h"><b>החברים</b><small>דירוג העשירים · (אחרי פישר כמובן)</small><button type="button" class="fr-x" aria-label="סגור">✕</button></div><div class="fr-list"></div></div>`;
    document.body.appendChild(o);
    o.addEventListener("click", (e) => { if (e.target === o || e.target.closest(".fr-x")) o.classList.remove("on"); });
    addEventListener("keydown", (e) => { if (e.key === "Escape") o.classList.remove("on"); }); }
  const src = document.querySelector("#lbBox ol");
  o.querySelector(".fr-list").innerHTML = src ? src.outerHTML : '<p class="fr-empty">טוען…</p>';
  o.classList.add("on");
}

// poker against the bots: pick the blinds right on the game card (swipe or ◀ ▶, one level at a time), then tap to sit down
(function botBlinds() {
  const card = document.querySelector('#gamesBox .game[href^="poker.html?bots"]'); if (!card) return;
  const BB = [2e4, 5e4, 1e5, 2.5e5, 5e5, 1e6, 2.5e6, 5e6, 1e7, 2.5e7, 5e7, 1e8, 2.5e8, 5e8, 1e9, 2.5e9, 5e9, 1e10, 2.5e10, 5e10, 1e11, 2.5e11, 5e11, 1e12, 2e12];
  const f = (n) => "₪" + (n >= 1e12 ? +(n / 1e12).toFixed(2) + "T" : n >= 1e9 ? +(n / 1e9).toFixed(2) + "B" : n >= 1e6 ? +(n / 1e6).toFixed(2) + "M" : +(n / 1e3).toFixed(1) + "K");
  let i = 0; try { i = Math.max(0, BB.indexOf(+localStorage.getItem("gc_botbb"))); } catch (e) {}
  const box = document.createElement("div"); box.className = "blsel";
  box.innerHTML = `<button type="button" class="ar" data-d="-1" aria-label="בליינד קטן יותר">‹</button><div class="rail">${BB.map((b) =>
    `<div class="it"><small>בליינדים</small><b>${f(b / 2)} / ${f(b)}</b><small>כניסה ${f(b * 20)}–${f(b * 100)}</small></div>`).join("")}</div><button type="button" class="ar" data-d="1" aria-label="בליינד גדול יותר">›</button><button type="button" class="go">שב לשולחן ♠</button>`;
  card.appendChild(box);
  const rail = box.querySelector(".rail");
  const set = (k, smooth) => { i = Math.max(0, Math.min(BB.length - 1, k)); 
    try { localStorage.setItem("gc_botbb", BB[i]); } catch (e) {}
    rail.scrollTo({ left: i * rail.clientWidth, behavior: smooth ? "smooth" : "auto" }); };
  box.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); const a = e.target.closest(".ar"); if (a) set(i + +a.dataset.d, true); else if (e.target.closest(".go")) go(); });
  const go = () => { location.href = `poker.html?bots=1&bb=${BB[i]}`; };
  card.addEventListener("click", (e) => { if (e.defaultPrevented) return; e.preventDefault(); go(); });   // the card itself also enters with the chosen blinds
  let t = null; rail.addEventListener("scroll", () => { clearTimeout(t); t = setTimeout(() => { const w = rail.clientWidth || 1; const k = Math.round(rail.scrollLeft / w); if (k !== i && k < BB.length) { i = k; try { localStorage.setItem("gc_botbb", BB[i]); } catch (e) {} } }, 120); });
  ["pointerdown", "touchstart"].forEach((ev) => rail.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }));
  requestAnimationFrame(() => set(i, false));
})();
