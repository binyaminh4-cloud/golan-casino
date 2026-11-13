// Issue #9: docs/errlog.js never throws, caps itself at 5 errors per page, sends the same error once, stays quiet without a server.
// Runs with plain node (no browser): node test/errlog_test.cjs
const vm = require("vm"), fs = require("fs"), path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "../docs/errlog.js"), "utf8");
let fails = 0;
const ok = (c, name) => { if (c) console.log("ok:", name); else { fails++; console.log("FAIL:", name); } };
const flushMicro = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function makeEnv(opts = {}) {
  const timers = []; let now = 0, id = 0;
  const handlers = {}, calls = [], unhandled = [];
  const ctx = {
    console, Promise, Object, String, Error, Array, RegExp, Date,
    location: opts.location || { pathname: "/golan-casino/roulette.html", search: opts.search || "?token=SECRET&mode=x" },
    navigator: { userAgent: opts.ua || "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", maxTouchPoints: 5 },
    setTimeout: (fn, ms) => { timers.push({ id: ++id, at: now + (ms || 0), fn }); return id; },
    addEventListener: (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); },
  };
  ctx.window = ctx;
  if (opts.db !== null) ctx.db = opts.db || {
    auth: { getSession: () => opts.session ? opts.session() : Promise.resolve({ data: { session: { user: {} } } }) },
    rpc: (name, args) => { calls.push({ name, args }); return opts.rpc ? opts.rpc(name, args) : Promise.resolve({ data: true }); },
  };
  process.on("unhandledRejection", (e) => unhandled.push(e));
  const env = { ctx, handlers, calls, unhandled,
    fire: (type, ev) => (handlers[type] || []).forEach((h) => h(ev)),
    async advance(ms) { const end = now + ms; for (;;) { await flushMicro(); const t = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!t) break; timers.splice(timers.indexOf(t), 1); now = Math.max(now, t.at); t.fn(); } now = end; await flushMicro(); },
  };
  return env;
}
const load = (env) => vm.runInContext(SRC, vm.createContext(env.ctx));

(async () => {
  // 1. an error is sent, with page name only (no ?parameters), cleaned message, device type
  let e = makeEnv(); load(e);
  e.fire("error", { message: "TypeError: x is not a function", filename: "https://golan.example/app.js?v=123", lineno: 77 });
  await e.advance(10000);
  ok(e.calls.length === 1 && e.calls[0].name === "log_client_error", "error is sent once");
  ok(e.calls[0].args.p_page === "roulette.html", "page name only, no parameters");
  ok(e.calls[0].args.p_message === "TypeError: x is not a function @app.js:77", "message with file name and line, no address");
  ok(e.calls[0].args.p_device === "iphone", "device type");

  // 2. an error loop of 1000 different errors does not flood: max 5
  e = makeEnv(); load(e);
  for (let i = 0; i < 1000; i++) e.fire("error", { message: "loop error " + i });
  await e.advance(120000);
  ok(e.calls.length === 5, "1000 different errors -> exactly 5 sent (got " + e.calls.length + ")");

  // 3. the same error 50 times is sent once; promise rejections count too
  e = makeEnv(); load(e);
  for (let i = 0; i < 50; i++) e.fire("error", { message: "same one" });
  for (let i = 0; i < 50; i++) e.fire("unhandledrejection", { reason: new Error("same reject") });
  await e.advance(60000);
  ok(e.calls.length === 2, "identical errors sent once each (got " + e.calls.length + ")");

  // 4. privacy: link, token, e-mail removed; 300 char cap
  e = makeEnv(); load(e);
  e.fire("error", { message: "fail https://x.supabase.co/rest/v1/rpc/f?apikey=SECRET for dan@example.com eyJhbGciOi.eyJzdWIiOiIx.sig_nature" });
  e.fire("error", { message: "long " + "word ".repeat(200) });
  await e.advance(20000);
  const msgs = e.calls.map((c) => c.args.p_message);
  ok(msgs[0] === "fail f for [email] [token]", "url/email/token removed: " + msgs[0]);
  ok(msgs[1].length <= 300, "message cut to 300");
  ok(!JSON.stringify(e.calls).includes("SECRET"), "no secret in anything sent");

  // 5. not signed in: nothing is sent
  e = makeEnv({ session: () => Promise.resolve({ data: { session: null } }) }); load(e);
  e.fire("error", { message: "anon error" }); await e.advance(20000);
  ok(e.calls.length === 0, "no session -> nothing sent");

  // 6. the server never answers: no throw, no unhandled rejection, no noise
  e = makeEnv({ rpc: () => new Promise(() => {}) }); load(e);
  e.fire("error", { message: "e1" }); e.fire("error", { message: "e2" }); await e.advance(60000);
  ok(e.calls.length === 2 && e.unhandled.length === 0, "server silent -> moves on after timeout, nothing thrown");
  e = makeEnv({ session: () => new Promise(() => {}) }); load(e);
  e.fire("error", { message: "e1" }); await e.advance(60000);
  ok(e.unhandled.length === 0, "session call silent -> nothing thrown");

  // 7. server errors (rejects / throws / returns error) stay silent
  for (const [name, rpc] of [["rejects", () => Promise.reject(new Error("503"))], ["throws", () => { throw new Error("boom"); }], ["returns error", () => Promise.resolve({ error: { message: "not_signed_in" } })]]) {
    e = makeEnv({ rpc }); load(e);
    let threw = false; try { e.fire("error", { message: "x" }); await e.advance(30000); } catch (x) { threw = true; }
    ok(!threw && e.unhandled.length === 0, "server " + name + " -> silent");
  }

  // 8. weird events never throw
  e = makeEnv(); load(e); let threw = false;
  try {
    e.fire("error", null); e.fire("error", {}); e.fire("error", { message: { toString() { throw new Error("x"); } } });
    e.fire("unhandledrejection", null); e.fire("unhandledrejection", { reason: null }); e.fire("unhandledrejection", { reason: { get message() { throw new Error("x"); } } });
    e.fire("error", { message: "Script error." }); e.fire("error", { message: "ResizeObserver loop limit exceeded" });
    await e.advance(30000);
  } catch (x) { threw = true; }
  ok(!threw && e.calls.length <= 5, "weird events don't throw (" + e.calls.length + " sent)");
  ok(!e.calls.some((c) => /Script error|ResizeObserver/.test(c.args.p_message)), "useless browser noise is skipped");

  // 9. the file itself never throws, even in a broken environment
  threw = false; try { vm.runInContext(SRC, vm.createContext({})); vm.runInContext(SRC, vm.createContext({ window: {}, location: null })); } catch (x) { threw = true; }
  ok(!threw, "loading in a broken environment doesn't throw");

  // 10. no db on the page: gives up quietly; db still in its 'const' dead zone is fine too
  e = makeEnv({ db: null }); load(e); e.fire("error", { message: "no db" }); await e.advance(60000);
  ok(e.calls.length === 0 && e.unhandled.length === 0, "page without a client: quiet");
  e = makeEnv({ db: null }); const c10 = vm.createContext(e.ctx); vm.runInContext(SRC, c10);
  e.fire("error", { message: "late db" }); await e.advance(3000);
  vm.runInContext("var db = { auth:{getSession:()=>Promise.resolve({data:{session:{}}})}, rpc:(n,a)=>{ __calls.push(a); return Promise.resolve({}); } }", Object.assign(c10, {}));
  c10.__calls = []; await e.advance(5000);
  ok(c10.__calls.length === 1, "db that appears a few seconds later is still used");

  // 11. preview mode: nothing is hooked
  e = makeEnv({ search: "?preview" }); load(e);
  ok(!e.handlers.error && !e.handlers.unhandledrejection, "preview mode: no listeners");

  // 12. loaded twice on one page: still one set of listeners
  e = makeEnv(); const c12 = vm.createContext(e.ctx); vm.runInContext(SRC, c12); vm.runInContext(SRC, c12);
  ok(e.handlers.error.length === 1, "loading the file twice adds listeners once");

  console.log(fails ? "\n" + fails + " FAILED" : "\nALL ERRLOG TESTS PASSED");
  process.exit(fails ? 1 : 0);
})();
