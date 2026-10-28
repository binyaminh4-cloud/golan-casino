// Golan Casino · מסע הדיג של עידו (live wheel room). The server decides every round (if_state / if_bet);
// this file only draws the shared clock, sends bets and plays the catch using the art kit's renderer.
const db = supabase.createClient(GC_CONFIG.supabaseUrl, GC_CONFIG.supabaseKey);
const $ = (id) => document.getElementById(id);
const fmt = (n) => { n = Number(n); const a = Math.abs(n); return a >= 1e12 ? "₪" + +(n / 1e12).toFixed(2) + "T" : a >= 1e9 ? "₪" + +(n / 1e9).toFixed(2) + "B" : a >= 1e6 ? "₪" + +(n / 1e6).toFixed(2) + "M" : "₪" + n.toLocaleString("en-US"); };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PREVIEW = /preview/.test(location.href);
const LAYOUT = ["dark","light","dark","light","blue","dark","light","dark","light","dark","orange","light","dark","light","dark","light","dark","blue","light","dark","light","dark","light","dark","light","red","dark","light","dark","light","blue","dark","light","dark","light","dark","orange","light","dark","light","dark","light","dark","blue","light","dark","light","dark","light","dark","light","dark","light"];
const ZONES = [["dark", "דג כהה", "×2"], ["light", "דג בהיר", "×2"], ["blue", "כחול", "×12–100"], ["orange", "כתום", "×16–200"], ["red", "אדום", "×40–500"]];
const ICON = { dark: "dark", light: "light", blue: "blue_i", orange: "orange_i", red: "red_i" };
const CATNAME = { dark: "דג כהה", light: "דג בהיר", blue: "דג כחול", orange: "דג כתום", red: "דג אדום" };

// coming soon: only the owner's test code opens the room
try { if (!PREVIEW && localStorage.getItem("gc_dev") !== "1") location.href = "./"; } catch (e) {}

// ---------- art ----------
const I = {}; const NAMES = ["bg", "main", "upper", "lower", "body", "head", "strain", "ul", "fl", "ur", "fr", "grip", "reel", "box", "lantern", "hole", "front", "splash", "ripple", "blue", "orange", "red", "dark", "light", "blue_i", "orange_i", "red_i", "rim", "hub", "pointer", "stand", "plaque"];
const loaded = Promise.all(NAMES.map((k) => new Promise((ok) => { const im = new Image(); im.onload = () => { I[k] = im; ok(); }; im.onerror = ok; im.src = `img/fishing/${k}.webp`; })));
const cv = $("cv"), ctx = cv.getContext("2d");
const TH = Math.PI * 2 / 53;

// boosts: a list of {seg, mult} (older rounds: one seg + maybe a whole colour)
function segMult(B, i, k) { if (!B) return 0; if (B.list && B.list.length) { const h = B.list.find((x) => x.seg === i); return h ? h.mult : 0; }
  return B.seg === i ? B.mult : B.cat === k ? B.cat_mult : 0; }
// best boost per betting zone, shown on the zone itself
function zoneBoosts(B) { const z = {}; for (let i = 0; i < 53; i++) { const m = segMult(B, i, LAYOUT[i]); if (m) z[LAYOUT[i]] = Math.max(z[LAYOUT[i]] || 0, m); } return z; }
let zbKey = "";
function paintZoneBoosts(B) { const z = zoneBoosts(B), key = JSON.stringify(z); if (key === zbKey) return; zbKey = key;
  document.querySelectorAll(".zone").forEach((b) => { let t = b.querySelector(".zb"); const m = z[b.dataset.k];
    if (!m) { if (t) t.remove(); return; } if (!t) { t = document.createElement("i"); t.className = "zb"; b.appendChild(t); } t.textContent = "×" + m; }); }
// wheel scene (adapted from the kit's wheelFrame): rotation and boost badges come from the round
function wheelScene(rot, t, B) {
  const C = FishingRender.contain;
  ctx.clearRect(0, 0, 1920, 1080); ctx.drawImage(I.main, 0, 0, 1920, 1080); ctx.fillStyle = "#03091644"; ctx.fillRect(0, 0, 1920, 1080);
  const cx = 610, cy = 550, r = 405; C(ctx, I.stand, cx - 500, 380, 1000, 650);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
  const colors = { dark: "#26445a", light: "#a0aeb9", blue: "#1856a0", orange: "#aa6423", red: "#a52e3a" };
  for (let i = 0; i < 53; i++) {
    const a = -Math.PI / 2 + i * TH, b = a + TH, k = LAYOUT[i];
    const g = ctx.createRadialGradient(-70, -110, 25, 0, 0, r); g.addColorStop(0, "#0c1724"); g.addColorStop(.55, colors[k]); g.addColorStop(.88, colors[k]); g.addColorStop(1, "#101c2c");
    ctx.fillStyle = g; ctx.strokeStyle = "#91764b"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r, a, b); ctx.closePath(); ctx.fill(); ctx.stroke();
    const bm = segMult(B, i, k);
    if (bm && t > 10.6) { ctx.save(); ctx.globalAlpha = .35 + .2 * Math.sin(t * 6); ctx.fillStyle = "#ffd34d"; ctx.fill(); ctx.restore(); }
    const mid = (a + b) / 2; ctx.save(); ctx.translate(Math.cos(mid) * 315, Math.sin(mid) * 315); ctx.rotate(mid + Math.PI / 2); if (I[ICON[k]]) C(ctx, I[ICON[k]], -20, -33, 40, 66);
    // boost badges: the one boosted friend-fish segment, or every segment of a boosted bonus colour
    const m = bm;
    if (m) {   // boost badge: lands with a pop during the 3 s reveal, then keeps glowing
      const age = Math.max(0, t - 10 - 0.25 - (i % 11) * 0.2), pop = age < .35 ? 1.8 - age * 2.3 : 1 + .06 * Math.sin(t * 6);
      if (age > 0) { ctx.translate(0, -70); ctx.scale(pop, pop); ctx.shadowColor = "#ffcf40"; ctx.shadowBlur = 30; ctx.fillStyle = "#ffe27a"; ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.lineWidth = 4; ctx.strokeStyle = "#8a5a00"; ctx.stroke(); ctx.fillStyle = "#3a2600"; ctx.font = "900 30px Inter, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("×" + m, 0, 2); }
    }
    ctx.restore();
  }
  ctx.restore();
  C(ctx, I.rim, cx - 480, cy - 480, 960, 960); C(ctx, I.hub, cx - 118, cy - 118, 236, 236); C(ctx, I.pointer, cx - 45, cy - 455, 90, 120);
  ctx.save(); ctx.translate(-300, 40); ctx.scale(1, 1);   // Ido sits right next to the wheel
  FishingRender.puppet(ctx, I, { bodyAngle: 0, headAngle: 0, handX: 0, handY: 0, reelAngle: t, breathing: 0 }); ctx.restore();
}

// ---------- shared clock ----------
let S = null, skew = 0, myBets = {}, sent = {}, lastBets = null, chip = 25, busy = false, balance = 0, lastRound = null, endShown = null;
const srvNow = () => Date.now() + skew;
const IDLE_SPEED = 0.16, TURNS = 5;
function rotAt(e) {   // e: seconds since the round started
  if (!S || S.stop == null || e < 13) return e * IDLE_SPEED;
  const r0 = 13 * IDLE_SPEED, target = -(S.stop + 0.5) * TH;
  let end = target; while (end < r0 + TURNS * Math.PI * 2) end += Math.PI * 2;
  const u = Math.min(1, (e - 13) / 7), ease = 1 - Math.pow(1 - u, 4);
  return r0 + (end - r0) * ease;
}
// camera: the scene fills the screen (cover); in the last seconds of the spin it pushes in on the pointer for the tension
const ease = (x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
let lastW = 0, lastH = 0;
function view(e) {
  const box = document.querySelector(".stagewrap"); if (box.clientWidth !== lastW || box.clientHeight !== lastH) { lastW = box.clientWidth; lastH = box.clientHeight; fit(); }
  // fit the whole wheel (rim top ≈70 → stand ≈1040 in scene pixels) into the space above the betting bar; Ido on its right
  const W = cv.width, H = cv.height, d = cv.width / Math.max(1, cv.clientWidth), bar = (document.querySelector(".betbar").offsetHeight + 6) * d;
  const s0 = Math.max(W / 1920, Math.min((H - bar) / 1050, W / 1250));
  let z = 1, fx = 110 + (W / s0) / 2, fy = 70 + (H - bar) / s0 / 2;
  if (S && S.stop != null) { const u = ease((e - 17.2) / 1.6) * (1 - ease((e - 21.6) / 1)); z = 1 + .7 * u; fx += (610 - fx) * u; fy += (330 - fy) * u; }
  const s = s0 * z, vh = H - bar; let ox = W / 2 - fx * s, oy = vh / 2 - fy * s;
  ox = Math.min(0, Math.max(W - 1920 * s, ox)); oy = Math.min(0, Math.max(H - 1080 * s, oy));
  ctx.setTransform(s, 0, 0, s, ox, oy);
}
const pop = $("bonusPop"), pcv = $("bonusCv"), pctx = pcv.getContext("2d");
function frame() {
  if (S && I.main) {
    const e = (srvNow() - S.start) / 1000;
    const isBonus = S.cat && ["blue", "orange", "red"].includes(S.cat) && S.total_mult;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#060c16"; ctx.fillRect(0, 0, cv.width, cv.height);
    view(e); wheelScene(rotAt(e), e, e >= 10 ? S.boosts : null); paintZoneBoosts(e >= 10 ? S.boosts : null);
    if (isBonus && e >= 20.8 && I[S.cat]) {   // the wheel stops; the catch opens in its own window over it
      pop.hidden = false; document.body.classList.add("catching");
      const p = FishingRender.bonusFrame(pctx, I, Math.max(0, e - 20.8), S.total_mult, S.cat);
      if (p.done && endShown !== S.round) showEnd();
    } else { pop.hidden = true; document.body.classList.remove("catching"); }
    if (e >= 20 && S.cat && !isBonus && endShown !== S.round) showEnd();
    phaseText(e);
  }
  requestAnimationFrame(frame);
}
function phaseText(e) {
  const t = e < 10 ? `הימורים · ${Math.ceil(10 - e)}` : e < 13 ? "⚡ מכפילים" : e < 20 ? "🎡 הגלגל מסתובב" : S.cat && ["blue", "orange", "red"].includes(S.cat) && !endShown ? "🎣 עידו דג!" : "תוצאות";
  if ($("phase").textContent !== t) $("phase").textContent = t;
  const open = e < 10; document.body.classList.toggle("closed", !open);
  // a big, clear countdown while bets are open (red in the last 3 seconds)
  const cd = $("count"), left = Math.ceil(10 - e);
  if (open && left > 0) { cd.hidden = false; if (cd.dataset.s !== String(left)) { cd.dataset.s = left; cd.innerHTML = `<small>הימורים נסגרים בעוד</small><b>${left}</b>`; cd.classList.toggle("hurry", left <= 3);
      cd.classList.remove("tick"); void cd.offsetWidth; cd.classList.add("tick"); if (left <= 3) try { SFX.tick(true); } catch (er) {} } }
  else if (e >= 10 && e < 13 && S.boosts) { cd.hidden = false; const b = S.boosts, key = "boost" + S.round;
    if (cd.dataset.s !== key) { cd.dataset.s = key; cd.classList.remove("hurry");
      const zb = zoneBoosts(b); cd.innerHTML = `<small>⚡ ${b.list ? b.list.length + " " : ""}מכפילים על הגלגל</small><b style="font-size:clamp(20px,5vh,34px)">${Object.entries(zb).map(([k, m]) => CATNAME[k] + " ×" + m).join(" · ")}</b>`; try { SFX.zap(); } catch (er) {} } }
  else cd.hidden = true;
}
function showEnd() {
  endShown = S.round; const r = $("result");
  const x = S.history && S.cat ? (["dark", "light"].includes(S.cat) ? 2 * (segMult(S.boosts, S.stop, LAYOUT[S.stop]) || 1) : S.total_mult) : null;
  const pay = S.payout || 0, staked = Object.values(S.mine || {}).reduce((a, b) => a + b, 0);
  r.innerHTML = `<b>${CATNAME[S.cat] || ""}${x ? ` · ×${Number(x).toLocaleString("en-US")}` : ""}</b>${staked ? (pay > 0 ? `<span class="win">זכית ${fmt(pay)}</span>` : `<span>לא הפעם</span>`) : ""}`;
  r.hidden = false; setTimeout(() => { r.hidden = true; }, 3500);
  if (pay > 0) { if (["blue", "orange", "red"].includes(S.cat) && window.GC_BONUS) GC_BONUS(`🎣 בונוס ${CATNAME[S.cat]} ×${S.total_mult}`, pay, "עידו הוציא אותו מהקרח"); else try { SFX.win(false); } catch (e) {} }
}

// ---------- betting ----------
const stepMax = (b) => { if (b < 500000) return 50000; let v = 500000, k = 0; for (;;) { const m = k % 3 === 1 ? 2.5 : 2; if (v * m > b) break; v *= m; k++; } return v / 5; };
const CHIPS = [5, 25, 100, 500, ...[1e3, 1e6, 1e9].flatMap((m) => [1, 5, 25, 100, 500].map((c) => c * m)), 1e12, 5e12];
const lab = (v) => String(fmt(v)).slice(1).replace(/,000$/, "K");
let rackKey = "";
function drawRack() {
  const ok = CHIPS.filter((v, i) => i < 6 || v * 20 <= balance), show = ok.slice(-6), k = show.join(",");
  if (k === rackKey) return; rackKey = k; if (!show.includes(chip)) chip = show[1];
  $("chips").innerHTML = show.map((v, i) => `<button class="chip c${i}" data-v="${v}" aria-pressed="${v === chip}">${lab(v)}</button>`).join("");
  $("chips").querySelectorAll(".chip").forEach((b) => GC_CHIPIFY(b, +b.dataset.v));
}
$("chips").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; chip = +b.dataset.v; $("chips").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); };
$("zones").innerHTML = ZONES.map(([k, n, p]) => `<button class="zone z-${k}" data-k="${k}"><img src="img/fishing/${ICON[k]}.webp" alt=""><span class="zn">${n}</span><small>${p}</small><b class="amt" data-a="${k}"></b></button>`).join("");
$("zones").onclick = (e) => { const b = e.target.closest(".zone"); if (b) add([b.dataset.k]); };
$("allBtn").onclick = () => add(["blue", "orange", "red"]);
$("clearBtn").onclick = () => { for (const k in myBets) myBets[k] = sent[k] || 0; drawBets(); };
$("rebetBtn").onclick = () => { if (!lastBets) return; for (const [k, v] of Object.entries(lastBets)) myBets[k] = Math.max(myBets[k] || 0, v); drawBets(); autoSend(); };
function add(keys) {
  if (!S || !S.open) return err("ההימורים לסיבוב הזה נסגרו. עוד רגע סיבוב חדש.");
  const cost = chip * keys.length, unsent = Object.keys(myBets).reduce((s, k) => s + (myBets[k] || 0) - (sent[k] || 0), 0);
  if (cost + unsent > balance) return err("אין מספיק שקלים להימור הזה.");
  for (const k of keys) { if ((myBets[k] || 0) + chip > maxBet()) return err(`מקסימום ${fmt(maxBet())} על כל אזור (היתרה שלך ${fmt(balance)}).`); }
  for (const k of keys) myBets[k] = (myBets[k] || 0) + chip;
  err(""); try { SFX.chip(); } catch (e) {} drawBets(); autoSend();
}
const maxBet = () => S && S.max_bet ? S.max_bet : stepMax(balance);
function drawBets() {
  for (const [k] of ZONES) { const a = document.querySelector(`[data-a="${k}"]`); a.textContent = myBets[k] ? lab(myBets[k]) : ""; a.classList.toggle("pending", (myBets[k] || 0) > (sent[k] || 0)); }
  const tot = Object.values(myBets).reduce((a, b) => a + b, 0);
  if (window.GC_LIMIT) GC_LIMIT(tot, maxBet(), balance, fmt);
}
let sendT = null;
function autoSend() { clearTimeout(sendT); sendT = setTimeout(sendNow, 450); }
async function sendNow() {
  if (busy || !S || !S.open || PREVIEW) return;
  const diff = {}; for (const k in myBets) { const d = (myBets[k] || 0) - (sent[k] || 0); if (d > 0) diff[k] = d; }
  if (!Object.keys(diff).length) return;
  busy = true;
  const { data, error } = await db.rpc("if_bet", { p_round: S.round, p_bets: diff, p_ref: crypto.randomUUID ? crypto.randomUUID() : Date.now() + "" + Math.random() });
  busy = false;
  if (error) { const m = error.message || ""; err(m.includes("betting_closed") ? "ההימורים נסגרו. ההימור לא נשלח." : m.includes("insufficient") ? "אין מספיק שקלים." : m.includes("invalid_amount") ? `מקסימום ${fmt(maxBet())} על כל אזור.` : "ההימור לא נשלח."); for (const k in myBets) myBets[k] = sent[k] || 0; drawBets(); return; }
  for (const k in diff) sent[k] = (sent[k] || 0) + diff[k];
  balance = data.balance; showBal(); drawBets(); autoSend();
}
function err(t) { $("err").textContent = t; }
function showBal() { $("bal").textContent = fmt(balance); drawRack(); }

// ---------- server state ----------
async function poll() {
  let data;
  if (PREVIEW) data = fakeState(); else { const r = await db.rpc("if_state"); if (r.error) return; data = r.data; }
  skew = data.now - Date.now();
  if (lastRound !== null && data.round !== lastRound) {   // a new round: the last one's bets become "repeat"
    if (Object.keys(sent).length) lastBets = { ...sent }; myBets = {}; sent = {}; endShown = null;
  }
  lastRound = data.round; S = data;
  if (data.mine) for (const [k, v] of Object.entries(data.mine)) { sent[k] = Math.max(sent[k] || 0, v); myBets[k] = Math.max(myBets[k] || 0, v); }
  if (!busy && data.balance != null && (srvNow() - data.start) / 1000 < 20 || (srvNow() - data.start) / 1000 > 21) { balance = data.balance; showBal(); }
  drawBets(); drawHist();
}
function drawHist() {
  $("hist").innerHTML = (S.history || []).slice(0, 10).map((h) => `<span class="h h-${h.cat}"><img src="img/fishing/${ICON[h.cat]}.webp" alt="">${h.x > 2 ? `<i>×${h.x}</i>` : ""}</span>`).join("");
}
let FAKE0 = Date.now();
function fakeState() {
  const t = Date.now(), e = ((t - FAKE0) / 1000) % 42, start = t - e * 1000;
  return { now: t, round: Math.floor((t - FAKE0) / 42000), start, open: e < 10, boosts: e >= 10 ? { list: [{ seg: 1, mult: 2 }, { seg: 6, mult: 2 }, { seg: 9, mult: 3 }, { seg: 13, mult: 2 }, { seg: 20, mult: 2 }, { seg: 28, mult: 5 }, { seg: 33, mult: 2 }, { seg: 47, mult: 2 }, { seg: 25, mult: 2 }] } : null, stop: e >= 13 ? 25 : null,
    cat: e >= 20 ? "red" : null, total_mult: e >= 20 ? 600 : null, mine: {}, payout: null, history: [{ cat: "dark", x: 2 }, { cat: "blue", x: 12 }, { cat: "light", x: 14 }], max_bet: 50000, balance: 100000 };
}
$("rulesBtn").onclick = () => $("rules").showModal();
(async () => {
  if (!PREVIEW) { const { data: { session } } = await db.auth.getSession(); if (!session) { location.href = "./"; return; } }
  await loaded; await poll(); setInterval(poll, 1000); requestAnimationFrame(frame);
  if (window.GC_LOADER) GC_LOADER.done();
})();
addEventListener("resize", fit); function fit() {
  const box = document.querySelector(".stagewrap"), d = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(box.clientWidth * d); cv.height = Math.round(box.clientHeight * d); cv.style.width = box.clientWidth + "px"; cv.style.height = box.clientHeight + "px";
  const pw = Math.min(box.clientWidth * .96, box.clientHeight * .9 * 16 / 9); pop.style.width = pw + "px"; pop.style.height = pw * 9 / 16 + "px";
}
fit(); setTimeout(fit, 300);
