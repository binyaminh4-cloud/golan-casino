/* Golan Casino · Roulette 3D (one player and Ms Fisher).
   The table, rail, felt layout and chips are real 3D (three.js); the dealer is a video standing behind the table.
   Rules and money are the classic private roulette on the server (rl_spin, mode "classic"): the result is drawn
   on the server before the dealer throws, and the 3D wheel (rl_wheel3d.js) is solved backwards to land on it.
   ?preview plays locally without a login (no money). */
import * as THREE from "three";

const $ = (id) => document.getElementById(id);
const PREVIEW = /[?#&]preview/.test(location.href);
const R = window.RLW;
const db = PREVIEW ? null : supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);
const fmt = (n) => { n = Math.floor(Number(n) + 1e-6); const a = Math.abs(n); return a >= 1e9 ? "₪" + +(n / 1e9).toFixed(2) + "B" : a >= 1e6 ? "₪" + +(n / 1e6).toFixed(2) + "M" : "₪" + n.toLocaleString("en-US"); };
const short = (v) => v >= 1e6 ? v / 1e6 + "M" : v >= 1e3 ? v / 1e3 + "K" : String(v);
const sfx = (f) => { try { f(); } catch (e) {} };
// Ms Fisher's voice: one clip per call (snd/r3d/n0..n36, bets, nomore), played at the effects volume
const voice = (name) => { try { SFX.fx("r3d/" + name + "_v2", { vol: 0.95 }); } catch (e) {} };
const preload = (name) => { try { SFX.fx("r3d/" + name + "_v2", { vol: 0 }); } catch (e) {} };   // sfx.js loads a file on first use

// ---------- the table, in metres (x right, y up, z toward the player) ----------
const H = 0.9;                                      // felt height
const FW = 2.7, FD = 1.1, FR = 0.18;                // felt size and corner radius
const X0 = -0.62, CW = 0.12, CH = 0.115, ZF = -0.36; // first number column left edge, cell size, far edge of the number grid
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => n === 0 ? "green" : REDS.has(n) ? "red" : "black";
const CHIPS = [
  { v: 100, c: "white", side: "#d9d6cc" }, { v: 1000, c: "red", side: "#8e1414" }, { v: 10000, c: "blue", side: "#1b2f86" },
  { v: 100000, c: "green", side: "#145f2a" }, { v: 1000000, c: "black", side: "#151515" }, { v: 10000000, c: "purple", side: "#4c1d6b" }];

// every betting area: key (server nums), rectangle on the felt, label
const AREAS = [];
const area = (nums, x, z, w, d, label, fill) => AREAS.push({ key: nums.join(","), nums, x, z, w, d, label, fill });
for (let c = 0; c < 12; c++) for (let r = 0; r < 3; r++) {
  const n = c * 3 + r + 1;
  area([n], X0 + c * CW, ZF + (2 - r) * CH, CW, CH, String(n), colorOf(n));
}
area([0], X0 - CW, ZF, CW, 3 * CH, "0", "green");
for (let r = 0; r < 3; r++) { const col = []; for (let c = 0; c < 12; c++) col.push(c * 3 + r + 1); area(col, X0 + 12 * CW, ZF + (2 - r) * CH, CW, CH, "2 to 1"); }
["1st 12", "2nd 12", "3rd 12"].forEach((l, i) => area(Array.from({ length: 12 }, (_, k) => i * 12 + k + 1), X0 + i * 4 * CW, ZF + 3 * CH, 4 * CW, CH, l));
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const OUT = [["1-18", range(1, 18)], ["EVEN", range(1, 36).filter((n) => n % 2 === 0)], ["RED", [...REDS].sort((a, b) => a - b)],
  ["BLACK", range(1, 36).filter((n) => !REDS.has(n))], ["ODD", range(1, 36).filter((n) => n % 2)], ["19-36", range(19, 36)]];
OUT.forEach(([l, nums], i) => area(nums, X0 + i * 2 * CW, ZF + 4 * CH, 2 * CW, CH, l, l === "RED" ? "red" : l === "BLACK" ? "black" : null));
const pays = (a) => 36 / a.nums.length;               // total return per unit staked (stake included), classic wheel

// ---------- renderer and scene ----------
const canvas = $("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0908);
const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.05, 30);
const EYE = new THREE.Vector3(0.1, 1.6, 0.82), LOOK_BET = new THREE.Vector3(0.1, 0.9, -0.12), LOOK_DEALER = new THREE.Vector3(0.1, 1.08, -1.0);
const LOOK = LOOK_BET.clone(); let lookTo = LOOK_BET;
camera.position.copy(EYE); camera.lookAt(LOOK);

scene.add(new THREE.HemisphereLight(0xffe2bc, 0x1a0c06, 0.55));
const spot = new THREE.SpotLight(0xffe0b0, 26, 6, Math.PI / 3.2, 0.55, 1.6); spot.position.set(0.15, 2.5, 0.15); spot.target.position.set(0.15, H, 0);
spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0004; scene.add(spot, spot.target);
const fill = new THREE.PointLight(0xffb070, 2.2, 5, 1.8); fill.position.set(0.2, 1.7, 1.1); scene.add(fill);

const loader = new THREE.TextureLoader();
const tex = (url, rx = 1, ry = 1) => { const t = loader.load(url); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 8; return t; };

function rrectShape(w, d, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
// wooden body
const wood = new THREE.MeshPhysicalMaterial({ map: tex("img/r3d/wood.jpg?v=1", 3, 1), roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 });
const body = new THREE.Mesh(new THREE.ExtrudeGeometry(rrectShape(FW + 0.3, FD + 0.3, FR + 0.12), { depth: 0.12, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 4, curveSegments: 24 }), wood);
body.rotation.x = -Math.PI / 2; body.position.y = H - 0.17; body.receiveShadow = true; scene.add(body);
const skirt = new THREE.Mesh(new THREE.ExtrudeGeometry(rrectShape(FW + 0.1, FD + 0.1, FR + 0.05), { depth: 0.7, bevelEnabled: false, curveSegments: 24 }), wood);
skirt.rotation.x = -Math.PI / 2; skirt.position.y = H - 0.84; scene.add(skirt);

// felt: the photo cloth, darkened, with the layout printed on it (drawn in code so the numbers are always right)
const PX = 1400 / FD;                                  // canvas pixels per metre
const feltCanvas = document.createElement("canvas"); feltCanvas.width = Math.round(FW * PX); feltCanvas.height = Math.round(FD * PX);
const feltTex = new THREE.CanvasTexture(feltCanvas); feltTex.colorSpace = THREE.SRGBColorSpace; feltTex.anisotropy = 16;
function drawFelt(cloth) {
  const g = feltCanvas.getContext("2d"), W = feltCanvas.width, D = feltCanvas.height;
  g.fillStyle = "#0b3a1d"; g.fillRect(0, 0, W, D);
  if (cloth) { for (let x = 0; x < W; x += cloth.width) for (let y = 0; y < D; y += cloth.height) g.drawImage(cloth, x, y); g.fillStyle = "rgba(4,20,10,.42)"; g.fillRect(0, 0, W, D); }
  const P = (x, z) => [(x + FW / 2) * PX, (z + FD / 2) * PX];
  const ink = { red: "rgba(128,6,12,.93)", black: "rgba(8,8,8,.86)", green: "rgba(10,90,40,.75)" };
  for (const a of AREAS) {
    const [x, y] = P(a.x, a.z), w = a.w * PX, d = a.d * PX;
    if (a.fill) { g.fillStyle = ink[a.fill]; g.fillRect(x + 5, y + 5, w - 10, d - 10); }
    g.strokeStyle = "rgba(236,226,196,.92)"; g.lineWidth = 5; g.strokeRect(x, y, w, d);
    if (a.label === "RED" || a.label === "BLACK") continue;
    const num = /^\d+$/.test(a.label), sz = num ? CH * PX * 0.5 : a.label === "2 to 1" ? d * 0.2 : d * 0.32;
    g.save(); g.translate(x + w / 2, y + d / 2); 
    g.fillStyle = "#f3ead2"; g.font = `${num ? 800 : 700} ${sz}px Inter, Heebo, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(a.label, 0, 2); g.restore();
  }
  // gold border around the whole layout
  const [bx, by] = P(X0 - CW - 0.03, ZF - 0.03); g.strokeStyle = "rgba(214,176,106,.85)"; g.lineWidth = 4; g.strokeRect(bx, by, (14 * CW + 0.06) * PX, (5 * CH + 0.06) * PX);
  feltTex.needsUpdate = true;
}
drawFelt(null);
{ const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = 512; c.height = 192; c.getContext("2d").drawImage(im, 0, 0, 512, 192); drawFelt(c); }; im.src = "img/r3d/felt.jpg?v=1"; }
const feltGeo = new THREE.ShapeGeometry(rrectShape(FW, FD, FR), 24);
{ const uv = feltGeo.attributes.uv, pos = feltGeo.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / FW + 0.5, pos.getY(i) / FD + 0.5); }
const felt = new THREE.Mesh(feltGeo, new THREE.MeshStandardMaterial({ map: feltTex, roughness: 0.97, metalness: 0 }));
felt.rotation.x = -Math.PI / 2; felt.position.y = H; felt.receiveShadow = true; scene.add(felt);
// (after the rotation the shape's +y is the far side, which is the top of the canvas: the default uv already matches)

// padded leather armrest around the felt
{
  const pts = rrectShape(FW + 0.08, FD + 0.08, FR + 0.04).getSpacedPoints(220).map((p) => new THREE.Vector3(p.x, H + 0.045, -p.y));
  const curve = new THREE.CatmullRomCurve3(pts, true);
  const leather = new THREE.MeshPhysicalMaterial({ map: tex("img/r3d/leather.jpg?v=1", 30, 1), roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4, color: 0xb08a78 });
  const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, 440, 0.055, 18, true), leather); rail.castShadow = true; scene.add(rail);
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9b36a, metalness: 1, roughness: 0.28 });
  const trim = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rrectShape(FW + 0.0, FD, FR).getSpacedPoints(220).map((p) => new THREE.Vector3(p.x, H + 0.004, -p.y)), true), 440, 0.006, 8, true), gold);
  scene.add(trim);
}

// ---------- chips ----------
const chipTop = {}, chipSide = {};
CHIPS.forEach((c) => {
  const t = loader.load(`img/r3d/chip_${c.c}.png?v=1`); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  chipTop[c.v] = new THREE.MeshStandardMaterial({ map: t, roughness: 0.55 });
  chipSide[c.v] = new THREE.MeshStandardMaterial({ color: c.side, roughness: 0.6 });
});
const CHIP_R = 0.021, CHIP_T = 0.0036;
const chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_T, 40);
function chipMesh(v) { const m = new THREE.Mesh(chipGeo, [chipSide[v], chipTop[v], chipSide[v]]); m.castShadow = true; return m; }
// the dealer's float: stacks of every colour, behind the layout
CHIPS.forEach((c, i) => { for (let k = 0; k < 14; k++) { const m = chipMesh(c.v); m.position.set(-0.34 + i * 0.05, H + CHIP_T / 2 + k * CHIP_T, -0.47); scene.add(m); } });

// ---------- the dealer: a video standing behind the table, faded at the edges into the room ----------
const vIdle = $("dealerIdle"), vThrow = $("dealerThrow");
const vtIdle = new THREE.VideoTexture(vIdle), vtThrow = new THREE.VideoTexture(vThrow);
[vtIdle, vtThrow].forEach((t) => { t.colorSpace = THREE.SRGBColorSpace; });
const mask = document.createElement("canvas"); mask.width = mask.height = 256;
{ const g = mask.getContext("2d"), gr = g.createRadialGradient(128, 118, 30, 128, 128, 150); gr.addColorStop(0, "#fff"); gr.addColorStop(0.62, "#fff"); gr.addColorStop(1, "#000");
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256); const lin = g.createLinearGradient(0, 0, 0, 256); lin.addColorStop(0.8, "rgba(0,0,0,0)"); g.fillStyle = lin; }
const dealerMat = new THREE.MeshBasicMaterial({ map: vtIdle, alphaMap: new THREE.CanvasTexture(mask), transparent: true, toneMapped: false, depthWrite: false });
const DW = 1.3, DH = DW * 560 / 752;
const dealer = new THREE.Mesh(new THREE.PlaneGeometry(DW, DH), dealerMat);
dealer.position.set(EYE.x, 0.62 + DH / 2, -0.98); dealer.renderOrder = -1; scene.add(dealer);
// warm out-of-focus lights of the casino floor, far behind her
{
  const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,200,120,1)"); gr.addColorStop(0.4, "rgba(255,170,80,.45)"); gr.addColorStop(1, "rgba(255,150,60,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const bt = new THREE.CanvasTexture(c); let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 34; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: bt, transparent: true, opacity: 0.25 + rnd() * 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
    const side = rnd() < 0.5 ? -1 : 1, x = EYE.x + side * (0.9 + rnd() * 2.6);
    sp.position.set(x, 1.1 + rnd() * 1.6, -2.4 - rnd() * 2); const sc = 0.18 + rnd() * 0.4; sp.scale.set(sc, sc, 1); scene.add(sp);
  }
}
let dealerMode = "idle";
function dealerPlay(which) {
  dealerMode = which;
  if (which === "throw") { vThrow.currentTime = 0; dealerMat.map = vtThrow; vThrow.play().catch(() => {}); }
  else { dealerMat.map = vtIdle; vIdle.loop = true; vIdle.play().catch(() => {}); }
  dealerMat.needsUpdate = true;
}
vThrow.addEventListener("ended", () => dealerPlay("idle"));

// ---------- bets on the felt ----------
const bets = new Map();                 // key -> amount
const stacks = new Map();               // key -> THREE.Group
let undo = [], lastBets = null, chipVal = CHIPS[1].v, busy = false, balance = 0;
function breakdown(amount) { const out = []; let a = amount; for (const c of [...CHIPS].reverse()) while (a >= c.v && out.length < 12) { out.push(c.v); a -= c.v; } if (!out.length) out.push(CHIPS[0].v); return out.reverse(); }
function areaCenter(a) { return new THREE.Vector3(a.x + a.w / 2, H, a.z + a.d / 2); }
function drawStack(key) {
  const old = stacks.get(key); if (old) scene.remove(old);
  const amt = bets.get(key); if (!amt) { stacks.delete(key); return; }
  const a = AREAS.find((x) => x.key === key), g = new THREE.Group(), c = areaCenter(a);
  breakdown(amt).forEach((v, i) => { const m = chipMesh(v); m.position.set(0, CHIP_T / 2 + i * CHIP_T, 0); m.rotation.y = i * 0.7; g.add(m); });
  g.position.copy(c); scene.add(g); stacks.set(key, g); return g;
}
function totalBet() { let s = 0; for (const v of bets.values()) s += v; return s; }
function showTotal() { $("total").textContent = fmt(totalBet()); $("spin").disabled = busy || !bets.size; $("undo").disabled = busy || !undo.length; $("clear").disabled = busy || !bets.size; $("repeat").disabled = busy || !lastBets || bets.size > 0; }
function place(key, amt, anim = true) {
  if (busy) return;
  if (totalBet() + amt > balance) { say("אין מספיק שקלים"); return; }
  bets.set(key, (bets.get(key) || 0) + amt); undo.push([key, amt]);
  const g = drawStack(key); sfx(() => SFX.chip());
  if (anim && g) {                            // the chip slides in from the player's side of the table
    const top = g.children.at(-1), to = top.position.clone(), from = new THREE.Vector3(EYE.x - g.position.x, 0.35, 0.75 - g.position.z);
    const t0 = performance.now(); tweens.push((now) => { const k = Math.min(1, (now - t0) / 320), e = 1 - Math.pow(1 - k, 3);
      top.position.set(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e + Math.sin(k * Math.PI) * 0.08, from.z + (to.z - from.z) * e); return k < 1; });
  }
  showTotal();
}
const tweens = [];
// the hand: rises from the bottom of the screen to the area, lets the chip go, and goes back
let handAnim = null;
function reach(a) {
  if (totalBet() + chipVal > balance) { say("אין מספיק שקלים"); return; }
  const c = areaCenter(a).project(camera), x = (c.x + 1) / 2 * innerWidth, y = (1 - c.y) / 2 * innerHeight;
  const el = $("hand"), h = innerHeight * 0.52, w = h * 360 / 607, px = w * 0.497, py = h * 0.021;
  const tilt = Math.max(-22, Math.min(22, (x - innerWidth * 0.62) / innerWidth * 40));
  $("handChip").src = `img/r3d/chip_${CHIPS.find((k) => k.v === chipVal).c}.png?v=1`; $("handChip").classList.remove("drop");
  if (handAnim) handAnim.cancel();
  el.hidden = false; el.style.left = (x - px) + "px"; el.style.top = (y - py) + "px";
  const key = a.key, amt = chipVal;
  handAnim = el.animate([
    { transform: `translate(${innerWidth * 0.25 - x}px, ${innerHeight}px) rotate(${tilt}deg)`, easing: "cubic-bezier(.2,.8,.3,1)" },
    { transform: `translate(0,0) rotate(${tilt}deg)`, offset: 0.45 },
    { transform: `translate(0,-4px) rotate(${tilt}deg)`, offset: 0.6, easing: "cubic-bezier(.5,0,.8,.4)" },
    { transform: `translate(${(innerWidth * 0.25 - x) * 0.5}px, ${innerHeight}px) rotate(${tilt}deg)` }], { duration: 640 });
  setTimeout(() => { $("handChip").classList.add("drop"); place(key, amt, false); }, 300);
  handAnim.onfinish = () => { el.hidden = true; handAnim = null; };
}

// tap on the felt -> the area under the finger
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
canvas.addEventListener("pointerdown", (e) => {
  if (busy || !$("enter").hidden) return;
  const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = new THREE.Vector3(); if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -H), hit)) return;
  const a = AREAS.find((a) => hit.x >= a.x && hit.x < a.x + a.w && hit.z >= a.z && hit.z < a.z + a.d);
  if (a) reach(a);
});

// ---------- bottom bar ----------
CHIPS.forEach((c, i) => {
  const b = document.createElement("button"); b.type = "button"; b.className = "chip" + (c.v === chipVal ? " on" : ""); b.style.backgroundImage = `url(img/r3d/chip_${c.c}.png?v=1)`;
  b.setAttribute("aria-label", "צ׳יפ " + fmt(c.v)); b.innerHTML = `<span>${short(c.v)}</span>`;
  b.onclick = () => { chipVal = c.v; document.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === b)); sfx(() => SFX.chip()); };
  $("chips").appendChild(b);
});
$("undo").onclick = () => { const u = undo.pop(); if (!u) return; const v = bets.get(u[0]) - u[1]; if (v > 0) bets.set(u[0], v); else bets.delete(u[0]); drawStack(u[0]); showTotal(); };
$("clear").onclick = () => clearBets();
$("repeat").onclick = () => { if (!lastBets) return; for (const [k, v] of lastBets) place(k, v, false); };
function clearBets() { for (const k of [...bets.keys()]) { bets.delete(k); drawStack(k); } undo = []; showTotal(); }

let sayT = 0;
function say(t, ms = 2200) { const s = $("say"); s.textContent = t; s.classList.add("on"); clearTimeout(sayT); sayT = setTimeout(() => s.classList.remove("on"), ms); }
function showBal(v) { $("bal").textContent = fmt(v); }

// ---------- the wheel: the same 3D wheel as the roulette, full screen while the ball runs ----------
let W = null, plan = null, t0 = 0, topView = false;
const host = $("wheelHost");
const lerp = (a, b, k) => a + (b - a) * k;
$("topView").onclick = () => { topView = !topView; $("topView").setAttribute("aria-pressed", topView); $("topView").textContent = topView ? "מבט רגיל" : "מבט על"; };

// ---------- one round ----------
function newRef() { return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(); }
function errText(e) { const m = (e && e.message) || ""; return /insufficient/.test(m) ? "אין מספיק שקלים." : /invalid_amount/.test(m) ? "הסכום מעל המקסימום שלך." : "תקלה בחיבור. נסו שוב."; }
async function serverSpin() {
  const payload = [...bets].map(([k, amt]) => ({ nums: k.split(",").map(Number), amt }));
  if (PREVIEW) {
    const n = /force=(\d+)/.test(location.search) ? +RegExp.$1 : Math.floor(Math.random() * 37), total = totalBet();
    const payout = payload.filter((b) => b.nums.includes(n)).reduce((s, b) => s + Math.floor(b.amt * 36 / b.nums.length), 0);
    balance = balance - total + payout; return { result: n, total, payout, balance };
  }
  const { data, error } = await db.rpc("rl_spin", { p_bets: payload, p_ref: newRef(), p_mode: "classic" });
  if (error) throw error;
  return { result: data.result, total: Number(data.total), payout: Number(data.payout), balance: Number(data.balance) };
}
const RELEASE = 2.15;                      // seconds into the throw video when the ball leaves her hand
async function spin() {
  if (busy || !bets.size) return;
  busy = true; showTotal(); $("bar").classList.add("off");
  let res;
  try { res = await serverSpin(); } catch (e) { busy = false; showTotal(); $("bar").classList.remove("off"); say(errText(e), 3000); return; }
  lastBets = new Map(bets); showBal(res.balance - res.payout); preload("n" + res.result);
  say("No more bets", 1600); voice("nomore");
  lookTo = LOOK_DEALER; await wait(1000); dealerPlay("throw");
  await wait(RELEASE * 1000);
  // to the wheel
  topView = false; $("topView").setAttribute("aria-pressed", "false"); $("topView").textContent = "מבט על";
  $("wheelView").hidden = false; W.cam = { z: 1, tilt: 48, fx: 600, fy: 600, az: 0 };
  plan = R.plan(res.result, W.rotor); t0 = performance.now(); sfx(() => SFX.roll(R.T.hit + 0.6)); dropped = false;
  await wait((R.T.settle + 1.6) * 1000);
  showResult(res);
  await wait(1700);
  $("wheelView").hidden = true; plan = null; lookTo = LOOK_BET; LOOK.copy(LOOK_BET);
  settle(res);
}
let dropped = false;
function showResult(res) {
  const n = res.result, c = colorOf(n), el = $("result");
  el.innerHTML = `<div class="n ${c} num">${n}</div>${res.payout > 0 ? `<div class="w">זכית ${fmt(res.payout)}</div>` : `<div class="l">${c === "red" ? "אדום" : c === "black" ? "שחור" : "ירוק"}</div>`}`;
  el.hidden = false; voice("n" + n); if (res.payout > 0) sfx(() => SFX.win(res.payout >= res.total * 5));
}
let dolly = null;
function settle(res) {
  const n = res.result;
  // the dolly on the winning number, losing chips leave the felt, winning stacks stay a moment
  const a = AREAS.find((x) => x.key === String(n));
  if (!dolly) { dolly = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.022, 0.07, 24), new THREE.MeshPhysicalMaterial({ color: 0xf6f2ff, roughness: 0.05, transmission: 0.6, thickness: 0.02, metalness: 0 })); dolly.castShadow = true; scene.add(dolly); }
  const p = areaCenter(a); dolly.position.set(p.x, H + 0.035, p.z); dolly.visible = true;
  for (const [k, g] of stacks) { const won = k.split(",").map(Number).includes(n); if (!won) { const t1 = performance.now(), y0 = g.position.y; tweens.push((now) => { const kk = Math.min(1, (now - t1) / 600); g.position.y = y0 + kk * 0.05; g.position.z -= 0.012; g.scale.setScalar(1 - kk); return kk < 1; }); } }
  balance = res.balance; showBal(balance);
  if (res.payout > 0 && res.payout >= res.total * 20) setTimeout(() => sfx(() => GC_BONUS("🎰 זכייה גדולה!", res.payout, "על " + n)), 300);
  setTimeout(() => {
    $("result").hidden = true; dolly.visible = false;
    for (const k of [...bets.keys()]) bets.delete(k); for (const [k, g] of stacks) scene.remove(g); stacks.clear(); undo = [];
    busy = false; $("bar").classList.remove("off"); showTotal(); voice("bets");
  }, 2600);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
$("spin").onclick = spin;

// ---------- render loop ----------
function fit() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h;
  const hfov = 86 * Math.PI / 180; camera.fov = 2 * Math.atan(Math.tan(hfov / 2) / camera.aspect) * 180 / Math.PI;   // keep the layout's width on any screen
  camera.fov = Math.min(camera.fov, 70); camera.updateProjectionMatrix();
}
addEventListener("resize", fit); fit();
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  for (let i = tweens.length - 1; i >= 0; i--) if (!tweens[i](now)) tweens.splice(i, 1);
  if (!$("wheelView").hidden && W) {
    if (plan) {
      const t = (now - t0) / 1000, s = plan.at(Math.min(t, R.T.end));
      W.rotor = s.rotor; W.ball = { phi: s.phi, r: s.r, lift: s.lift };
      const b = W.pose(), k = 1 - Math.pow(0.003, dt);
      const near = t > R.T.settle - 1.2 ? Math.min(1, (t - (R.T.settle - 1.2)) / 1.6) : 0;   // closing in on the ball at the end
      W.cam.tilt = lerp(W.cam.tilt, topView ? 3 : lerp(48, 34, near), k);
      W.cam.z = lerp(W.cam.z, topView ? 0.78 : lerp(1, 2.6, near), k);
      const f = topView ? 0 : near;                // the top view always shows the whole wheel
      W.cam.fx = lerp(W.cam.fx, lerp(600, b.x, f), k); W.cam.fy = lerp(W.cam.fy, lerp(600, b.y, f), k);
      if (t > R.T.hit && !dropped) { dropped = true; sfx(() => SFX.ballDrop()); }
    } else W.idle(dt);
    W.camera();
    return;
  }
  LOOK.lerp(lookTo, 1 - Math.pow(0.18, dt)); camera.position.copy(EYE); camera.lookAt(LOOK);
  renderer.render(scene, camera);
}

// ---------- start ----------
(async function boot() {
  W = await R.mount(host, "img/roulette/");
  requestAnimationFrame(frame);
  if (PREVIEW) { balance = 50000000; showBal(balance); }
  else {
    const { data: { session } } = await db.auth.getSession();
    if (!session) { location.href = "./"; return; }
    const w = await db.from("wallets").select("balance").eq("user_id", session.user.id).single();
    if (!w.error) { balance = Number(w.data.balance); showBal(balance); }
  }
  showTotal();
  try { GC_LOADER.done(); } catch (e) {}
  $("enterGo").onclick = () => { preload("nomore"); $("enter").hidden = true; dealerPlay("idle"); preload("bets"); setTimeout(() => voice("bets"), 900); vThrow.load(); };
  if (/[?&]go\b/.test(location.search)) $("enterGo").click();
})();
