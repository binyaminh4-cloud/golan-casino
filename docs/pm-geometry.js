(function (root) {
  const speed = { easy: 1.2, normal: 1.8, extreme: 5.7 };
  function limit(angle, margin = 40) {
    const dx = Math.sin(angle), dy = Math.cos(angle);
    return Math.min(dx > 0 ? (1920 - margin - 1000) / dx : dx < 0 ? (margin - 1000) / dx : Infinity,
      dy > 0 ? (1080 - margin - 280) / dy : Infinity);
  }
  // Food moves horizontally inside its own aiming lane; bombs stay fixed.
  // Adjacent food phases are close so targets cannot exchange lanes.
  function position(index, time = 0, moving = false) {
    const a = -1.35 + index * 2.7 / 11;
    return { x: 1000 + Math.sin(a) * 620 + (moving ? 36 * Math.sin(time * 1.7 + index * .4) : 0), y: 280 + Math.cos(a) * 620 };
  }
  function hit(rocks, layer, angle) {
    const dx = Math.sin(angle), dy = Math.cos(angle); let best = null;
    if (dy <= 0) return null;
    for (const k of rocks) {
      if (k.taken || k.layer !== layer) continue;
      const vx = k.x - 1000, vy = k.y - 280, t = vx * dx + vy * dy, d2 = vx * vx + vy * vy - t * t;
      if (t > 0 && d2 <= (k.w * .52 + 7) ** 2 && (!best || t < best.distance)) best = { rock: k, distance: t };
    }
    return best;
  }
  root.PM_GEOMETRY = { speed, limit, position, hit };
})(typeof window === "undefined" ? globalThis : window);
