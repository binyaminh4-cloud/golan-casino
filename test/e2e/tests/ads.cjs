// "Out of money" ad offer: it can be closed with the X (and the X never opens the ads page), and it never shows inside a challenge (?ch=).
const { newPage, assert } = require("../lib.cjs");
const tests = [];
const say = (page) => page.evaluate(() => { const d = document.createElement("div"); d.id = "t" + Math.random(); d.textContent = "אין מספיק שקלים"; document.body.appendChild(d); });

tests.push({
  name: "ads offer: the X closes it, no jump to ads",
  timeout: 60000,
  async run({ browser, base }) {
    const page = await newPage(browser, base, { mock: true });
    try {
      await page.goto(base + "slots.html", { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
      const url = page.url();
      await say(page);
      await page.waitForSelector("#adNudge", { timeout: 5000 });
      const b = await page.locator("#adNudge button").boundingBox(); assert(b && b.width >= 40 && b.height >= 36, "the X is too small to tap");
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForFunction(() => !document.getElementById("adNudge"), null, { timeout: 3000 });
      await page.waitForTimeout(500);
      assert(page.url() === url, "tapping the X left the page: " + page.url());
      assert(!(await page.$("#adNudge")), "the offer came back right after closing");
    } finally { await page.closeAll(); }
  },
});

tests.push({
  name: "ads offer: never inside a challenge",
  timeout: 60000,
  async run({ browser, base }) {
    const page = await newPage(browser, base, { mock: true });
    try {
      await page.goto(base + "slots.html?ch=test", { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
      await say(page); await page.waitForTimeout(1500);
      assert(!(await page.$("#adNudge")), "the ads offer showed up inside a challenge");
    } finally { await page.closeAll(); }
  },
});
module.exports = { tests };
