/* Golan Casino · Ido, the house guide ("עידו, מהמר מקצועי").
   Shows a step-by-step walkthrough the first time a member opens a game, and again from the "עידו" button.
   His picture lives in the private "characters" bucket (guide_ido.webp), like the members' characters. */
(function () {
  const css = `
  .gd-btn{display:inline-flex;align-items:center;gap:6px;background:rgba(23,18,15,.9);color:#F1D69A;border:1px solid #80602E;border-radius:99px;
    padding:6px 12px 6px 6px;font:700 14px Heebo,sans-serif;cursor:pointer;white-space:nowrap}
  .gd-btn img{width:26px;height:26px;border-radius:50%;object-fit:cover;object-position:50% 6%;background:#000}
  .gd-btn .q{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:#F1D69A;color:#0B0908}
  .gd{position:fixed;inset:0;z-index:9800;pointer-events:auto}
  .gd-dim{position:absolute;inset:0;background:rgba(5,4,3,.55)}
  .gd-ring{position:fixed;border:3px solid #F1D69A;border-radius:12px;box-shadow:0 0 0 9999px rgba(5,4,3,.35),0 0 24px rgba(241,214,154,.7);
    transition:all .35s ease;pointer-events:none}
  .gd-host{position:absolute;inset-inline-start:max(10px,env(safe-area-inset-left));bottom:max(8px,env(safe-area-inset-bottom));display:flex;align-items:flex-end;gap:10px;
    max-width:min(640px,calc(100vw - 20px))}
  .gd-ido{width:clamp(110px,22vh,190px);flex:none;filter:drop-shadow(0 12px 18px rgba(0,0,0,.75));animation:gdIn .45s ease-out}
  .gd-ido.talk{animation:gdTalk .5s ease-out}
  @keyframes gdIn{from{transform:translateY(30px);opacity:0}}
  @keyframes gdTalk{40%{transform:translateY(-6px)}}
  .gd-bub{position:relative;margin-bottom:clamp(40px,10vh,90px);background:#F5ECDD;color:#17120F;border-radius:16px;padding:14px 16px 12px;
    box-shadow:0 14px 40px rgba(0,0,0,.6);font:500 15px/1.55 Heebo,sans-serif;min-width:220px}
  .gd-bub::before{content:"";position:absolute;inset-inline-start:-9px;bottom:22px;border:10px solid transparent;border-inline-end-color:#F5ECDD;border-inline-start:0}
  .gd-name{font:700 13px Heebo;color:#80602E;margin-bottom:4px}
  .gd-txt b{color:#681F2B}
  .gd-nav{display:flex;gap:6px;align-items:center;margin-top:10px}
  .gd-nav button{font:700 14px Heebo;border-radius:8px;padding:8px 14px;border:1px solid #C5A05A;cursor:pointer;min-height:38px}
  .gd-next{background:linear-gradient(180deg,#F1D69A,#C5A05A);color:#0B0908}
  .gd-prev,.gd-skip{background:transparent;color:#5a4630;border-color:#cdb58a!important}
  .gd-skip{margin-inline-start:auto;border:0!important;text-decoration:underline;padding:8px 4px!important}
  .gd-install{margin-top:8px;font:700 14px Heebo;border-radius:8px;padding:8px 14px;border:1px solid #C5A05A;background:linear-gradient(180deg,#F1D69A,#C5A05A);color:#0B0908;cursor:pointer}
  .gd-neon{position:fixed;left:50%;bottom:max(6px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:5;display:grid;justify-items:center;pointer-events:none}
  .gd-neon svg{width:64px;height:107px;filter:drop-shadow(0 0 6px rgba(241,214,154,.45))}
  .gd-neon path{fill:none;stroke:#F1D69A;stroke-width:6;stroke-linecap:round;stroke-linejoin:round;opacity:.2;animation:chev 1.2s infinite}
  .gd-neon .c2{animation-delay:.2s}.gd-neon .c3{animation-delay:.4s}
  .gd-neon .tip{fill:#C5A05A;stroke:none;opacity:1;animation:none}
  .gd-neon span{font:700 16px Heebo,sans-serif;color:#F1D69A;letter-spacing:.05em;margin-bottom:2px;text-shadow:0 2px 6px #000}
  .gd-neon.up{left:auto;right:70px;bottom:auto;top:6px;transform:none}
  .gd-neon.up svg{transform:rotate(180deg)}.gd-neon.up span{order:2}
  @keyframes chev{0%,100%{opacity:.2}40%{opacity:1}}
  .gd-host{z-index:2;transition:bottom .3s}
  .gd.neon-on .gd-host{bottom:calc(175px + env(safe-area-inset-bottom))}
  .gd-dots{font:500 12px Inter;color:#8a7558}
  .gd-host.top{bottom:auto;top:max(8px,env(safe-area-inset-top));max-height:calc(100dvh - 16px)}
  .gd-ring{animation:gdPulse 1.4s ease-in-out infinite}
  @keyframes gdPulse{50%{box-shadow:0 0 0 9999px rgba(5,4,3,.35),0 0 38px rgba(241,214,154,1)}}
  @media (max-width:560px){.gd-host{inset-inline:8px;flex-direction:column;align-items:flex-start;gap:0;max-width:none}
    .gd-ido{width:96px;margin-inline-start:6px;margin-bottom:-4px}.gd-bub{margin-bottom:0;min-width:0;width:100%;font-size:14.5px;max-height:52vh;overflow:auto}
    .gd-bub::before{inset-inline-start:34px;bottom:auto;top:-9px;border:10px solid transparent;border-bottom-color:#F5ECDD;border-top:0}}
  @media (max-height:520px){.gd-bub{font-size:14px;padding:10px 12px;margin-bottom:24px;max-height:calc(100dvh - 70px);overflow:auto}.gd-ido{width:112px}.gd.neon-on .gd-host{bottom:max(8px,min(175px,calc(100dvh - var(--gdh,0px) - 8px)))}}
  .gd-host{max-height:calc(100dvh - 16px)}
  .gd .gd-host.top{bottom:auto!important;align-items:flex-start}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  let imgUrl = null;
  async function loadImg(db) {
    if (imgUrl !== null || !db) return imgUrl;
    try { const { data } = await db.storage.from("characters").createSignedUrl("guide_ido.webp", 3600); imgUrl = (data && data.signedUrl) || ""; }
    catch (e) { imgUrl = ""; }
    return imgUrl;
  }

  function run(steps) {
    steps = steps.filter((s) => !s.only || document.querySelector(s.only));     // a step about something this member can't see is dropped
    let i = 0;
    const o = document.createElement("div"); o.className = "gd"; o.setAttribute("role", "dialog"); o.setAttribute("aria-label", "עידו מסביר על המשחק");
    o.innerHTML = `<div class="gd-dim"></div><div class="gd-ring" hidden></div>
      <div class="gd-host">${imgUrl ? `<img class="gd-ido" src="${imgUrl}" alt="עידו">` : ""}
        <div class="gd-bub"><div class="gd-name">עידו · מהמר מקצועי</div><div class="gd-txt"></div>
          <div class="gd-nav"><button class="gd-prev">הקודם</button><button class="gd-next">הבא</button><span class="gd-dots"></span><button class="gd-skip">דלג</button></div></div></div>`;
    document.body.appendChild(o);
    const ring = o.querySelector(".gd-ring"), dim = o.querySelector(".gd-dim");
    const show = () => {
      const s = steps[i];
      o.querySelector(".gd-txt").innerHTML = s.t;
      o.querySelector(".gd-prev").hidden = i === 0;
      o.querySelector(".gd-next").textContent = i === steps.length - 1 ? "יאללה, לשחק!" : "הבא";
      o.querySelector(".gd-dots").textContent = `${i + 1}/${steps.length}`;
      const ido = o.querySelector(".gd-ido"); if (ido) { ido.classList.remove("talk"); void ido.offsetWidth; ido.classList.add("talk"); }
      place(true);
      o.querySelector(".gd-neon")?.remove(); o.classList.toggle("neon-on", !!s.ios);
      if (s.ios) {
        const ipad = /ipad/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        const a = document.createElement("div"); a.className = "gd-neon" + (ipad ? " up" : "");
        a.innerHTML = '<span>שיתוף</span><svg viewBox="0 0 90 150"><path class="c1" d="M20 20 L45 45 L70 20"/><path class="c2" d="M20 55 L45 80 L70 55"/><path class="c3" d="M20 90 L45 115 L70 90"/><path class="tip" d="M30 130 l15 15 l15 -15z"/></svg>';
        o.appendChild(a);
      }
    };
    // spotlight: only a real, visible element with a sensible size gets a ring; the bubble moves away from it
    const pick = (sel) => sel && [...document.querySelectorAll(sel)].find((e) => {
      if (!e.getClientRects().length) return false; const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      return r.width > 12 && r.height > 12 && cs.visibility !== "hidden" && +cs.opacity > 0.05 && r.width < innerWidth * 1.05 && !e.closest(".gd");
    });
    const place = (scroll) => {
      const s = steps[i], el = pick(s.el), host = o.querySelector(".gd-host");
      if (el && scroll) { const rr = el.getBoundingClientRect(); if (rr.top < 60 || rr.bottom > innerHeight * 0.55) { el.scrollIntoView({ block: "center" }); scrollBy(0, -innerHeight * 0.15); } }
      const r = el && el.getBoundingClientRect();
      if (r && r.width && r.bottom > 0 && r.top < innerHeight) {
        ring.hidden = false; dim.style.background = "transparent";
        Object.assign(ring.style, { left: Math.max(2, r.left - 6) + "px", top: Math.max(2, r.top - 6) + "px", width: Math.min(innerWidth - 4, r.width + 12) + "px", height: r.height + 12 + "px" });
        if (scroll || host.dataset.step !== String(i)) {   // choose the side once per step, so Ido doesn't jump around while the page moves
          host.dataset.step = i; host.style.transition = "none";
          const ov = () => { const h = host.getBoundingClientRect(); return Math.max(0, Math.min(r.bottom, h.bottom) - Math.max(r.top, h.top)) + Math.max(0, -h.top) * 3; };
          host.classList.remove("top"); const a = ov(); host.classList.add("top"); const b = ov();
          if (b >= a) host.classList.remove("top");
          requestAnimationFrame(() => { host.style.transition = ""; });
        }
      } else { ring.hidden = true; dim.style.background = ""; if (host.dataset.step !== String(i)) { host.dataset.step = i; host.classList.remove("top"); } }
    };
    const keepIn = () => { const host = o.querySelector(".gd-host"); if (!host) return; const h = host.getBoundingClientRect(); o.style.setProperty("--gdh", h.height + "px"); if (h.top < 0 && !host.classList.contains("top")) host.classList.add("top"); else if (h.bottom > innerHeight && host.classList.contains("top")) host.classList.remove("top"); };
    const follow = setInterval(() => { if (!document.body.contains(o)) return clearInterval(follow); place(); keepIn(); }, 300);
    let done; const closed = new Promise((r) => done = r);
    const close = () => { clearInterval(follow); o.remove(); done(); };
    o.querySelector(".gd-next").onclick = () => { if (i < steps.length - 1) { i++; show(); } else close(); };
    o.querySelector(".gd-prev").onclick = () => { if (i > 0) { i--; show(); } };
    o.querySelector(".gd-skip").onclick = close;
    addEventListener("resize", () => document.body.contains(o) && show());
    // while Ido talks, the chat button and the sound menu step aside so nothing covers him
    document.querySelectorAll(".sfx-menu").forEach((m) => m.hidden = true);
    show(); return closed;
  }

  window.GC_GUIDE = {
    // game: "roulette" | "blackjack"; mount: element to put the "עידו" button in
    async init({ game, db, mount, steps, auto = true }) {
      await loadImg(db);
      if (mount) {
        const b = document.createElement("button"); b.className = "gd-btn"; b.type = "button"; b.setAttribute("aria-label", "עידו מסביר איך משחקים");
        b.innerHTML = (imgUrl ? `<img src="${imgUrl}" alt="">` : `<span class="q">?</span>`) + "איך משחקים";
        b.onclick = () => run(steps); mount.appendChild(b);
      }
      let seen = false; try { seen = localStorage.getItem("gc_guide2_" + game) === "1"; localStorage.setItem("gc_guide2_" + game, "1"); } catch (e) {}
      // first visit: Ido explains once — only when no other popup (game intro, entrance, sound menu, loader) is on screen
      if (auto && !seen) {
        const ready = () => !document.getElementById("gcLoad") && !document.querySelector(".soundask, .gc-sit, .gc-bi, .gc-bonus, .gi, #frSheet.on, #enter:not([hidden]), .sfx-menu:not([hidden]), #lxMenu:not([hidden])") && ![...document.querySelectorAll(".rotate-gate,.portrait-gate")].some((g) => getComputedStyle(g).display !== "none") && (game !== "lobby" || document.querySelector("#promoSlides > *")) && !(game !== "lobby" && matchMedia("(pointer: coarse) and (orientation: portrait)").matches);
        return new Promise((res) => { const wait = setInterval(() => { if (ready()) { clearInterval(wait); setTimeout(() => run(steps).then(res), 400); } }, 300); });
      }
    },
    run,
  };
})();

// "add to home screen": Android gives us an install prompt we can trigger from a button
let gcInstall = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); gcInstall = e; });
document.addEventListener("click", async (e) => { if (e.target.closest(".gd-install") && gcInstall) { gcInstall.prompt(); await gcInstall.userChoice.catch(() => {}); gcInstall = null; } });
function installStep() {
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) return null;   // already an app
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const btn = gcInstall ? '<br><button class="gd-install">📲 הוסף עכשיו למסך הבית</button>' : "";
  return { ios, t: ios
    ? "📲 טיפ: שמרו את הקזינו כ<b>אפליקציה במסך הבית</b>. באייפון: פתחו את האתר ב<b>ספארי</b>, לחצו על כפתור <b>השיתוף</b> (ריבוע עם חץ למעלה), גללו ובחרו <b>״הוסף למסך הבית״</b>, ואז <b>״הוסף״</b>. מעכשיו זה נפתח כמו אפליקציה, בלי שורת כתובת."
    : "📲 טיפ: שמרו את הקזינו כ<b>אפליקציה במסך הבית</b>. באנדרואיד: בכרום לחצו על <b>שלוש הנקודות ⋮</b> למעלה, ובחרו <b>״הוספה למסך הבית״</b> או <b>״התקנת אפליקציה״</b>, ואז <b>״הוסף״</b>. מעכשיו זה נפתח כמו אפליקציה, בלי שורת כתובת." + btn };
}

window.GC_STEPS = {
  intro: (game) => `היי, אני <b>עידו</b>, מהמר מקצועי, ואני כאן כדי להסביר לכם על המשחק שהמפתח שלי, <b>בנימין בולדר</b>, בנה. בואו נתחיל ב${game}.`,
  roulette: () => [
    { t: GC_STEPS.intro("רולטה") + " סוף סוף, רולטה! המשחק היחיד שאני באמת אוהב." },
    { el: "#chips", t: "קודם בוחרים <b>צ׳יפ</b> כאן למטה. כל לחיצה על השולחן מניחה את הסכום הזה. ברגע שמתחילים להמר, <b>השולחן נפרס על כל המסך</b>, ואחרי 3 שניות בלי לחיצה הוא חוזר לגודל רגיל." },
    { el: "#board", t: "לחיצה על <b>מספר</b> = הימור על מספר אחד, משלם <b>35 ל־1</b>. על <b>הקו</b> בין שני מספרים = ספליט (17:1). על <b>הצומת</b> של ארבעה = פינה (8:1). על הקו התחתון של טור = שורה (11:1)." },
    { el: "#board", t: "בחוץ יש הימורים רגועים יותר: <b>אדום/שחור, זוגי/אי־זוגי, 1–18/19–36</b> משלמים 1:1. <b>תריסר</b> ו<b>טור (2:1)</b> משלמים 2 ל־1. על אפס כולם מפסידים." },
    { el: "#viewRace", t: "ב<b>מסלול · שכנים</b> המספרים מסודרים כמו על הגלגל. לחיצה על מספר שמה צ׳יפ גם על השכנים שלו. <b>וואזן, טייר, אורפלן וזרו</b> הם הימורים קבועים על אזורים בגלגל." },
    GC_STEPS.spinStep(),
    { el: "#gcLimit", only: "#gcLimit", t: "ליד הארנק רואים את <b>סך ההימור</b> ואת <b>המקסימום להימור</b>. המקסימום עולה במדרגות ככל שהארנק גדל. לחיצה עליו מסבירה למה." },
    { el: "#eyeBtn", only: "#eyeBtn", t: "👁️ <b>חברים</b> מראה על השולחן את הצ׳יפים של החברים, עם האות הראשונה של השם. לחיצה נוספת מסתירה אותם." },
    { el: ".gc-auto", only: ".gc-auto", t: "🔁 <b>אוטומטי</b>: חוזר על ההימור האחרון 10, 25, 50, 100 או ∞ סיבובים. לחיצה נוספת עוצרת, ויציאה מהמשחק עוצרת לבד." },
    { el: ".btns", t: "<b>⌫ 1</b> מוריד את ההימור האחרון (אפשר כמה פעמים ברצף), <b>🧹 ניקוי</b> מוריד את כל ההימורים, <b>הכפל</b> מכפיל את כל ההימורים, ו<b>↻</b> חוזר על הסיבוב הקודם. יתרון הבית 2.7% בכל הימור. בהצלחה!" },
  ],
  live: () => !/[?&]private/.test(location.search),
  spinStep: () => GC_STEPS.live()
    ? { el: "#bigClock", t: "זה <b>שולחן חי</b>: כל החברים משחקים על אותו גלגל, סיבוב כל 55 שניות. יש <b>25 שניות</b> להמר (השעון מעל הגלגל), והצ׳יפים נשלחים לבד. כשהזמן נגמר הדילרית קוראת <b>No more bets</b>. התוצאה נקבעת בשרת מראש, ואף אחד לא יכול לשנות אותה. רוצים לשחק לבד בקצב שלכם, בלי שעון? בלובי יש <b>🔒 שולחן פרטי</b>." }
    : { el: "#spinBtn", t: "מוכנים? לוחצים <b>סובב</b>. התוצאה נקבעת בשרת ברגע הלחיצה, ואף אחד לא יכול לשנות אותה. גם לא אני 😉" },
  jobs: () => [
    { t: "עבודה? אין ברירה. גם אני עבדתי פה, כי חייבים להביא בשר לרולטה. בואו נראה איך זה עובד." },
    { el: "#lvlBox", only: "#lvlBox:not([hidden])", t: "זו <b>הרמה</b> שלכם, מ־1 עד 10. כל משמרת ששולמה וכל אתגר שסיימתם נותנים נקודות ניסיון. כל רמה מגדילה את <b>המשכורת השבועית והחודשית</b>, ועלייה ברמה נותנת גם <b>מענק</b> לבנק." },
    { el: ".levels", t: "בוחרים עבודה ורמת קושי. <b>קל</b> משלם מעט, <b>קשה</b> משלם הרבה. ב<b>אקסטרים</b> השכר ענק, אבל טעות אחת והמשמרת לא משולמת. אין הגבלה: עובדים כמה שרוצים." },
    { el: '.job[data-game="driver"]', t: "🚐 <b>נהג מיניבוס:</b> מחזיקים את האצבע כדי לבלום ועוצרים במשבצת הצהובה. עצירה בדיוק באמצע = בונוס. פרות, כבשים וטרקטורים? לבלום בזמן." },
    { el: '.job[data-game="fisher"]', t: "🎣 <b>דייג:</b> לוחצים כשהדג מתחת לפיתיון. דג זהב שווה הכי הרבה. התשלום נכנס ל<b>בנק</b> בסוף המשמרת." },
    { el: '.job[data-game="fiber"]', t: "🔌 <b>טכנאי סיבים:</b> נוגעים בסיב ואז במשבצת באותו צבע, לפני שהשעון נגמר. טעות מורידה זמן. גם כאן התשלום נכנס ל<b>בנק</b>." },
    { el: '.job[data-game="dealer"]', t: "🃏 <b>דילר מתלמד:</b> מקלידים כמה שווה כל יד, באיזה סדר שרוצים. אס שווה 1 או 11, תמונה 10." },
    { el: ".jobcards.soon", t: "🔜 <b>בקרוב:</b> מנהל עבודה, ספר, ומאלף אריות אסייתיים לבקנים. אל תשאלו. כל הכסף שתרוויחו פה, אני ממליץ בחום על רולטה." },
  ],
  lobby: () => { const s = GC_STEPS._lobby(), i = installStep(); if (i) s.splice(s.length - 1, 0, i); return s; },
  _lobby: () => [
    { t: "היי, אני <b>עידו</b>, מהמר מקצועי. בנימין בנה פה קזינו סאטירי לחבר׳ה, ואני כאן להראות לכם איפה הכול. חצי דקה, מבטיח." },
    { el: ".lx-bal", t: "זה <b>הארנק</b> שלכם: שקלים משחקיים בלבד, אין פה כסף אמיתי. משחקים רק עם מה שבארנק. נגמר? לחיצה על הארנק לוקחת ישר <b>לעבודות</b>." },
    { el: "#meBtn", t: "זו <b>הדמות</b> שלכם. לחיצה עליה פותחת תפריט: צלילים ומוזיקה, החלפת סיסמה, ההסבר הזה שוב, ויציאה. האייקון ליד השם של כל אחד הוא <b>הרמה</b> שלו." },
    { el: "#promo", t: "כאן מתחלפים <b>האתגרים והמשחקים החדשים</b>. אפשר להחליק הצידה וללחוץ כדי להיכנס." },
    { el: ".lb", t: "<b>שלושת העשירים</b> (אחרי פישר כמובן). נספר הכול: הארנק <b>ועוד הבנק</b>. נקודה ירוקה = מחובר עכשיו." },
    { el: '.lx-nav [data-nav="games"]', t: "🎰 <b>משחקים</b>: למעלה בוחרים קטגוריה, ומחליקים הצידה בין המשחקים שבתוכה." },
    { el: '.lx-nav [data-nav="lb"]', t: "👥 <b>חברים</b>: כל החבר׳ה, מי מחובר, ומי שמר כמה. סוגרים ב־✕ או בלחיצה בחוץ." },
    { el: '.lx-nav [data-nav="jobs"]', t: "💼 <b>עבודות</b>: משימות קצרות שמשלמות שכר אמיתי לארנק. ככה אני ממן את הרולטה." },
    { el: '.lx-nav [data-nav="ch"]', t: "🏆 <b>אתגרים</b>: דו־קרבות מול החברים, טורניר ג׳קפוט וטבלת עונה. אלוף העונה לוקח <b>מיליארד</b>." },
    { el: '.lx-nav [data-nav="bank"]', t: "🏦 <b>הבנק</b>: לשם נכנסות המשכורות (שבועית וחודשית, לפי הרמה), מתנות ותשלומים מחלק מהעבודות. משם מושכים לארנק כשרוצים לשחק." },
    { el: ".gc-chat-btn", t: "💬 <b>הצ׳אט של החבורה</b>, מכל מקום באתר. שם גם מודיעים כשמישהו זוכה בגדול." },
    { t: "📱 חשוב: את <b>הלובי מחזיקים לאורך</b>, ו<b>המשחקים משוחקים לרוחב</b>. בתוך כל משחק אני מחכה בכפתור <b>איך משחקים</b>. בהצלחה!" },
  ],
  lightning: () => [
    { t: "היי, זה שוב אני, <b>עידו</b>. ברוכים הבאים לרולטת הברק המחומש: בכל סיבוב בדיוק 5 מספרים מקבלים ברק. כאן בנימין הכריז על עצמו כ<b>זאוס, מלך האלים</b>. ביקשתי ממנו להפסיק, הוא הוריד עליי ברק." },
    { t: "בנימין עצבני עליי שמשכתי מהכספומט, והוא זורק עליי ברקים כל פעם שהוא רואה אותי על השולחן." },
    { el: "#board", t: "לפני כל סיבוב <b>בנימין זאוס</b> זורק עליי ברקים. אני קופץ ובורח, הוא מפספס, והברק פוגע במספר שעליו עמדתי. בכל סיבוב <b>1 עד 5 מספרים</b> נפגעים, וכל מספר כזה מקבל <b>תוספת: מכפיל של 50x עד 500x</b>." },
    { el: "#board", t: "הימור על <b>מספר בודד</b> שנפגע מברק, ונוחת עליו הכדור, משלם את המכפיל. ₪10 על מספר עם 500x שווים <b>₪5,010</b>." },
    { t: "המחיר: מספר בודד בלי ברק משלם <b>29 ל־1</b> במקום 35. כל השאר, כמו אדום/שחור ותריסרים, נשאר כרגיל." },
    { t: "ב<b>רולטת XXX</b> בנימין זאוס עצבני במיוחד: <b>שרשרת ברקים</b> עד 10 מספרים, ו<b>מכה כפולה</b> עד <b>2,000x</b>. מספר בודד בלי ברק משלם שם רק 19 ל־1." },
    ...(GC_STEPS.live() ? [{ el: "#bigClock", t: "זה <b>שולחן חי</b>: כל החברים על אותו גלגל ואותה תוצאה, סיבוב כל 55 שניות. יש 25 שניות להמר, והצ׳יפים נשלחים לבד. גם ברולטה הרגילה ובשתי רולטות הברקים הכדור נוחת על אותו מספר, רק הברקים שונים. רוצים לשחק לבד? בלובי יש <b>🔒 שולחן פרטי</b>." }] : []),
    { t: "טיפ ממני: לפזר כמה צ׳יפים על מספרים בודדים, לחכות לברק ולהתפלל. עובד בערך כמו התפילות שלי שלא יהיה עבודה מחר בבוקר. בהצלחה!" },
  ],
  lightningBJ: () => [
    { t: "פישר והברקים שלו. רועש, מהבהב, ובעיקר לא רולטה. אבל בנימין מכריח, אז בבקשה:" },
    { t: "ברוכים הבאים ל<b>בלאק ג׳ק הכפולות של פישר</b>. החוקים של הבלאק ג׳ק רגילים לגמרי: מתקרבים ל־21 יותר מהדילרית בלי לעבור. ההבדל הוא <b>די־ג׳יי פישר והברקים שלו</b>." },
    { el: ".betui .row", t: "<b>1. שמים הימור.</b> בוחרים צ׳יפ ולוחצים על העיגול. לכל יד מתווספת <b>עמלת ברק של חצי מההימור</b>: הימור ₪100 עולה ₪150. אין כאן הימורים צדדיים." },
    { el: ".dj", t: "<b>2. פישר עושה דרופ.</b> לפני שהקלפים יוצאים הוא מפיל <b>ברקים על 2–3 ערכי קלפים</b>, לכל אחד מכפיל ×2 עד ×25. למשל: <b>A ×5 · 7 ×3</b>. הם מופיעים בלוח ליד העיגול." },
    { el: ".boost", t: "<b>3. משחקים יד רגילה.</b> כל קלף מוכה ברק שנוחת לך <b>זוהר בזהב</b> עם המכפיל שלו." },
    { t: "<b>4. ניצחת עם קלף זוהר ביד? הרווח מוכפל מיד.</b> ₪100 רווח עם אס ×5 = <b>₪500</b>. בלאק ג׳ק (₪150) עם ×5 = ₪750. יש כמה קלפים זוהרים? נספר הכי גבוה. הפסדת? המכפיל לא עוזר, ופישר מושך בכתפיים." },
  ],
  slots: () => [
    { t: "אני שונא מכונות מזל. בנימין מכריח אותי להסביר, אז בואו נגמור עם זה מהר." },
    { t: "ברוכים הבאים ל<b>מכונות המזל</b>. כאן לא צריך לחשוב, רק ללחוץ. הדבר האהוב עליי." },
    { el: "#chips", t: "בוחרים <b>הימור לסיבוב</b> למטה, וזהו. ההימור מתחלק לבד בין <b>5 קווי הזכייה</b>." },
    { el: "#reels", t: "שלושה סמלים זהים על קו זוכים. כמה בדיוק? הכול ב<b>טבלת תשלומים</b> למעלה. דובדבן בתחילת קו כבר מחזיר משהו." },
    { el: "#spinBtn", t: "לוחצים <b>סובב</b>, הגלגלים נעצרים אחד אחרי השני, והקווים הזוכים נדלקים בזהב. הזכייה קופצת באמצע המסך." },
    { el: ".gc-auto", only: ".gc-auto", t: "🔁 <b>אוטומטי</b>: 10, 25, 50, 100 או ∞ סיבובים ברצף. לחיצה נוספת עוצרת." },
    { el: ".marquee-top", t: "במכונת האטרף של בנימין יש גם <b>🎁 FREE SPINS</b>: אחד כזה בכל אחד משלושת הגלגלים = <b>10 סיבובים חינם</b>, והם מסתובבים לבד. ויש שני ג׳קפוטים: של זאוס (מתחיל במיליון) ושל בנימין (חייב לצאת פעם בשבועיים)." },
  ],
  blackjack: () => [
    { t: GC_STEPS.intro("בלאק ג׳ק") + " בלאק ג׳ק? הייתי מעדיף רולטה, אבל בנימין אמר שאם לא אסביר הוא מוריד לי את המשכורת." },
    { t: "המטרה: להגיע <b>קרוב יותר ל־21</b> מהדילרית, בלי לעבור. 10, J, Q, K שווים 10. <b>אס</b> שווה 1 או 11, מה שטוב לך." },
    { el: ".betui .row", t: "בוחרים <b>צ׳יפ</b> ולוחצים על <b>העיגול הגדול</b> מול הכיסא שלך. זה ההימור הראשי." },
    { el: ".spot:not(.main)", t: "העיגולים הקטנים הם <b>הימורים צדדיים</b>: PP זוג מושלם · 21+3 · LL ליידיז מזל · BB באסטר. הם לא חובה." },
    { el: "#dealBtn", t: "<b>חלק קלפים</b> מתחיל את הסיבוב. אחר כך: <b>קלף</b> = עוד קלף, <b>עמוד</b> = מספיק לי, <b>הכפל</b> = כפול הימור וקלף אחד, <b>פיצול</b> = זוג הופך לשתי ידיים." },
    { t: "הדילרית עוצרת על 17. <b>בלאק ג׳ק משלם 3 ל־2</b>. כשהיא מראה אס אפשר לקנות <b>ביטוח</b>. בהצלחה, ותזכרו לעמוד על 17!" },
  ],
  dragons: () => [
    { t: "היי, זה <b>עידו</b>. ברוכים הבאים ל<b>דרקוני הגולן LINK</b>. כן, אני על הגלגלים, עם המשקפיים. רועי, בנימין ויואב איתי." },
    { el: "#reels", t: "5 גלגלים ו־<b>25 קווים</b>. שלושה סמלים זהים ומעלה על קו, משמאל לימין, משלמים. <b>הדרקון</b> מחליף כל סמל. רועי, עידו, בנימין ויואב משלמים הכי הרבה." },
    { el: "#betBox", t: "את ההימור משנים ב־<b>−</b> וב־<b>+</b>. ההימור מתחלק שווה על כל 25 הקווים. <b>הימור מקסימלי</b> קופץ ישר לגבול שלך." },
    { el: "#reels", t: "🔥 <b>כדורי אש</b>: 6 ומעלה פותחים את <b>החזק וזכה</b>. הכדורים ננעלים, מקבלים 3 סיבובים, וכל כדור חדש מחזיר את הספירה ל־3." },
    { el: "#jpG", t: "כדור יכול להיות סכום או ג׳קפוט: <b>MINI ×10, MINOR ×25, MAJOR ×100</b> מההימור. ממלאים את כל 15 המשבצות? <b>GRAND ×1,000</b>." },
    { el: "#bBuy", t: "🛒 לא רוצים לחכות? <b>קנה בונוס</b> מכניס ישר להחזק וזכה עם 6 כדורים נעולים." },
    { el: "#bSpin", t: "<b>סובב</b> וזהו." },
    { el: "#autoH", t: "🔁 <b>אוטומטי</b>: 10, 25, 50, 100 או ∞ סיבובים. לחיצה נוספת עוצרת. בהצלחה!" },
  ],
  wildwest: () => [
    { t: "היי, זה <b>עידו</b>. ברוכים הבאים ל<b>מערב הפרוע של הגולן</b>. אני ובנימין בדו־קרב, ואתם מרוויחים מזה." },
    { el: ".board", t: "5 גלגלים של 5 שורות. שלושה סמלים זהים ומעלה על קו, משמאל לימין, משלמים. <b>סוס הפרא</b> מחליף כל סמל." },
    { el: "#bets", t: "את ההימור מחליפים בחצים <b>◀ ▶</b>. הגבול עולה ככל שהארנק גדל." },
    { el: ".board", t: "שלושה בונוסים: <b>סוס הפרא</b> (סוסים ננעלים), <b>ראש בראש</b> (דו־קרבות עם מכפילים עד ×100) ו<b>התפרצות הר געש</b> (איסוף ומכפיל מצטבר)." },
    { el: "#buy", t: "🛒 העגלה קונה כניסה ישירה לאחד הבונוסים. <b>⏩</b> מאיץ את הסיבובים." },
    { el: "#spin", t: "<b>סובב</b> וזהו. כשנכנסים לבונוס הכל מאט, כדי שתראו מה קורה. בהצלחה!" },
    { el: ".gc-auto", only: ".gc-auto", t: "🔁 <b>אוטומטי</b>: 10, 25, 50, 100 או ∞ סיבובים ברצף, ועוצר לבד בבונוס או ביציאה מהמשחק." },
  ],
  kinneret: () => [
    { t: "היי, זה <b>עידו</b>. ברוכים הבאים ל<b>על האש בכינרת</b>. מנגל, שקיעה, והחבר׳ה." },
    { el: ".board", t: "לוח של 7 על 7. <b>5 סמלים זהים ומעלה שנוגעים זה בזה</b> (למעלה, למטה, לצדדים) משלמים, נעלמים, וחדשים נופלים במקומם." },
    { el: "#friends", t: "כל זכייה ממלאת את המד של <b>החבר הבא בתור</b>. 3 זכיות = הוא מגיע לשולחן ועושה משהו טוב ללוח." },
    { el: ".board", t: "משבצת שזכתה פעמיים מקבלת <b>מכפיל</b>. 3 מנגלים ומעלה = <b>סיבובים חינם</b>, והמכפילים נשארים לכל הבונוס." },
    { el: "#bets", t: "את ההימור מחליפים בחצים <b>◀ ▶</b>. <b>🛒</b> קונה סיבובים חינם, ו<b>⏩</b> מאיץ." },
    { el: "#spin", t: "<b>סובב</b>, ותיהנו מהאוכל. בהצלחה!" },
    { el: ".gc-auto", only: ".gc-auto", t: "🔁 <b>אוטומטי</b>: 10, 25, 50, 100 או ∞ סיבובים ברצף, ועוצר לבד בבונוס או ביציאה מהמשחק." },
  ],
  pachinko: () => [
    { t: "היי, זה <b>עידו</b>. ברוכים הבאים ל<b>מכונת השירותים</b>. לא אני בחרתי את השם." },
    { el: "#game", t: "5 גלגלים. שלושה סמלים זהים ומעלה על קו משלמים. <b>3 אסלות</b> = הפצ׳ינקו של אביחי. <b>4 ומעלה</b> = סופר הבונוס של פישר." },
    { el: "#game", t: "בבונוס הגושים נופלים מסיכה לסיכה ונוחתים על חבר. לכל חבר <b>מכפיל</b>. ב־DOUBLE המכפיל מוכפל ומקבלים עוד נפילה." },
    { el: "#bets", t: "את ההימור מחליפים ב־<b>▲ ▼</b>. <b>🛒 בונוס</b> קונה כניסה ישירה." },
    { el: "#spin", t: "<b>סובב</b> וזהו. בהצלחה!" },
    { el: ".gc-auto", only: ".gc-auto", t: "🔁 <b>אוטומטי</b>: 10, 25, 50, 100 או ∞ סיבובים ברצף, ועוצר לבד בבונוס או ביציאה מהמשחק." },
  ],
  protein: () => [
    { t: "היי, זה <b>עידו</b>. ברוכים הבאים ל<b>שולה החלבון</b>. אביחי בחדר כושר, ואנחנו מרוויחים." },
    { el: "#game", t: "הקרס של אביחי מתנדנד. <b>לוחצים על המסך</b> כדי לשלוח אותו. רואים מה יש בכל מקום: <b>פטרייה או חזה עוף</b> מוסיפים לקופה, <b>פצצה</b> מאפסת אותה." },
    { el: "#game", t: "הכול זז כל הזמן, אז צריך לתזמן. קרס שחוזר ריק נחשב שליפה. פרס עם <b>תג של יואב</b> שווה יותר." },
    { t: "אחרי כל 3 שליפות מחליטים: <b>לקחת את הקופה</b> או להמשיך לשכבה עמוקה ושווה יותר. 4 שכבות בסך הכול. בהצלחה!" },
  ],
  fisher90: () => [
    { t: "היי, זה <b>עידו</b>. <b>1:1 בדקה ה־90</b>, והכדור אצל פישר. יש עד חמש החלטות עד השער." },
    { el: "#start-panel", t: "בוחרים <b>סכום התקפה</b> בחצים ולוחצים <b>התחל התקפה</b>." },
    { el: ".field", t: "בכל שלב יש כרטיסים בפינה: מהלך בטוח יותר עם רווח קטן, או מסוכן יותר עם רווח גדול. על כל כרטיס כתוב <b>כמה תקבל והסיכוי</b>." },
    { t: "מהלך שנכשל מאבד את הקופה. אחרי כל הצלחה אפשר ללחוץ <b>💵 קח וצא</b>. בעיטה מסיימת את ההתקפה. בהצלחה!" },
  ],
  fishing: () => [
    { t: "היי, זה <b>עידו</b>, ואני על הקרח. ברוכים הבאים ל<b>גלגל הדגים</b>. כל החבר׳ה על אותו גלגל, באותו זמן." },
    { el: "#zones", t: "יש <b>10 שניות</b> להמר. <b>דג כהה / דג בהיר</b> משלמים פי 2. <b>כחול, כתום ואדום</b> הם דגי בונוס: אני יוצא לדוג, וככל שהדג גדול יותר, הזכייה גדולה יותר." },
    { el: "#chips", t: "בוחרים <b>צ׳יפ</b> ולוחצים על משבצת. <b>כל הבונוסים</b> שם צ׳יפ על שלושת הצבעים, ו־<b>↻</b> חוזר על ההימור הקודם." },
    { el: "#zones", t: "אחרי שההימורים נסגרים נוחתים <b>מכפילים</b> על הגלגל. המכפיל הגבוה של כל דג מופיע גם על המשבצת שלו." },
    { el: "#table", only: "#table span", t: "כאן רואים <b>מי ליד השולחן</b> ומה כל אחד הימר. בהצלחה!" },
  ],
  chicken: () => [
    { t: "היי, זה <b>עידו</b>. כן, אני תרנגולת. בנימין חשב שזה מצחיק. ברוכים הבאים ל<b>עידו חוצה את הכביש</b>." },
    { el: "#marks", t: "יש <b>10 נתיבים</b>. על כל עיגול כתוב <b>כמה תקבלו בסך הכול</b> אם תעצרו שם, כולל ההימור." },
    { el: "#lv", t: "בוחרים רמה: <b>קל</b> בטוח יותר וכפולות קטנות, <b>אקסטרים</b> מסוכן מאוד עד <b>×175</b>." },
    { el: "#go", t: "<b>התחל</b> מוריד את ההימור ועושה את הצעד הראשון. כל צעד מוצלח מעלה את הסכום. רכב בנתיב = הפסדתם את ההימור." },
    { el: "#bar", t: "אחרי כל צעד מחליטים: <b>צעד הבא</b> או <b>💰 קח</b>. אין שעון, אין לחץ. בצעד העשירי הכסף נלקח לבד. בהצלחה!" },
  ],

  dp: (g) => [
    ...({
      uth: [{ t: "היי, זה <b>עידו</b>. <b>אולטימייט הולדם</b>: פוקר מול הדילרית, לא מול החברים. שנינו מקבלים 2 קלפים, ו־5 קלפים משותפים נפתחים באמצע. מנצחת היד הכי טובה מ־5 קלפים." },
        { el: "#spots", t: "שמים <b>אנטה</b>, ו<b>בליינד</b> באותו סכום נכנס לבד. <b>טריפס</b> הוא הימור צדדי שמשלם על שלישייה ומעלה, גם אם הפסדתם ליד." },
        { t: "ההחלטות: לפני הקלפים המשותפים אפשר <b>להעלות ×3 או ×4</b> מהאנטה. אחרי 3 קלפים: <b>×2</b>. אחרי כל ה־5: <b>×1</b> או ויתור. מוקדם = יותר כסף על השולחן. אפשר גם צ׳ק ולחכות." },
        { t: "הדילרית צריכה <b>זוג ומעלה</b> כדי ״להיפתח״. אם היא לא נפתחת, האנטה חוזר אליכם, והשאר משחק רגיל. הבליינד משלם בונוס על סטרייט ומעלה." }],
      tcp: [{ t: "היי, זה <b>עידו</b>. <b>פוקר 3 קלפים</b>: הכי מהיר שיש. אתם והדילרית מקבלים 3 קלפים כל אחד." },
        { el: "#spots", t: "שמים <b>אנטה</b>. <b>פייר פלוס</b> הוא הימור צדדי שמשלם על זוג ומעלה ביד שלכם, לא משנה מה יש לדילרית." },
        { t: "רואים את הקלפים ומחליטים: <b>שחק</b> (עוד הימור בגובה האנטה) או <b>ויתור</b>. בשלושה קלפים <b>סטרייט שווה יותר מצבע</b>." },
        { t: "הדילרית צריכה <b>מלכה ומעלה</b> כדי להיפתח. לא נפתחה? האנטה משלם 1:1 וה״שחק״ חוזר. יש גם בונוס אנטה על סטרייט ומעלה." }],
      csp: [{ t: "היי, זה <b>עידו</b>. <b>קריביאן סטאד</b>: 5 קלפים לכם, 5 לדילרית, ורק אחד שלה גלוי." },
        { el: "#spots", t: "שמים <b>אנטה</b> וחולקים. רואים את 5 הקלפים שלכם ואת הקלף הגלוי שלה." },
        { t: "מחליטים: <b>העלה ×2</b> מהאנטה, או <b>ויתור</b> ומפסידים את האנטה. ההעלאה משלמת לפי חוזק היד: זוג 1:1, ועד רויאל פלאש." },
        { t: "הדילרית צריכה <b>אס ומלך</b> ומעלה כדי להיפתח. לא נפתחה? האנטה משלם 1:1 וההעלאה חוזרת." }],
    }[g] || []),
    { el: "#modeTag", t: "ב<b>שולחן לייב</b> כל החברים משחקים מול אותה דילרית, באותם קלפים שלה, עם שעון להחלטות. ב<b>שולחן פרטי</b> משחקים לבד, בקצב שלכם." },
    { el: "#rulesBtn", t: "כל טבלאות התשלומים נמצאות ב<b>חוקים ותשלומים</b>. הקלפים של הדילרית נחשפים אחד־אחד, אז תחזיקו חזק. בהצלחה!" },
  ],
  poker: () => [
    { t: "היי, זה <b>עידו</b>. <b>טקסס הולדם</b> מול החברים: כל אחד מקבל 2 קלפים, 5 נפתחים באמצע, והיד הכי טובה לוקחת את הקופה." },
    ...(/[?&]bots/.test(location.search) ? [{ t: "🤖 זה <b>השולחן הפרטי שלך מול הבוטים</b>. שלושה בוטים בשמות של החבר׳ה, כל אחד עם סגנון משלו: אחד זהיר, אחד רגיל ואחד פרוע שמבלף הרבה. בוט שנגמרים לו הצ׳יפים קונה עוד. כשאתה קם, הם מחכים לך." }] : []),
    { el: "#tables", only: "#tables .t, #tables > *", t: "בוחרים שולחן, לוחצים <b>שב כאן</b> ובוחרים עם כמה כסף לשבת. מה שלא בשולחן נשאר בארנק." },
    { el: "#acts", t: "כשתורכם: <b>צ׳ק</b>, <b>קול</b>, <b>העלה</b> עם הסליידר, <b>אול־אין</b> או <b>ויתור</b>. יש 25 שניות להחליט." },
    { t: "בטורניר הג׳קפוט כולם מתחילים עם 500 צ׳יפים, והבליינדים עולים כל 5 ידיים. מי שמתנתק ליותר מ־15 שניות מודח. בהצלחה!" },
  ],
  challenges: () => [
    { t: "היי, זה <b>עידו</b>. ברוכים הבאים ל<b>אתגרים</b>. כאן מתחרים מול החברים על נקודות לעונה, וגם על כסף גדול." },
    { el: ".prizes", t: "בסוף העונה: <b>אלוף כל האתגרים לוקח ₪1,000,000,000</b>. ובכל אתגר בנפרד: מקום ראשון ₪100M, שני ₪50M ושלישי ₪25M." },
    { el: "#board", t: "<b>טבלת העונה</b>: הנקודות של כולם מכל האתגרים. ניצחון בדו־קרב = 30 נקודות." },
    { el: ".ch.zeus", t: "⚡ <b>הדו־קרב של זאוס</b>: מזמינים חבר, 10 סיבובים על הרולטה החיה, 10,000 צ׳יפים לכל אחד. בסיבוב האחרון הכול ×2. טעיתם בהזמנה? יש <b>בטל הזמנה</b>." },
    { el: ".ch.ido", t: "🃏 <b>החפיסה שלי</b>: 5 ידיים בלאק ג׳ק. החבר מקבל בדיוק את אותה חפיסה וצריך לעבור את התוצאה שלכם." },
    { el: ".ch.fisher", t: "🎧 <b>הסט של פישר</b>: 5 ידיים בבלאק ג׳ק הכפולות, לבד. כל ₪100 רווח = נקודה. 3 סטים ביום נספרים." },
    { el: ".ch.tourney", t: "🎡 <b>טורניר ג׳קפוט</b>: 3 נרשמים, גלגל קובע פרס עד ₪50M, והמנצח לוקח הכול. יש 5 דקות להיכנס לשולחן, ומי שמתנתק 15 שניות מודח." },
    { el: ".ch.vault", t: "🏦 <b>הכספת של בנימין</b>: כולם ביחד ממלאים אותה בזכיות במכונת האטרף של בנימין. מגיעים ל־₪3B? כל אחד מקבל ₪50M." },
    { t: "אפשר לשחק בכמה אתגרים במקביל. ובקרוב: אתגרים מול <b>הבוטים</b>. בהצלחה!" },
  ],
  bank: () => [
    { t: "היי, זה <b>עידו</b>. ברוכים הבאים ל<b>בנק</b>. פישר הבנקאי. אל תשאלו אותו על הלוואות." },
    { el: ".bals", t: "<b>בבנק</b> נמצא הכסף השמור. <b>בארנק</b> נמצא הכסף שמשחקים בו. בטבלת העשירים נספרים שניהם ביחד." },
    { el: ".amt", t: "כותבים סכום, או בוחרים <b>1M, 10M, חצי או הכול</b>, ולוחצים <b>הפקדה</b> או <b>משיכה</b>." },
    { el: "details", t: "ב<b>תנועות אחרונות</b> רואים מה נכנס: משכורת שבועית וחודשית לפי הרמה, מענקי עלייה ברמה, מתנות מבעל הבית ותשלומים מעבודות." },
  ],
};
