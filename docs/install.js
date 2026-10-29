/* Golan Casino · "save to home screen" gate. Before sign-up (and again before Ido's lobby tour if skipped) a popup explains
   why the casino must be saved as an app, with step-by-step instructions for iPhone / Android. Never shown inside the installed app. */
(function () {
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (standalone()) return;
  let deferred = null; addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; });
  const ua = navigator.userAgent, ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const notSafari = ios && /crios|fxios|edgios|instagram|fban|fbav|whatsapp/i.test(ua);
  const css = `.gi{position:fixed;inset:0;z-index:9900;display:grid;place-items:center;background:rgba(5,3,2,.88);backdrop-filter:blur(4px);direction:rtl;font-family:Heebo,sans-serif;padding:14px}
.gi .bx{width:min(440px,100%);max-height:94dvh;overflow:auto;background:radial-gradient(ellipse at 50% 0,#3a2a10,#120c08);border:2px solid #F1D69A;border-radius:20px;padding:18px;color:#F5ECDD;box-shadow:0 0 50px rgba(255,214,110,.35)}
.gi img.ic{width:72px;height:72px;border-radius:18px;display:block;margin:0 auto 8px;box-shadow:0 6px 18px #000a}
.gi h2{margin:0 0 6px;text-align:center;font:900 22px Heebo;color:#ffe27a}.gi p{margin:0 0 10px;font-size:14px;line-height:1.5;text-align:center;color:#e8dcc4}
.gi ul{margin:0 0 12px;padding:0;list-style:none;display:grid;gap:6px}.gi li{font-size:13.5px;background:rgba(255,255,255,.05);border-radius:10px;padding:7px 10px}
.gi ol{margin:0 0 12px;padding:0 18px 0 0;display:grid;gap:8px;font-size:14.5px}.gi ol b{color:#ffe27a}
.gi .go{width:100%;height:48px;border:0;border-radius:99px;background:linear-gradient(180deg,#F1D69A,#C5A05A);color:#1b0f06;font:900 17px Heebo;cursor:pointer}
.gi .skip{display:block;margin:10px auto 0;background:none;border:0;color:#9b8a70;font-size:12px;text-decoration:underline;cursor:pointer}
.gi .warn{color:#ffb0b0;font-weight:700}.gi .sh{display:inline-block;padding:0 6px;border:1px solid #C5A05A;border-radius:6px}`;
  function steps() {
    if (ios && notSafari) return `<ol><li>האפליקציה נשמרת רק מ<b>ספארי</b>. לחץ על <b>⋯ / שלוש הנקודות</b> ובחר <b>"פתח בספארי"</b> (או העתק את הקישור והדבק בספארי).</li><li>בספארי: לחץ על כפתור <b>השיתוף</b> <span class="sh">⬆︎</span> בתחתית.</li><li>גלול ובחר <b>"הוסף למסך הבית"</b> ← <b>"הוסף"</b>.</li><li>מעכשיו נכנסים רק מהאייקון של גולן קזינו במסך הבית.</li></ol>`;
    if (ios) return `<ol><li>לחץ על כפתור <b>השיתוף</b> <span class="sh">⬆︎</span> בתחתית ספארי.</li><li>גלול למטה ובחר <b>"הוסף למסך הבית"</b>.</li><li>לחץ <b>"הוסף"</b> למעלה.</li><li>מעכשיו נכנסים רק מהאייקון של גולן קזינו במסך הבית.</li></ol>`;
    return `<ol><li>${deferred ? "לחץ על הכפתור למטה ← <b>התקן</b>." : "בכרום לחץ על <b>שלוש הנקודות ⋮</b> למעלה."}</li>${deferred ? "" : `<li>בחר <b>"התקנת אפליקציה"</b> או <b>"הוספה למסך הבית"</b> ← <b>התקן</b>.</li>`}<li>מעכשיו נכנסים רק מהאייקון של גולן קזינו.</li></ol>`;
  }
  function show(reason) {
    return new Promise((done) => {
      if (document.querySelector(".gi")) return done();
      if (!document.getElementById("giCss")) { const c = document.createElement("style"); c.id = "giCss"; c.textContent = css; document.head.appendChild(c); }
      const o = document.createElement("div"); o.className = "gi";
      o.innerHTML = `<div class="bx"><img class="ic" src="img/brand/icon-192.png?v=2" alt=""><h2>📲 קודם שומרים את הקזינו כאפליקציה</h2>
        <p>${reason === "again" ? "דילגת בפעם הקודמת. בלי אפליקציה הקזינו לא עובד כמו שצריך:" : "גולן קזינו בנוי לעבוד כ<b>אפליקציה על מסך הבית</b>. בדפדפן רגיל:"}</p>
        <ul><li class="warn">🎰 המשחקים לא נכנסים למסך, נחתכים וזזים כשהסרגלים של הדפדפן קופצים</li><li>📱 אין מסך מלא לרוחב, והשולחנות קטנים</li><li>🔊 צלילים ומוזיקה נקטעים</li><li>🔐 קל להתנתק ולאבד את המקום בשולחן</li><li>⚡ טעינה איטית יותר בכל כניסה</li></ul>
        <p><b>איך שומרים (30 שניות):</b></p>${steps()}
        ${deferred && !ios ? `<button type="button" class="go inst">📲 התקן עכשיו</button>` : `<button type="button" class="go ok">שמרתי, אני נכנס מהאייקון</button>`}
        <button type="button" class="skip">להמשיך בדפדפן בכל זאת (לא מומלץ)</button></div>`;
      document.body.appendChild(o);
      const close = (skipped) => { o.remove(); try { localStorage.setItem("gc_install_seen", skipped ? "skip" : "done"); } catch (e) {} done(); };
      o.querySelector(".skip").onclick = () => close(true);
      const ok = o.querySelector(".ok"); if (ok) ok.onclick = () => close(false);
      const inst = o.querySelector(".inst"); if (inst) inst.onclick = async () => { deferred.prompt(); const r = await deferred.userChoice.catch(() => ({})); deferred = null; if (r && r.outcome === "accepted") close(false); };
    });
  }
  window.GC_INSTALL = { show, standalone };
  // first visit (before signing up / logging in): always
  document.addEventListener("DOMContentLoaded", () => {
    let seen = null; try { seen = localStorage.getItem("gc_install_seen"); } catch (e) {}
    if (!seen) setTimeout(() => show("first"), 900);
  });
})();
