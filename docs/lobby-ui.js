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
    lbOff(); menu.hidden = true;
    if (k === "lb") { document.body.classList.add("lbfull"); mark("lb"); return; }
    if (k === "home") { if (!$("gamesBox").hidden) $("catBack").click(); mark("home"); return; }
    if (k === "games") { let c = "rl"; try { c = sessionStorage.getItem("gc_cat") || "rl"; } catch (er) {} window.GC_SHOWCAT && GC_SHOWCAT(c); }
  };
  $("lxLock").onclick = () => ($("lxLock").hidden = true);
  document.addEventListener("click", (e) => { if (document.body.classList.contains("lbfull") && !e.target.closest(".lb, .lx-nav")) { lbOff(); mark("home"); } });
  // the lock mark on "אתגרים" follows the owner's switch
  setInterval(() => { const c = document.querySelector(".chbanner"); $("navCh").classList.toggle("locked", !c || c.hidden); }, 1500);
})();

// home: swipeable slideshow of all games (new ones first). Open games: tap = straight into the game. Coming soon: big lock, not tappable.
(function promo() {
  const host = document.getElementById("promoSlides"), dots = document.getElementById("promoDots"); if (!host) return;
  let k = 0, n = 0, timer = null;
  const go = (i) => { if (!n) return; k = (i + n) % n; host.style.transform = `translateX(${k * 100}%)`; [...dots.children].forEach((d, j) => d.classList.toggle("on", j === k)); };
  const auto = () => { clearInterval(timer); timer = setInterval(() => { if (!document.hidden && !document.body.classList.contains("gpage")) go(k + 1); }, 5000); };
  const build = () => {
    const all = [...document.querySelectorAll("#gamesBox .game")], open = all.filter((g) => !g.classList.contains("soon")), soon = all.filter((g) => g.classList.contains("soon"));
    const list = [...open.filter((g) => /חדש/.test(g.querySelector(".tag")?.textContent || "")), ...soon, ...open.filter((g) => !/חדש/.test(g.querySelector(".tag")?.textContent || ""))].slice(0, 10);
    n = list.length;
    host.innerHTML = list.map((g) => { const cs = getComputedStyle(g), art = cs.getPropertyValue("--poster") || cs.getPropertyValue("--art") || "", locked = g.classList.contains("soon");
      const t = g.querySelector("h3")?.textContent || "", p = g.querySelector("p")?.textContent || "";
      return `<${locked ? "div" : "a"} class="sl${locked ? " lock" : ""}" ${locked ? 'aria-disabled="true"' : `href="${g.getAttribute("href")}"`} style="background-image:linear-gradient(to left,rgba(10,7,5,.92),rgba(10,7,5,.55) 45%,rgba(10,7,5,0) 70%),${art}">
        ${locked ? '<i class="padlock">🔒</i>' : ""}<span><em>${locked ? "בקרוב · נעול" : "▶ שחק עכשיו"}</em><b>${t}</b><small>${p}</small></span></${locked ? "div" : "a"}>`; }).join("");
    dots.innerHTML = list.map((_, i) => `<button type="button" aria-label="שקופית ${i + 1}" class="${i ? "" : "on"}"></button>`).join("");
    dots.onclick = (e) => { const b = e.target.closest("button"); if (b) { go([...dots.children].indexOf(b)); auto(); } };
    go(0); auto();
  };
  // swipe with a finger (RTL: swipe left = next)
  let x0 = null, moved = false;
  host.addEventListener("pointerdown", (e) => { x0 = e.clientX; moved = false; });
  host.addEventListener("pointermove", (e) => { if (x0 !== null && Math.abs(e.clientX - x0) > 12) moved = true; });
  host.addEventListener("pointerup", (e) => { if (x0 === null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 40) { go(k + (dx < 0 ? -1 : 1)); auto(); } });
  host.addEventListener("click", (e) => { if (moved) { e.preventDefault(); moved = false; } }, true);
  setTimeout(build, 1200);
})();
