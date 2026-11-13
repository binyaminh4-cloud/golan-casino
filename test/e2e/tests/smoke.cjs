// Quick check: every page that has a ?preview mode loads with no JS errors, no console errors and no missing files.
// Pages without a preview mode are not opened - they are only listed (see `listed` in the report).
const fs = require("fs"), path = require("path");
const { DOCS, newPage, waitLoaded, assert } = require("../lib.cjs");

// Shared scripts mention "preview" for every page, so they do not count as a page's own preview mode.
const SHARED = /^(loader|sfx|chat|guide|voice|landscape|portrait|config|lobby-ui|app|install|version|sw)\b/;
const PREVIEW_RE = /[?#&]preview|has\(["']preview["']\)|get\(["']preview["']\)/;

function discover() {
  const withPreview = [], without = [];
  for (const f of fs.readdirSync(DOCS).filter((x) => x.endsWith(".html")).sort()) {
    const html = fs.readFileSync(path.join(DOCS, f), "utf8");
    const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^":]+?\.m?js)(?:\?[^"]*)?"/g)].map((m) => m[1]).filter((s) => !SHARED.test(path.basename(s)));
    const text = html + scripts.map((s) => { try { return fs.readFileSync(path.join(DOCS, s), "utf8"); } catch (e) { return ""; } }).join("\n");
    (PREVIEW_RE.test(text) ? withPreview : without).push(f);
  }
  return { withPreview, without };
}

const { withPreview, without } = discover();
const tests = withPreview.map((f) => ({
  name: "smoke:" + f.replace(".html", ""),
  async run({ browser, base }) {
    const page = await newPage(browser, base, { mock: false });
    try {
      await page.goto(base + f + "?preview", { waitUntil: "domcontentloaded" });
      await waitLoaded(page);
      await page.waitForTimeout(1500);
      assert(!page.errors.length, page.errors.slice(0, 4).join(" | "));
    } finally { await page.closeAll(); }
  },
}));
module.exports = { tests, listed: without };
