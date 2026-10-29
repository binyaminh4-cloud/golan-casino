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
    if (k === "games") { const box = $("gamesBox"); box.querySelectorAll(".game").forEach((g) => g.hidden = false); box.hidden = false; $("cats").hidden = true; $("catBack").hidden = false; mark("games"); }
  };
  $("lxLock").onclick = () => ($("lxLock").hidden = true);
  document.addEventListener("click", (e) => { if (document.body.classList.contains("lbfull") && !e.target.closest(".lb, .lx-nav")) { lbOff(); mark("home"); } });
  // the lock mark on "אתגרים" follows the owner's switch
  setInterval(() => { const c = document.querySelector(".chbanner"); $("navCh").classList.toggle("locked", !c || c.hidden); }, 1500);
})();
