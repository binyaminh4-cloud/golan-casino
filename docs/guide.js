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
  .gd-dots{font:500 12px Inter;color:#8a7558}
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
      const el = s.el && document.querySelector(s.el);
      const r = el && el.getBoundingClientRect();
      if (r && r.width) { ring.hidden = false; dim.style.background = "transparent";
        Object.assign(ring.style, { left: r.left - 6 + "px", top: r.top - 6 + "px", width: r.width + 12 + "px", height: r.height + 12 + "px" }); }
      else { ring.hidden = true; dim.style.background = ""; }
    };
    const close = () => o.remove();
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
      if (auto && !seen) setTimeout(() => run(steps), 900);
    },
    run,
  };
})();

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
  blackjack: () => [
    { t: GC_STEPS.intro("בלאק ג׳ק") },
    { t: "המטרה: להגיע <b>קרוב יותר ל־21</b> מהדילרית, בלי לעבור. 10, J, Q, K שווים 10. <b>אס</b> שווה 1 או 11, מה שטוב לך." },
    { el: ".betui .row", t: "בוחרים <b>צ׳יפ</b> ולוחצים על <b>העיגול הגדול</b> מול הכיסא שלך. זה ההימור הראשי." },
    { el: ".spot:not(.main)", t: "העיגולים הקטנים הם <b>הימורים צדדיים</b>: PP זוג מושלם · 21+3 · LL ליידיז מזל · BB באסטר. הם לא חובה." },
    { el: "#dealBtn", t: "<b>חלק קלפים</b> מתחיל את הסיבוב. אחר כך: <b>קלף</b> = עוד קלף, <b>עמוד</b> = מספיק לי, <b>הכפל</b> = כפול הימור וקלף אחד, <b>פיצול</b> = זוג הופך לשתי ידיים." },
    { t: "הדילרית עוצרת על 17. <b>בלאק ג׳ק משלם 3 ל־2</b>. כשהיא מראה אס אפשר לקנות <b>ביטוח</b>. בהצלחה, ותזכרו לעמוד על 17!" },
  ],
};
