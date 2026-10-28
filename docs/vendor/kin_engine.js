// על האש בכינרת — deterministic game engine (same code in the simulator and in the browser).
// A round is fully determined by its seed: the server picks a seed (with its known total) and the browser replays it.
(function (root, factory) { const api = factory(); if (typeof module === "object" && module.exports) module.exports = api; else root.KinEngine = api; })(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const N = 7, REG = ["pita", "kebab", "chicken", "steak", "burger", "beer"], WILD = "mushroom_wild", PLATE = "plate_wild", SC = "scatter";
  const CFG = {
    weights: { pita: 30, kebab: 26, chicken: 18, steak: 12, burger: 9, beer: 5, scatter: 0.85 },
    payScale: 0.62, fsScale: 0.043,   // calibrated by simulation (see test/kin_sim)
    // pay (× stake) by cluster size 5..15+ for each symbol
    pay: { pita: [0.1, 0.12, 0.15, 0.2, 0.3, 0.4, 0.6, 0.8, 1, 1.5, 2.5], kebab: [0.12, 0.15, 0.2, 0.25, 0.35, 0.5, 0.7, 1, 1.2, 1.8, 3],
           chicken: [0.15, 0.2, 0.25, 0.3, 0.45, 0.6, 0.9, 1.2, 1.5, 2.2, 4], steak: [0.2, 0.25, 0.3, 0.4, 0.6, 0.8, 1.2, 1.6, 2, 3, 5],
           burger: [0.25, 0.3, 0.4, 0.5, 0.8, 1, 1.5, 2, 2.5, 4, 7], beer: [0.4, 0.5, 0.6, 0.8, 1.2, 1.6, 2.4, 3, 4, 6, 10] },
    order: ["fisher", "avichai", "yoav", "roy", "binyamin", "ido", "harel"],
    fs: { 3: 10, 4: 15, 5: 20 }, retrig: { 2: 3, 3: 5 }, maxFs: 60, maxStages: 60, maxWin: 5000, maxCell: 8,
  };
  function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function pick(R, w) { const keys = Object.keys(w); let tot = 0; for (const k of keys) tot += w[k]; let x = R() * tot; for (const k of keys) { x -= w[k]; if (x < 0) return k; } return keys[keys.length - 1]; }
  const idx = (r, c) => r * N + c, rc = (i) => [Math.floor(i / N), i % N];
  function newBoard(R, inFs) { const b = []; for (let i = 0; i < N * N; i++) b.push(pick(R, CFG.weights)); return b; }
  function payFor(sym, n) { const p = CFG.pay[sym]; return p[Math.min(n, 15) - 5]; }
  // clusters: for each regular symbol (richest first), orthogonal groups of that symbol + wilds, ≥5 and ≥1 real symbol; a wild serves one cluster
  function findClusters(b) {
    const used = new Set(), out = [];
    for (const s of REG.slice().reverse()) {
      const seen = new Set();
      for (let i = 0; i < N * N; i++) {
        if (b[i] !== s || seen.has(i) || used.has(i)) continue;
        const comp = [], st = [i]; seen.add(i);
        while (st.length) { const j = st.pop(); comp.push(j); const [r, c] = rc(j);
          for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= N || cc >= N) continue; const k = idx(rr, cc);
            if (seen.has(k) || used.has(k)) continue; if (b[k] === s || b[k] === WILD || b[k] === PLATE) { seen.add(k); st.push(k); } } }
        if (comp.length >= 5) { comp.forEach((k) => used.add(k)); out.push({ sym: s, cells: comp.sort((x, y) => x - y) }); }
      }
    }
    return out;
  }
  function gravity(R, b) {   // remove nulls, drop down, refill from the top
    for (let c = 0; c < N; c++) { const col = []; for (let r = N - 1; r >= 0; r--) if (b[idx(r, c)] !== null) col.push(b[idx(r, c)]);
      for (let r = N - 1, k = 0; r >= 0; r--, k++) b[idx(r, c)] = k < col.length ? col[k] : pick(R, CFG.weights); }
  }
  // one spin (paid or free). state carries cell multipliers / friend meter across free spins.
  function spin(R, st, steps) {
    const b = newBoard(R); let win = 0, stages = 0;
    steps.push({ t: "board", b: b.slice(), m: st.m.slice(), meter: st.meter, next: st.next });
    const resolve = () => {   // cascades until the board is quiet; returns number of winning stages
      let n = 0;
      for (;;) {
        if (stages >= CFG.maxStages) break;
        const cl = findClusters(b); if (!cl.length) break;
        let stagePay = 0; const parts = [];
        for (const k of cl) { const act = k.cells.map((i) => st.m[i]).filter((v) => v >= 2), f = act.length ? act.reduce((a, v) => a + v, 0) : 1;
          const p = Math.round(payFor(k.sym, k.cells.length) * f * CFG.payScale * (st.fs ? CFG.fsScale : 1) * 100) / 100; stagePay += p; parts.push({ sym: k.sym, cells: k.cells, f, pay: p }); }
        for (const k of cl) for (const i of k.cells) { st.m[i] = st.m[i] === 0 ? 1 : st.m[i] === 1 ? 2 : Math.min(CFG.maxCell, st.m[i] * 2); b[i] = null; }
        win += stagePay; n++; stages++;
        st.meter++;
        steps.push({ t: "win", parts, pay: stagePay, m: st.m.slice(), meter: st.meter });
        gravity(R, b); steps.push({ t: "drop", b: b.slice() });
        while (st.meter >= 3) { st.meter -= 3; ability(R, st, b, steps, resolve); }
      }
      return n;
    };
    resolve();
    const sc = b.filter((x) => x === SC).length;
    return { win, sc };
  }
  function ability(R, st, b, steps, resolve) {
    const who = CFG.order[st.next]; st.next = (st.next + 1) % CFG.order.length;
    const fx = { t: "friend", who, cells: [] };
    const regCells = () => b.map((x, i) => REG.includes(x) ? i : -1).filter((i) => i >= 0);
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    if (who === "fisher") { for (const i of shuffle(regCells().filter((i) => b[i] !== "kebab")).slice(0, 4)) { b[i] = "kebab"; fx.cells.push(i); } }
    else if (who === "avichai") { b.forEach((x, i) => { if (x === "pita") { b[i] = WILD; fx.cells.push(i); } }); }
    else if (who === "yoav") { const ok = []; for (let r = 0; r <= N - 3; r++) for (let c = 0; c <= N - 3; c++) { let good = true; for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) if (b[idx(r + dr, c + dc)] === SC) good = false; if (good) ok.push([r, c]); }
      if (ok.length) { const [r, c] = ok[Math.floor(R() * ok.length)]; for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) { b[idx(r + dr, c + dc)] = PLATE; fx.cells.push(idx(r + dr, c + dc)); } } }
    else if (who === "roy") { for (const i of shuffle([...Array(N * N).keys()]).slice(0, 4)) { st.m[i] = st.m[i] >= 2 ? Math.min(CFG.maxCell, st.m[i] * 2) : 2; fx.cells.push(i); } }
    else if (who === "binyamin") { const src = b.map((x, i) => x === "burger" ? i : -1).filter((i) => i >= 0);
      for (const i of src) { const [r, c] = rc(i), opts = [];
        for (const [a, d] of [[[0, 1], [0, 2]], [[0, -1], [0, 1]], [[0, -2], [0, -1]], [[1, 0], [2, 0]], [[-1, 0], [1, 0]], [[-2, 0], [-1, 0]]]) {
          const cells = [a, d].map(([dr, dc]) => [r + dr, c + dc]); if (cells.every(([rr, cc]) => rr >= 0 && cc >= 0 && rr < N && cc < N && REG.includes(b[idx(rr, cc)]))) opts.push(cells.map(([rr, cc]) => idx(rr, cc))); }
        if (opts.length) for (const k of opts[Math.floor(R() * opts.length)]) { if (b[k] !== "burger") { b[k] = "burger"; fx.cells.push(k); } } } }
    else if (who === "ido") { for (const i of shuffle([...Array(N * N).keys()]).slice(0, 3)) { st.m[i] = st.m[i] >= 2 ? st.m[i] + 23 : 23; fx.cells.push(i); } }
    else if (who === "harel") { fx.waves = [];
      for (let w = 0; w < 2; w++) { const present = REG.filter((s) => b.includes(s)); if (!present.length) break; const s = present[Math.floor(R() * present.length)];
        b.forEach((x, i) => { if (x === s) b[i] = null; }); gravity(R, b); fx.waves.push({ sym: s, b: b.slice() }); } }
    fx.b = b.slice(); fx.m = st.m.slice(); steps.push(fx);
    resolve();
  }
  function play(seed) {
    const R = rng(seed), steps = [], st = { m: Array(N * N).fill(0), meter: 0, next: 0 };
    const base = spin(R, st, steps); let total = base.win, fsAward = 0;
    steps.push({ t: "end", win: base.win, sc: base.sc });
    if (base.sc >= 3) {
      let left = CFG.fs[Math.min(base.sc, 5)], played = 0; fsAward = left;
      const fst = { m: Array(N * N).fill(0), meter: 0, next: 0, fs: true };
      steps.push({ t: "fs_start", spins: left });
      while (left > 0 && played < CFG.maxFs && total < CFG.maxWin) {
        left--; played++; steps.push({ t: "fs_spin", n: played, left });
        const r = spin(R, fst, steps); total += r.win;
        const add = r.sc >= 3 ? CFG.retrig[3] : r.sc === 2 ? CFG.retrig[2] : 0; if (add) { left += add; fsAward += add; }
        steps.push({ t: "end", win: r.win, sc: r.sc, add, left });
      }
      steps.push({ t: "fs_end", spins: played });
    }
    total = Math.min(Math.round(total * 100) / 100, CFG.maxWin);
    return { seed, total, fs: fsAward, steps };
  }
  return { N, REG, CFG, play, findClusters };
});
