// Golan Casino · 3D blackjack table. All game logic and randomness live in the database
// (bj_deal / bj_action); this file only renders state and sends the player's choices.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const db = supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);
const $ = (id) => document.getElementById(id);
const fmt = (n) => "₪" + Number(n).toLocaleString("en-US");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------- scene ----------------
const stage = $("stage");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c0806);
scene.fog = new THREE.Fog(0x0c0806, 12, 26);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);

scene.add(new THREE.HemisphereLight(0xffe7c4, 0x1a0f08, 0.45));
const key = new THREE.SpotLight(0xffe2b0, 220, 30, Math.PI / 5, 0.5, 1.6);
key.position.set(0, 10, 2.5); key.target.position.set(0, 0, 0.3);
key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004;
scene.add(key, key.target);
const fill = new THREE.PointLight(0xff9a5a, 18, 18); fill.position.set(-6, 4, 6); scene.add(fill);
const rimL = new THREE.PointLight(0xffd59a, 10, 14); rimL.position.set(6, 3, -4); scene.add(rimL);

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
function noise(ctx, w, h, alpha, n = 9000) {
  for (let i = 0; i < n; i++) { ctx.fillStyle = `rgba(${Math.random() < .5 ? 0 : 255},${Math.random() < .5 ? 0 : 255},${Math.random() < .5 ? 0 : 255},${alpha * Math.random()})`; ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
}

// Table geometry: half-circle felt, radius 4, straight dealer edge at z = -2.
const R = 4, CZ = -2;
const SPOTS = {
  main: { x: 0, z: 1.05, r: 0.42, label: "הימור" },
  pp:   { x: -1.95, z: 0.55, r: 0.3, label: "זוג מושלם" },
  ll:   { x: -1.05, z: 1.45, r: 0.3, label: "ליידיז מזל" },
  bust: { x: 1.05, z: 1.45, r: 0.3, label: "באסטר" },
  t3:   { x: 1.95, z: 0.55, r: 0.3, label: "21+3" },
};
const FW = 2048, FH = 2048;
const toPx = (x, z) => [((x / R + 1) / 2) * FW, ((-(z - CZ) / R + 1) / 2) * FH];  // matches CircleGeometry UVs after rotation

async function buildTable() {
  await document.fonts.load('700 60px "Frank Ruhl Libre"'); await document.fonts.load('500 40px "Heebo"');
  const felt = canvasTex(FW, FH, (ctx) => {
    const g = ctx.createRadialGradient(FW / 2, FH / 2, 100, FW / 2, FH / 2, FW / 2);
    g.addColorStop(0, "#137049"); g.addColorStop(1, "#0a4430");
    ctx.fillStyle = g; ctx.fillRect(0, 0, FW, FH); noise(ctx, FW, FH, 0.05, 60000);
    ctx.strokeStyle = "rgba(217,181,111,.9)"; ctx.fillStyle = "rgba(217,181,111,.95)"; ctx.textAlign = "center"; ctx.direction = "rtl";
    // arcs
    const [cx, cy] = toPx(0, CZ), pr = FW / 2 / R;
    ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(cx, cy, 2.75 * pr, 0, Math.PI); ctx.stroke();
    ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, 2.62 * pr, 0, Math.PI); ctx.stroke();
    ctx.font = '700 64px "Frank Ruhl Libre"'; let [x, y] = toPx(0, -0.15); ctx.fillText("בלאק ג׳ק משלם 3 ל־2", x, y);
    ctx.font = '500 38px "Heebo"'; [x, y] = toPx(0, 0.18); ctx.fillText("הדילר עומד על 17 רך · ביטוח משלם 2 ל־1", x, y);
    ctx.font = '500 30px "Heebo"'; [x, y] = toPx(0, -1.65); ctx.fillStyle = "rgba(217,181,111,.55)"; ctx.fillText("גולן קזינו · שקלים משחקיים בלבד", x, y);
    for (const [k, s] of Object.entries(SPOTS)) {
      const [sx, sy] = toPx(s.x, s.z), rr = s.r * pr;
      ctx.strokeStyle = "rgba(245,239,228,.85)"; ctx.lineWidth = k === "main" ? 7 : 5;
      ctx.beginPath(); ctx.arc(sx, sy, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(sx, sy, rr - 12, 0, Math.PI * 2); ctx.globalAlpha = .4; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(245,239,228,.9)"; ctx.font = (k === "main" ? '700 40px ' : '700 28px ') + '"Heebo"';
      ctx.fillText(s.label, sx, sy + rr + (k === "main" ? 50 : 40));
    }
  });
  const feltMesh = new THREE.Mesh(new THREE.CircleGeometry(R, 128, Math.PI, Math.PI),
    new THREE.MeshStandardMaterial({ map: felt, roughness: 0.95, metalness: 0 }));
  feltMesh.rotation.x = -Math.PI / 2; feltMesh.position.set(0, 0, CZ); feltMesh.receiveShadow = true; scene.add(feltMesh);

  const woodTex = canvasTex(1024, 128, (ctx, w, h) => {
    ctx.fillStyle = "#4a2a16"; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) { ctx.strokeStyle = `rgba(${20 + Math.random() * 40},${10 + Math.random() * 20},5,${Math.random() * .5})`; ctx.lineWidth = 1 + Math.random() * 3;
      const yy = Math.random() * h; ctx.beginPath(); ctx.moveTo(0, yy); for (let xx = 0; xx <= w; xx += 64) ctx.lineTo(xx, yy + Math.sin(xx / 90 + i) * 4); ctx.stroke(); }
  });
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping; woodTex.repeat.set(6, 1);
  const wood = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.45, metalness: 0.05, color: 0xd8b89a });
  const leather = new THREE.MeshStandardMaterial({ color: 0x1b100b, roughness: 0.55 });
  const rail = new THREE.Mesh(new THREE.TorusGeometry(R + 0.12, 0.2, 24, 160, Math.PI), leather);
  rail.rotation.x = Math.PI / 2; rail.rotation.z = Math.PI; rail.position.set(0, 0.06, CZ); rail.castShadow = rail.receiveShadow = true; scene.add(rail);
  const rimW = new THREE.Mesh(new THREE.TorusGeometry(R + 0.36, 0.07, 12, 160, Math.PI), wood);
  rimW.rotation.copy(rail.rotation); rimW.position.set(0, -0.02, CZ); scene.add(rimW);
  const back = new THREE.Mesh(new THREE.BoxGeometry(2 * R + 1, 0.22, 0.5), wood);
  back.position.set(0, 0.02, CZ - 0.2); back.castShadow = back.receiveShadow = true; scene.add(back);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.3, R + 0.1, 1.6, 96, 1, true, Math.PI / 2, Math.PI), wood);
  skirt.position.set(0, -0.85, CZ); scene.add(skirt);

  // Dealer chip tray and card shoe
  const tray = new THREE.Mesh(new RoundedBoxGeometry(2.4, 0.08, 0.5, 3, 0.04), new THREE.MeshStandardMaterial({ color: 0x0e0a08, roughness: .4 }));
  tray.position.set(0, 0.04, CZ + 0.45); tray.receiveShadow = true; scene.add(tray);
  [1000, 500, 100, 25, 10].forEach((v, i) => { for (let j = 0; j < 6; j++) { const c = chipMesh(v); c.position.set(-0.96 + i * 0.48, 0.1 + j * 0.052, CZ + 0.45); scene.add(c); } });
  const shoe = new THREE.Mesh(new RoundedBoxGeometry(0.75, 0.42, 1.1, 3, 0.05), new THREE.MeshStandardMaterial({ color: 0x2b0f12, roughness: .35, metalness: .1 }));
  shoe.position.set(2.7, 0.22, CZ + 0.55); shoe.rotation.y = -0.35; shoe.castShadow = true; scene.add(shoe);
  const dpile = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.25, 0.84, 2, 0.02), new THREE.MeshStandardMaterial({ map: backTex, roughness: .6 }));
  dpile.position.set(-2.8, 0.12, CZ + 0.6); dpile.rotation.y = 0.3; dpile.castShadow = true; scene.add(dpile);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({
    map: canvasTex(512, 512, (ctx, w, h) => { ctx.fillStyle = "#2a0d10"; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = "rgba(217,181,111,.12)"; ctx.lineWidth = 3;
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { ctx.beginPath(); ctx.arc(i * 64 + 32, j * 64 + 32, 20, 0, Math.PI * 2); ctx.stroke(); } noise(ctx, w, h, .06); }),
    roughness: 1 }));
  floor.material.map.wrapS = floor.material.map.wrapT = THREE.RepeatWrapping; floor.material.map.repeat.set(20, 20);
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.65; floor.receiveShadow = true; scene.add(floor);
}

// ---------------- cards ----------------
const RED = { H: 1, D: 1 }, SUIT = { S: "♠", H: "♥", D: "♦", C: "♣" };
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
const backTex = canvasTex(256, 358, (ctx, w, h) => {
  roundRect(ctx, 0, 0, w, h, 18); ctx.fillStyle = "#f4ede0"; ctx.fill();
  roundRect(ctx, 12, 12, w - 24, h - 24, 10); ctx.fillStyle = "#7a1420"; ctx.fill(); ctx.save(); ctx.clip();
  ctx.strokeStyle = "rgba(217,181,111,.55)"; ctx.lineWidth = 2;
  for (let i = -h; i < w + h; i += 16) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i, h); ctx.lineTo(i + h, 0); ctx.stroke(); }
  ctx.restore(); ctx.strokeStyle = "#d9b56f"; ctx.lineWidth = 4; roundRect(ctx, 22, 22, w - 44, h - 44, 8); ctx.stroke();
  ctx.fillStyle = "#d9b56f"; ctx.font = '700 44px "Frank Ruhl Libre", serif'; ctx.textAlign = "center"; ctx.fillText("ג", w / 2, h / 2 + 15);
});
const faceCache = {};
function faceTex(card) {
  if (faceCache[card]) return faceCache[card];
  const r = card[0] === "T" ? "10" : card[0], s = card[1], col = RED[s] ? "#b3121c" : "#14110f";
  return (faceCache[card] = canvasTex(256, 358, (ctx, w, h) => {
    roundRect(ctx, 0, 0, w, h, 18); ctx.fillStyle = "#fbf7ef"; ctx.fill(); ctx.strokeStyle = "#cfc6b4"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = col; ctx.textAlign = "center";
    ctx.font = '700 54px "Inter", sans-serif'; ctx.fillText(r, 36, 62); ctx.font = '44px serif'; ctx.fillText(SUIT[s], 36, 106);
    ctx.save(); ctx.translate(w, h); ctx.rotate(Math.PI); ctx.font = '700 54px "Inter", sans-serif'; ctx.fillText(r, 36, 62); ctx.font = '44px serif'; ctx.fillText(SUIT[s], 36, 106); ctx.restore();
    if ("JQK".includes(card[0])) {
      roundRect(ctx, 64, 74, w - 128, h - 148, 10); ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke();
      ctx.font = '700 120px "Frank Ruhl Libre", serif'; ctx.fillText(card[0], w / 2, h / 2 + 10); ctx.font = '56px serif'; ctx.fillText(SUIT[s], w / 2, h / 2 + 76);
    } else if (card[0] === "A") { ctx.font = '150px serif'; ctx.fillText(SUIT[s], w / 2, h / 2 + 52); }
    else { ctx.font = '130px serif'; ctx.fillText(SUIT[s], w / 2, h / 2 + 46); }
  }));
}
const CARD_W = 0.56, CARD_H = 0.8;
const cardGeo = new THREE.BoxGeometry(CARD_W, 0.006, CARD_H);
const edgeMat = new THREE.MeshStandardMaterial({ color: 0xeee6d6, roughness: .6 });
const backMat = new THREE.MeshStandardMaterial({ map: backTex, roughness: .55, alphaTest: .5 });
function cardMesh(card) {
  const face = new THREE.MeshStandardMaterial({ map: card === "??" ? backTex : faceTex(card), roughness: .5, alphaTest: .5 });
  const m = new THREE.Mesh(cardGeo, [edgeMat, edgeMat, face, backMat, edgeMat, edgeMat]);
  m.castShadow = true; m.userData.card = card; return m;
}
function revealCard(m, card) { m.material[2].map = faceTex(card); m.material[2].needsUpdate = true; m.userData.card = card; }

// ---------------- chips ----------------
const CHIP_COL = { 10: "#1d4f8a", 25: "#1f6b3e", 100: "#222222", 500: "#6b2a8a", 1000: "#b07a1f" };
const chipTexCache = {};
function chipTex(v) {
  return chipTexCache[v] ||= canvasTex(256, 256, (ctx, w) => {
    ctx.fillStyle = CHIP_COL[v]; ctx.beginPath(); ctx.arc(128, 128, 128, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f5efe4"; for (let i = 0; i < 8; i++) { ctx.save(); ctx.translate(128, 128); ctx.rotate(i * Math.PI / 4); ctx.fillRect(-14, -128, 28, 34); ctx.restore(); }
    ctx.strokeStyle = "rgba(245,239,228,.8)"; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(128, 128, 76, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#f5efe4"; ctx.font = '700 58px "Inter", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(v >= 1000 ? "1K" : v, 128, 132);
  });
}
const chipGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.05, 40);
function chipMesh(v) {
  const top = new THREE.MeshStandardMaterial({ map: chipTex(v), roughness: .4 });
  const side = new THREE.MeshStandardMaterial({ color: CHIP_COL[v], roughness: .45 });
  const m = new THREE.Mesh(chipGeo, [side, top, top]); m.castShadow = true; m.receiveShadow = true; return m;
}
function breakdown(amount) { const out = []; for (const v of [1000, 500, 100, 25, 10]) while (amount >= v && out.length < 14) { out.push(v); amount -= v; } return out; }
const stacks = {};  // key -> THREE.Group
function setStack(key, amount, x, z) {
  if (stacks[key]) scene.remove(stacks[key]);
  if (!amount) { delete stacks[key]; return; }
  const g = new THREE.Group(); breakdown(amount).forEach((v, i) => { const c = chipMesh(v); c.position.y = 0.025 + i * 0.052; c.rotation.y = Math.random(); g.add(c); });
  g.position.set(x, 0, z); scene.add(g); stacks[key] = g; return g;
}

// ---------------- text sprites (hand totals) ----------------
function label(text, color = "#f5efe4") {
  const t = canvasTex(256, 96, (ctx, w, h) => { roundRect(ctx, 8, 8, w - 16, h - 16, 40); ctx.fillStyle = "rgba(12,8,6,.82)"; ctx.fill(); ctx.strokeStyle = "rgba(217,181,111,.8)"; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = color; ctx.font = '700 48px "Inter", "Heebo", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, w / 2, h / 2 + 2); });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false })); s.scale.set(0.62, 0.23, 1); s.renderOrder = 10; return s;
}

// ---------------- tweens ----------------
const tweens = [];
const ease = (t) => 1 - Math.pow(1 - t, 3);
function tween(ms, step) { return new Promise((res) => { if (reduced) ms = Math.min(ms, 60); tweens.push({ t0: performance.now(), ms, step, res }); }); }
function flyTo(obj, to, { ms = 420, lift = 0.5, flip = null } = {}) {
  const from = obj.position.clone(), r0 = obj.rotation.z, r1 = flip == null ? r0 : flip;
  return tween(ms, (k) => { obj.position.lerpVectors(from, to, k); obj.position.y += Math.sin(k * Math.PI) * lift; obj.rotation.z = r0 + (r1 - r0) * k; });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));
const SHOE_POS = new THREE.Vector3(2.55, 0.42, CZ + 0.95);

// ---------------- table state ----------------
let dealerCards = [], handCards = [], handLabels = [], dealerLabel = null, activeRing = null, lastState = null, busy = false;
const DEALER_Z = CZ + 1.35, HAND_Z = 0.15;
function handX(i, n) { return n === 1 ? 0 : (i - (n - 1) / 2) * 1.35; }
function cardTarget(hand, idx, n) { return new THREE.Vector3(handX(hand, n) + idx * 0.2 - 0.1, 0.012 + idx * 0.007, HAND_Z - idx * 0.12); }
function dealerTarget(idx) { return new THREE.Vector3(idx * 0.62 - 0.31, 0.012, DEALER_Z); }

async function dealCard(card, target, faceUp = true) {
  const m = cardMesh(card === "??" ? "AS" : card); if (card === "??") m.userData.card = "??";
  m.position.copy(SHOE_POS); m.rotation.set(0, -0.35, Math.PI); scene.add(m);
  const rotY = m.rotation.y; tween(420, (k) => { m.rotation.y = rotY * (1 - k); });
  await flyTo(m, target, { flip: faceUp ? 0 : Math.PI });
  return m;
}
function clearTable() {
  [...dealerCards, ...handCards.flat()].forEach((m) => scene.remove(m));
  [...handLabels, dealerLabel, activeRing].forEach((s) => s && scene.remove(s));
  dealerCards = []; handCards = []; handLabels = []; dealerLabel = null; activeRing = null;
  for (const k of Object.keys(stacks)) if (k.startsWith("hand") || k.startsWith("pay") || k.startsWith("spot:")) setStack(k, 0);
}
function updateLabels(st) {
  handLabels.forEach((s) => scene.remove(s)); handLabels = [];
  const n = st.hands.length;
  st.hands.forEach((h, i) => {
    const out = st.result?.hands?.[i]?.outcome;
    const txt = out ? ({ win: "ניצחון", blackjack: "בלאק ג׳ק", push: "תיקו", lose: "הפסד", bust: "נשרף", surrender: "ויתור" })[out] : String(h.total);
    const s = label(txt, out === "win" || out === "blackjack" ? "#5fc48f" : out && out !== "push" ? "#e56b6f" : "#f5efe4");
    s.position.set(handX(i, n), 0.55, HAND_Z + 0.55); scene.add(s); handLabels.push(s);
  });
  if (dealerLabel) scene.remove(dealerLabel);
  dealerLabel = label(String(st.dealer_total)); dealerLabel.position.set(0, 0.55, DEALER_Z - 0.7); scene.add(dealerLabel);
  if (activeRing) scene.remove(activeRing);
  if (st.status === "playing" && n > 1) {
    activeRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.56, 48), new THREE.MeshBasicMaterial({ color: 0xd9b56f, transparent: true, opacity: .9 }));
    activeRing.rotation.x = -Math.PI / 2; activeRing.position.set(handX(st.active, n), 0.004, HAND_Z - 0.05); scene.add(activeRing);
  }
}
function placeHandStacks(st) {
  const n = st.hands.length;
  setStack("spot:main", 0);
  st.hands.forEach((h, i) => setStack("hand" + i, h.bet, handX(i, n) + 0.0, SPOTS.main.z + (n > 1 ? 0.0 : 0)));
}

// Sync scene with server state, animating only what changed.
async function sync(st) {
  busy = true; setControls(st);
  const n = st.hands.length;
  // splits: move the second card of a split hand into the new hand
  while (handCards.length < n && handCards.length > 0) {
    const i = handCards.findIndex((hc, k) => hc.length >= 2 && hc[1].userData.card !== st.hands[k].cards[1]);
    if (i < 0) break;
    const moved = handCards[i].splice(1, 1)[0]; handCards.splice(i + 1, 0, [moved]);
  }
  placeHandStacks(st);
  // re-layout existing cards
  await Promise.all(handCards.flatMap((hc, hi) => hc.map((m, ci) => flyTo(m, cardTarget(hi, ci, n), { ms: 300, lift: 0.1 }))));
  // initial deal order: player, dealer, player, dealer
  if (!dealerCards.length && !handCards.length) {
    handCards = st.hands.map(() => []);
    const seq = [["p", 0], ["d", 0], ["p", 1], ["d", 1]];
    for (const [who, idx] of seq) {
      if (who === "p") handCards[0].push(await dealCard(st.hands[0].cards[idx], cardTarget(0, idx, n)));
      else dealerCards.push(await dealCard(st.dealer[idx], dealerTarget(idx), st.dealer[idx] !== "??"));
      await sleep(90);
    }
  }
  // new player cards
  for (let i = 0; i < n; i++) {
    handCards[i] ||= [];
    for (let c = handCards[i].length; c < st.hands[i].cards.length; c++) { handCards[i].push(await dealCard(st.hands[i].cards[c], cardTarget(i, c, n))); await sleep(80); }
  }
  // dealer: reveal hole card, then draw
  if (dealerCards[1] && dealerCards[1].userData.card === "??" && st.dealer[1] !== "??") {
    revealCard(dealerCards[1], st.dealer[1]);
    await tween(380, (k) => { dealerCards[1].rotation.z = Math.PI * (1 - k); dealerCards[1].position.y = 0.012 + Math.sin(k * Math.PI) * 0.3; });
    await sleep(250);
  }
  for (let c = dealerCards.length; c < st.dealer.length; c++) { dealerCards.push(await dealCard(st.dealer[c], dealerTarget(c))); await sleep(350); }
  updateLabels(st);
  lastState = st; $("bal").textContent = fmt(st.balance);
  if (st.status === "done") await showResult(st);
  busy = false; setControls(st);
}

const SIDE_NAME = { pp: "זוג מושלם", t3: "21+3", ll: "ליידיז מזל", bust: "באסטר", insurance: "ביטוח" };
async function showResult(st) {
  const net = st.result.net, outs = st.result.hands.map((h) => h.outcome);
  let head = net > 0 ? `ניצחת ${fmt(net)}` : net < 0 ? `הפסדת ${fmt(-net)}` : "יצאת באפס";
  if (outs.length === 1 && outs[0] === "blackjack") head = `בלאק ג׳ק! ${fmt(net)}`;
  if (st.result.dealer_blackjack) head = "לדילר יש בלאק ג׳ק · " + head;
  const sideWins = Object.entries(st.result.side || {}).filter(([, v]) => v && v !== 0).map(([k, v]) => `${SIDE_NAME[k]}${typeof v === "number" ? " " + v + ":1" : ""}`);
  showMsg(head, sideWins.length ? "זכייה בהימור צדדי: " + sideWins.join(" · ") : "");
  // chips: winners get paid from the tray, losers go to the dealer
  const n = st.hands.length;
  await Promise.all(outs.map(async (o, i) => {
    const g = stacks["hand" + i]; if (!g) return;
    if (o === "lose" || o === "bust") await flyTo(g, new THREE.Vector3(0, 0, CZ + 0.45), { ms: 600, lift: 0.4 });
    else if (o === "win" || o === "blackjack") { const p = setStack("pay" + i, o === "blackjack" ? st.hands[i].bet * 1.5 : st.hands[i].bet, 0, CZ + 0.45);
      await flyTo(p, new THREE.Vector3(handX(i, n) + 0.36, 0, SPOTS.main.z), { ms: 600, lift: 0.4 }); }
  }));
  for (const k of ["pp", "t3", "ll", "bust"]) { const g = stacks["spot:" + k]; if (g) await flyTo(g, (st.result.side?.[k] ?? 0) > 0 ? new THREE.Vector3(g.position.x, 0, g.position.z + 0.6) : new THREE.Vector3(0, 0, CZ + 0.45), { ms: 450 }); }
}
let msgTimer; function showMsg(t, sub = "") { const m = $("msg"); m.innerHTML = ""; m.append(t); if (sub) { const s = document.createElement("small"); s.textContent = sub; m.append(s); } m.classList.add("show"); clearTimeout(msgTimer); msgTimer = setTimeout(() => m.classList.remove("show"), 3800); }

// ---------------- betting ----------------
let chip = 25; const bets = { main: 0, pp: 0, t3: 0, ll: 0, bust: 0 }; let lastBets = null;
document.querySelectorAll(".chip").forEach((b) => b.onclick = () => { chip = +b.dataset.v; document.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", x === b)); });
function renderBets() {
  for (const [k, s] of Object.entries(SPOTS)) setStack("spot:" + k, bets[k], s.x, s.z);
  const parts = Object.entries(bets).filter(([, v]) => v).map(([k, v]) => `${k === "main" ? "ראשי" : SIDE_NAME[k]} <b class="num">${fmt(v)}</b>`);
  $("betSummary").innerHTML = parts.length ? parts.join(" · ") : "עוד לא הנחת הימור";
  $("dealBtn").disabled = !bets.main;
}
function addBet(k) {
  if (lastState && lastState.status !== "done") return;
  if (lastState?.status === "done") { clearTable(); lastState = null; }
  const next = bets[k] + chip;
  if (k === "main" && next > 50000) return err("ההימור הראשי המקסימלי הוא ₪50,000.");
  if (k !== "main" && next > Math.max(bets.main, 0)) return err("הימור צדדי לא יכול להיות גבוה מההימור הראשי. הנח קודם הימור ראשי.");
  bets[k] = next; err(""); renderBets();
}
$("clearBtn").onclick = () => { Object.keys(bets).forEach((k) => bets[k] = 0); renderBets(); };
$("rebetBtn").onclick = () => { if (lastBets) { Object.assign(bets, lastBets); if (lastState?.status === "done") { clearTable(); lastState = null; } renderBets(); } };
$("dealBtn").onclick = async () => {
  if (busy || !bets.main) return;
  if (lastState?.status === "done") { clearTable(); lastState = null; }
  err(""); busy = true; $("dealBtn").disabled = true;
  const ref = crypto.randomUUID();
  const { data, error } = await db.rpc("bj_deal", { p_main: bets.main, p_pp: bets.pp, p_t3: bets.t3, p_ll: bets.ll, p_bust: bets.bust, p_ref: ref });
  busy = false;
  if (error) { renderBets(); return err(errText(error)); }
  lastBets = { ...bets };
  setStack("spot:main", 0);
  Object.keys(bets).forEach((k) => bets[k] = 0); $("betSummary").textContent = "";
  for (const k of ["pp", "t3", "ll", "bust"]) if (lastBets[k]) setStack("spot:" + k, lastBets[k], SPOTS[k].x, SPOTS[k].z);
  await sync(data);
};
document.querySelectorAll("#playUI .btn").forEach((b) => b.onclick = async () => {
  if (busy || !lastState) return;
  busy = true; setControls(lastState, true);
  const { data, error } = await db.rpc("bj_action", { p_round: lastState.id, p_action: b.dataset.a });
  busy = false;
  if (error) { setControls(lastState); return err(errText(error)); }
  await sync(data);
});
function setControls(st, lock = false) {
  const playing = st && st.status !== "done";
  $("betUI").hidden = !!playing; $("playUI").hidden = !playing;
  document.querySelectorAll("#playUI .btn").forEach((b) => { b.hidden = !st?.actions?.includes(b.dataset.a); b.disabled = busy || lock; });
  $("rebetBtn").disabled = !lastBets;
}
function err(t) { $("err").textContent = t; }
function errText(e) {
  const m = e.message || "";
  if (m.includes("insufficient_funds")) return "אין מספיק שקלים משחקיים להימור הזה. הקטן את ההימור.";
  if (m.includes("invalid_side_bet")) return "הימור צדדי לא יכול להיות גבוה מההימור הראשי.";
  if (m.includes("invalid_main_bet")) return "ההימור הראשי חייב להיות בין ₪10 ל־₪50,000.";
  if (m.includes("illegal_action")) return "הפעולה הזאת לא אפשרית כרגע.";
  if (m.includes("round_in_progress")) { resume(); return "יש לך יד פתוחה. ממשיכים ממנה."; }
  return "משהו השתבש. בדוק חיבור ונסה שוב.";
}

// ---------------- input: tap betting spots on the table ----------------
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(), spotMeshes = [];
for (const [k, s] of Object.entries(SPOTS)) { const m = new THREE.Mesh(new THREE.CircleGeometry(s.r + 0.08, 32), new THREE.MeshBasicMaterial({ visible: false })); m.rotation.x = -Math.PI / 2; m.position.set(s.x, 0.02, s.z); m.userData.spot = k; scene.add(m); spotMeshes.push(m); }
renderer.domElement.addEventListener("pointerup", (e) => {
  const r = renderer.domElement.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera); const hit = ray.intersectObjects(spotMeshes)[0]; if (hit) addBet(hit.object.userData.spot);
});

// ---------------- loop & layout ----------------
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h); camera.aspect = w / h;
  const portrait = w / h < 0.9;
  camera.fov = portrait ? 62 : 42;
  camera.position.set(0, portrait ? 7.2 : 5.6, portrait ? 6.6 : 5.6);
  camera.lookAt(0, 0, portrait ? -0.2 : -0.1); camera.updateProjectionMatrix();
}
addEventListener("resize", resize); resize();
let t0 = performance.now();
renderer.setAnimationLoop((now) => {
  for (let i = tweens.length - 1; i >= 0; i--) { const tw = tweens[i]; const k = Math.min(1, (now - tw.t0) / tw.ms); tw.step(ease(k)); if (k >= 1) { tweens.splice(i, 1); tw.res(); } }
  if (activeRing) activeRing.material.opacity = 0.55 + Math.sin(now / 250) * 0.35;
  key.position.x = Math.sin((now - t0) / 9000) * 0.3;
  renderer.render(scene, camera);
});

// ---------------- start ----------------
async function resume() { const { data } = await db.rpc("bj_current"); if (data) { clearTable(); await sync(data); } }
(async () => {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { location.href = "./"; return; }
  await buildTable(); renderBets();
  const { data: w } = await db.from("wallets").select("balance").eq("user_id", session.user.id).single();
  if (w) $("bal").textContent = fmt(w.balance);
  await resume();
  setControls(lastState);
})();
$("rulesBtn").onclick = () => $("rules").showModal();
