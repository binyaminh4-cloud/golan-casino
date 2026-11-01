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
