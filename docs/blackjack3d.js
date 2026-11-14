/* Golan Casino · Blackjack 3D (one player and Ms Fisher).
   Same table, chips and dealer as Roulette 3D; the rules and money are the classic solo blackjack on the server
   (bj_deal / bj_action / bj_current, mode "classic", with side bets). ?preview plays locally with no money. */
import * as THREE from "./vendor/three/three.module.min.js";   // by path: iPhones before iOS 16.4 have no import maps

const $ = (id) => document.getElementById(id);
const PREVIEW = /[?#&]preview/.test(location.href);
const LIVE = /[?&]live\b/.test(location.search), TABLE_NO = 2;   // live: the shared table (bjt_*), table 2 = the 3D table
const db = PREVIEW ? null : supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);
const fmt = (n) => { n = Math.floor(Number(n) + 1e-6); const a = Math.abs(n); return a >= 1e9 ? "₪" + +(n / 1e9).toFixed(2) + "B" : a >= 1e6 ? "₪" + +(n / 1e6).toFixed(2) + "M" : "₪" + n.toLocaleString("en-US"); };
const short = (v) => v >= 1e12 ? v / 1e12 + "T" : v >= 1e9 ? v / 1e9 + "B" : v >= 1e6 ? v / 1e6 + "M" : v >= 1e3 ? v / 1e3 + "K" : String(v);
const sfx = (f) => { try { f(); } catch (e) {} };
const voice = (name) => { try { SFX.fx("r3d/" + name + "_v2", { vol: 0.95 }); } catch (e) {} };
const preload = (name) => { try { SFX.fx("r3d/" + name + "_v2", { vol: 0 }); } catch (e) {} };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const H = 0.9, FW = 2.4, FD = 1.1, FR = 0.5;            // a blackjack table: rounded on the player's side
const BET = { x: 0, z: 0.17 };
if (/[?&]yaw=/.test(location.search)) setTimeout(() => { userYaw = +location.search.match(/yaw=(-?[\d.]+)/)[1]; userAt = performance.now() + 1e9; }, 100);
// side bets, as in the app's blackjack (each up to the main bet): Perfect Pairs, 21+3, Lucky Ladies, Buster
const SIDES = [{ k: "pp", t: "PERFECT", t2: "PAIRS", x: -0.4, z: 0.12 }, { k: "t3", t: "21+3", t2: "", x: -0.21, z: 0.22 },
  { k: "ll", t: "LUCKY", t2: "LADIES", x: 0.21, z: 0.22 }, { k: "bust", t: "BUSTER", t2: "BLACKJACK", x: 0.4, z: 0.12 }];
const SPOT = { main: BET, ...Object.fromEntries(SIDES.map((x) => [x.k, x])) };
const SIDE_NAME = { pp: "זוג מושלם", t3: "21+3", ll: "ליידיז מזל", bust: "באסטר" };                           // the betting circle in front of the player
// chips follow the wallet like the other tables: the same series (×5/×4 steps), a chip shows once the wallet holds
// 20× its value, 6 on screen. Colours cycle through the six photographed chips; the value is printed on the chip.
const CHIP_V = [5, 25, 100, 500, ...[1e3, 1e6, 1e9].flatMap((m) => [1, 5, 25, 100, 500].map((c) => c * m)), 1e12, 5e12];
const CHIP_LOOK = [{ c: "white", side: "#d9d6cc" }, { c: "red", side: "#8e1414" }, { c: "blue", side: "#1b2f86" },
  { c: "green", side: "#145f2a" }, { c: "black", side: "#151515" }, { c: "purple", side: "#4c1d6b" }];
const ALL_CHIPS = CHIP_V.map((v, i) => ({ v, ...CHIP_LOOK[i % 6] }));
let CHIPS = ALL_CHIPS.slice(2, 8);

// ---------- renderer and scene ----------
const canvas = $("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0908);
const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.05, 30);
const EYE = new THREE.Vector3(0, 1.45, 0.78), LOOK_BET = new THREE.Vector3(0, 0.86, -0.08), LOOK_DEALER = new THREE.Vector3(0, 1.28, -1.0);
const LOOK = LOOK_BET.clone(); let lookTo = LOOK_BET;
if (/[?&]dbg=/.test(location.search)) { const v = location.search.match(/dbg=([-\d.,]+)/)[1].split(",").map(Number); EYE.set(v[0], v[1], v[2]); }
// camera: 0 = the table, 1 = the dealer. The game picks a view (autoU); dragging up/down overrides it,
// and 3 s after the last touch it goes back to the game's view. Zoom = the side buttons.
const LOOK_HOLE = new THREE.Vector3(0, 0.95, -0.4);
const LOOK_DOWN = new THREE.Vector3(0, 0.82, 0.22);       // dragging up past the table view: down onto the betting circles       // her cards, when she turns her hidden card
let autoU = 0, userU = null, userAt = 0, u = 0, zoom = 1, userYaw = 0, yaw = 0;   // yaw: drag sideways to look at the players beside you
const setView = (v) => { autoU = v; };
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
  const cream = "rgba(236,226,196,.92)", gold = "rgba(214,176,106,.9)";
  // the classic arcs: text arcs centred behind the dealer
  const [cx, cy] = P(0, -1.25);
  const arc = (r, text, size, col) => {
    g.save(); g.translate(cx, cy); g.font = `800 ${size}px Inter, sans-serif`; g.fillStyle = col; g.textAlign = "center"; g.textBaseline = "middle";
    const R = r * PX, total = g.measureText(text).width / R; let a = Math.PI / 2 + total / 2;
    for (const ch of text) { const w = g.measureText(ch).width / R; a -= w / 2; g.save(); g.rotate(a); g.translate(R, 0); g.rotate(-Math.PI / 2); g.fillText(ch, 0, 0); g.restore(); a -= w / 2; }
    g.restore();
  };
  arc(0.9, "BLACKJACK PAYS 3 TO 2", 50, gold);
  arc(0.99, "DEALER MUST STAND ON 17", 32, cream);
  g.save(); g.translate(cx, cy); g.strokeStyle = gold; g.lineWidth = 5;
  g.beginPath(); g.arc(0, 0, 1.05 * PX, Math.PI * 0.32, Math.PI * 0.68); g.stroke();
  g.beginPath(); g.arc(0, 0, 1.13 * PX, Math.PI * 0.32, Math.PI * 0.68); g.stroke(); g.restore();
  arc(1.09, "INSURANCE PAYS 2 TO 1", 30, gold);
  // the player's betting circle
  const [bx, by] = P(BET.x, BET.z);
  g.strokeStyle = cream; g.lineWidth = 6; g.beginPath(); g.arc(bx, by, 0.075 * PX, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = gold; g.lineWidth = 3; g.beginPath(); g.arc(bx, by, 0.088 * PX, 0, Math.PI * 2); g.stroke();
  for (const sd of SIDES) {
    const [x, y] = P(sd.x, sd.z); g.strokeStyle = gold; g.lineWidth = 4; g.beginPath(); g.arc(x, y, 0.05 * PX, 0, Math.PI * 2); g.stroke();
    g.fillStyle = cream; g.textAlign = "center"; g.textBaseline = "middle"; g.font = `800 ${sd.t2 ? 20 : 28}px Inter, sans-serif`;
    if (sd.t2) { g.fillText(sd.t, x, y - 12); g.fillText(sd.t2, x, y + 12); } else g.fillText(sd.t, x, y);
  }
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
const chipMats = {}, chipImg = {};
const lookOf = (v) => ALL_CHIPS.find((c) => c.v === v) || ALL_CHIPS[0];
function chipMat(v) {
  if (chipMats[v]) return chipMats[v];
  const L = lookOf(v), cv = document.createElement("canvas"); cv.width = cv.height = 256;
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const paint = (im) => { const g = cv.getContext("2d"); g.clearRect(0, 0, 256, 256); if (im) g.drawImage(im, 0, 0, 256, 256);
    g.fillStyle = "rgba(10,8,6,.55)"; g.beginPath(); g.arc(128, 128, 62, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff"; g.font = "900 " + (short(v).length > 3 ? 54 : 66) + "px Inter, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(short(v), 128, 132); t.needsUpdate = true; };
  if (!chipImg[L.c]) { chipImg[L.c] = new Image(); chipImg[L.c].src = `img/r3d/chip_${L.c}.png?v=1`; }
  const im = chipImg[L.c]; if (im.complete && im.naturalWidth) paint(im); else { paint(null); im.addEventListener("load", () => paint(im)); }
  return (chipMats[v] = [new THREE.MeshStandardMaterial({ color: L.side, roughness: 0.6 }), new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, transparent: true })]);
}
const CHIP_R = 0.021, CHIP_T = 0.0036;
const chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_T, 40);
function chipMesh(v) { const [sd, tp] = chipMat(v); const m = new THREE.Mesh(chipGeo, [sd, tp, sd]); m.castShadow = true; return m; }
// the dealer's float: stacks of every colour, behind the layout
CHIPS.forEach((c, i) => { for (let k = 0; k < 14; k++) { const m = chipMesh(c.v); m.position.set(-0.66 + i * 0.05, H + CHIP_T / 2 + k * CHIP_T, -0.4); scene.add(m); } });

// ---------- the dealer: a video standing behind the table, faded at the edges into the room ----------
const vIdle = $("dealerIdle"), vThrow = $("dealerThrow");
const vtIdle = new THREE.VideoTexture(vIdle), vtThrow = new THREE.VideoTexture(vThrow);
[vtIdle, vtThrow].forEach((t) => { t.colorSpace = THREE.SRGBColorSpace; });
const mask = document.createElement("canvas"); mask.width = mask.height = 256;
{ // fade only the outer edges of the video, so her arms stay visible when she reaches to the side
  const g = mask.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 256, 256);
  const lx = g.createLinearGradient(0, 0, 256, 0); lx.addColorStop(0, "#000"); lx.addColorStop(0.06, "#fff"); lx.addColorStop(0.94, "#fff"); lx.addColorStop(1, "#000");
  g.globalCompositeOperation = "multiply"; g.fillStyle = lx; g.fillRect(0, 0, 256, 256);
  const ly = g.createLinearGradient(0, 0, 0, 256); ly.addColorStop(0, "#000"); ly.addColorStop(0.08, "#fff"); ly.addColorStop(1, "#fff"); g.fillStyle = ly; g.fillRect(0, 0, 256, 256); }
const dealerMat = new THREE.MeshBasicMaterial({ map: vtIdle, alphaMap: new THREE.CanvasTexture(mask), transparent: true, toneMapped: false, depthWrite: false });
const DW = 1.3, DH = DW * 560 / 752;
const dealer = new THREE.Mesh(new THREE.PlaneGeometry(DW, DH), dealerMat);
dealer.position.set(0, 0.8 + DH / 2, -0.98); dealer.renderOrder = -1; scene.add(dealer);   // her hands (the dealing motion) stay above the rail
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

// ---------- cards ----------
const CARD_W = 0.125, CARD_H = 0.175;
const cardGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
const backTex = loader.load("cards3/back.webp?v=1"); backTex.colorSpace = THREE.SRGBColorSpace; backTex.anisotropy = 8;
const faceTex = {};
// card faces drawn in code for readability from across the table: a huge rank and suit, the same in both corners
function faceOf(c) {
  if (faceTex[c]) return faceTex[c];
  const cv = document.createElement("canvas"); cv.width = 256; cv.height = 360; const g = cv.getContext("2d");
  const rank = c[0] === "T" ? "10" : c[0], suit = { S: "♠", H: "♥", D: "♦", C: "♣" }[c[1]], col = "HD".includes(c[1]) ? "#c8102e" : "#111";
  g.fillStyle = "#fffdf6"; g.beginPath(); g.roundRect(4, 4, 248, 352, 22); g.fill(); g.strokeStyle = "#c5a05a"; g.lineWidth = 5; g.stroke();
  g.fillStyle = col; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = `900 ${rank === "10" ? 92 : 110}px Inter, Arial, sans-serif`; g.fillText(rank, 74, 80);
  g.font = "84px Arial, sans-serif"; g.fillText(suit, 74, 168);
  g.font = "160px Arial, sans-serif"; g.fillText(suit, 170, 262);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return (faceTex[c] = t);
}
const SHOE = new THREE.Vector3(0.62, H + 0.09, -0.42);
const HAND_OUT = new THREE.Vector3(-0.28, H + 0.06, -0.6);   // where her hand leaves the card in the dealing clip
{ // the shoe: a dark box with a gold lip, on the dealer's right
  const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.2), new THREE.MeshStandardMaterial({ color: 0x15100c, roughness: 0.4 }));
  shoe.position.set(0.66, H + 0.04, -0.46); shoe.rotation.y = -0.4; shoe.castShadow = true; scene.add(shoe);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(0.122, 0.012, 0.02), new THREE.MeshStandardMaterial({ color: 0xd9b36a, metalness: 1, roughness: 0.3 }));
  lip.position.set(0.62, H + 0.075, -0.37); lip.rotation.y = -0.4; scene.add(lip);
}
// a card is a thin group: front and back planes
function cardMesh(code) {
  const g = new THREE.Group();
  const front = new THREE.Mesh(cardGeo, new THREE.MeshStandardMaterial({ map: code && code !== "??" ? faceOf(code) : backTex, roughness: 0.45 }));
  const back = new THREE.Mesh(cardGeo, new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.45 })); back.rotation.y = Math.PI;
  front.rotation.x = back.rotation.x = 0; g.add(front, back); g.userData = { front, code };
  g.rotation.x = -Math.PI / 2; front.castShadow = true; return g;
}
const tweens = [];
function fly(obj, to, ms, { lift = 0.06, spinZ = 0, flipTo = null } = {}) {
  const from = obj.position.clone(), r0 = obj.rotation.clone(), t0 = performance.now();
  return new Promise((res) => tweens.push((now) => {
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    obj.position.lerpVectors(from, to, e); obj.position.y += Math.sin(k * Math.PI) * lift;
    obj.rotation.z = r0.z + (spinZ - r0.z) * e;
    if (flipTo !== null) obj.rotation.x = r0.x + (flipTo - r0.x) * e;
    if (k >= 1) { res(); return false; } return true;
  }));
}
const pPos = (h, i, n) => { const spread = n > 1 ? 0.32 : 0; const hx = BET.x + (h - (n - 1) / 2) * spread; return new THREE.Vector3(hx - 0.04 + i * 0.07, H + 0.002 + i * 0.0006, BET.z - 0.2 - i * 0.012); };
const dPos = (i) => new THREE.Vector3(-0.1 + i * 0.11, H + 0.002 + i * 0.0006, -0.32);
let pCards = [], dCards = [];
// one dealing gesture per card: her hand comes to the shoe and slides the card forward; the 3D card leaves exactly
// when her hand releases it (DEAL_RELEASE seconds into the clip). Without the clip (not made yet) she keeps the idle loop.
const vDeal = document.createElement("video"); vDeal.src = "vid/r3d/fisher_deal.mp4?v=1"; vDeal.muted = true; vDeal.playsInline = true; vDeal.preload = "auto";
const vtDeal = new THREE.VideoTexture(vDeal); vtDeal.colorSpace = THREE.SRGBColorSpace;
const hasDeal = true;   // blackjack never uses the roulette throw clip (she holds a ball in it)
const DEAL_RELEASE = 1.32;          // the clip is her first dealing motion, 1.6x faster; her hand is lowest at 2.1 s of the original
vDeal.addEventListener("ended", () => dealerPlay("idle"));
async function gesture() {
  vDeal.currentTime = 0; dealerMat.map = vtDeal; dealerMat.needsUpdate = true; vDeal.play().catch(() => {});
  await wait(DEAL_RELEASE * 1000);
}
async function dealTo(code, pos, faceDown = false) {
  await gesture();
  const c = cardMesh(faceDown ? null : code); c.position.copy(hasDeal ? HAND_OUT : SHOE); c.rotation.set(-Math.PI / 2, 0, hasDeal ? 0.3 : -0.4); scene.add(c);
  sfx(() => SFX.card ? SFX.card() : SFX.chip());
  await fly(c, pos, 330, { spinZ: (Math.random() - 0.5) * 0.06 });
  return c;
}
async function flip(c, code) {
  c.userData.front.material.map = faceOf(code); c.userData.front.material.needsUpdate = true; c.userData.code = code;
  const y0 = c.position.y; await fly(c, c.position.clone().setY(y0 + 0.04), 160, { lift: 0 }); await fly(c, c.position.clone().setY(y0), 160, { lift: 0 });
  sfx(() => SFX.cardFlip && SFX.cardFlip());
}

// ---------- bet ----------
let bets = { main: 0, pp: 0, t3: 0, ll: 0, bust: 0 }, lastBets = null, chipVal = CHIPS[1].v, balance = 0, busy = false, st = null;
const stacks = {};
function drawBet(k, amount) {
  if (stacks[k]) { scene.remove(stacks[k]); delete stacks[k]; }
  if (!amount) return;
  const g = new THREE.Group(); let a = amount, i = 0;
  for (const c of [...ALL_CHIPS].reverse()) while (a >= c.v && i < 14) { const m = chipMesh(c.v); m.position.set(0, CHIP_T / 2 + i * CHIP_T, 0); m.rotation.y = i * 0.7; g.add(m); a -= c.v; i++; }
  g.position.set(SPOT[k].x, H, SPOT[k].z); scene.add(g); stacks[k] = g;
}
const drawAll = () => { for (const k in bets) drawBet(k, bets[k]); try { drawOthers(); } catch (e) {} };
const totalBet = () => Object.values(bets).reduce((a, b) => a + b, 0);
const areaCenter = (a) => new THREE.Vector3(SPOT[a.key].x, H, SPOT[a.key].z);
function place(key, amt) {
  if (busy || st || (LIVE && !PREVIEW && T && T.my_bet)) return;
  if (key !== "main" && bets[key] + amt > bets.main) { say(bets.main ? "הימור צד עד גובה ההימור הראשי" : "קודם הימור בעיגול הגדול"); return; }
  bets[key] += amt; drawBet(key, bets[key]); sfx(() => SFX.chip()); showBar(); drawOthers();
}
function showBar() {
  const t = totalBet(); $("total").textContent = fmt(t); $("deal").disabled = busy || !bets.main || (LIVE && !PREVIEW && !canBetLive()); $("clear").disabled = busy || !t; $("repeat").disabled = busy || !lastBets || t > 0;
}
let sayT = 0;
function say(t, ms = 2200) { const s = $("say"); s.textContent = t; s.classList.add("on"); clearTimeout(sayT); sayT = setTimeout(() => s.classList.remove("on"), ms); }
function showBal(v) { $("bal").textContent = fmt(v); drawRack(); }

// the hand: rises from the bottom of the screen to the area, lets the chip go, and goes back
let handAnim = null;
function reach(a) {
  if (totalBet() + chipVal > balance) { say("אין מספיק שקלים"); return; }
  const c = areaCenter(a).project(camera), x = (c.x + 1) / 2 * innerWidth, y = (1 - c.y) / 2 * innerHeight;
  const el = $("hand"), h = innerHeight * 0.52, w = h * 360 / 607, px = w * 0.497, py = h * 0.021;
  const tilt = Math.max(-22, Math.min(22, (x - innerWidth * 0.62) / innerWidth * 40));
  $("handChip").src = `img/r3d/chip_${lookOf(chipVal).c}.png?v=1`; $("handChip").classList.remove("drop");
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



// tap on the felt: the betting circle
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let drag = null;
canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, u0: userU ?? u, yaw0: userYaw, moved: false }; try { canvas.setPointerCapture(e.pointerId); } catch (x) {} });
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return; const dy = e.clientY - drag.y, dx = e.clientX - drag.x;
  if (Math.abs(dy) > 8 || Math.abs(dx) > 8) drag.moved = true;
  if (drag.moved) { userU = Math.max(-1, Math.min(1, drag.u0 + dy / (innerHeight * 0.6))); userYaw = Math.max(-0.95, Math.min(0.95, drag.yaw0 + dx / innerWidth * 1.6)); userAt = performance.now(); }
});
canvas.addEventListener("pointercancel", () => { drag = null; });
canvas.addEventListener("pointerup", (e) => {
  const d = drag; drag = null; if (!d || d.moved) { if (d) userAt = performance.now(); return; }
  if (busy || st || !$("enter").hidden) return;
  const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera); const hit = new THREE.Vector3();
  if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -H), hit)) return;
  for (const [k, p] of Object.entries(SPOT)) if (Math.hypot(hit.x - p.x, hit.z - p.z) < (k === "main" ? 0.12 : 0.07)) { reach({ key: k }); break; }
});
let rackKey = "";
function drawRack() {
  const ok = ALL_CHIPS.filter((c, i) => i < 6 || c.v * 20 <= balance), show = ok.slice(-6), k = show.map((c) => c.v).join(",");
  if (k === rackKey) return; rackKey = k; CHIPS = show;
  if (!show.some((c) => c.v === chipVal)) chipVal = show[Math.min(2, show.length - 1)].v;
  $("chips").innerHTML = "";
  show.forEach((c) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "chip" + (c.v === chipVal ? " on" : ""); b.style.backgroundImage = `url(img/r3d/chip_${c.c}.png?v=1)`;
    b.setAttribute("aria-label", "צ׳יפ " + fmt(c.v)); b.innerHTML = `<span>${short(c.v)}</span>`;
    b.onclick = () => { chipVal = c.v; document.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === b)); sfx(() => SFX.chip()); };
    $("chips").appendChild(b);
  });
}
$("clear").onclick = () => { for (const k in bets) bets[k] = 0; drawAll(); showBar(); };
$("repeat").onclick = () => { if (!lastBets) return; const t = Object.values(lastBets).reduce((a, b) => a + b, 0); if (t > balance) { say("אין מספיק שקלים"); return; } bets = { ...lastBets }; drawAll(); showBar(); };

// ---------- totals above the cards (HTML labels that follow the 3D points) ----------
const labels = [];
function label(text, pos, cls = "") { const el = document.createElement("div"); el.className = "tot num " + cls; el.textContent = text; document.body.appendChild(el); labels.push({ el, pos }); return el; }
function clearLabels() { labels.splice(0).forEach((l) => l.el.remove()); }
function placeLabels() { for (const l of labels) { const p = l.pos.clone().project(camera); l.el.style.left = (p.x + 1) / 2 * innerWidth + "px"; l.el.style.top = (1 - p.y) / 2 * innerHeight + "px"; } }

// ---------- server (or the local preview engine) ----------
function newRef() { return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(); }
function errText(e) { const m = (e && e.message) || ""; return /insufficient/.test(m) ? "אין מספיק שקלים." : /invalid_side/.test(m) ? "הימור צד עד גובה ההימור הראשי." : /invalid_amount|max/.test(m) ? "הסכום מעל המקסימום שלך." : "תקלה בחיבור. נסו שוב."; }
const P = PREVIEW ? previewEngine() : null;
async function srvDeal(b) {
  if (P) return P.deal(b);
  const { data, error } = await db.rpc("bj_deal", { p_main: b.main, p_pp: b.pp, p_t3: b.t3, p_ll: b.ll, p_bust: b.bust, p_ref: newRef(), p_mode: "classic", p_run: null });
  if (error) throw error; return data;
}
async function srvAct(a) { if (P) return P.act(a); const { data, error } = await db.rpc("bj_action", { p_round: st.id, p_action: a }); if (error) throw error; return data; }

// ---------- render a state: deal what is new, flip the hole card, totals, end ----------
async function render(next) {
  busy = true; showActs();
  const n = next.hands.length;
  if (!pCards.length && !dCards.length) {
    pCards = next.hands.map(() => []);
    setView(1); await wait(400);
    setTimeout(() => setView(0), 3600);
    pCards[0].push(await dealTo(next.hands[0].cards[0], pPos(0, 0, n)));
    dCards.push(await dealTo(next.dealer[0], dPos(0)));
    pCards[0].push(await dealTo(next.hands[0].cards[1], pPos(0, 1, n)));
    dCards.push(await dealTo(null, dPos(1), true));
  }
  // a split: the second card moves to the new hand
  while (pCards.length < n) {
    const i = pCards.findIndex((h, k) => h.length >= 2 && h[1].userData.code !== next.hands[k].cards[1]); if (i < 0) break;
    const moved = pCards[i].splice(1, 1)[0]; pCards.splice(i + 1, 0, [moved]);
  }
  for (let h = 0; h < n; h++) for (let c = 0; c < (pCards[h] || []).length; c++) await fly(pCards[h][c], pPos(h, c, n), 220, { lift: 0.01 });
  for (let h = 0; h < n; h++) { pCards[h] ||= []; for (let c = pCards[h].length; c < next.hands[h].cards.length; c++) pCards[h].push(await dealTo(next.hands[h].cards[c], pPos(h, c, n))); }
  if (n > 1) drawBet("main", 0);
  if (dCards[1] && !dCards[1].userData.code && next.dealer[1] !== "??") { setView(0.45); await wait(500); await flip(dCards[1], next.dealer[1]); await wait(600); }
  for (let c = dCards.length; c < next.dealer.length; c++) { dCards.push(await dealTo(next.dealer[c], dPos(c))); await wait(250); }
  clearLabels();
  const OUT = { win: "ניצחון", blackjack: "בלאק ג׳ק!", push: "תיקו", lose: "הפסד", bust: "נשרף", surrender: "ויתור" };
  next.hands.forEach((h, i) => {
    const o = next.result?.hands?.[i]?.outcome, cls = o === "win" || o === "blackjack" ? "win" : o && o !== "push" ? "lose" : "";
    label(o ? `${h.total} · ${OUT[o]}` : (n > 1 && next.status !== "done" && i === next.active ? "▶ " : "") + h.total, pPos(i, 0, n).add(new THREE.Vector3(-0.13, 0, 0)), cls);
  });
  label(next.dealer_total, dPos(0).add(new THREE.Vector3(-0.14, 0, 0)));
  st = next; if (next.balance != null) { balance = Number(next.balance); }
  if (next.status === "done") await finish(next); else if (next.actions?.includes("insurance")) voice("insurance");
  busy = false; showActs();
}
async function finish(r) {
  setView(0);
  const net = Number(r.result.net), outs = r.result.hands.map((h) => h.outcome);
  showBal(balance);
  if (outs.length === 1 && outs[0] === "blackjack") voice("blackjack");
  else if (net > 0 && Number(r.dealer_total) > 21) voice("dealerbust");
  else if (net > 0) voice("youwin");
  else if (outs.every((o) => o === "push")) voice("push");
  else if (outs.every((o) => o === "bust")) voice("bust");
  else if (net < 0) voice("dealerwins");
  const sides = Object.entries(r.result.side || {}).filter(([k, v]) => SIDE_NAME[k] && v && v !== 0).map(([k, v]) => `${SIDE_NAME[k]}${typeof v === "number" ? " " + v + ":1" : ""}`);
  const el = $("result"); el.innerHTML = (net > 0 ? `<div class="w">ניצחת ${fmt(net)}</div>` : net < 0 ? `<div class="l">הפסדת ${fmt(-net)}</div>` : `<div class="l">תיקו</div>`)
    + (sides.length ? `<div class="l">זכייה בצד: ${sides.join(" · ")}</div>` : "");
  el.hidden = false; if (net > 0) sfx(() => SFX.win(net >= Number(r.staked) * 2));
  if (net > 0 && net >= Number(r.staked) * 20) setTimeout(() => sfx(() => GC_BONUS("🃏 זכייה גדולה!", net, "")), 300);
  await wait(2600);
  el.hidden = true; clearLabels();
  for (const c of [...pCards.flat(), ...dCards]) { const to = new THREE.Vector3(-0.6, H + 0.05, -0.45); fly(c, to, 420).then(() => scene.remove(c)); }
  pCards = []; dCards = []; for (const k in bets) bets[k] = 0; drawAll(); await wait(450);
  st = null; showBar(); if (!LIVE) voice("bets");
}
function showActs() {
  const playing = st && st.status !== "done";
  $("bar").classList.toggle("off", !!playing || busy); $("acts").classList.toggle("off", !playing || busy);
  document.querySelectorAll("#acts .a").forEach((b) => { b.hidden = !(st && st.actions && st.actions.includes(b.dataset.a)); b.disabled = busy; });
  showBar();
}
$("deal").onclick = async () => {
  if (busy || !bets.main) return;
  if (totalBet() > balance) { say("אין מספיק שקלים"); return; }
  if (LIVE && !PREVIEW) {
    if (!canBetLive()) { say("ההימורים סגורים, מחכים לסיבוב הבא"); return; }
    busy = true; showActs(); let d2;
    try { const { data, error } = await db.rpc("bjt_bet", { p_t: TABLE_NO, p_main: bets.main, p_pp: bets.pp, p_t3: bets.t3, p_ll: bets.ll, p_bust: bets.bust, p_ref: newRef() }); if (error) throw error; d2 = data; }
    catch (e) { busy = false; showActs(); say(errText(e), 3000); return; }
    lastBets = { ...bets }; busy = false; await tApply(d2); return;
  }
  busy = true; showActs(); let d;
  try { d = await srvDeal(bets); } catch (e) { busy = false; showActs(); say(errText(e), 3000); return; }
  lastBets = { ...bets }; showBal(Number(d.balance));
  await render(d);
};
document.querySelectorAll("#acts .a").forEach((b) => b.onclick = async () => {
  if (busy || !st) return; busy = true; showActs(); let d;
  try { d = await srvAct(b.dataset.a); } catch (e) { busy = false; showActs(); say(errText(e), 3000); return; }
  if (b.dataset.a === "double" && st && st.hands.length === 1) drawBet("main", bets.main * 2);
  await render(d);
});

// ---------- local engine for ?preview (same rules as the server: 6 decks, S17, 3:2) ----------
function previewEngine() {
  const R = "A23456789TJQK", S = "CDHS"; let shoe = [];
  const draw = () => { if (shoe.length < 20) { shoe = []; for (let d = 0; d < 6; d++) for (const r of R) for (const s of S) shoe.push(r + s); shoe.sort(() => Math.random() - 0.5); } return shoe.pop(); };
  const val = (c) => c[0] === "A" ? 11 : "TJQK".includes(c[0]) ? 10 : +c[0];
  const tot = (cs) => { let t = 0, a = 0; for (const c of cs) { t += val(c); if (c[0] === "A") a++; } while (t > 21 && a) { t -= 10; a--; } return t; };
  let r = null;
  const view = () => ({ ...r, hands: r.hands.map((h) => ({ ...h, total: tot(h.cards) })), dealer: r.status === "done" ? r.dealer : [r.dealer[0], "??"],
    dealer_total: r.status === "done" ? tot(r.dealer) : val(r.dealer[0]), actions: acts(), balance, staked: r.staked, main_bet: r.main_bet });
  const acts = () => { if (r.status !== "playing") return []; const h = r.hands[r.active], a = ["hit", "stand"];
    if (h.cards.length === 2 && balance >= h.bet) a.push("double"); if (h.cards.length === 2 && val(h.cards[0]) === val(h.cards[1]) && r.hands.length < 4 && balance >= h.bet) a.push("split");
    if (h.cards.length === 2 && r.hands.length === 1) a.push("surrender"); return a; };
  const settle = () => {
    while (r.hands.some((h) => !h.bust && !h.surr) && tot(r.dealer) < 17) r.dealer.push(draw());
    const d = tot(r.dealer), dbj = d === 21 && r.dealer.length === 2; let pay = 0; const out = [];
    for (const h of r.hands) { const t = tot(h.cards), bj = t === 21 && h.cards.length === 2 && r.hands.length === 1;
      let o; if (h.surr) { o = "surrender"; pay += h.bet / 2; } else if (t > 21) o = "bust"; else if (bj && !dbj) { o = "blackjack"; pay += h.bet * 2.5; } else if (dbj) o = "lose";
      else if (d > 21 || t > d) { o = "win"; pay += h.bet * 2; } else if (t === d) { o = "push"; pay += h.bet; } else o = "lose"; out.push({ outcome: o }); }
    balance += pay; r.status = "done"; r.result = { hands: out, net: pay - r.staked, dealer_blackjack: dbj };
  };
  const next = () => { while (r.active < r.hands.length && (tot(r.hands[r.active].cards) >= 21 || r.hands[r.active].done)) r.active++; if (r.active >= r.hands.length) settle(); };
  return {
    deal(bs) { const b = bs.main, side = bs.pp + bs.t3 + bs.ll + bs.bust; balance -= b + side; r = { id: 1, status: "playing", hands: [{ cards: [draw(), draw()], bet: b }], dealer: [draw(), draw()], active: 0, staked: b + side, main_bet: b };
      if (/force=bj/.test(location.search)) r.hands[0].cards = ["AS", "KH"];
      if (tot(r.hands[0].cards) === 21 || tot(r.dealer) === 21) settle(); return view(); },
    act(a) { const h = r.hands[r.active];
      if (a === "hit") { h.cards.push(draw()); if (tot(h.cards) > 21) h.bust = true; }
      if (a === "stand") h.done = true;
      if (a === "double") { balance -= h.bet; r.staked += h.bet; h.bet *= 2; h.cards.push(draw()); h.done = true; }
      if (a === "surrender") { h.surr = true; h.done = true; }
      if (a === "split") { balance -= h.bet; r.staked += h.bet; const c2 = h.cards.pop(); h.cards.push(draw()); r.hands.splice(r.active + 1, 0, { cards: [c2, draw()], bet: h.bet }); }
      next(); return view(); } };
}

// ---------- video players beside you (preview of the live table): right = player 1, left = player 2 ----------
// Each is a plane behind the rail, turned toward the middle; the flat dark background is keyed out in the shader.
// idle loops; win plays once and returns to idle. (?side=win plays the win clips, for testing)
const SEATS = [];
function videoSeat({ idle, win, x, z, rotY, w }) {
  const mk = (src, loop) => { const v = document.createElement("video"); v.src = src; v.muted = true; v.loop = loop; v.playsInline = true; v.preload = "auto"; return v; };
  const vi = mk(idle, true), vw = mk(win, false);
  const ti = new THREE.VideoTexture(vi), tw = new THREE.VideoTexture(vw); ti.colorSpace = tw.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.ShaderMaterial({ uniforms: { map: { value: ti } }, transparent: true, depthWrite: false,
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform sampler2D map; varying vec2 vUv; void main(){ vec4 c = texture2D(map, vUv); vec3 s = c.rgb;" +
      " float d = length(s - vec3(0.075, 0.022, 0.012)); float a = smoothstep(0.09, 0.17, d);" +
      " a *= smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x) * smoothstep(1.0, 0.95, vUv.y);" +
      " gl_FragColor = vec4(s, a); }" });
  const h = w * 496 / 864, pl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  pl.position.set(x, 0.97 + h / 2, z); pl.rotation.y = rotY; pl.renderOrder = -1; scene.add(pl);
  const seat = { vi, vw, mat, ti, tw,
    win() { vw.currentTime = 0; mat.uniforms.map.value = tw; vw.play().catch(() => {}); },
    idle() { mat.uniforms.map.value = ti; vi.play().catch(() => {}); } };
  vw.addEventListener("ended", () => seat.idle());
  seat.idle(); addEventListener("pointerdown", () => { vi.play().catch(() => {}); }, { once: true });
  seat.mesh = pl; SEATS.push(seat); return seat;
}
// two characters (filmed for one side each); a player gets one at random (stable per user); if both side players
// need the same side, the second one is mirrored onto the other side.
const CHARS = [{ idle: "vid/r3d/player1_idle_loop.mp4?v=1", win: "vid/r3d/player1_win.mp4?v=1", side: 1, w: 0.62 },
               { idle: "vid/r3d/player2_idle_loop.mp4?v=1", win: "vid/r3d/player2_win.mp4?v=1", side: -1, w: 0.56 }];
const SLOT = { [1]: { x: 1.2, z: 0.12, rotY: -1.15, bet: new THREE.Vector3(0.78, H, 0.05) }, [-1]: { x: -1.2, z: 0.12, rotY: 1.15, bet: new THREE.Vector3(-0.78, H, 0.05) } };
const charOf = (id) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % CHARS.length; };
const slotSeat = {};                                  // side -> { key, seat }
function seatAt(side, ci) {
  const key = ci + ":" + side, cur = slotSeat[side];
  if (cur && cur.key === key) return cur.seat;
  if (cur) { scene.remove(cur.seat.mesh); cur.seat.vi.pause(); cur.seat.vw.pause(); }
  const c = CHARS[ci], sl = SLOT[side], seat = videoSeat({ idle: c.idle, win: c.win, x: sl.x, z: sl.z, rotY: sl.rotY, w: c.w });
  if (c.side !== side) seat.mesh.scale.x = -1;        // mirrored onto the other side
  slotSeat[side] = { key, seat }; return seat;
}
function clearSeat(side) { const cur = slotSeat[side]; if (cur) { scene.remove(cur.seat.mesh); cur.seat.vi.pause(); cur.seat.vw.pause(); delete slotSeat[side]; } }
if (!LIVE && PREVIEW && /[?&]seats\b/.test(location.search)) { seatAt(1, 0); seatAt(-1, 1); }

// ---------- the live table: poll bjt_state, bet with bjt_bet, play my hand with bj_action, draw the two players beside me ----------
let T = null, tBusy = false, doneId = null, othersG = new THREE.Group(), winShown = {};
scene.add(othersG);
const betLabels = [];
function betLabel(text, pos) { const el = document.createElement("div"); el.className = "tot num"; el.textContent = text; document.body.appendChild(el); betLabels.push({ el, pos }); }
function clearBetLabels() { betLabels.splice(0).forEach((l) => l.el.remove()); }
function drawOthers() {
  othersG.clear(); clearBetLabels();
  if (bets.main && !(LIVE && T && T.my_bet && !st)) betLabel(fmt(totalBet()), new THREE.Vector3(BET.x, H, BET.z + 0.12));
  if (!T) return;
  const me = T.me && T.me.user_id, others = T.players.filter((p) => p.id !== MY_ID).slice(0, 2);
  const sides = []; for (const p of others) { let sd = CHARS[charOf(p.id)].side; if (sides.includes(sd)) sd = -sd; sides.push(sd); }
  for (const sd of [1, -1]) if (!sides.includes(sd)) clearSeat(sd);
  others.forEach((p, k) => {
    const sd = sides[k], seat = seatAt(sd, charOf(p.id)), sl = SLOT[sd];
    let a = Number(p.bet) + Object.values(p.side || {}).reduce((x, y) => x + Number(y || 0), 0), i = 0;
    for (const c of [...ALL_CHIPS].reverse()) while (a >= c.v && i < 12) { const m = chipMesh(c.v); m.position.set(sl.bet.x, H + CHIP_T / 2 + i * CHIP_T, sl.bet.z); othersG.add(m); a -= c.v; i++; }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.078, 48), new THREE.MeshBasicMaterial({ color: 0xd6b06a })); ring.rotation.x = -Math.PI / 2; ring.position.set(sl.bet.x, H + 0.002, sl.bet.z); othersG.add(ring);
    (p.hands || []).forEach((h, hi) => h.cards.forEach((cd, ci) => {
      const m = cardMesh(cd); m.position.set(sl.bet.x - sd * (0.03 + ci * 0.07 + hi * 0.2), H + 0.002 + ci * 0.0006, sl.bet.z - 0.2 - ci * 0.012); m.rotation.z = sd * 0.35; othersG.add(m); }));
    const o = p.out && p.out[0] && p.out[0].outcome, OUT = { win: "ניצחון", blackjack: "בלאק ג׳ק!", push: "תיקו", lose: "הפסד", bust: "נשרף", surrender: "ויתור" };
    const tot = p.hands && p.hands[0] ? p.hands[0].total : "";
    betLabel(`${p.name} · ${fmt(p.bet)}${tot !== "" ? " · " + tot : ""}${o ? " · " + OUT[o] : p.status === "waiting" ? " · עומד ✓" : ""}`, sl.bet.clone().add(new THREE.Vector3(0, 0, 0.13)));
    if (Number(p.net) > 0 && winShown[p.id] !== T.round) { winShown[p.id] = T.round; seat.win(); }
  });
  if (!T.me && T.dealer && T.dealer.length && !dCards.length) T.dealer.forEach((cd, i) => { const m = cardMesh(cd === "??" ? null : cd); m.position.copy(dPos(i)); othersG.add(m); });
}
let MY_ID = null;
async function tApply(d) {
  if (!d) return; d._t = Date.now(); T = d; balance = Number(d.balance); if (!busy) showBal(balance);
  const m = d.me;
  if (m && !busy && m.id !== doneId) {
    if (!st || st.id !== m.id) { if (!bets.main && d.my_bet) { bets.main = Number(d.my_bet.main); drawAll(); } await render(m); }
    else if (st.status !== m.status || st.dealer.length !== m.dealer.length || JSON.stringify(st.hands) !== JSON.stringify(m.hands)) await render(m);
    if (m.status === "done") doneId = m.id;
  }
  drawOthers(); showActs();
}
async function tPoll() {
  if (tBusy || document.hidden || !$("enter").hidden) return; tBusy = true;
  try { const { data, error } = PREVIEW ? { data: fakeT() } : await db.rpc("bjt_state", { p_t: TABLE_NO }); if (!error) await tApply(data); } catch (e) {}
  tBusy = false;
}
function canBetLive() { return LIVE && T && T.phase === "betting" && !T.my_bet; }
setInterval(() => {                                    // the betting clock in the message pill
  if (!LIVE || !T) return; const s2 = $("say");
  if (T.phase === "betting" && T.bet_until) { const left = Math.max(0, Math.ceil((T.bet_until - (Date.now() + (T.now - T._t))) / 1000));
    s2.textContent = T.my_bet ? `ההימור נשלח · מחלקים בעוד ${left}` : `הימורים נסגרים בעוד ${left}`; s2.classList.add("on"); }
  else if (T.phase === "betting" && !T.bet_until) { s2.textContent = "מחכים להימור הראשון"; s2.classList.add("on"); }
  else s2.classList.remove("on");
}, 250);
// preview: two friends with cards so the live table can be looked at without a login
let fakeN = 0;
function fakeT() { fakeN++; return { round: 1, phase: "playing", now: Date.now(), bet_until: null, dealer: ["KH", "??"], balance, me: null, my_bet: null,
  players: [{ id: "a1", name: "אורי", bet: 10000, side: {}, status: "playing", net: fakeN > 3 ? 10000 : null, hands: [{ cards: ["9S", "TD"], total: 19 }], out: fakeN > 3 ? [{ outcome: "win" }] : null },
            { id: "b2", name: "דניאל", bet: 100000, side: {}, status: "waiting", hands: [{ cards: ["AS", "7C"], total: 18 }] }] }; }

// ---------- render loop ----------
let baseFov = 60;
function fit() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h;
  const hfov = 80 * Math.PI / 180; baseFov = Math.min(70, 2 * Math.atan(Math.tan(hfov / 2) / camera.aspect) * 180 / Math.PI); camera.fov = baseFov / zoom; camera.updateProjectionMatrix();
}
$("zin").onclick = () => { zoom = Math.min(2.4, zoom * 1.3); };
$("zout").onclick = () => { zoom = Math.max(1, zoom / 1.3); };
addEventListener("resize", fit); fit();
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  for (let i = tweens.length - 1; i >= 0; i--) if (!tweens[i](now)) tweens.splice(i, 1);
  if (userU !== null && !drag && now - userAt > 3000) { userU = null; userYaw = 0; }    // back to the game's view
  const want = userU ?? autoU; u += (want - u) * (1 - Math.pow(userU !== null ? 0.0001 : 0.15, dt));
  const target = autoU > 0.3 && autoU < 0.7 && userU === null ? LOOK_HOLE : (u < 0 ? LOOK_BET.clone().lerp(LOOK_DOWN, -u) : LOOK_BET.clone().lerp(LOOK_DEALER, u));
  LOOK.lerp(target, 1 - Math.pow(0.05, dt)); yaw += (userYaw - yaw) * (1 - Math.pow(0.002, dt));
  camera.position.copy(EYE); const L = LOOK.clone().sub(EYE).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(EYE); L.y += Math.abs(yaw) * 0.45; camera.lookAt(L);   // looking to a side lifts the view to the player's face
  const f = baseFov / zoom; if (Math.abs(camera.fov - f) > 0.05) { camera.fov += (f - camera.fov) * (1 - Math.pow(0.01, dt)); camera.updateProjectionMatrix(); }
  renderer.render(scene, camera); placeLabels(); for (const l of betLabels) { const q = l.pos.clone().project(camera); l.el.style.left = (q.x + 1) / 2 * innerWidth + "px"; l.el.style.top = (1 - q.y) / 2 * innerHeight + "px"; l.el.style.display = q.z < 1 ? "" : "none"; }
}

(async function boot() {
  requestAnimationFrame(frame);
  if (LIVE) { $("deal").textContent = "שלח הימור"; document.querySelector(".top h1").textContent = "בלאק ג׳ק 3D לייב"; document.title = "בלאק ג׳ק 3D לייב · גולן קזינו"; }
  if (PREVIEW) { balance = 50000000; showBal(balance); }
  else {
    const { data: { session } } = await db.auth.getSession();
    if (!session) { location.href = "./"; return; }
    MY_ID = session.user.id;
    const w = await db.from("wallets").select("balance").eq("user_id", session.user.id).single();
    if (!w.error) { balance = Number(w.data.balance); showBal(balance); }
  }
  showBar();
  try { GC_LOADER.done(); } catch (e) {} try { GC_LOOKHINT(canvas, { side: true }); } catch (e) {}
  $("enterGo").onclick = async () => {
    $("enter").hidden = true; dealerPlay("idle"); vDeal.load(); vDeal.play().then(() => { vDeal.pause(); vDeal.currentTime = 0; }).catch(() => {}); preload("bets"); setTimeout(() => voice("bets"), 900);
    ["blackjack", "dealerbust", "youwin", "dealerwins", "push", "insurance", "bust"].forEach(preload);
    if (LIVE) { tPoll(); setInterval(tPoll, 2000); document.addEventListener("visibilitychange", () => { if (!document.hidden) tPoll(); }); }
    else if (!PREVIEW) { const { data } = await db.rpc("bj_current"); if (data && data.status !== "done" && !data.table) { bets.main = Number(data.main_bet); drawAll(); await render(data); } }
  };
  window.__gameReady = 1;
  if (window.__enterWanted) { const b = $("enterGo"); b.disabled = false; b.textContent = "לשולחן"; addEventListener("pointerdown", () => { vIdle.play().catch(() => {}); }, { once: true }); b.click(); }   // tapped while loading (the video may need one more tap to start)
  else if (/[?&]go\b/.test(location.search)) $("enterGo").click();
})();
