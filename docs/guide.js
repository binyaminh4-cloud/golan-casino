/* Golan Casino · Ido, the house guide ("עידו, מהמר מקצועי").
   Shows a step-by-step walkthrough the first time a member opens a game, and again from the "עידו" button.
   His picture lives in the private "characters" bucket (guide_ido.webp), like the members' characters. */
(function () {
  const css = `
  .gd-btn{display:inline-flex;align-items:center;gap:6px;background:rgba(23,18,15,.9);color:#F1D69A;border:1px solid #80602E;border-radius:99px;
    padding:6px 12px 6px 6px;font:700 14px Heebo,sans-serif;cursor:pointer;white-space:nowrap}
  .gd-btn img{width:26px;height:26px;border-radius:50%;object-fit:cover;object-position:50% 6%;background:#000}
  .gd-btn .q{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:#F1D69A;color:#0B0908}
  .gd{position:fixed;inset:0;z-index:300;pointer-events:auto}
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
  @media (max-width:560px){.gd-host{inset-inline:8px;flex-direction:column;align-items:flex-start;gap:0;max-width:none}
    .gd-ido{width:96px;margin-inline-start:6px;margin-bottom:-4px}.gd-bub{margin-bottom:0;min-width:0;width:100%;font-size:14.5px;max-height:52vh;overflow:auto}
    .gd-bub::before{inset-inline-start:34px;bottom:auto;top:-9px;border:10px solid transparent;border-bottom-color:#F5ECDD;border-top:0}}
  @media (max-height:520px){.gd-bub{font-size:14px;padding:10px 12px;margin-bottom:24px}.gd-ido{width:112px}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  let imgUrl = null;
  async function loadImg(db) {
    if (imgUrl !== null || !db) return imgUrl;
    try { const { data } = await db.storage.from("characters").createSignedUrl("guide_ido.webp", 3600); imgUrl = (data && data.signedUrl) || ""; }
    catch (e) { imgUrl = ""; }
    return imgUrl;
  }

  function run(steps) {
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
    const place = (scroll) => {
      const s = steps[i];
      const el = false && s.el && [...document.querySelectorAll(s.el)].find((e) => e.getClientRects().length && e.getBoundingClientRect().width > 4);
      if (el && scroll) { const rr = el.getBoundingClientRect(); if (rr.top < 0 || rr.bottom > innerHeight * 0.6) { el.scrollIntoView({ block: "start" }); scrollBy(0, -70); } }
      const r = el && el.getBoundingClientRect();
      if (r && r.width) { ring.hidden = false; dim.style.background = "transparent";
        Object.assign(ring.style, { left: r.left - 6 + "px", top: r.top - 6 + "px", width: r.width + 12 + "px", height: r.height + 12 + "px" }); }
      else { ring.hidden = true; dim.style.background = ""; }
    };
    const follow = setInterval(() => { if (!document.body.contains(o)) return clearInterval(follow); place(); }, 300);
    const close = () => { clearInterval(follow); o.remove(); };
    o.querySelector(".gd-next").onclick = () => { if (i < steps.length - 1) { i++; show(); } else close(); };
    o.querySelector(".gd-prev").onclick = () => { if (i > 0) { i--; show(); } };
    o.querySelector(".gd-skip").onclick = close;
    addEventListener("resize", () => document.body.contains(o) && show());
    show();
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
      let seen = false; try { seen = localStorage.getItem("gc_guide_" + game) === "1"; localStorage.setItem("gc_guide_" + game, "1"); } catch (e) {}
      if (auto && !seen) {
        const ready = () => !document.getElementById("gcLoad") && !(game !== "lobby" && matchMedia("(pointer: coarse) and (orientation: portrait)").matches);
        const wait = setInterval(() => { if (ready()) { clearInterval(wait); setTimeout(() => run(steps), 600); } }, 300);
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
    { el: "#chips", t: "קודם בוחרים <b>צ׳יפ</b> כאן למטה. כל לחיצה על השולחן מניחה את הסכום הזה." },
    { el: "#board", t: "לחיצה על <b>מספר</b> = הימור על מספר אחד, משלם <b>35 ל־1</b>. על <b>הקו</b> בין שני מספרים = ספליט (17:1). על <b>הצומת</b> של ארבעה = פינה (8:1). על הקו התחתון של טור = שורה (11:1)." },
    { el: "#board", t: "בחוץ יש הימורים רגועים יותר: <b>אדום/שחור, זוגי/אי־זוגי, 1–18/19–36</b> משלמים 1:1. <b>תריסר</b> ו<b>טור (2:1)</b> משלמים 2 ל־1. על אפס כולם מפסידים." },
    { el: "#viewRace", t: "ב<b>מסלול · שכנים</b> המספרים מסודרים כמו על הגלגל. לחיצה על מספר שמה צ׳יפ גם על השכנים שלו. <b>וואזן, טייר, אורפלן וזרו</b> הם הימורים קבועים על אזורים בגלגל." },
    GC_STEPS.spinStep(),
    { el: ".btns", t: "<b>בטל</b> מוריד את הצ׳יפ האחרון, <b>הכפל</b> מכפיל את כל ההימורים, ו<b>אותו הימור</b> חוזר על הסיבוב הקודם. יתרון הבית 2.7% בכל הימור. בהצלחה!" },
  ],
  live: () => !/[?&]private/.test(location.search),
  spinStep: () => GC_STEPS.live()
    ? { el: "#spinBtn", t: "זה <b>שולחן חי</b>: כל החברים משחקים על אותו גלגל, סיבוב כל 48 שניות. יש <b>25 שניות</b> להמר (השעון למטה), ואז לוחצים <b>אשר הימור</b>. צ׳יפ שלא אישרתם לא משחק. התוצאה נקבעת בשרת מראש, ואף אחד לא יכול לשנות אותה. רוצים לשחק לבד בקצב שלכם? בלובי יש <b>🔒 שולחן פרטי</b>." }
    : { el: "#spinBtn", t: "מוכנים? לוחצים <b>סובב</b>. התוצאה נקבעת בשרת ברגע הלחיצה, ואף אחד לא יכול לשנות אותה. גם לא אני 😉" },
  jobs: () => [
    { t: "עבודה? אין ברירה. גם אני עבדתי פה, כי חייבים להביא בשר לרולטה. בואו נראה איך זה עובד." },
    { t: "בוחרים עבודה ורמת קושי. <b>קל</b> משלם מעט, <b>קשה</b> משלם הרבה, אבל טעות אחת או חריגה מהזמן והמשמרת לא משולמת. אין הגבלה: עובדים כמה שרוצים." },
    { t: "🚐 <b>נהג הסעות:</b> לוחצים על התחנות לפי הסדר. קודם אוספים נוסע 🧍, אחר כך מורידים אותו 🏠 (אותו מספר). צריך לעמוד בתקציב הקילומטרים." },
    { t: "🃏 <b>דילר מתלמד:</b> מקלידים כמה שווה כל יד. אס שווה 1 או 11, תמונה 10. כל הכסף שתרוויחו פה, אני ממליץ בחום על רולטה." },
  ],
  lobby: () => { const s = GC_STEPS._lobby(), i = installStep(); if (i) s.splice(s.length - 1, 0, i); return s; },
  _lobby: () => [
    { t: "היי, אני <b>עידו</b>, מהמר מקצועי, ואני כאן כדי להסביר לכם על המשחק שהמפתח שלי, <b>בנימין בולדר</b>, בנה. הוא ביקש שאגיד ״גאון״. אמרתי. עכשיו נמשיך." },
    { el: ".wallet", t: "זה <b>הארנק</b> שלכם. שקלים משחקיים בלבד, אין פה כסף אמיתי. בנימין התעקש על זה, כי הוא מכיר אותי." },
    { el: ".games", t: "כאן בוחרים <b>שולחן</b>: בלאק ג׳ק ורולטה, ובקרוב פוקר ומכונות מזל. בנימין עדיין בונה אותם. הוא אומר ״עוד שבוע״ כבר שבועיים." },
    { el: ".lb", t: "<b>טבלת העשירים</b>. מי שבראש יכול להתרברב בקבוצה. מי שבתחתית, אני שם בשבילו." },
    { el: "#hdrAv", t: "זו <b>הדמות</b> שלכם. אחרי ההרשמה בנימין נותן לכל חבר דמות אישית משלו, והיא יושבת איתכם ליד השולחן בכל המשחקים." },
    { t: "📱 טיפ חשוב: את הלובי רואים איך שרוצים, אבל <b>המשחקים עצמם משוחקים לרוחב</b>, כמו שולחן אמיתי. כשנכנסים לשולחן, <b>סובבו את הטלפון</b>. אם לא, אני אזכיר לכם. ואם הטלפון לא מסתובב, בדקו שנעילת הסיבוב כבויה." },
    { el: ".gd-btn", t: "בתוך כל משחק אני מחכה בכפתור <b>איך משחקים</b> ומסביר הכל. בנימין כתב את הקוד, אבל אני זה שיודע לשחק. יאללה, בהצלחה!" },
  ],
  lightning: () => [
    { t: "היי, זה שוב אני, <b>עידו</b>. ברוכים הבאים לרולטת הברקים. כאן בנימין הכריז על עצמו כ<b>זאוס, מלך האלים</b>. ביקשתי ממנו להפסיק, הוא הוריד עליי ברק." },
    { t: "לפני כל סיבוב זאוס זורק <b>ברקים על 1 עד 5 מספרים</b>, וכל מספר כזה מקבל <b>מכפיל של 50x עד 500x</b>." },
    { t: "הימור על <b>מספר בודד</b> שנפגע מברק, ונוחת עליו הכדור, משלם את המכפיל. ₪10 על מספר עם 500x שווים <b>₪5,010</b>." },
    { t: "המחיר: מספר בודד בלי ברק משלם <b>29 ל־1</b> במקום 35. כל השאר, כמו אדום/שחור ותריסרים, נשאר כרגיל." },
    { t: "ב<b>רולטת XXX</b> זאוס עצבני במיוחד: <b>שרשרת ברקים</b> עד 10 מספרים, ו<b>מכה כפולה</b> עד <b>2,000x</b>. מספר בודד בלי ברק משלם שם רק 19 ל־1." },
    ...(GC_STEPS.live() ? [{ t: "זה <b>שולחן חי</b>: כל החברים על אותו גלגל ואותה תוצאה, סיבוב כל 48 שניות. יש 25 שניות להמר ולאשר ב<b>אשר הימור</b>. גם ברולטה הרגילה ובשתי רולטות הברקים הכדור נוחת על אותו מספר, רק הברקים שונים. רוצים לשחק לבד? בלובי יש <b>🔒 שולחן פרטי</b>." }] : []),
    { t: "טיפ ממני: לפזר כמה צ׳יפים על מספרים בודדים, לחכות לברק ולהתפלל. עובד בערך כמו התפילות שלי שלא יהיה עבודה מחר בבוקר. בהצלחה!" },
  ],
  lightningBJ: () => [
    { t: "פישר והברקים שלו. רועש, מהבהב, ובעיקר לא רולטה. אבל בנימין מכריח, אז בבקשה:" },
    { t: "ברוכים הבאים ל<b>בלאק ג׳ק הכפולות של פישר</b>. החוקים של הבלאק ג׳ק רגילים לגמרי: מתקרבים ל־21 יותר מהדילרית בלי לעבור. ההבדל הוא <b>די־ג׳יי פישר והברקים שלו</b>." },
    { t: "<b>1. שמים הימור.</b> בוחרים צ׳יפ ולוחצים על העיגול. לכל יד מתווספת <b>עמלת ברק של חצי מההימור</b>: הימור ₪100 עולה ₪150. אין כאן הימורים צדדיים." },
    { t: "<b>2. פישר עושה דרופ.</b> לפני שהקלפים יוצאים הוא מפיל <b>ברקים על 2–3 ערכי קלפים</b>, לכל אחד מכפיל ×2 עד ×25. למשל: <b>A ×5 · 7 ×3</b>. הם מופיעים בלוח ליד העיגול." },
    { t: "<b>3. משחקים יד רגילה.</b> כל קלף מוכה ברק שנוחת לך <b>זוהר בזהב</b> עם המכפיל שלו." },
    { t: "<b>4. ניצחת עם קלף זוהר ביד? הרווח מוכפל מיד.</b> ₪100 רווח עם אס ×5 = <b>₪500</b>. בלאק ג׳ק (₪150) עם ×5 = ₪750. יש כמה קלפים זוהרים? נספר הכי גבוה. הפסדת? המכפיל לא עוזר, ופישר מושך בכתפיים." },
  ],
  slots: () => [
    { t: "אני שונא מכונות מזל. בנימין מכריח אותי להסביר, אז בואו נגמור עם זה מהר." },
    { t: "ברוכים הבאים ל<b>מכונות המזל</b>. כאן לא צריך לחשוב, רק ללחוץ. המקום האהוב עליי." },
    { t: "בוחרים <b>הימור לקו</b> למטה. יש <b>5 קווי זכייה</b> קבועים, אז כל סיבוב עולה פי 5 מההימור לקו." },
    { t: "שלושה סמלים זהים על קו משלמים לפי הטבלה: <b>💎 יהלום 1000x</b>, שבע 300x, בר 100x, ועד דובדבן 15x. דובדבן אחד בתחילת קו מחזיר את ההימור, שניים משלמים פי 3." },
    { t: "לוחצים <b>סובב</b>, הגלגלים נעצרים אחד אחרי השני, והקווים הזוכים נדלקים בזהב. התוצאה נקבעת בשרת. בהצלחה!" },
  ],
  blackjack: () => [
    { t: GC_STEPS.intro("בלאק ג׳ק") + " בלאק ג׳ק? הייתי מעדיף רולטה, אבל בנימין אמר שאם לא אסביר הוא מוריד לי את המשכורת." },
    { t: "המטרה: להגיע <b>קרוב יותר ל־21</b> מהדילרית, בלי לעבור. 10, J, Q, K שווים 10. <b>אס</b> שווה 1 או 11, מה שטוב לך." },
    { el: ".betui .row", t: "בוחרים <b>צ׳יפ</b> ולוחצים על <b>העיגול הגדול</b> מול הכיסא שלך. זה ההימור הראשי." },
    { el: ".spot:not(.main)", t: "העיגולים הקטנים הם <b>הימורים צדדיים</b>: PP זוג מושלם · 21+3 · LL ליידיז מזל · BB באסטר. הם לא חובה." },
    { el: "#dealBtn", t: "<b>חלק קלפים</b> מתחיל את הסיבוב. אחר כך: <b>קלף</b> = עוד קלף, <b>עמוד</b> = מספיק לי, <b>הכפל</b> = כפול הימור וקלף אחד, <b>פיצול</b> = זוג הופך לשתי ידיים." },
    { t: "הדילרית עוצרת על 17. <b>בלאק ג׳ק משלם 3 ל־2</b>. כשהיא מראה אס אפשר לקנות <b>ביטוח</b>. בהצלחה, ותזכרו לעמוד על 17!" },
  ],
};
