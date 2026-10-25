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
  .gd-neon{position:fixed;left:50%;bottom:max(6px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:5;display:grid;justify-items:center;pointer-events:none;animation:neonBob 1s ease-in-out infinite}
  .gd-neon svg{width:70px;height:130px;fill:none;stroke:#ff3df2;stroke-width:9;stroke-linecap:round;stroke-linejoin:round;
    filter:drop-shadow(0 0 4px #fff) drop-shadow(0 0 10px #ff3df2) drop-shadow(0 0 22px #ff3df2) drop-shadow(0 0 40px #b400ff);animation:neonFlick 1.6s infinite}
  .gd-neon span{order:-1;font:900 22px Heebo,sans-serif;color:#fff;text-shadow:0 0 6px #fff,0 0 14px #00f0ff,0 0 28px #00f0ff,0 0 48px #0080ff;margin-bottom:2px;animation:neonFlick 1.6s infinite .3s}
  .gd-neon.up{left:auto;right:70px;bottom:auto;top:6px;transform:none}
  .gd-neon.up svg{transform:rotate(180deg)}.gd-neon.up span{order:2}
  @keyframes neonBob{50%{translate:0 14px}}
  @keyframes neonFlick{0%,18%,22%,62%,64%,100%{opacity:1}20%,63%{opacity:.25}}
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
        a.innerHTML = '<svg viewBox="0 0 60 110"><path d="M30 4 V82 M8 62 L30 100 L52 62" /></svg><span>כאן! שיתוף</span>';
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
    { t: GC_STEPS.intro("רולטה") },
    { el: "#chips", t: "קודם בוחרים <b>צ׳יפ</b> כאן למטה. כל לחיצה על השולחן מניחה את הסכום הזה." },
    { el: "#board", t: "לחיצה על <b>מספר</b> = הימור על מספר אחד, משלם <b>35 ל־1</b>. על <b>הקו</b> בין שני מספרים = ספליט (17:1). על <b>הצומת</b> של ארבעה = פינה (8:1). על הקו התחתון של טור = שורה (11:1)." },
    { el: "#board", t: "בחוץ יש הימורים רגועים יותר: <b>אדום/שחור, זוגי/אי־זוגי, 1–18/19–36</b> משלמים 1:1. <b>תריסר</b> ו<b>טור (2:1)</b> משלמים 2 ל־1. על אפס כולם מפסידים." },
    { el: "#viewRace", t: "ב<b>מסלול · שכנים</b> המספרים מסודרים כמו על הגלגל. לחיצה על מספר שמה צ׳יפ גם על השכנים שלו. <b>וואזן, טייר, אורפלן וזרו</b> הם הימורים קבועים על אזורים בגלגל." },
    { el: "#spinBtn", t: "מוכנים? לוחצים <b>סובב</b>. התוצאה נקבעת בשרת ברגע הלחיצה, ואף אחד לא יכול לשנות אותה. גם לא אני 😉" },
    { el: ".btns", t: "<b>בטל</b> מוריד את הצ׳יפ האחרון, <b>הכפל</b> מכפיל את כל ההימורים, ו<b>אותו הימור</b> חוזר על הסיבוב הקודם. יתרון הבית 2.7% בכל הימור. בהצלחה!" },
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
    { t: "טיפ ממני: לפזר כמה צ׳יפים על מספרים בודדים, לחכות לברק ולהתפלל. עובד בערך כמו התפילות שלי שלא יהיה עבודה מחר בבוקר. בהצלחה!" },
  ],
  lightningBJ: () => [
    { t: "בלאק ג׳ק ברקים: כל סיבוב עולה <b>הימור ועוד עמלת ברק</b> באותו גובה." },
    { t: "בסוף כל יד נוחת ברק עם <b>מכפיל 2x עד 25x</b>. יד של 21 טוענת את המכפילים הכי גדולים." },
    { t: "המכפיל מכפיל את <b>הרווח ביד המנצחת הבאה שלך</b>. זכית ב־₪100 עם 10x? קיבלת <b>₪1,000</b>." },
    { t: "המכפיל תקף עד גובה ההימור שבו הוא הושג. ניסיתי לעבוד על המערכת עם ₪10 ואז ₪50,000. בנימין חשב על זה קודם." },
  ],
  blackjack: () => [
    { t: GC_STEPS.intro("בלאק ג׳ק") },
    { t: "המטרה: להגיע <b>קרוב יותר ל־21</b> מהדילרית, בלי לעבור. 10, J, Q, K שווים 10. <b>אס</b> שווה 1 או 11, מה שטוב לך." },
    { el: ".betui .row", t: "בוחרים <b>צ׳יפ</b> ולוחצים על <b>העיגול הגדול</b> מול הכיסא שלך. זה ההימור הראשי." },
    { el: ".spot:not(.main)", t: "העיגולים הקטנים הם <b>הימורים צדדיים</b>: PP זוג מושלם · 21+3 · LL ליידיז מזל · BB באסטר. הם לא חובה." },
    { el: "#dealBtn", t: "<b>חלק קלפים</b> מתחיל את הסיבוב. אחר כך: <b>קלף</b> = עוד קלף, <b>עמוד</b> = מספיק לי, <b>הכפל</b> = כפול הימור וקלף אחד, <b>פיצול</b> = זוג הופך לשתי ידיים." },
    { t: "הדילרית עוצרת על 17. <b>בלאק ג׳ק משלם 3 ל־2</b>. כשהיא מראה אס אפשר לקנות <b>ביטוח</b>. בהצלחה, ותזכרו לעמוד על 17!" },
  ],
};
