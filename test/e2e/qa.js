// Golan Casino QA: every page x device, transitions lobby <-> games (incl. back button), loading screen, layout.
const { chromium, devices } = require("playwright");
const fs = require("fs");
const BASE = process.env.BASE || "http://localhost:8765/";
const OUT = process.env.OUT || "/tmp/qa"; fs.mkdirSync(OUT, { recursive: true });
const MOCK = fs.readFileSync(__dirname + "/mock_supabase.js", "utf8");
const DEV = {
  "phone-landscape": { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: devices["iPhone 13"].userAgent },
  "phone-portrait": { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: devices["iPhone 13"].userAgent },
  "small-landscape": { viewport: { width: 667, height: 375 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: devices["Pixel 5"].userAgent },
  "tablet": { viewport: { width: 1024, height: 768 }, hasTouch: true },
  "desktop": { viewport: { width: 1440, height: 900 } },
};
const PAGES = {
  lobby: { url: "index.html", must: ["#lobbyView header", ".games", ".wallet", ".lb"] },
  roulette: { url: "roulette.html", must: [".top .back", "#board", "#spinBtn", "#chips", "#wheelHost"] },
  lightning: { url: "roulette.html?mode=lightning", must: [".top .back", "#board", "#spinBtn", "#chips"] },
  xxx: { url: "roulette.html?mode=xxx", must: [".top .back", "#board", "#spinBtn"] },
  blackjack: { url: "blackjack.html", must: [".top a", "#dealBtn", ".betui .chip", ".spot.main"] },
  fisher: { url: "blackjack.html?mode=lightning", must: [".top a", "#dealBtn", ".spot.main"] },
  slots: { url: "slots.html", must: [".top .back", "#reels", "#spinBtn", "#chips"] },
};
const problems = [];
const bad = (dev, page, msg) => { const s = `[${dev}] ${page}: ${msg}`; problems.push(s); console.log(s); };

async function waitLoader(p, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await p.evaluate(() => !document.getElementById("gcLoad") && !document.documentElement.classList.contains("gc-loading")).catch(() => false)) return Date.now() - t0; await p.waitForTimeout(150); }
  return -1;
}
async function checkLayout(p, dev, name, must) {
  const r = await p.evaluate((must) => {
    const out = { overflowX: document.documentElement.scrollWidth > innerWidth + 1, missing: [], offscreen: [], overlaps: [] };
    const rot = document.querySelector(".rotate-gate"); out.rotate = !!rot && getComputedStyle(rot).display !== "none";
    const boxes = [];
    for (const s of must) {
      const e = [...document.querySelectorAll(s)].find((x) => x.getClientRects().length);
      if (!e) { out.missing.push(s); continue; }
      const b = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      if (b.width < 2 || b.height < 2 || cs.visibility === "hidden" || cs.opacity === "0") { out.missing.push(s + " (invisible)"); continue; }
      if (b.left < -2 || b.right > innerWidth + 2 || (!document.getElementById('lobbyView') && (b.top < -2 || b.bottom > innerHeight + 2))) out.offscreen.push(`${s} [${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}] vs ${innerWidth}x${innerHeight}`);
      boxes.push([s, b]);
    }
    // controls covered by something else (top element at their centre)
    for (const [s, b] of boxes) {
      const x = b.left + b.width / 2, y = b.top + b.height / 2; if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      const top = document.elementFromPoint(x, y), e = document.querySelector(s);
      if (top && e && !e.contains(top) && !top.contains(e)) out.overlaps.push(`${s} covered by ${top.tagName.toLowerCase()}${top.id ? "#" + top.id : ""}.${[...top.classList].join(".")}`);
    }
    return out;
  }, must);
  if (r.rotate) return "rotate";
  if (r.overflowX) bad(dev, name, "horizontal overflow (page wider than the screen)");
  r.missing.forEach((m) => bad(dev, name, "missing " + m));
  r.offscreen.forEach((m) => bad(dev, name, "off screen " + m));
  r.overlaps.forEach((m) => bad(dev, name, m));
  return "ok";
}

(async () => {
  const browser = await chromium.launch();
  const only = process.env.DEVS ? process.env.DEVS.split(",") : null;
  for (const [dev, opt] of Object.entries(DEV)) { if (only && !only.includes(dev)) continue; console.log("== " + dev);
    const ctx = await browser.newContext(opt);
    await ctx.addInitScript(() => { ["lobby", "roulette", "lightning", "lightning_bj", "blackjack", "slots"].forEach((g) => localStorage.setItem("gc_guide_" + g, "1")); });
    await ctx.route("**/supabase.min.js", (r) => r.fulfill({ contentType: "text/javascript", body: MOCK }));
    await ctx.route("**/fonts.googleapis.com/**", (r) => r.fulfill({ body: "" }));
    const p = await ctx.newPage();
    p.on("pageerror", (e) => bad(dev, p.url().split("/").pop(), "JS error: " + e.message));
    p.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) bad(dev, p.url().split("/").pop(), "console: " + m.text().slice(0, 140)); });
    for (const [name, pg] of Object.entries(PAGES)) {
      await p.goto(BASE + pg.url);
      const t = await waitLoader(p);
      if (t < 0) bad(dev, name, "loading screen still up after 15s");
      await p.waitForTimeout(700);
      const st = await checkLayout(p, dev, name, pg.must);
      await p.screenshot({ path: `${OUT}/${dev}_${name}.png` });
      if (st === "rotate" && !dev.includes("portrait")) bad(dev, name, "rotate prompt shown in landscape");
    }
    // transitions: lobby -> each game by clicking its card -> back to lobby by the button -> again with browser Back
    for (const [name, href] of [["roulette", "roulette.html"], ["blackjack", "blackjack.html"], ["slots", "slots.html"], ["lightning", "roulette.html?mode=lightning"]]) {
      await p.goto(BASE + "index.html"); if (await waitLoader(p) < 0) bad(dev, "lobby", "loader stuck before transition");
      const card = p.locator(`a.game[href="${href}"]`);
      if (!(await card.count())) { bad(dev, "lobby", "no card for " + href); continue; }
      await card.scrollIntoViewIfNeeded(); await card.click();
      await p.waitForURL("**/" + href.split("?")[0] + "*");
      const t1 = await waitLoader(p); if (t1 < 0) bad(dev, name, "stuck loading after opening from lobby");
      await p.waitForTimeout(500);
      const back = p.locator(".top a, .top .back").first();
      if (await p.evaluate(() => { const g = document.querySelector(".rotate-gate"); return g && getComputedStyle(g).display !== "none"; })) { await p.goBack(); }
      else { await back.click(); }
      await p.waitForFunction(() => /\/(index\.html)?$/.test(location.pathname), null, { timeout: 20000 }).catch(() => bad(dev, name, "the lobby button did not return to the lobby"));
      const t2 = await waitLoader(p); if (t2 < 0) bad(dev, "lobby", `stuck loading after returning from ${name}`);
      await p.goForward().catch(() => {}); const t3 = await waitLoader(p); if (t3 < 0) bad(dev, name, "stuck loading after browser Forward");
      await p.goBack().catch(() => {}); const t4 = await waitLoader(p); if (t4 < 0) bad(dev, "lobby", "stuck loading after browser Back");
      await p.screenshot({ path: `${OUT}/${dev}_back_from_${name}.png` });
    }
    await ctx.close();
  }
  await browser.close();
  console.log(problems.length ? problems.join("\n") : "NO PROBLEMS");
})();
