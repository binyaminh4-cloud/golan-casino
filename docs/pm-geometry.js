(function (root) {
  const speed = { easy: 1.2, normal: 1.8, extreme: 5.7 };
  function limit(angle, margin = 40) {
    const dx = Math.sin(angle), dy = Math.cos(angle);
    return Math.min(dx > 0 ? (1920 - margin - 1000) / dx : dx < 0 ? (margin - 1000) / dx : Infinity,
      dy > 0 ? (1080 - margin - 280) / dy : Infinity);
  }
  function position(index) { const a = -1.35 + index * 2.7 / 11; return { x: 1000 + Math.sin(a) * 620, y: 280 + Math.cos(a) * 620 }; }
  root.PM_GEOMETRY = { speed, limit, position };
})(typeof window === "undefined" ? globalThis : window);
