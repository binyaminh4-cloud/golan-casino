// Machine-only ladder: the wallet can fund a whole spin, including its last shekel.
window.GC_SLOT_LADDER = function (min, balance) {
  const max = Math.max(min, Math.floor(Number(balance) || 0)), out = [];
  for (let p = 1; p <= max; p *= 10) for (const m of [1, 2.5, 5]) {
    const v = p * m; if (v >= min && v <= max && Number.isInteger(v)) out.push(v);
  }
  if (out[out.length - 1] !== max) out.push(max);
  return out;
};
window.GC_SLOT_SELECT = function (values, current) {
  if (values.includes(current)) return current;
  const regular = values.filter(v => v <= current && [1, 2.5, 5].includes(v / 10 ** Math.floor(Math.log10(v))));
  return regular.pop() || values[0];
};
// Regular chip steps only (1, 2.5, 5 × 10^k) between min and the wallet. Unlike GC_SLOT_LADDER it never adds the wallet itself.
window.GC_SLOT_REGULAR = function (min, balance) {
  const bal = Math.floor(Number(balance) || 0), out = [];
  for (let p = 1; p <= bal; p *= 10) for (const m of [1, 2.5, 5]) {
    const v = p * m; if (v >= min && v <= bal && Number.isInteger(v)) out.push(v);
  }
  return out;
};
// Same rule as the other games (rl/bj/if/aterf): the chip is offered only if 20 × chip ≤ wallet, except the first `keep` steps,
// which are always shown. Never offers a chip above the wallet. Shows the last `keep` offered chips.
window.GC_SLOT_RACK = function (min, balance, keep = 6) {
  const bal = Math.floor(Number(balance) || 0), all = GC_SLOT_REGULAR(min, bal);
  const ok = all.filter((v, i) => i < keep || v * 20 <= bal);
  return (ok.length ? ok : [min]).slice(-keep);
};
