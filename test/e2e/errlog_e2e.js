// Issue #9 in a real browser: errors on a page reach log_client_error (max 5, same one once), the page keeps working, a dead server changes nothing.
// Needs: cd docs && python3 -m http.server 8765   then: node test/e2e/errlog_e2e.js   (BASE=... to change the address)
const { chromium, devices } = require("playwright");
const BASE = process.env.BASE || "http://localhost:8765/";
let fails = 0; const ok = (c, n) => { console.log(c ? "ok:" : "FAIL:", n); if (!c) fails++; };
// fake Supabase: signed in, records every rpc in window.__rpc; mode "dead" = the server never answers
const stub = (mode) => `window.__rpc = []; window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getUser: async () => ({ data: { user: { id: "u1" } } }) },
  rpc: (name, a) => { window.__rpc.push({ name, a }); return ${mode === "dead" ? "new Promise(() => {})" : "Promise.resolve({ data: true })"}; },
  from: () => { const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, single: async () => ({ data: null }), then: (f) => f({ data: [] }) }; return q; },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {}, functions: { invoke: async () => ({}) } }) };`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome" });
  for (const mode of ["live", "dead"]) {
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    await ctx.route("**/supabase.min.js", (r) => r.fulfill({ contentType: "text/javascript", body: stub(mode) }));
    await ctx.route("**/fonts.googleapis.com/**", (r) => r.fulfill({ body: "" }));
    const p = await ctx.newPage(); const pageErrors = [];
    p.on("pageerror", (e) => { if (!/e2e-/.test(e.message)) pageErrors.push(e.message); });
    await p.goto(BASE + "protein.html?x=SECRET", { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(500);
    // 1 identical error x20, 1000 different errors, 1 rejected promise
    await p.evaluate(() => {
      for (let i = 0; i < 20; i++) setTimeout(() => { throw new Error("e2e-same"); }, 0);
      for (let i = 0; i < 1000; i++) setTimeout(() => { throw new Error("e2e-loop " + i); }, 0);
      Promise.reject(new Error("e2e-reject"));
    });
    await p.waitForTimeout(mode === "dead" ? 16000 : 12000);
    const calls = await p.evaluate(() => window.__rpc.filter((c) => c.name === "log_client_error").map((c) => c.a));
    ok(calls.length <= 5, mode + ": at most 5 sent (" + calls.length + ")");
    if (mode === "live") {
      ok(calls.length >= 1 && calls.every((c) => c.p_page === "protein.html"), "live: page name only, no ?x=SECRET");
      ok(calls.filter((c) => /e2e-same/.test(c.p_message)).length <= 1, "live: the same error is sent once");
      ok(!JSON.stringify(calls).includes("SECRET") && calls.every((c) => c.p_device === "iphone" && c.p_message.length <= 300), "live: no secret, device type, message size");
    } else ok(calls.length >= 1, "dead: the browser tried (and moved on)");
    const alive = await p.evaluate(() => { document.body.dataset.t = "1"; return document.body.dataset.t === "1"; });
    ok(alive, mode + ": the page still responds");
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? fails + " FAILED" : "ALL ERRLOG E2E TESTS PASSED"); process.exit(fails ? 1 : 0);
})();
