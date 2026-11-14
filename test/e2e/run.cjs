#!/usr/bin/env node
// One command: node test/e2e/run.cjs   (see README.md)
//   --repeat N   run every test N times (default 1; use 3 to check stability)
//   --only TEXT  only tests whose name contains TEXT
//   --shots DIR  save a screenshot at the end of each game test (default /tmp/gc-e2e)
const fs = require("fs"), path = require("path");
const { startServer, launch } = require("./lib.cjs");

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true); };
const REPEAT = +arg("repeat", 1), ONLY = arg("only", ""), SHOTS = arg("shots", "/tmp/gc-e2e");
const QUARANTINE = JSON.parse(fs.readFileSync(path.join(__dirname, "quarantine.json"), "utf8"));
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const smoke = require("./tests/smoke.cjs"), games = require("./tests/games.cjs"), boards = require("./tests/boards.cjs");
  const all = [...smoke.tests, ...games.tests, ...boards.tests].filter((t) => !ONLY || t.name.includes(ONLY));
  const run = all.filter((t) => !QUARANTINE[t.name]), skipped = all.filter((t) => QUARANTINE[t.name]);
  const { base, close } = await startServer(), browser = await launch();
  const results = new Map(); let failed = 0;
  console.log(`${run.length} tests x ${REPEAT}${skipped.length ? `, ${skipped.length} quarantined` : ""}\n`);
  try {
    for (const t of run) {            // one page at a time, never in parallel
      const res = [];
      for (let i = 0; i < REPEAT; i++) {
        const t0 = Date.now();
        try { await Promise.race([t.run({ browser, base, shots: SHOTS }), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout " + (t.timeout || 90000) / 1000 + "s")), t.timeout || 90000))]); res.push({ ok: true, ms: Date.now() - t0 }); }
        catch (e) { res.push({ ok: false, ms: Date.now() - t0, err: (e.message || String(e)).split("\n")[0].slice(0, 220) }); }
      }
      results.set(t.name, res);
      const pass = res.filter((r) => r.ok).length; if (pass < REPEAT) failed++;
      console.log(`${pass === REPEAT ? "PASS" : "FAIL"} ${pass}/${REPEAT}  ${t.name}  (${Math.round(res.reduce((s, r) => s + r.ms, 0) / res.length / 100) / 10}s)`);
      for (const r of res) if (!r.ok) console.log("     " + r.err);
    }
  } finally { await browser.close(); await close(); }
  if (skipped.length) { console.log("\nQuarantined (not run):"); for (const t of skipped) console.log(`  ${t.name}: ${QUARANTINE[t.name]}`); }
  console.log(`\nPages without ?preview (listed, not opened): ${smoke.listed.join(" ") || "-"}`);
  console.log(failed ? `\n${failed} test(s) failed` : `\nall ${run.length} tests passed${REPEAT > 1 ? " every time" : ""}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
