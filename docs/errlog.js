/* Golan Casino · error log (Issue #9). Sends the errors that happen on a player's phone to the server (log_client_error), so the owner can see them.
   Rules: up to 5 errors per page load · the same error is sent once · only page name, message (300 chars), device type · never throws, never shows anything,
   and stays silent when the server doesn't answer. The whole file is wrapped in try/catch. */
(function () {
  try {
    if (window.__gcErrLog) return;
    window.__gcErrLog = 1;
    if (/[?&]preview(=|&|$)/.test(location.search)) return;           // preview mode has no login

    var MAX = 5, WAIT_MS = 5000, seen = {}, queue = [], used = 0, busy = false, polls = 0, timer = 0;

    function page() {
      try { return (String(location.pathname).split("/").pop() || "index.html").slice(0, 60); } catch (e) { return "?"; }
    }
    function device() {
      try {
        var u = navigator.userAgent || "";
        if (/iPhone|iPod/i.test(u)) return "iphone";
        if (/iPad/i.test(u) || (/Macintosh/i.test(u) && navigator.maxTouchPoints > 1)) return "ipad";
        if (/Android/i.test(u)) return "android";
        return "desktop";
      } catch (e) { return "other"; }
    }
    // no full addresses, tokens or e-mails: a link becomes just its file name
    function clean(s) {
      try {
        s = String(s == null ? "" : s);
        s = s.replace(/https?:\/\/[^\s"')]+/gi, function (u) {
          try { return u.replace(/[?#].*$/, "").split("/").filter(Boolean).pop() || "[url]"; } catch (e) { return "[url]"; }
        });
        s = s.replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, "[token]");
        s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]");
        s = s.replace(/[A-Za-z0-9_-]{32,}/g, "[token]");
        return s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 300);
      } catch (e) { return ""; }
    }
    function client() {
      try { return (typeof db !== "undefined" && db && db.rpc && db.auth) ? db : null; } catch (e) { return null; }   // the page's own Supabase client
    }
    function timeout(p) {
      return Promise.race([p, new Promise(function (_, no) { setTimeout(function () { no(new Error("t")); }, WAIT_MS); })]);
    }

    function flush() {
      try {
        timer = 0;
        if (busy || !queue.length) return;
        var c = client();
        if (!c) { if (++polls < 15) timer = setTimeout(flush, 1000); else queue.length = 0; return; }   // no client on this page: give up quietly
        busy = true;
        var item = queue.shift();
        timeout(c.auth.getSession()).then(function (r) {
          if (!(r && r.data && r.data.session)) return;                    // not signed in: the server would refuse anyway
          return timeout(c.rpc("log_client_error", { p_page: item.p, p_message: item.m, p_device: item.d }));
        }).then(function () {}, function () {}).then(function () {
          busy = false;
          if (queue.length && !timer) timer = setTimeout(flush, 1500);
        });
      } catch (e) { busy = false; }
    }

    function report(msg) {
      try {
        var m = clean(msg);
        if (!m || /^Script error\.?$/i.test(m) || /ResizeObserver loop/i.test(m)) return;
        var key = page() + "|" + m;
        if (seen[key] || used >= MAX) return;                              // same error once; 5 per page load
        seen[key] = 1; used++;
        queue.push({ p: page(), m: m, d: device() });
        if (!timer && !busy) timer = setTimeout(flush, 1500);
      } catch (e) {}
    }

    window.addEventListener("error", function (ev) {
      try {
        if (!ev) return;
        var text = ev.message || (ev.error && ev.error.message) || "";
        var file = ev.filename ? " @" + String(ev.filename).replace(/[?#].*$/, "").split("/").pop() + ":" + (ev.lineno || 0) : "";
        report(text + file);
      } catch (e) {}
    });
    window.addEventListener("unhandledrejection", function (ev) {
      try {
        var r = ev && ev.reason;
        report("Promise: " + ((r && r.message) || (typeof r === "string" ? r : r ? Object.prototype.toString.call(r) : "rejected")));
      } catch (e) {}
    });
  } catch (e) { /* the error log must never break a page */ }
})();
