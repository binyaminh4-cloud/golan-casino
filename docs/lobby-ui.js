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

// home: rotating "coming soon" slideshow built from the real coming-soon games (tap → games page of that category)
(function promo() {
  const host = document.getElementById("promoSlides"), dots = document.getElementById("promoDots"); if (!host) return;
  const build = () => {
    const soon = [...document.querySelectorAll('#gamesBox .game[data-soon], #gamesBox .game.soon')];
    const list = soon.length ? soon : [...document.querySelectorAll("#gamesBox .game")].slice(0, 6);
    host.innerHTML = list.map((g, i) => { const art = getComputedStyle(g).getPropertyValue("--poster") || getComputedStyle(g).getPropertyValue("--art") || "", t = g.querySelector("h3")?.textContent || "", p = g.querySelector("p")?.textContent || "";
      return `<button type="button" class="sl${i ? "" : " on"}" data-c="${g.dataset.cat}" style="background-image:linear-gradient(to left,rgba(10,7,5,.92),rgba(10,7,5,.55) 45%,rgba(10,7,5,0) 70%),${art}"><span><em>${soon.length ? "בקרוב 🔒" : "חדש"}</em><b>${t}</b><small>${p}</small></span></button>`; }).join("");
    dots.innerHTML = list.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("");
    host.onclick = (e) => { const b = e.target.closest(".sl"); if (b && window.GC_SHOWCAT) GC_SHOWCAT(b.dataset.c); };
  };
  let k = 0; setTimeout(build, 1200);
  setInterval(() => { const s = host.children; if (!s.length || document.hidden || document.body.classList.contains("gpage")) return;
    s[k % s.length].classList.remove("on"); dots.children[k % s.length]?.classList.remove("on"); k++; s[k % s.length].classList.add("on"); dots.children[k % s.length]?.classList.add("on"); }, 4500);
})();
