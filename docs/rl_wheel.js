/* Golan Casino · European roulette wheel.
   Everything with a number on it is drawn here from ORDER (the official single-zero sequence), so the
   pocket order and colours can never drift from the betting layout or the server.
   The ball path is solved backwards from the server's result: whatever happens on the way, at time
   T3 the ball sits in the pocket of `result` and then rides with the rotor. */
(function () {
  const ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
  const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
  const color = (n) => n === 0 ? "green" : RED.has(n) ? "red" : "black";
  const STEP = 360 / 37;
  const IDX = {}; ORDER.forEach((n, i) => IDX[n] = i);

  // geometry, in the 1200x1200 wheel space (centre 600,600). Angles: degrees, clockwise from 12 o'clock.
  const G = { C: 600, rotorR: 372, numIn: 318, numOut: 362, pocketIn: 270, rest: 294, track: 486, hole: 367, ballD: 30, turretD: 300 };
  // timeline (seconds from launch)
  const T = { drop: 5.2, hit: 6.5, settle: 8.9, end: 11.8 };

  const norm = (a) => ((a % 360) + 360) % 360;
  const pocketAt = (localAngle) => ORDER[Math.round(norm(localAngle) / STEP) % 37];

  // ---- motion model (pure; used by the animation and by the tests) ----
  function plan(result, rotor0, rnd) {
    rnd = rnd || Math.random;
    const W0 = 700 + rnd() * 120, tau = 5 + rnd() * 1.2;      // ball: anticlockwise, slowing down
    const R0 = 42 + rnd() * 16, rtau = 30;                    // rotor: clockwise, nearly constant
    const D = T.settle - T.hit;
    const rotor = (t) => rotor0 + R0 * rtau * (1 - Math.exp(-t / rtau));
    const wr = (t) => R0 * Math.exp(-t / rtau);
    const Phi = (t) => -W0 * tau * (1 - Math.exp(-t / tau));
    const wb = (t) => -W0 * Math.exp(-t / tau);
    // relative travel after hitting the rotor, chosen so the speed is continuous at the hit
    const delta = (wr(T.hit) - wb(T.hit)) * D / 2;             // > 0
    const target = STEP * IDX[result];
    const phiHit = rotor(T.hit) + target + delta;
    const phi0 = phiHit - Phi(T.hit);
    const bounces = 2.6 + rnd() * 1.4;
    return { result, rotor, at(t) {
      let phi, r, lift = 0;
      if (t <= T.hit) {
        phi = phi0 + Phi(Math.max(0, t));
        if (t <= T.drop) r = G.track + 2 * Math.sin(t * 9);
        else {
          const s = (t - T.drop) / (T.hit - T.drop);
          r = G.track + (354 - G.track) * Math.pow(s, 1.7);
          if (s > 0.3 && s < 0.6) { const b = Math.sin(Math.PI * (s - 0.3) / 0.3); r += 14 * b; lift = 0.5 * b; }   // deflector
        }
      } else if (t < T.settle) {
        const s = (t - T.hit) / D, g = (1 - s) * (1 - s);
        phi = rotor(t) + target + delta * g;
        const hop = (1 - s) * (1 - s) * Math.abs(Math.cos(Math.PI * bounces * s));
        r = G.rest + 60 * hop; lift = hop;
      } else { phi = rotor(t) + target; r = G.rest; }
      return { rotor: rotor(t), phi, r, lift };
    } };
  }

  // ---- drawing ----
  function drawRotor(cv, img) {
    const S = cv.width, k = S / (2 * G.rotorR), x = cv.getContext("2d");
    x.setTransform(k, 0, 0, k, S / 2, S / 2);
    x.drawImage(img, -G.rotorR, -G.rotorR, 2 * G.rotorR, 2 * G.rotorR);
    const rad = (d) => (d - 90) * Math.PI / 180;
    const fill = { red: ["#C3162B", "#7E0D1A"], black: ["#1A1716", "#050404"], green: ["#127A41", "#06401F"] };
    ORDER.forEach((n, i) => {
      const a0 = rad(i * STEP - STEP / 2), a1 = rad(i * STEP + STEP / 2), [c1, c2] = fill[color(n)];
      x.beginPath(); x.arc(0, 0, G.numOut, a0, a1); x.arc(0, 0, G.numIn, a1, a0, true); x.closePath();
      x.fillStyle = c1; x.fill();
      const gp = x.createRadialGradient(0, 0, G.pocketIn, 0, 0, G.numIn);
      gp.addColorStop(0, c2); gp.addColorStop(0.55, c1); gp.addColorStop(1, c2);
      x.beginPath(); x.arc(0, 0, G.numIn, a0, a1); x.arc(0, 0, G.pocketIn, a1, a0, true); x.closePath();
      x.fillStyle = gp; x.fill();
    });
    const brass = (w) => { const g = x.createLinearGradient(-G.rotorR, -G.rotorR, G.rotorR, G.rotorR);
      g.addColorStop(0, "#F7E3A6"); g.addColorStop(0.5, "#A9802F"); g.addColorStop(1, "#F1D69A"); x.strokeStyle = g; x.lineWidth = w; };
    ORDER.forEach((n, i) => {             // frets between pockets, thin dividers in the number ring
      const a = rad(i * STEP - STEP / 2);
      brass(4.5); x.beginPath(); x.moveTo(Math.cos(a) * G.pocketIn, Math.sin(a) * G.pocketIn); x.lineTo(Math.cos(a) * G.numIn, Math.sin(a) * G.numIn); x.stroke();
      brass(1.6); x.beginPath(); x.moveTo(Math.cos(a) * G.numIn, Math.sin(a) * G.numIn); x.lineTo(Math.cos(a) * G.numOut, Math.sin(a) * G.numOut); x.stroke();
    });
    [[G.pocketIn, 3], [G.numIn, 3], [G.numOut, 3.5]].forEach(([r, w]) => { brass(w); x.beginPath(); x.arc(0, 0, r, 0, 7); x.stroke(); });
    x.fillStyle = "#F5ECDD"; x.textAlign = "center"; x.textBaseline = "middle";
    x.font = "700 27px 'Frank Ruhl Libre', Georgia, serif";
    ORDER.forEach((n, i) => {
      x.save(); x.rotate(i * STEP * Math.PI / 180); x.translate(0, -(G.numIn + G.numOut) / 2);
      x.shadowColor = "rgba(0,0,0,.6)"; x.shadowBlur = 2; x.fillText(String(n), 0, 1.5); x.restore();
    });
  }

  function build(host, base) {
    host.innerHTML = `<div class="rig"><div class="rotorwrap"><canvas class="rotor" width="1600" height="1600"></canvas>
      <img class="turret" src="${base}turret.webp" alt=""></div><img class="bowl" src="${base}bowl.webp" alt="">
      <img class="bshadow" src="${base}ball_shadow.webp" alt=""><img class="ball" src="${base}ball.webp" alt=""></div>`;
    return { rig: host.querySelector(".rig"), rotorwrap: host.querySelector(".rotorwrap"), canvas: host.querySelector("canvas"),
             ball: host.querySelector(".ball"), shadow: host.querySelector(".bshadow") };
  }

  const RLW = { ORDER, RED, color, STEP, IDX, G, T, plan, pocketAt, norm };
  RLW.mount = async function (host, base) {
    const el = build(host, base);
    const img = new Image(); img.src = base + "rotor.webp";
    await Promise.all([img.decode().catch(() => {}), document.fonts ? document.fonts.load("700 27px 'Frank Ruhl Libre'").catch(() => {}) : 0]);
    drawRotor(el.canvas, img);
    const W = { el, rotor: Math.random() * 360, ball: { phi: 0, r: G.rest, lift: 0 }, resting: 0, cam: { z: 1, tilt: 48, fx: 600, fy: 600 } };
    W.ball.phi = W.rotor + STEP * IDX[0];
    W.pose = function () {
      el.rotorwrap.style.transform = `rotate(${W.rotor}deg)`;
      const a = (W.ball.phi) * Math.PI / 180, bx = G.C + W.ball.r * Math.sin(a), by = G.C - W.ball.r * Math.cos(a);
      const sc = 1 + 0.35 * W.ball.lift;
      el.ball.style.transform = `translate(${bx - G.ballD / 2}px,${by - G.ballD / 2 - 10 * W.ball.lift}px) scale(${sc})`;
      el.shadow.style.transform = `translate(${bx - 24 + 4}px,${by - 24 + 5}px) scale(${1 - 0.3 * W.ball.lift})`;
      el.shadow.style.opacity = 0.75 - 0.4 * W.ball.lift;
      return { x: bx, y: by };
    };
    W.camera = function (hostSize) {
      const c = W.cam, s = hostSize / 1200;
      el.rig.style.left = el.rig.style.top = (hostSize / 2 - 600) + "px";
      el.rig.style.transform = `scale(${s}) perspective(2400px) scale(${c.z}) rotateX(${c.tilt}deg) translate(${600 - c.fx}px,${600 - c.fy}px)`;
    };
    W.idle = function (dt) { W.rotor += 30 * dt; W.ball.phi += 30 * dt; W.pose(); };
    W.local = () => norm(W.ball.phi - W.rotor);           // ball angle in the rotor's own frame
    W.under = () => pocketAt(W.local());                  // the number of the pocket the ball is in
    return W;
  };
  window.RLW = RLW;
})();
