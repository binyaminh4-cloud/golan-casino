(function (root) {
  const speed = { easy: 1.2, normal: 1.8, extreme: 5.7 };
  function limit(angle, margin = 40) {
    const dx = Math.sin(angle), dy = Math.cos(angle);
    return Math.min(dx > 0 ? (1920 - margin - 1000) / dx : dx < 0 ? (margin - 1000) / dx : Infinity,
      dy > 0 ? (1080 - margin - 280) / dy : Infinity);
  }
  // Two independent oscillations produce diagonal/curved movement for every
  // item. Bounded aiming lanes keep food reachable and sprites inside the field.
  function position(index, time = 0, moving = false) {
    const a = -1.35 + index * 2.7 / 11 + (moving ? .10 * Math.sin(time * 2.55 + index * .85) : 0);
    const radius = 620 + (moving ? 64 * Math.sin(time * 3.45 + index * 1.31) : 0);
    return { x: 1000 + Math.sin(a) * radius, y: 280 + Math.cos(a) * radius };
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
  // Swept relative collision, substepped at 120Hz: fast frames cannot jump
  // through an item. Return the FIRST physical contact, not a click-time pick.
  function sweep(rocks, layer, angle, from, to, timeFrom, timeTo) {
    const dx = Math.sin(angle), dy = Math.cos(angle), steps = Math.max(1, Math.ceil((timeTo - timeFrom) * 120));
    for (let step = 0; step < steps; step++) {
      const f0 = step / steps, f1 = (step + 1) / steps, l0 = from + (to - from) * f0, l1 = from + (to - from) * f1;
      let best = null;
      for (const rock of rocks) {
        if (rock.taken || rock.layer !== layer) continue;
        const p0 = position(rock.id % 12, timeFrom + (timeTo - timeFrom) * f0, true);
        const p1 = position(rock.id % 12, timeFrom + (timeTo - timeFrom) * f1, true);
        const x = 1000 + dx * l0 - p0.x, y = 280 + dy * l0 - p0.y;
        const vx = dx * (l1 - l0) - (p1.x - p0.x), vy = dy * (l1 - l0) - (p1.y - p0.y);
        const radius = rock.w * .52 + 7, c = x * x + y * y - radius * radius, a = vx * vx + vy * vy, b = 2 * (x * vx + y * vy);
        const disc = b * b - 4 * a * c;
        const f = c <= 0 ? 0 : a > 0 && disc >= 0 ? (-b - Math.sqrt(disc)) / (2 * a) : -1;
        if (f >= 0 && f <= 1 && (!best || f < best.local)) {
          const fraction = f0 + f / steps;
          best = { rock, local: f, fraction, distance: from + (to - from) * fraction };
        }
      }
      if (best) return best;
    }
    return null;
  }
  root.PM_GEOMETRY = { speed, limit, position, hit, sweep };
})(typeof window === "undefined" ? globalThis : window);
