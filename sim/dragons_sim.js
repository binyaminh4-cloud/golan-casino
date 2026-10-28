// RTP simulation for docs/vendor/dg_engine.js: node sim/dragons_sim.js [n]
const E = require("../docs/vendor/dg_engine.js"); const n = +process.argv[2] || 300000;
let hits = 0, tot = 0, base = 0, bon = 0, nb = 0, big = 0, max = 0;
for (let i = 0; i < n; i++) { const r = E.play(i * 7919 + 13); tot += r.total; if (r.bonus) { nb++; bon += r.steps[r.steps.length - 1].sum; } else base += r.total; if (r.total >= 50) big++; if (r.total > 0) hits++; max = Math.max(max, r.total); }
console.log("RTP", (tot / n).toFixed(4), "base", ((tot - bon) / n).toFixed(4), "bonus", (bon / n).toFixed(4), "bonus 1 in", (n / nb).toFixed(0), "avg bonus ×", (bon / nb).toFixed(1), "≥50× 1 in", (n / big).toFixed(0), "max", max, "hit 1 in", (n / hits).toFixed(2));
let bt = 0, bs = []; for (let i = 0; i < 40000; i++) { const t = E.play(i * 104729 + 7, { buy: 1 }).total; bt += t; bs.push(t); } bs.sort((a, b) => a - b);
console.log("buy mean ×", (bt / 40000).toFixed(2), "p10", bs[4000], "p50", bs[20000], "p90", bs[36000], "p99", bs[39600]);
