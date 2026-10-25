/* Golan Casino · European roulette wheel in real 3D (three.js).
   Bowl, rim, ball track, rotor cone and turret are lathed from measured profiles; frets, diamonds and rings
   are real geometry; lacquer and chrome reflect an environment map. The number ring and the 37 pockets are
   drawn in code from RLW.ORDER, so order and colours cannot drift. Motion comes from RLW.plan (shared with
   the tests): we only map (angle, radius, lift) onto the 3D surfaces. Units: 1200-px wheel space, scaled k. */
import * as THREE from "three";
import { RoomEnvironment } from "./vendor/three/RoomEnvironment.js";

const R = window.RLW, G = R.G, k = 1 / 600;
const P = (r, y) => new THREE.Vector2(r * k, y * k);

// ---------- procedural textures ----------
function woodTexture(dark, light, burl) {
  const c = document.createElement("canvas"); c.width = c.height = 1024; const x = c.getContext("2d");
  x.fillStyle = dark; x.fillRect(0, 0, 1024, 1024);
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 520; i++) {                    // grain lines along u (around the wheel)
    const y = rnd() * 1024, a = 0.04 + rnd() * 0.10, w = 1 + rnd() * 3, amp = 4 + rnd() * 18, f = 2 + rnd() * 5;
    x.strokeStyle = rnd() < 0.5 ? `rgba(0,0,0,${a})` : light.replace("A", a * 1.2); x.lineWidth = w; x.beginPath();
    for (let u = 0; u <= 1024; u += 16) x.lineTo(u, y + Math.sin(u / 1024 * Math.PI * 2 * f + i) * amp);
    x.stroke();
  }
  if (burl) for (let i = 0; i < 900; i++) {          // burl figure
    const cx = rnd() * 1024, cy = rnd() * 1024, r = 2 + rnd() * 9;
    x.strokeStyle = `rgba(20,4,2,${0.08 + rnd() * 0.14})`; x.lineWidth = 1.2; x.beginPath(); x.ellipse(cx, cy, r * 1.6, r, rnd() * 3, 0, 7); x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function ringTexture() {                               // number ring + pocket floors, top-down, far side up
  const S = 2048, c = document.createElement("canvas"); c.width = c.height = S; const x = c.getContext("2d");
  const kk = S / 2 / G.rotorR; x.setTransform(kk, 0, 0, kk, S / 2, S / 2);
  const rad = (d) => (d - 90) * Math.PI / 180, STEP = R.STEP;
  const fill = { red: ["#B8142A", "#6E0B16"], black: ["#1B1817", "#060505"], green: ["#118043", "#063D1F"] };
  x.fillStyle = "#3a120b"; x.beginPath(); x.arc(0, 0, G.rotorR, 0, 7); x.fill();
  R.ORDER.forEach((n, i) => {
    const a0 = rad(i * STEP - STEP / 2), a1 = rad(i * STEP + STEP / 2), [c1, c2] = fill[R.color(n)];
    x.beginPath(); x.arc(0, 0, G.numOut, a0, a1); x.arc(0, 0, G.numIn, a1, a0, true); x.closePath(); x.fillStyle = c1; x.fill();
    const g = x.createRadialGradient(0, 0, G.pocketIn, 0, 0, G.numIn); g.addColorStop(0, c2); g.addColorStop(0.5, c1); g.addColorStop(1, c2);
    x.beginPath(); x.arc(0, 0, G.numIn, a0, a1); x.arc(0, 0, G.pocketIn, a1, a0, true); x.closePath(); x.fillStyle = g; x.fill();
  });
  x.strokeStyle = "rgba(225,225,225,.9)"; x.lineWidth = 1.4;
  R.ORDER.forEach((n, i) => { const a = rad(i * STEP - STEP / 2); x.beginPath(); x.moveTo(Math.cos(a) * G.numIn, Math.sin(a) * G.numIn); x.lineTo(Math.cos(a) * G.numOut, Math.sin(a) * G.numOut); x.stroke(); });
  x.fillStyle = "#F7F1E6"; x.textAlign = "center"; x.textBaseline = "middle"; x.font = "700 28px 'Frank Ruhl Libre', Georgia, serif";
  R.ORDER.forEach((n, i) => { x.save(); x.rotate(i * STEP * Math.PI / 180); x.translate(0, -(G.numIn + G.numOut) / 2); x.fillText(String(n), 0, 1.5); x.restore(); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; return t;
}
// lathe with planar (top-down) UVs so the ring texture lands exactly where the numbers belong
function planarUV(geo, radiusPx) {
  const p = geo.attributes.position, uv = geo.attributes.uv, Rt = radiusPx * k;
  for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 + p.getX(i) / (2 * Rt), 0.5 - p.getZ(i) / (2 * Rt));
  uv.needsUpdate = true; return geo;
}
// LatheGeometry starts at +z and turns anticlockwise seen from above; our angles are clockwise from -z.
const lathe = (pts, seg = 160) => new THREE.LatheGeometry(pts, seg);

// ---------- heights of the playing surfaces (px), used to put the ball on them ----------
const TRACK = { r0: 372, y0: 30, r1: 502, y1: 76 };
const yTrack = (r) => TRACK.y0 + (r - TRACK.r0) / (TRACK.r1 - TRACK.r0) * (TRACK.y1 - TRACK.y0);
const yRing = (r) => 27 + (r - G.numIn) / (372 - G.numIn) * 9;   // number ring slopes up to the rotor edge
const POCKET_FLOOR = 14, BALL = 15;
function ballY(r, lift) {
  let y = r >= 372 ? yTrack(Math.min(r, TRACK.r1)) : r >= G.numIn ? yRing(r) : POCKET_FLOOR;
  return y + BALL + lift * 34;
}

async function mount(host, base) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.innerHTML = ""; host.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = "width:100%;height:100%;display:block";

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);

  const key = new THREE.DirectionalLight(0xfff1dc, 2.2); key.position.set(-2.4, 4.2, -0.6); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -1.3, right: 1.3, top: 1.3, bottom: -1.3, near: 0.5, far: 8 });
  key.shadow.bias = -0.0004; key.shadow.radius = 4;
  const warm = new THREE.PointLight(0xffc98a, 6, 6, 1.6); warm.position.set(1.4, 1.2, 2.0); warm.intensity = 3;
  scene.add(key, warm, new THREE.AmbientLight(0xffe6c8, 0.18));

  await (document.fonts ? document.fonts.load("700 28px 'Frank Ruhl Libre'").catch(() => {}) : 0);
  const woodDark = woodTexture("#33090a", "rgba(140,40,20,A)", true);
  const woodLight = woodTexture("#c79a5e", "rgba(245,210,150,A)", false);
  const woodCone = woodTexture("#4a1209", "rgba(170,60,30,A)", true); woodCone.repeat.set(3, 1);
  const lacquer = (map, color = 0xffffff) => new THREE.MeshPhysicalMaterial({ map, color, side: THREE.DoubleSide, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 0.45 });
  const mWood = lacquer(woodDark), mLight = lacquer(woodLight), mCone = lacquer(woodCone);
  const mTrack = lacquer(woodDark, 0x9a6050); mTrack.roughness = 0.6; mTrack.clearcoat = 0.5; mTrack.envMapIntensity = 0.3;
  const mChrome = new THREE.MeshStandardMaterial({ color: 0xe8e8ea, side: THREE.DoubleSide, metalness: 1, roughness: 0.1, envMapIntensity: 1.2 });
  const mRing = new THREE.MeshPhysicalMaterial({ map: ringTexture(), side: THREE.DoubleSide, roughness: 0.55, clearcoat: 0.12, clearcoatRoughness: 0.2, envMapIntensity: 0.15 });

  // ----- table felt -----
  // the table is the background photo: a transparent shadow catcher + a soft contact shadow under the base
  const table = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.42 }));
  table.rotation.x = -Math.PI / 2; table.receiveShadow = true; scene.add(table);
  const cs = document.createElement("canvas"); cs.width = cs.height = 256; const cx = cs.getContext("2d");
  const gr = cx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, "rgba(0,0,0,.75)"); gr.addColorStop(0.78, "rgba(0,0,0,.62)"); gr.addColorStop(0.86, "rgba(0,0,0,.35)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  cx.fillStyle = gr; cx.fillRect(0, 0, 256, 256);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 2.5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cs), transparent: true, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = 0.002; scene.add(contact);

  // ----- static bowl (outer rim, inlays, ball track) — proportions follow the reference photo -----
  const bowl = new THREE.Group(); scene.add(bowl);
  const add = (geo, mat, g = bowl) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  add(lathe([P(560, 0), P(612, 0), P(617, 6), P(618, 30)]), mWood);
  add(lathe([P(618, 30), P(619, 31), P(619, 39), P(618, 40)]), mLight);             // thin maple band low on the wall
  add(lathe([P(618, 40), P(619, 70), P(619, 112)]), mWood);
  add(lathe([P(619, 112), P(620, 113), P(620, 121), P(619, 122)]), mLight);          // second maple band
  add(lathe([P(619, 122), P(618, 132), P(612, 146), P(600, 156), P(584, 161), P(566, 162), P(550, 160), P(538, 155)]), mWood);   // thick rounded rim
  add(lathe([P(538, 155), P(530, 149), P(524, 141)]), mLight);                        // light band on the inner edge
  add(lathe([P(524, 141), P(516, 128), P(510, 112), P(506, 96), P(503, 84), P(502, 76)]), mWood);   // inner wall down to the track
  add(lathe([P(502, 76), P(480, 70), P(440, 59), P(400, 44), P(372, TRACK.y0), P(370, 0)], 200), mTrack);   // sloped ball track
  add(lathe([P(505, 96), P(506.5, 97), P(506.5, 102), P(505, 103)]), mChrome);       // chrome bead
  for (let i = 0; i < 8; i++) {                                                       // leaf-shaped chrome deflectors
    const a = (i * 45 + 22.5) * Math.PI / 180, r = 452, d = add(new THREE.SphereGeometry(1, 20, 10), mChrome);
    d.scale.set(26 * k, 5 * k, 7 * k); d.position.set(Math.sin(a) * r * k, (yTrack(r) + 2.5) * k, -Math.cos(a) * r * k);
    d.rotation.y = -a; d.rotation.z = 0.32;
  }

  // ----- rotor (turns) -----
  const rotor = new THREE.Group(); scene.add(rotor);
  add(planarUV(lathe([P(372, 36), P(366, 35.5), P(G.numOut, 34), P(G.numIn, 27)], 256), G.rotorR), mRing, rotor);     // sloped number ring
  add(planarUV(lathe([P(G.numIn, POCKET_FLOOR), P(G.pocketIn, POCKET_FLOOR)], 256), G.rotorR), mRing, rotor);         // pocket floors
  add(lathe([P(G.numIn, 27), P(G.numIn - 1, POCKET_FLOOR)]), mWood, rotor);
  add(lathe([P(G.pocketIn, POCKET_FLOOR), P(G.pocketIn - 2, 32), P(250, 38), P(200, 56), P(140, 80), P(90, 98), P(55, 106)], 200), mCone, rotor);   // cone
  add(lathe([P(372, 0), P(372, 36)]), mWood, rotor);
  const torus = (r, y, tube) => { const t = add(new THREE.TorusGeometry(r * k, tube * k, 12, 200), mChrome, rotor); t.rotation.x = Math.PI / 2; t.position.y = y * k; };
  torus(G.numIn, 29, 3); torus(G.pocketIn + 1, 32, 3.2); torus(G.numOut + 1, 35, 1.6);
  for (let i = 0; i < 37; i++) {                                                      // frets between pockets
    const a = (i * R.STEP - R.STEP / 2) * Math.PI / 180, f = add(new THREE.BoxGeometry(3.4 * k, 17 * k, (G.numIn - G.pocketIn) * k), mChrome, rotor);
    const rm = (G.numIn + G.pocketIn) / 2; f.position.set(Math.sin(a) * rm * k, (POCKET_FLOOR + 8.5) * k, -Math.cos(a) * rm * k); f.rotation.y = -a;
  }
  // chrome turret, lathed after the reference: base, waisted stem, knurled collar, finial ball
  add(lathe([P(0, 104), P(70, 104), P(68, 114), P(56, 124), P(44, 134), P(34, 146), P(28, 164), P(26, 186), P(30, 196), P(40, 202), P(42, 214), P(40, 226),
    P(30, 232), P(20, 240), P(16, 256), P(15, 276), P(22, 288), P(26, 300), P(24, 312), P(16, 322), P(0, 326)], 120), mChrome, rotor);

  // ----- ball -----
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL * k, 40, 24),
    new THREE.MeshPhysicalMaterial({ color: 0xf7f2e8, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 }));
  ball.castShadow = true; scene.add(ball);

  const W = { el: { canvas: renderer.domElement }, rotor: Math.random() * 360, ball: { phi: 0, r: G.rest, lift: 0 }, cam: { z: 1, tilt: 48, fx: 600, fy: 600, az: 0 }, is3d: true };
  W.ball.phi = W.rotor;
  const xz = (a, r) => [Math.sin(a * Math.PI / 180) * r, -Math.cos(a * Math.PI / 180) * r];
  W.pose = function () {
    rotor.rotation.y = -W.rotor * Math.PI / 180;
    const [bx, bz] = xz(W.ball.phi, W.ball.r);
    ball.position.set(bx * k, ballY(W.ball.r, W.ball.lift) * k, bz * k);
    ball.rotation.x += 0.2; ball.rotation.z += 0.13;
    return { x: 600 + bx, y: 600 + bz };
  };
  W.camera = function () {
    const w = host.clientWidth || 300, h = host.clientHeight || 300;
    if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    const c = W.cam, e = (90 - c.tilt) * Math.PI / 180, az = (c.az || 0) * Math.PI / 180;
    const wide = camera.aspect > 1.2, tv = Math.tan(camera.fov * Math.PI / 360);
    // wide view: wheel ≈42% of the screen width, centred at 50% / 53% like the background; square view: safe margin
    const fitDist = wide ? 2.07 / (0.42 * 2 * tv * camera.aspect) : 2.07 / (0.84 * 2 * tv * Math.min(1, camera.aspect));
    camera.setViewOffset(w, h, 0, wide ? -0.03 * h : 0, w, h);
    host.classList.toggle("bgwide", wide);
    const dist = fitDist / c.z;
    const tx = (c.fx - 600) * k, tz = (c.fy - 600) * k, ty = 0.05;
    // camera stands on the opposite side of the target from angle `az` (az = 0: standing at the near side, +z)
    camera.position.set(tx + Math.sin(az) * Math.cos(e) * dist, ty + Math.sin(e) * dist, tz + Math.cos(az) * Math.cos(e) * dist);
    camera.lookAt(tx, ty, tz);
    renderer.render(scene, camera);
  };
  W.idle = function (dt) { W.rotor += 30 * dt; W.ball.phi += 30 * dt; W.pose(); };
  W.local = () => R.norm(W.ball.phi - W.rotor);
  W.under = () => R.pocketAt(W.local());
  W.pose(); W.camera();
  return W;
}

// WebGL available? then this becomes the wheel; otherwise rl_wheel.js keeps its 2D wheel.
try {
  const ok = !!document.createElement("canvas").getContext("webgl2");
  if (ok && !/[?&]flat\b/.test(location.search)) R.mount3d = mount;
} catch (e) {}
window.dispatchEvent(new Event("rlw3d"));
