// דרקוני הגולן LINK — deterministic engine (same code in the simulator and in the browser).
// 5 reels × 3 rows, 25 lines. Dragon = wild. Fire orbs carry a value (× total bet) or a jackpot label.
// 6+ orbs start "Hold & Win": orbs lock, 3 respins, every new orb resets the counter to 3; all 15 cells = GRAND.
// Jackpots are fixed multiples of the bet: MINI ×10, MINOR ×25, MAJOR ×100, GRAND ×1000.
(function (root, factory) { const api = factory(); if (typeof module === "object" && module.exports) module.exports = api; else root.DGEngine = api; })(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const R5 = 5, ROWS = 3, WILD = "dragon", ORB = "orb";
  const CFG = {
    // reel weights (same for all reels; the dragon wild never lands on reel 1)
    weights: { roy: 3, ido: 3, binyamin: 3, yoav: 3, fortune: 4, turtle: 5, ship: 6, lotus: 6, A: 9, K: 9, Q: 10, J: 10, "10": 11, "9": 11, dragon: 2.2, orb: 13.5 },
    // line pays (× line bet) for 3 / 4 / 5 of a kind
    pay: { dragon: [25, 100, 500], roy: [20, 60, 200], ido: [20, 60, 200], binyamin: [20, 60, 200], yoav: [20, 60, 200], fortune: [15, 45, 150],
      turtle: [10, 30, 100], ship: [8, 25, 80], lotus: [8, 25, 80], A: [5, 15, 50], K: [5, 15, 50], Q: [4, 10, 40], J: [4, 10, 40], "10": [3, 8, 30], "9": [3, 8, 30] },
    payScale: 12.6, // calibrated by simulation (sim/dragons_sim.js)
    orbValues: { 1: 40, 2: 25, 3: 14, 5: 9, 8: 5, 10: 3, MINI: 3, MINOR: 0.9, MAJOR: 0.12 },
    orbScale: 1,
    respinOrbChance: 0.075,   // chance for each empty cell to catch an orb on a respin
    trigger: 6, jackpots: { MINI: 10, MINOR: 25, MAJOR: 100, GRAND: 1000 }, maxWin: 2000,
  };
  const LINES = [[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],[0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[0,1,1,1,0],
    [2,1,1,1,2],[1,0,1,2,1],[1,2,1,0,1],[0,1,0,1,0],[2,1,2,1,2],[1,1,0,1,1],[1,1,2,1,1],[0,0,1,0,0],[2,2,1,2,2],[0,2,0,2,0],
    [2,0,2,0,2],[1,0,2,0,1],[1,2,0,2,1],[0,2,2,2,0],[2,0,0,0,2]];
  function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function pick(R, w) { const keys = Object.keys(w); let tot = 0; for (const k of keys) tot += w[k]; let x = R() * tot; for (const k of keys) { x -= w[k]; if (x < 0) return k; } return keys[keys.length - 1]; }
  const orbVal = (R) => { const v = pick(R, CFG.orbValues); return isNaN(+v) ? v : +v; };
  const valueOf = (v) => typeof v === "number" ? v * CFG.orbScale : CFG.jackpots[v];
  // grid[c][r]; orbs[c][r] = value or null
  function spinGrid(R) { const g = [], o = [];
    for (let c = 0; c < R5; c++) { g.push([]); o.push([]); for (let r = 0; r < ROWS; r++) { let s = pick(R, CFG.weights); if (c === 0 && s === WILD) s = "9";
      g[c].push(s); o[c].push(s === ORB ? orbVal(R) : null); } }
    return { g, o }; }
  function lineWins(g) { const wins = []; let tot = 0;
    LINES.forEach((L, li) => { let sym = null, n = 0;
      for (let c = 0; c < R5; c++) { const s = g[c][L[c]]; if (s === ORB) break;
        if (sym === null) { if (s !== WILD) sym = s; n++; continue; }
        if (s === sym || s === WILD) n++; else break; }
      if (sym === null) sym = WILD;
      // all wilds then a symbol: count again treating leading wilds as that symbol
      if (n >= 3 && CFG.pay[sym]) { const p = CFG.pay[sym][n - 3] * CFG.payScale / 25; wins.push({ line: li, n, sym, pay: p }); tot += p; } });
    return { wins, tot }; }
  function play(seed, opts = {}) {
    const R = rng(seed), steps = []; let total = 0;
    let sp;
    if (opts.buy) { // bought bonus: a base spin with exactly 6 orbs
      sp = spinGrid(R); const cells = []; for (let c = 0; c < R5; c++) for (let r = 0; r < ROWS; r++) { if (sp.g[c][r] === ORB) { sp.g[c][r] = "A"; sp.o[c][r] = null; } cells.push([c, r]); }
      for (let k = 0; k < 6; k++) { const i = Math.floor(R() * cells.length), [c, r] = cells.splice(i, 1)[0]; sp.g[c][r] = ORB; sp.o[c][r] = orbVal(R); }
    } else sp = spinGrid(R);
    const lw = opts.buy ? { wins: [], tot: 0 } : lineWins(sp.g); total += lw.tot;
    steps.push({ t: "spin", g: sp.g, o: sp.o, wins: lw.wins, win: lw.tot });
    let count = 0; for (let c = 0; c < R5; c++) for (let r = 0; r < ROWS; r++) if (sp.o[c][r] !== null) count++;
    let bonus = false;
    if (count >= CFG.trigger) { bonus = true;
      const held = sp.o.map((col) => col.slice()); let left = 3; steps.push({ t: "hw_start", held: held.map((c) => c.slice()) });
      while (left > 0) { const fresh = [];
        for (let c = 0; c < R5; c++) for (let r = 0; r < ROWS; r++) if (held[c][r] === null && R() < CFG.respinOrbChance) { held[c][r] = orbVal(R); fresh.push([c, r, held[c][r]]); }
        left = fresh.length ? 3 : left - 1; let n = 0; for (const col of held) for (const v of col) if (v !== null) n++;
        steps.push({ t: "respin", fresh, left, count: n });
        if (n === 15) break; }
      let sum = 0, n = 0; const parts = [];
      for (let c = 0; c < R5; c++) for (let r = 0; r < ROWS; r++) { const v = held[c][r]; if (v === null) continue; n++; sum += valueOf(v); parts.push([c, r, v]); }
      const grand = n === 15; if (grand) sum += CFG.jackpots.GRAND;
      total += sum; steps.push({ t: "hw_end", parts, sum, grand });
    }
    let capped = false; if (total > CFG.maxWin) { total = CFG.maxWin; capped = true; }
    total = Math.round(total * 100) / 100;
    return { steps, total, bonus, capped };
  }
  return { CFG, LINES, play, valueOf };
});
