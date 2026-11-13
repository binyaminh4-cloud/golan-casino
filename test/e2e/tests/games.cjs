// Game tests. They check what the player SEES on the page (buttons, tables, totals), not short animations.
// The 3D scenes run on software WebGL, so every wait is wait_for_function with a long timeout, never a fixed sleep.
const fs = require("fs");
const { newPage, waitLoaded, enter, visible, tapUntil, assert } = require("../lib.cjs");

const shot = async (page, shots, name) => { try { await page.screenshot({ path: `${shots}/${name}.png` }); } catch (e) {} };
// real mouse click at the element's centre: no waiting for "stable" frames (the 3D page draws slowly without a GPU and the betting window is short)
const clickAt = async (page, sel) => { const b = await page.locator(sel).boundingBox(); assert(b, "not on screen: " + sel); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
const moneyOf = (page, sel) => page.evaluate((s) => Number((document.querySelector(s).textContent || "").replace(/[^\d]/g, "") || 0), sel);

const tests = [];

// ---- Roulette 3D live: the bet goes to the server by itself (no "send" button) ----
tests.push({
  name: "roulette3d-live: bet is sent by itself, no button",
  timeout: 120000,
  async run({ browser, base, shots }) {
    const page = await newPage(browser, base, { mock: true });
    try {
      await page.goto(base + "roulette3d.html?live&go", { waitUntil: "domcontentloaded" });
      await waitLoaded(page, 60000);
      await enter(page);
      // wait for a betting window with enough time left (the mock server cycles every 48 s, open 25 s)
      await page.waitForFunction(() => { const m = /הימורים פתוחים · (\d+)/.exec(document.getElementById("say").textContent || ""); return m && +m[1] >= 10; }, null, { timeout: 90000, polling: 250 });
      assert(!(await visible(page, "#spin")), "the send button (#spin) is visible in live mode");
      const hit = await tapUntil(page, "#scene", async () => (await moneyOf(page, "#total")) > 0);
      assert(hit, "could not place a chip on the table (#total stayed 0)");
      // the mock server stores sent bets in localStorage.mockdb.live
      await page.waitForFunction(() => { try { const l = JSON.parse(localStorage.getItem("mockdb") || "{}").live || {}; return Object.values(l).some((a) => a.length); } catch (e) { return false; } }, null, { timeout: 8000, polling: 200 });
      assert(!(await visible(page, "#spin")), "the send button appeared after betting");
      await shot(page, shots, "roulette3d-live");
      assert(!page.errors.length, page.errors.slice(0, 3).join(" | "));
    } finally { await page.closeAll(); }
  },
});

// ---- Blackjack 3D: the deal works (bet -> cards -> action buttons or a finished hand) ----
tests.push({
  name: "blackjack3d: deal works",
  timeout: 120000,
  async run({ browser, base, shots }) {
    const page = await newPage(browser, base, { mock: false });
    try {
      await page.goto(base + "blackjack3d.html?preview", { waitUntil: "domcontentloaded" });
      await waitLoaded(page, 60000);
      await enter(page);
      const hit = await tapUntil(page, "#scene", () => page.evaluate(() => !document.getElementById("deal").disabled));
      assert(hit, "could not place the main bet (#deal stayed disabled)");
      await page.click("#deal");
      // dealt = the betting bar goes away and either the action buttons show or the hand already finished (blackjack)
      await page.waitForFunction(() => {
        const vis = (s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.getBoundingClientRect().height > 1; };
        const acts = document.getElementById("acts"), result = document.getElementById("result");
        return (acts && !acts.classList.contains("off") && vis("#acts [data-a=hit]")) || (result && !result.hidden);
      }, null, { timeout: 60000, polling: 300 });
      await shot(page, shots, "blackjack3d-deal");
      if (await visible(page, "#acts [data-a=stand]") && !(await page.locator("#acts").evaluate((e) => e.classList.contains("off")))) {
        await page.click("#acts [data-a=stand]");
        await page.waitForFunction(() => { const r = document.getElementById("result"); return r && !r.hidden; }, null, { timeout: 60000, polling: 300 });
      }
      assert(!page.errors.length, page.errors.slice(0, 3).join(" | "));
    } finally { await page.closeAll(); }
  },
});

// ---- Aterf roulette (preview, fast betting, always a VIP bonus so the round has a bonus screen) ----
const ATERF = "aterf.html?preview&fast&force=vip";
// in-page recorder: every 100 ms note whether the close-up (#cine) is on and which bonus tables (.pot) are visible
const RECORDER = () => {
  const vis = (e) => !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 1;
  const w = (window.__rec = { cineOn: false, cineSeenOn: false, potsOutside: 0, potsInside: 0, bonusBoxSeen: false, bigClock: [] });
  setInterval(() => {
    const cine = document.getElementById("cine"), on = vis(cine), pots = [...document.querySelectorAll(".pot")].filter(vis).length;
    w.cineOn = on; if (on) w.cineSeenOn = true;
    if (pots) { if (on) w.potsInside++; else w.potsOutside++; }
    if (vis(document.getElementById("bonusBox"))) w.bonusBoxSeen = true;
    const b = document.querySelector("#bigClock b"); if (b) { const t = b.textContent.trim(); if (w.bigClock[w.bigClock.length - 1] !== t) w.bigClock.push(t); }
  }, 100);
};

tests.push({
  name: "aterf: bonus tables only in close-up",
  timeout: 150000,
  async run({ browser, base, shots }) {
    const page = await newPage(browser, base, { mock: false });
    try {
      await page.goto(base + ATERF, { waitUntil: "domcontentloaded" });
      await waitLoaded(page, 60000); await enter(page);
      await page.evaluate(RECORDER);
      // wait until the close-up has been on and is off again (ball landed)
      await page.waitForFunction(() => window.__rec.cineSeenOn && !window.__rec.cineOn, null, { timeout: 120000, polling: 300 });
      const r = await page.evaluate(() => window.__rec);
      await shot(page, shots, "aterf-after-closeup");
      assert(r.potsInside > 0, "the bonus tables never showed in the close-up");
      assert(r.potsOutside === 0, `the bonus tables showed outside the close-up (${r.potsOutside} samples)`);
      assert(!page.errors.length, page.errors.slice(0, 3).join(" | "));
    } finally { await page.closeAll(); }
  },
});

tests.push({
  name: "aterf: new round starts empty",
  timeout: 260000,
  async run({ browser, base, shots }) {
    const page = await newPage(browser, base, { mock: false });
    try {
      await page.goto(base + ATERF, { waitUntil: "domcontentloaded" });
      await waitLoaded(page, 60000); await enter(page);
      await page.evaluate(RECORDER);
      // round 1: wait for a betting window with enough time left (the page's own state tells the phase), bet on a number (the live table sends it by itself)
      await page.waitForFunction(() => { const S = window.__atf && window.__atf.S; return S && S.phase === "betting" && Date.parse(S.deadline) - Date.now() > 4500; }, null, { timeout: 120000, polling: 150 });
      const id1 = await page.evaluate(() => window.__atf.S.id);
      await clickAt(page, '#board .cell[data-k="17"]');
      await page.waitForFunction(() => document.querySelectorAll("#chipLayer .chip").length > 0, null, { timeout: 4000 });
      await page.waitForFunction(() => window.__atf.sent.size > 0, null, { timeout: 5000 });
      const had = await page.evaluate(() => ({ chips: document.querySelectorAll("#chipLayer .chip").length, total: document.getElementById("total").textContent }));
      assert(had.chips > 0, "round 1: the bet chip is not on the board");
      // wait for round 1 to run through its bonus and for the NEXT betting window to open
      await page.waitForFunction((id) => { const S = window.__atf.S; return S && S.id !== id && S.phase === "betting" && window.__rec.bonusBoxSeen; }, id1, { timeout: 170000, polling: 300 });
      await page.waitForTimeout(500);
      const now = await page.evaluate(() => {
        const vis = (e) => !!e && !e.hidden && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 1;
        return { chips: document.querySelectorAll("#chipLayer .chip").length, total: document.getElementById("total").textContent, pockets: document.querySelectorAll("#board .pocket").length,
          bonusBox: vis(document.getElementById("bonusBox")), pots: [...document.querySelectorAll(".pot")].filter(vis).length, result: vis(document.getElementById("resultCard")) };
      });
      await shot(page, shots, "aterf-new-round");
      assert(now.chips === 0, `new round still has ${now.chips} chip(s) on the board`);
      assert(!/[1-9]/.test(now.total), `new round total is ${now.total}`);
      assert(now.pockets === 0, `new round still shows ${now.pockets} bonus pocket(s)`);
      assert(!now.bonusBox && now.pots === 0 && !now.result, `new round still shows old bonus/result (box=${now.bonusBox}, pots=${now.pots}, result=${now.result})`);
      assert(!page.errors.length, page.errors.slice(0, 3).join(" | "));
    } finally { await page.closeAll(); }
  },
});

module.exports = { tests };
