// Shared helpers for the browser test set (see README.md). Plain Node, no packages of our own.
const fs = require("fs"), path = require("path"), http = require("http");

function loadPlaywright() {
  const tries = [process.env.GC_PLAYWRIGHT, "playwright", "/opt/npm-tools/node_modules/playwright"].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch (e) { /* try next */ } }
  throw new Error("Playwright not found. Install it (npm i -D playwright) or set GC_PLAYWRIGHT to its path.");
}
const DOCS = path.resolve(__dirname, "../../docs");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".mp3": "audio/mpeg",
  ".mp4": "video/mp4", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".glb": "model/gltf-binary", ".woff2": "font/woff2" };

// Static server for docs/ on a free port (one server for the whole run).
function startServer(root = DOCS) {
  const srv = http.createServer((req, res) => {
    const f = path.resolve(root, "." + decodeURIComponent(req.url.split("?")[0]));
    if (f !== root && !f.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    const target = fs.existsSync(f) && fs.statSync(f).isDirectory() ? path.join(f, "index.html") : f;   // like GitHub Pages: "/" is index.html
    fs.stat(target, (e, st) => {
      if (e || !st.isFile()) { res.writeHead(404); return res.end(); }
      const type = MIME[path.extname(target).toLowerCase()] || "application/octet-stream", m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
      if (m) { const a = m[1] ? +m[1] : 0, b = m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
        res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${a}-${b}/${st.size}`, "Accept-Ranges": "bytes", "Content-Length": b - a + 1 }); return fs.createReadStream(target, { start: a, end: b }).pipe(res); }
      res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Accept-Ranges": "bytes", "Cache-Control": "no-store" }); fs.createReadStream(target).pipe(res);
    });
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok({ srv, base: `http://127.0.0.1:${srv.address().port}/`, close: () => new Promise((r) => srv.close(r)) })));
}

// Chrome with software WebGL so the 3D pages draw without a GPU. One browser for the whole run.
async function launch() {
  const { chromium } = loadPlaywright();
  const args = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--mute-audio", "--autoplay-policy=no-user-gesture-required"];
  try { return await chromium.launch({ channel: "chrome", args }); } catch (e) { return await chromium.launch({ args }); }
}

// Known real bugs: files the pages ask for that are not in the repo. Listed here (and in an Issue) so the set stays green
// for everything else; remove the line when the file is added. Anything NOT on this list that returns 404 fails the test.
const KNOWN_MISSING = [
  "snd/r3d/nomore_v2.mp3",   // roulette 3D "no more bets" voice - never committed (silent in the game)
];
const known = (u) => KNOWN_MISSING.some((k) => u.includes(k));

const MOCK = fs.readFileSync(path.join(__dirname, "mock_supabase.js"), "utf8");
const NOOP_SUPABASE = "window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){},signOut:async()=>({})},rpc:async()=>({data:null}),from(){const q={select:()=>q,eq:()=>q,order:()=>q,single:async()=>({data:null}),then:(r)=>r({data:[]})};return q;}})};";

// A fresh page: no network outside localhost (CDN supabase is replaced, fonts are empty), errors collected in page.errors.
// opts: mock=true uses the fake signed-in supabase (mock_supabase.js); otherwise a do-nothing stub (for ?preview pages).
async function newPage(browser, base, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 844, height: 390 }, hasTouch: !!opts.touch, serviceWorkers: "block" });
  await ctx.addInitScript(() => { try { ["lobby", "roulette", "lightning", "lightning_bj", "blackjack", "slots", "aterf", "roulette3d", "blackjack3d"].forEach((g) => { localStorage.setItem("gc_guide_" + g, "1"); localStorage.setItem("gc_guide2_" + g, "1"); }); } catch (e) {} });
  await ctx.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(base)) return r.fallback();
    if (/supabase(\.min)?\.js/.test(u)) return r.fulfill({ contentType: "text/javascript", body: opts.mock ? MOCK : NOOP_SUPABASE });
    if (/fonts\.googleapis\.com/.test(u)) return r.fulfill({ contentType: "text/css", body: "" });
    return r.abort();   // nothing else leaves the machine
  });
  const page = await ctx.newPage(); page.errors = [];
  const rel = (u) => u.replace(base, "");
  page.on("pageerror", (e) => page.errors.push("JS error: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource|net::ERR_FAILED/.test(m.text())) page.errors.push("console: " + m.text().slice(0, 160)); });
  page.on("response", (r) => { if (r.url().startsWith(base) && r.status() >= 400 && !/favicon/.test(r.url()) && !known(r.url())) page.errors.push(`HTTP ${r.status()} ${rel(r.url())}`); });
  page.on("requestfailed", (r) => { if (r.url().startsWith(base) && !known(r.url())) page.errors.push(`request failed ${rel(r.url())}`); });
  page.closeAll = () => ctx.close();
  return page;
}

// Loading screen gone (gc-loading class / #gcLoad), then the "enter" overlay dismissed if the page has one.
async function waitLoaded(page, timeout = 30000) {
  await page.waitForFunction(() => !document.getElementById("gcLoad") && !document.documentElement.classList.contains("gc-loading"), null, { timeout });
}
async function enter(page) {      // "enter" overlay: click it unless the page already skipped it (?go)
  const gone = () => page.evaluate(() => { const e = document.getElementById("enter"); return !e || e.hidden || getComputedStyle(e).display === "none"; });
  await page.waitForFunction(() => { const e = document.getElementById("enter"); return !e || e.hidden || (getComputedStyle(e).display !== "none" && document.getElementById("enterGo")); }, null, { timeout: 30000 });
  if (!(await gone())) { await page.click("#enterGo"); await page.waitForFunction(() => { const e = document.getElementById("enter"); return !e || e.hidden || getComputedStyle(e).display === "none"; }); }
}
const visible = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.hidden) return false; const c = getComputedStyle(e), b = e.getBoundingClientRect(); return c.display !== "none" && c.visibility !== "hidden" && b.width > 1 && b.height > 1; }, sel);

// Taps a grid of points on the 3D canvas until `changed()` says the bet went in (the board has no DOM to click).
async function tapUntil(page, canvasSel, changed, { xs = [0.3, 0.4, 0.5, 0.6, 0.7], ys = [0.55, 0.65, 0.75, 0.85, 0.45, 0.35] } = {}) {
  const box = await page.locator(canvasSel).boundingBox();
  for (const y of ys) for (const x of xs) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
    await page.waitForTimeout(250);
    if (await changed()) return { x, y };
  }
  return null;
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
module.exports = { loadPlaywright, startServer, launch, newPage, waitLoaded, enter, visible, tapUntil, assert, DOCS };
