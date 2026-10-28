// המערב הפרוע של הגולן — deterministic engine (local profile inspired by Wanted Dead or a Wild; not the original math).
// 5×5, 15 lines, horse Wilds, VS duel symbols that turn a whole column wild with ×2..×100 when that makes a win,
// three bonuses: סוס הפרא (sticky wilds), ראש בראש (more duels), התפרצות הר געש (collect, then 3 decisive spins). Max 12,500×.
(function (root, factory) { const api = factory(); if (typeof module === "object" && module.exports) module.exports = api; else root.WWEngine = api; })(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const R5 = 5, LOW = ["J", "Q", "K", "A"], HIGH = ["horseshoe", "boot", "hat", "revolver", "coin", "bull"], W = "horse_wild", VS = "duel";
  const SC = { horse: "horse_scatter", duel: "duel_scatter", volcano: "volcano_scatter" };
  const LINES = [[0,0,0,0,0],[1,1,1,1,1],[2,2,2,2,2],[3,3,3,3,3],[4,4,4,4,4],[0,1,2,1,0],[4,3,2,3,4],[1,2,3,2,1],[3,2,1,2,3],[0,1,0,1,0],[4,3,4,3,4],[2,1,0,1,2],[2,3,4,3,2],[1,0,1,0,1],[3,4,3,4,3]];
  const CFG = {
    w: { J: 20, Q: 19, K: 17, A: 16, horseshoe: 11, boot: 10, hat: 9, revolver: 7, coin: 5, bull: 4, horse_wild: 2.2, duel: 0.9, horse_scatter: 1.5, duel_scatter: 1.5, volcano_scatter: 1.5 },
    pay: { J: [0.1, 0.25, 0.75], Q: [0.1, 0.25, 0.75], K: [0.15, 0.3, 1], A: [0.15, 0.3, 1], horseshoe: [0.2, 0.5, 1.5], boot: [0.25, 0.75, 2], hat: [0.3, 1, 2.5],
           revolver: [0.4, 1.25, 3.5], coin: [0.5, 1.5, 5], bull: [0.75, 2.5, 7.5] },
    duelM: [[2, 30], [3, 22], [5, 18], [7, 12], [10, 9], [20, 5], [50, 3], [100, 1]],
    payScale: 1.15, bs: { horse: 1.6, duel: 1.5, volcano: 7.5 }, stickyW: 6,   // calibrated by simulation: ≈96%, a bonus ≈ every 217 spins (local reference ×1.4)
    maxWin: 12500, spins: 10,
  };
  function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function pick(R, w) { let tot = 0; for (const k in w) tot += w[k]; let x = R() * tot; for (const k in w) { x -= w[k]; if (x < 0) return k; } return Object.keys(w).pop(); }
  const pickPair = (R, arr) => { let tot = 0; for (const [, w] of arr) tot += w; let x = R() * tot; for (const [v, w] of arr) { x -= w; if (x < 0) return v; } return arr[0][0]; };
  // grid g[c][r]; one scatter per column at most
  function board(R, w) { const g = []; for (let c = 0; c < R5; c++) { const col = []; let sc = false;
      for (let r = 0; r < R5; r++) { let s = pick(R, w); if (s.endsWith("_scatter")) { if (sc) s = pick(R, { J: 1, Q: 1, K: 1, A: 1 }); sc = true; } if (s === VS && (c === 0)) s = "hat"; col.push(s); } g.push(col); } return g; }
  // line wins given wild cells and column multipliers (column mults add up on a line)
  function lineWins(g, colMult) {
    const wins = []; let total = 0;
    LINES.forEach((L, li) => {
      const cellsym = (c) => g[c][L[c]], isW = (s) => s === W || s === "W";
      let sym = null; for (let c = 0; c < R5; c++) { const s = cellsym(c); if (!isW(s)) { sym = s; break; } }
      if (sym === null) sym = "bull";
      if (!CFG.pay[sym]) return;
      let n = 0; for (let c = 0; c < R5; c++) { const s = cellsym(c); if (s === sym || isW(s)) n++; else break; }
      if (n < 3) return;
      let m = 0; for (let c = 0; c < n; c++) if (colMult[c]) m += colMult[c];
      const p = CFG.pay[sym][n - 3] * (m || 1);
      wins.push({ line: li, sym, n, m: m || 1, pay: p }); total += p;
    });
    return { wins, total };
  }
  // resolve one board: VS columns expand only if that creates (or improves) a win
  function evaluate(R, g, opts = {}) {
    const colMult = [0, 0, 0, 0, 0], duels = [];
    for (let c = 0; c < R5; c++) if (g[c].includes(VS)) {
      const trial = g.map((col, k) => k === c ? col.map(() => "W") : col.slice());
      const base = lineWins(g.map((col) => col.map((s) => s === VS ? "x" : s)), colMult).total;
      const t = lineWins(trial, colMult).total;
      if (t > base) { const m = pickPair(R, opts.duelM || CFG.duelM); colMult[c] = m; g[c] = g[c].map(() => "W"); duels.push({ col: c, m, winner: R() < .5 ? "binyamin" : "ido" }); }
      else g[c] = g[c].map((s) => s === VS ? "x" : s);
    }
    const lw = lineWins(g, colMult);
    return { duels, colMult, ...lw };
  }
  const scCount = (g, type) => g.reduce((n, col) => n + col.filter((s) => s === SC[type]).length, 0);
  function play(seed) {
    const R = rng(seed), steps = []; let total = 0;
    const g = board(R, CFG.w); const shown = g.map((c) => c.slice());
    const ev = evaluate(R, g); total += ev.total * CFG.payScale;
    steps.push({ t: "spin", g: shown, after: g.map((c) => c.slice()), duels: ev.duels, wins: ev.wins, win: ev.total * CFG.payScale });
    let bonus = null; for (const k of ["horse", "duel", "volcano"]) if (scCount(shown, k) >= 3) { bonus = k; break; }
    if (bonus) {
      steps.push({ t: "bonus", kind: bonus, spins: CFG.spins });
      const bw = { ...CFG.w, horse_scatter: 0, duel_scatter: 0, volcano_scatter: 0 };
      if (bonus === "horse") {   // wilds that land stay for the rest of the bonus
        const sticky = new Set();
        for (let s = 1; s <= CFG.spins && total < CFG.maxWin; s++) { const b = board(R, { ...bw, horse_wild: CFG.stickyW });
          for (const k of sticky) { const [c, r] = k.split(",").map(Number); b[c][r] = W; }
          b.forEach((col, c) => col.forEach((x, r) => { if (x === W) sticky.add(c + "," + r); }));
          const shownB = b.map((c) => c.slice()), e = evaluate(R, b), win = e.total * CFG.bs[bonus]; total += win;
          steps.push({ t: "fs", n: s, g: shownB, after: b.map((c) => c.slice()), duels: e.duels, wins: e.wins, win, sticky: [...sticky] }); }
      } else if (bonus === "duel") {   // more duel symbols, bigger duels
        for (let s = 1; s <= CFG.spins && total < CFG.maxWin; s++) { const b = board(R, { ...bw, duel: 4.2 }), shownB = b.map((c) => c.slice());
          const e = evaluate(R, b, { duelM: [[2, 22], [3, 22], [5, 20], [7, 14], [10, 11], [20, 6], [50, 4], [100, 1.5]] }), win = e.total * CFG.bs[bonus]; total += win;
          steps.push({ t: "fs", n: s, g: shownB, after: b.map((c) => c.slice()), duels: e.duels, wins: e.wins, win }); }
      } else {   // volcano: 7 collecting spins (wilds and duel multipliers pile up), then 3 decisive spins with them scattered anew
        let wilds = 0, mult = 1;
        for (let s = 1; s <= 7; s++) { const b = board(R, { ...bw, horse_wild: 2.8, duel: 1.6 }), shownB = b.map((c) => c.slice());
          const nw = b.flat().filter((x) => x === W).length; const nd = b.flat().filter((x) => x === VS).length; wilds += nw;
          let add = 0; for (let k = 0; k < nd; k++) add += pickPair(R, [[1, 50], [2, 30], [3, 15], [5, 5]]); mult += add;
          const e = evaluate(R, b), win = e.total * CFG.bs[bonus]; total += win;
          steps.push({ t: "fs", n: s, g: shownB, after: b.map((c) => c.slice()), duels: e.duels, wins: e.wins, win, collect: { wilds, mult, add, nw } }); }
        for (let s = 8; s <= 10 && total < CFG.maxWin; s++) { const b = board(R, { ...bw, duel: 0 }); const cellsAll = []; for (let c = 0; c < 5; c++) for (let r = 0; r < 5; r++) cellsAll.push([c, r]);
          for (let i = cellsAll.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [cellsAll[i], cellsAll[j]] = [cellsAll[j], cellsAll[i]]; }
          const place = cellsAll.slice(0, Math.min(wilds, 12)); for (const [c, r] of place) b[c][r] = W;
          const lw = lineWins(b, [0, 0, 0, 0, 0]), win = lw.total * mult * CFG.bs[bonus]; total += win;
          steps.push({ t: "fs", n: s, g: b.map((c) => c.slice()), after: b.map((c) => c.slice()), duels: [], wins: lw.wins, win, decisive: { mult, placed: place } }); }
      }
      steps.push({ t: "bonus_end" });
    }
    const capped = total >= CFG.maxWin; total = Math.min(Math.round(total * 100) / 100, CFG.maxWin);
    return { seed, total, bonus, capped, steps };
  }
  return { CFG, LINES, play };
});
