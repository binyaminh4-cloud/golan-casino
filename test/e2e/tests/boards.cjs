// Roulette 3D: splits and corners on the regular layout, the neighbours board (racetrack), and switching between them.
// Aterf: the same switch fades the board instead of jumping.
const { newPage, waitLoaded, enter, assert } = require("../lib.cjs");
const shot = async (page, shots, name) => { try { await page.screenshot({ path: `${shots}/${name}.png` }); } catch (e) {} };
const tests = [];

tests.push({
  name: "roulette3d: splits, corners and the neighbours board",
  timeout: 150000,
  async run({ browser, base, shots }) {
    const page = await newPage(browser, base, { mock: false });
    try {
      await page.goto(base + "roulette3d.html?preview", { waitUntil: "domcontentloaded" });
      await waitLoaded(page, 60000); await enter(page);
      await page.waitForFunction(() => window.__r3d, null, { timeout: 60000 });
      // tap a felt point (metres) through the real camera, wait for the hand to drop the chip
      const tap = async (x, z, keys) => {
        const s = await page.evaluate(([x, z]) => window.__r3d.toScreen(x, z), [x, z]); await page.mouse.click(s.x, s.y);
        await page.waitForFunction((n) => window.__r3d.bets.size >= n, keys, { timeout: 20000, polling: 100 });
      };
      const X0 = -0.62, CW = 0.12, ZF = -0.36, CH = 0.115;
      await tap(X0 + CW * 1, ZF + CH * 0.5, 1);       // line between 3 and 6
      await tap(X0 + CW * 2, ZF + CH * 1, 2);         // where 5, 6, 8, 9 meet
      await tap(X0 + CW * 4.5, ZF + CH * 1.5, 3);     // inside 14
      const keys = await page.evaluate(() => [...window.__r3d.bets.keys()].sort());
      assert(JSON.stringify(keys) === JSON.stringify(["14", "3,6", "5,6,8,9"]), "table bets: " + keys.join(" | "));
      await shot(page, shots, "roulette3d-splits");

      await page.click("#viewBtn");
      await page.waitForFunction(() => window.__r3d.view === "race" && window.__r3d.vb === 1, null, { timeout: 20000 });
      const q = await page.evaluate(() => window.__r3d.RACE[17]);
      await tap(q.x, q.z, 8);                          // 17 with 2 neighbours each side: 2 25 17 34 6
      const n = await page.evaluate(() => Object.fromEntries(window.__r3d.bets));
      for (const k of ["2", "25", "17", "34", "6"]) assert(n[k] > 0, "neighbour missing: " + k);
      await shot(page, shots, "roulette3d-race");
      await page.click("#undo");                       // one undo takes the whole neighbours bet back
      assert(await page.evaluate(() => window.__r3d.bets.size) === 3, "undo did not take back the neighbours bet");
      await page.click("#viewBtn");
      await page.waitForFunction(() => window.__r3d.view === "table" && window.__r3d.vb === 0, null, { timeout: 20000 });
      assert(await page.evaluate(() => window.__r3d.bets.size) === 3, "bets lost when switching back");
      assert(!page.errors.length, page.errors.slice(0, 3).join(" | "));
    } finally { await page.closeAll(); }
  },
});

tests.push({
  name: "aterf: switching to the neighbours board fades, no jump",
  timeout: 120000,
  async run({ browser, base, shots }) {
    const page = await newPage(browser, base, { mock: false });
    try {
      await page.goto(base + "aterf.html?preview&fast", { waitUntil: "domcontentloaded" });
      await waitLoaded(page, 60000); await enter(page);
      // the board must really animate: an opacity transition out and another back in (not an instant swap)
      await page.evaluate(() => { const b = document.getElementById("board"); window.__tr = [];
        b.addEventListener("transitionstart", (e) => { if (e.target === b && e.propertyName === "opacity") window.__tr.push("start"); });
        b.addEventListener("transitionend", (e) => { if (e.target === b && e.propertyName === "opacity") window.__tr.push("end"); });
        document.getElementById("viewRace").click(); });
      await page.waitForFunction(() => document.querySelectorAll("#board .rc").length === 37 && window.__tr.filter((x) => x === "end").length >= 2, null, { timeout: 15000, polling: 100 });
      assert(await page.evaluate(() => getComputedStyle(document.getElementById("board")).opacity) === "1", "board not back to full");
      await shot(page, shots, "aterf-race");
      assert(!page.errors.length, page.errors.slice(0, 3).join(" | "));
    } finally { await page.closeAll(); }
  },
});

module.exports = { tests };
