import {
  registerRecognizedSketch,
  removeSketch,
  startInteractionEngine,
  stopInteractionEngine,
  getRegistry,
  getEngine,
  clearAllCooldowns,
} from '/static/animation/index.js';

import { STORY_TEMPLATES } from '/static/animation/storyTemplates.js';
import { detectParts, buildPartGroup, getSemanticScale, SEMANTIC_SCALE_KNOWN } from '/static/animation/partAnimator.js';
import { resolveProfile } from '/static/animation/semanticProfiles.js';


// ─── Config ───────────────────────────────────────────────────────────────────
const MIN_STROKES_FOR_DONE_BTN = 1;

const state = {
  activeZones: { left: false, right: false },
  submitted:   { left: false, right: false },
  drawSettings: {
    left:  { color: '#1a1a1a', size: 6, erasing: false },
    right: { color: '#1a1a1a', size: 6, erasing: false },
  },
  strokesByZone: { left: [], right: [] },
  analyzing: { left: false, right: false },
  results: { left: null, right: null },
  svgPaths: { left: [], right: [] },
  detectionModel: null,
  stream: null,
  // Stability state
  smoothedPersonX: [null, null],
  zoneMissCount: { left: 0, right: 0 },
};

// Detection Constants
const EMA_ALPHA    = 0.5;  // Very snappy
const MISS_TO_HIDE = 3;    // Reacts fast to leaving
const HYSTERESIS   = 0.04; // Very narrow neutral zone


// ─── DOM refs ────────────────────────────────────────────────────────────────
const canvas      = document.getElementById('draw-canvas');
const ctx         = canvas.getContext('2d');
const video       = document.getElementById('camera-video');
const pipCanvas   = document.getElementById('pip-canvas');
const statusBar   = document.getElementById('status-bar');
const welcome     = document.getElementById('welcome');
const startBtn    = document.getElementById('start-btn');
const zoneLeft    = document.getElementById('zone-left');
const zoneRight   = document.getElementById('zone-right');
const doneLeft    = document.getElementById('done-left');
const doneRight   = document.getElementById('done-right');
const spinLeft    = document.getElementById('spinner-left');
const spinRight   = document.getElementById('spinner-right');
const resultLeft  = document.getElementById('result-left');
const resultRight = document.getElementById('result-right');
const catLeft     = document.getElementById('cat-left');
const catRight    = document.getElementById('cat-right');
const labelLeft   = document.getElementById('label-left');
const labelRight  = document.getElementById('label-right');
const saveAllBtn  = document.getElementById('save-all-btn');

// ─── Canvas resize ───────────────────────────────────────────────────────────
function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  redrawAll();
}
window.addEventListener('resize', resizeCanvas);

// ─── Start ───────────────────────────────────────────────────────────────────
startBtn.addEventListener('click', async () => {
  welcome.style.display = 'none';
  setStatus('Requesting camera…');
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 1280, height: 720 } });
    video.srcObject = state.stream;
    await video.play();
    setStatus('Loading person detection…');
    await loadDetectionModel();
    resizeCanvas();
    setStatus('Step in front of the camera!');
    startDetectionLoop();
    setupDrawing();
    setupToolbar();
  } catch (e) {
    setStatus('❌ Camera error: ' + e.message);
    console.error(e);
  }
});

// ─── Load BlazeFace ──────────────────────────────────────────────────────────
async function loadDetectionModel() {
  await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
  await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/blazeface@0.0.7/dist/blazeface.min.js');
  state.detectionModel = await blazeface.load();
  console.log('BlazeFace ready');
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
}

// ─── Person detection loop (BlazeFace) ───────────────────────────────────────
function startDetectionLoop() {
  // Draw center split line on PiP canvas
  pipCanvas.width  = pipCanvas.offsetWidth  || 180;
  pipCanvas.height = pipCanvas.offsetHeight || 120;
  drawPipSplitLine();

  setInterval(async () => {
    if (!state.detectionModel || video.readyState < 2) return;
    try {
      // BlazeFace estimateFaces(video, returnTensors)
      const preds = await state.detectionModel.estimateFaces(video, false);
      // Convert face boxes to 'people' format for the existing updateZones logic
      const faces = preds.map(p => {
        const [x1, y1] = p.topLeft;
        const [x2, y2] = p.bottomRight;
        return { bbox: [x1, y1, x2 - x1, y2 - y1], score: 0.9 };
      });
      updateZones(faces);
    } catch (e) { console.warn('Face detection error:', e); }
  }, 100);
}

function drawPipSplitLine() {
  const ctx2 = pipCanvas.getContext('2d');
  const pw = pipCanvas.width;
  const ph = pipCanvas.height;
  ctx2.clearRect(0, 0, pw, ph);
  ctx2.save();
  ctx2.setLineDash([3, 3]);
  ctx2.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx2.lineWidth = 1;
  ctx2.beginPath();
  ctx2.moveTo(pw / 2, 0);
  ctx2.lineTo(pw / 2, ph);
  ctx2.stroke();
  ctx2.restore();
}

function updateZones(faces) {
  const W = video.videoWidth || 640;

  // 1. Convert face detections to mirrored center-X
  const currentDetections = faces.slice(0, 2).map(f => {
    const rawX = f.bbox[0] + f.bbox[2] / 2;
    return 1 - rawX / W; // mirrored X
  });

  // 2. Assign detections to slots (Nearest Neighbor)
  let newPositions = [null, null];
  if (currentDetections.length > 0) {
    if (currentDetections.length === 1) {
      const det = currentDetections[0];
      const d0 = state.smoothedPersonX[0] !== null ? Math.abs(det - state.smoothedPersonX[0]) : 999;
      const d1 = state.smoothedPersonX[1] !== null ? Math.abs(det - state.smoothedPersonX[1]) : 999;
      newPositions[d0 <= d1 ? 0 : 1] = det;
    } else {
      const [d1, d2] = currentDetections;
      const prev0 = state.smoothedPersonX[0] ?? 0.25;
      const prev1 = state.smoothedPersonX[1] ?? 0.75;
      if ((Math.abs(d1 - prev0) + Math.abs(d2 - prev1)) <= (Math.abs(d2 - prev0) + Math.abs(d1 - prev1))) {
        newPositions[0] = d1; newPositions[1] = d2;
      } else {
        newPositions[0] = d2; newPositions[1] = d1;
      }
    }
  }

  // 3. Update EMA
  for (let i = 0; i < 2; i++) {
    if (newPositions[i] !== null) {
      const prev = state.smoothedPersonX[i];
      state.smoothedPersonX[i] = prev === null ? newPositions[i] : prev + (newPositions[i] - prev) * EMA_ALPHA;
    }
  }

  // 4. Decide wanted zones
  const wanted = { left: false, right: false };
  for (let i = 0; i < 2; i++) {
    const mx = state.smoothedPersonX[i];
    if (mx === null) continue;
    
    if (mx < 0.5 - HYSTERESIS) {
      wanted.left = true;
    } else if (mx > 0.5 + HYSTERESIS) {
      wanted.right = true;
    } else {
      if (state.activeZones.left && mx < 0.5 + HYSTERESIS) wanted.left = true;
      else if (state.activeZones.right && mx > 0.5 - HYSTERESIS) wanted.right = true;
      else if (mx < 0.5) wanted.left = true; else wanted.right = true;
    }
  }

  // 5. Activate/Deactivate
  ['left', 'right'].forEach(zone => {
    if (wanted[zone]) {
      state.zoneMissCount[zone] = 0;
      setZoneActive(zone, true);
    } else {
      state.zoneMissCount[zone]++;
      if (state.zoneMissCount[zone] >= MISS_TO_HIDE) {
        if (!state.submitted[zone]) {
          setZoneActive(zone, false);
          if (zone === 'left') state.smoothedPersonX[0] = null;
          else state.smoothedPersonX[1] = null;
        }
      }
    }
  });

  if (faces.length === 0 && !wanted.left && !wanted.right) {
    setStatus('Step closer to the camera 👋');
  } else {
    const count = (wanted.left ? 1 : 0) + (wanted.right ? 1 : 0);
    setStatus(count === 1 ? '1 inventor detected 🎨' : '2 inventors detected 🎨🎨');
  }
}

function setZoneActive(side, active) {
  if (state.activeZones[side] === active) return;
  state.activeZones[side] = active;
  const zone    = side === 'left' ? zoneLeft    : zoneRight;
  const toolbar = document.getElementById(`toolbar-${side}`);
  if (active) {
    zone.classList.add('active');
    if (!state.submitted[side]) toolbar.classList.add('active');
  } else {
    // Always hide toolbar when person leaves
    toolbar.classList.remove('active');
    // Only hide zone if NOT yet submitted — submitted zones keep SVG visible
    if (!state.submitted[side]) {
      zone.classList.remove('active');
    }
  }
  redrawAll();
}

// ─── Drawing ──────────────────────────────────────────────────────────────────
function setupDrawing() {
  canvas.addEventListener('pointerdown',  onPointerDown);
  canvas.addEventListener('pointermove',  onPointerMove);
  canvas.addEventListener('pointerup',    onPointerUp);
  canvas.addEventListener('pointerleave', onPointerUp);
  canvas.addEventListener('pointercancel',onPointerUp);
}

// Per-pointer stroke state — enables simultaneous two-person drawing.
// Key: e.pointerId  Value: { zone, lastX, lastY, currentStroke }
const activeStrokes = new Map();

function getZoneForX(x) {
  return x < window.innerWidth / 2 ? 'left' : 'right';
}

function onPointerDown(e) {
  if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
  const zone = getZoneForX(e.clientX);
  if (!state.activeZones[zone]) return;
  if (state.analyzing[zone]) return;

  // Capture this pointer so we continue receiving moves even outside canvas
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}

  const s = state.drawSettings[zone];
  activeStrokes.set(e.pointerId, {
    zone,
    lastX: e.clientX,
    lastY: e.clientY,
    currentStroke: {
      zone,
      color:   s.erasing ? 'rgba(0,0,0,1)' : s.color,
      size:    s.erasing ? s.size * 4 : s.size,
      points:  [{ x: e.clientX, y: e.clientY }],
      erasing: s.erasing,
    },
  });
}

function onPointerMove(e) {
  const ps = activeStrokes.get(e.pointerId);
  if (!ps) return;

  // Don't let a stroke cross into the other zone
  if (getZoneForX(e.clientX) !== ps.zone) return;

  ps.currentStroke.points.push({ x: e.clientX, y: e.clientY });

  ctx.globalCompositeOperation = ps.currentStroke.erasing ? 'destination-out' : 'source-over';
  ctx.beginPath();
  ctx.strokeStyle = ps.currentStroke.color;
  ctx.lineWidth   = ps.currentStroke.size;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.moveTo(ps.lastX, ps.lastY);
  ctx.lineTo(e.clientX, e.clientY);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';

  ps.lastX = e.clientX;
  ps.lastY = e.clientY;
}

function onPointerUp(e) {
  const ps = activeStrokes.get(e.pointerId);
  if (!ps) return;
  activeStrokes.delete(e.pointerId);

  if (ps.currentStroke.points.length > 1) {
    const { zone } = ps.currentStroke;
    state.strokesByZone[zone].push(ps.currentStroke);

    const pts = ps.currentStroke.points;
    let d = `M${pts[0].x},${pts[0].y}`;
    pts.slice(1).forEach(p => d += ` L${p.x},${p.y}`);
    state.svgPaths[zone].push({
      d, color: ps.currentStroke.color, size: ps.currentStroke.size,
      erasing: ps.currentStroke.erasing,
    });

    updateDoneBtn(zone);
  }
}


function updateDoneBtn(zone) {
  const nonErase = state.strokesByZone[zone].filter(s => !s.erasing);
  const btn = zone === 'left' ? doneLeft : doneRight;
  if (nonErase.length >= MIN_STROKES_FOR_DONE_BTN) {
    btn.classList.add('visible');
  } else {
    btn.classList.remove('visible');
  }
  // Update undo button disabled state
  const undoBtn = document.getElementById(`undo-${zone}`);
  if (undoBtn) undoBtn.disabled = state.strokesByZone[zone].length === 0;
}

// ─── Redraw all ───────────────────────────────────────────────────────────────
function redrawAll() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ['left', 'right'].forEach(zone => {
    // Only draw strokes if the zone is currently active (person present) OR has been submitted
    if (!state.activeZones[zone] && !state.submitted[zone]) return;

    state.strokesByZone[zone].forEach(stroke => {
      if (stroke.points.length < 2) return;
      ctx.globalCompositeOperation = stroke.erasing ? 'destination-out' : 'source-over';
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth   = stroke.size;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      stroke.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    });
  });
  ctx.globalCompositeOperation = 'source-over'; // always reset
}

// ─── I'm Done ────────────────────────────────────────────────────────────────
doneLeft.addEventListener('click', () => analyzeZone('left'));
doneRight.addEventListener('click', () => analyzeZone('right'));

async function analyzeZone(zone) {
  if (state.analyzing[zone]) return;
  state.analyzing[zone] = true;

  const btn  = zone === 'left' ? doneLeft  : doneRight;
  const spin = zone === 'left' ? spinLeft  : spinRight;
  const res  = zone === 'left' ? resultLeft : resultRight;
  const catEl  = zone === 'left' ? catLeft  : catRight;
  const lblEl  = zone === 'left' ? labelLeft : labelRight;

  btn.disabled = true;
  spin.classList.add('visible');

  // Capture full composite (mountain SVG template + user strokes) for both
  // classification and animation. GPT-4o handles the background fine, and
  // including the mountain gives it crucial context for what was "invented".
  const zoneCanvas = await captureZoneCanvas(zone, false);
  state.snapshots = state.snapshots || {};
  state.snapshots[zone] = zoneCanvas;
  const dataUrl = zoneCanvas.toDataURL('image/png');

  try {
    const result = await identifyDoodle(dataUrl);
    console.log(`%c[classify] "${zone}" → ${result.label} (${result.category})`, 'color:#2d6a4f;font-weight:bold');
    state.results[zone] = result;
    state.submitted[zone] = true;

    const zoneEl = zone === 'left' ? zoneLeft : zoneRight;
    zoneEl.classList.add('submitted');

    catEl.textContent  = result.category;
    lblEl.textContent  = result.label;
    res.classList.add('visible');
    spin.classList.remove('visible');

    if (state.submitted.left && state.submitted.right) {
      setTimeout(() => transitionToAnimationStage(), 1000);
    }

    checkSaveAll();
  } catch (e) {
    spin.classList.remove('visible');
    btn.disabled = false;
    btn.textContent = '⚠ Retry';
    state.analyzing[zone] = false;
    console.error('[classify] Analysis failed:', e);
    setStatus('⚠ API error – check console');
  }
}

async function captureZoneCanvas(zone, strokesOnly = false) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const half = W / 2;
  const xOff = zone === 'left' ? 0 : half;
  const offscreen = document.createElement('canvas');
  offscreen.width  = half;
  offscreen.height = H;
  const oc = offscreen.getContext('2d');

  // Always start with white background
  oc.fillStyle = strokesOnly ? '#ffffff' : '#f8f5f0';
  oc.fillRect(0, 0, half, H);

  if (!strokesOnly) {
    // Draw cloud SVG at its screen position (used for animation snapshot)
    const cloudEl = document.querySelector(`#zone-${zone} .cloud-svg`);
    if (cloudEl) {
      const rect = cloudEl.getBoundingClientRect();
      let svgStr = new XMLSerializer().serializeToString(cloudEl);
      if (!svgStr.includes('xmlns=')) {
        svgStr = svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      }
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      await new Promise(resolve => {
        const img = new Image();
        img.onload = () => { oc.drawImage(img, rect.left - xOff, rect.top, rect.width, rect.height); URL.revokeObjectURL(url); resolve(); };
        img.onerror = resolve;
        img.src = url;
      });
    }
  }

  // User strokes on top
  oc.drawImage(canvas, xOff, 0, half, H, 0, 0, half, H);
  return offscreen;
}

async function identifyDoodle(dataUrl) {
  const resp = await fetch('/api/classify-sketch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ image: dataUrl }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Server Error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  if (data.error) {
      throw new Error(data.error);
  }
  return data;
}

// ─── Save all ────────────────────────────────────────────────────────────────
function checkSaveAll() {
  const hasAny = state.results.left || state.results.right;
  if (hasAny) saveAllBtn.classList.add('visible');
}

saveAllBtn.addEventListener('click', saveResults);

async function saveResults() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const exportData = [];

  for (const zone of ['left', 'right']) {
    if (!state.results[zone]) continue;

    // PNG (async — composites cloud + strokes)
    const zoneCanvas = await captureZoneCanvas(zone);
    const pngDataUrl = zoneCanvas.toDataURL('image/png');
    downloadDataUrl(pngDataUrl, `doodle_${zone}_${timestamp}.png`);

    const record = {
      zone,
      timestamp,
      category: state.results[zone].category,
      label:    state.results[zone].label,
      description: state.results[zone].description,
      svgPaths: state.svgPaths[zone],
      canvasWidth:  window.innerWidth / 2,
      canvasHeight: window.innerHeight,
    };
    exportData.push(record);
  }

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  downloadDataUrl(URL.createObjectURL(blob), `doodles_${timestamp}.json`);
  setStatus('✅ Saved!');
}

function downloadDataUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────
function setupToolbar() {
  // Color swatches — scoped per zone
  document.querySelectorAll('.color-swatch').forEach(el => {
    el.addEventListener('click', () => {
      const zone = el.dataset.zone;
      state.drawSettings[zone].color   = el.dataset.color;
      state.drawSettings[zone].erasing = false;
      // Update selected state only within this zone's toolbar
      document.querySelectorAll(`#toolbar-${zone} .color-swatch`)
        .forEach(s => s.classList.remove('selected'));
      el.classList.add('selected');
      document.getElementById(`eraser-${zone}`).classList.remove('selected');
    });
  });

  // Size buttons — scoped per zone
  document.querySelectorAll('.size-btn').forEach(el => {
    el.addEventListener('click', () => {
      const zone = el.dataset.zone;
      state.drawSettings[zone].size = parseInt(el.dataset.size);
      document.querySelectorAll(`#toolbar-${zone} .size-btn`)
        .forEach(s => s.classList.remove('selected'));
      el.classList.add('selected');
    });
  });

  // Erasers — one per zone
  ['left', 'right'].forEach(zone => {
    document.getElementById(`eraser-${zone}`).addEventListener('click', function() {
      state.drawSettings[zone].erasing = !state.drawSettings[zone].erasing;
      this.classList.toggle('selected', state.drawSettings[zone].erasing);
    });

    // Undo button — initially disabled
    const undoBtn = document.getElementById(`undo-${zone}`);
    undoBtn.disabled = true;
    undoBtn.addEventListener('click', () => undoZone(zone));

    // Clear All button
    const clearBtn = document.getElementById(`clear-${zone}`);
    if (clearBtn) clearBtn.addEventListener('click', () => clearZone(zone));
  });
}

function undoZone(zone) {
  if (state.strokesByZone[zone].length === 0) return;
  state.strokesByZone[zone].pop();
  state.svgPaths[zone].pop();
  redrawAll();
  updateDoneBtn(zone);
}

function clearZone(zone) {
  if (state.strokesByZone[zone].length === 0) return;
  state.strokesByZone[zone] = [];
  state.svgPaths[zone]      = [];
  // Turn off eraser mode if it was active
  state.drawSettings[zone].erasing = false;
  const eraserBtn = document.getElementById(`eraser-${zone}`);
  if (eraserBtn) eraserBtn.classList.remove('selected');
  redrawAll();
  updateDoneBtn(zone);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setStatus(msg) {
  statusBar.textContent = msg;
}



// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 2 — Seamless In-Place Animation
//  When both users submit:
//   1. Capture each zone's canvas (mountain SVG + user strokes) before hiding
//   2. Fade out zone overlays, toolbars, buttons — white background stays
//   3. Mount a transparent Konva stage directly on top of #app
//   4. Render each sketch into a Konva group (white stripped)
//   5. Register both with the animation engine using label+category from GPT
// ══════════════════════════════════════════════════════════════════════════════

let konvaStage = null;
let konvaLayer = null;

async function transitionToAnimationStage() {

  // ── Step 1: Capture BEFORE hiding (zones must still be visible in DOM) ──
  const leftSnap  = await captureZoneCanvas('left');
  const rightSnap = await captureZoneCanvas('right');

  // ── Step 2: Fade out zone chrome, keep white background ─────────────────
  ['left', 'right'].forEach(zone => {
    const zoneEl = document.getElementById(`zone-${zone}`);
    if (zoneEl) { zoneEl.style.transition = 'opacity 0.5s'; zoneEl.style.opacity = '0'; }
    setTimeout(() => { if (zoneEl) zoneEl.style.display = 'none'; }, 550);

    const tb = document.getElementById(`toolbar-${zone}`);
    if (tb) tb.style.display = 'none';

    const dn = document.getElementById(`done-${zone}`);
    if (dn) dn.style.display = 'none';

    const rs = document.getElementById(`result-${zone}`);
    if (rs) rs.style.display = 'none';

    const sp = document.getElementById(`spinner-${zone}`);
    if (sp) sp.style.display = 'none';
  });

  canvas.style.display = 'none';
  if (saveAllBtn) saveAllBtn.style.display = 'none';
  if (statusBar)  { statusBar.style.transition = 'opacity 0.5s'; statusBar.style.opacity = '0'; }

  // ── Step 3: Mount a transparent Konva overlay on #app ────────────────────
  const app = document.getElementById('app');
  const W   = app.offsetWidth  || window.innerWidth;
  const H   = app.offsetHeight || window.innerHeight;

  // Destroy old stage if present
  if (konvaStage) { konvaStage.destroy(); konvaStage = null; konvaLayer = null; }

  const overlay = document.createElement('div');
  overlay.id = 'konva-overlay';
  overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:600;';
  app.appendChild(overlay);

  konvaStage = new Konva.Stage({ container: overlay, width: W, height: H });
  konvaLayer = new Konva.Layer();
  konvaStage.add(konvaLayer);
  getEngine().resize(W, H);

  // ── Step 4: Strip white background from a canvas snapshot ────────────────
  function stripWhite(srcCanvas) {
    const tmp = document.createElement('canvas');
    tmp.width = srcCanvas.width; tmp.height = srcCanvas.height;
    const tc = tmp.getContext('2d');
    tc.drawImage(srcCanvas, 0, 0);
    const id = tc.getImageData(0, 0, tmp.width, tmp.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const brightness = (d[i] + d[i+1] + d[i+2]) / 3;
      if (brightness > 235) {
        d[i+3] = 0;
      } else if (brightness > 210) {
        d[i+3] = Math.round(d[i+3] * (235 - brightness) / 25);
      }
    }
    tc.putImageData(id, 0, 0);
    return tmp.toDataURL('image/png');
  }

  // Build a Konva.Image from a stripped canvas dataURL.
  // We render at 1:1 scale — the captured canvas is already the correct
  // half-screen size, so we place it left-edge at 0 for left zone and
  // at W/2 for right zone (agentId encodes which side).
  function makeGroup(dataURL, cx, cy, agentId) {
    return new Promise(resolve => {
      const img = new window.Image();
      img.onload = () => {
        // Place the image so its visual center is at (cx, cy)
        const dw = img.width;
        const dh = img.height;
        const kImg = new Konva.Image({ image: img, x: -dw/2, y: -dh/2, width: dw, height: dh });
        const g = new Konva.Group({ x: cx, y: cy, id: agentId });
        g.add(kImg);
        konvaLayer.add(g);
        konvaLayer.draw();
        resolve({ group: g, w: dw, h: dh });
      };
      img.onerror = () => resolve(null);
      img.src = dataURL;
    });
  }

  const lR = state.results.left;
  const rR = state.results.right;

  // ── Step 4a: Detect body parts for each sketch (runs in parallel with canvas strip) ──
  // We send the zone canvas data URLs to the backend for GPT-4o part detection.
  const leftDataURL  = leftSnap.toDataURL('image/png');
  const rightDataURL = rightSnap.toDataURL('image/png');

  const [leftParts, rightParts, sizeComp, sceneDesc] = await Promise.all([
    detectParts(leftDataURL,  lR.label),
    detectParts(rightDataURL, rR.label),
    fetch('/api/compare-sizes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label_left: lR.label, label_right: rR.label }),
    }).then(r => r.json()).catch(() => null),
    fetch('/api/semantic-scene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label_left:     lR.label,    label_right:     rR.label,
        category_left:  lR.category, category_right:  rR.category,
        tags_left:  resolveProfile({ label: lR.label,  category: lR.category,  confidence: 0.9 }).tags,
        tags_right: resolveProfile({ label: rR.label,  category: rR.category,  confidence: 0.9 }).tags,
      }),
    }).then(r => r.json()).catch(() => null),
  ]);

  if (sceneDesc && !sceneDesc.error) {
    console.log('%c[semantic-scene] ' + sceneDesc.narrative, 'color:#a060ff;font-weight:bold');
  }

  // ── Sizing constants ──────────────────────────────────────────────────────────
  // Display size is derived from real-world relative size, NOT from how big
  // the user drew the sketch on screen.
  //
  // The larger real-world object fills LARGE_H_FRAC of the screen height.
  // The smaller object is scaled proportionally.  Nothing goes below MIN_H_PX
  // (so tiny insects are still visible) or above MAX_H_PX (so mountains don't
  // overflow the canvas).
  const LARGE_H_FRAC = 0.50;                      // "biggest" item = 50% screen height
  const MIN_H_PX     = Math.max(80, H * 0.08);    // floor  : 8% of screen
  const MAX_H_PX     = H * 0.78;                   // ceiling: 78% of screen

  // ── Step 1: get semantic table values (always available, hand-calibrated) ─────
  // These are the ground-truth relative real-world sizes.  We always compute
  // target heights from this table first.
  const semL = getSemanticScale(lR.label);   // e.g. flower = 0.70
  const semR = getSemanticScale(rR.label);   // e.g. butterfly = 0.55
  const semMax = Math.max(semL, semR, 0.1);
  const baseH  = H * LARGE_H_FRAC;

  let leftTargetH  = Math.min(MAX_H_PX, Math.max(MIN_H_PX, baseH * (semL / semMax)));
  let rightTargetH = Math.min(MAX_H_PX, Math.max(MIN_H_PX, baseH * (semR / semMax)));

  console.log(
    `%c[scaling] Semantic table: "${lR.label}"=${semL} "${rR.label}"=${semR}` +
    ` → L=${leftTargetH.toFixed(0)}px R=${rightTargetH.toFixed(0)}px`,
    'color:#7c3aed;font-weight:bold'
  );

  // ── Step 2: optionally refine with GPT compare-sizes ─────────────────────────
  // Only trust GPT if BOTH labels are absent from the semantic table (unknown
  // objects), OR if GPT's ordering agrees with the semantic table's ordering.
  // If GPT contradicts the semantic table for a known item, ignore GPT.
  const LEFT_IN_TABLE  = SEMANTIC_SCALE_KNOWN.has(lR.label.toLowerCase());
  const RIGHT_IN_TABLE = SEMANTIC_SCALE_KNOWN.has(rR.label.toLowerCase());
  const bothUnknown    = !LEFT_IN_TABLE && !RIGHT_IN_TABLE;

  if (sizeComp && !sizeComp.error && sizeComp.left_scale !== undefined) {
    const gL = Math.max(0.10, parseFloat(sizeComp.left_scale)  || 1.0);
    const gR = Math.max(0.10, parseFloat(sizeComp.right_scale) || 1.0);

    // Verify GPT ordering matches semantic table (or both are unknown)
    const semSaysLeftBigger = semL >= semR;
    const gptSaysLeftBigger = gL  >= gR;
    const orderingAgrees    = semSaysLeftBigger === gptSaysLeftBigger;

    if (bothUnknown || orderingAgrees) {
      const gMax = Math.max(gL, gR);
      const gptL = Math.min(MAX_H_PX, Math.max(MIN_H_PX, baseH * (gL / gMax)));
      const gptR = Math.min(MAX_H_PX, Math.max(MIN_H_PX, baseH * (gR / gMax)));

      // Blend: GPT provides the exact ratio, semantic table provides the anchor
      // Use GPT values but only if at least one label is known in the table
      // (so the anchor is reliable).  If both unknown, trust GPT entirely.
      if (bothUnknown) {
        leftTargetH  = gptL;
        rightTargetH = gptR;
        console.log(`%c[scaling] GPT (both unknown): "${lR.label}"=${gL.toFixed(2)} "${rR.label}"=${gR.toFixed(2)} → L=${leftTargetH.toFixed(0)}px R=${rightTargetH.toFixed(0)}px`, 'color:#059669;font-weight:bold');
      } else {
        // GPT agrees with semantic ordering — use GPT ratio but cap extremes
        // by blending 50/50 with the semantic values so we don't drift too far
        leftTargetH  = Math.min(MAX_H_PX, Math.max(MIN_H_PX, (leftTargetH  + gptL) / 2));
        rightTargetH = Math.min(MAX_H_PX, Math.max(MIN_H_PX, (rightTargetH + gptR) / 2));
        console.log(`%c[scaling] GPT blend: L=${leftTargetH.toFixed(0)}px R=${rightTargetH.toFixed(0)}px (${sizeComp.reasoning})`, 'color:#0284c7;font-weight:bold');
      }
    } else {
      console.log(`%c[scaling] GPT overruled (ordering mismatch). Using semantic table only.`, 'color:#dc2626;font-weight:bold');
    }
  }

  console.log(`%c[scaling] Final targets: "${lR.label}"=${leftTargetH.toFixed(0)}px "${rR.label}"=${rightTargetH.toFixed(0)}px`, 'color:#7c3aed;font-weight:bold');

  // ── Step 4b: Build Konva groups ───────────────────────────────────────────────
  // buildPartGroup is called with overrideScale=1.0 so it NEVER applies its own
  // semantic scale. We are the single authority for all scaling below.

  // ── AI color cache (label → [r,g,b,a]) ────────────────────────────────────
  // Calls /api/sketch-color (GPT-4o-mini) for any label not already cached.
  // Each unique label is looked up at most once per page session.
  const _colorCache = new Map();

  async function fetchSketchColor(label) {
    const key = (label || '').toLowerCase();
    if (_colorCache.has(key)) return _colorCache.get(key);
    try {
      const res = await fetch('/api/sketch-color', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ label: key }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { r, g, b, a } = await res.json();
      const color = [r, g, b, a ?? 165];
      _colorCache.set(key, color);
      console.log(`%c[color] "${key}" → rgba(${color})`, 'color:#e07830;font-weight:bold');
      return color;
    } catch (err) {
      console.warn(`[color] fetch failed for "${key}", using default:`, err.message);
      const fallback = [220, 210, 195, 150];
      _colorCache.set(key, fallback);
      return fallback;
    }
  }

  async function spawnSketch(snap, parts, label, category, cx, cy, agentId, targetH) {
    // Fetch AI-determined fill color before building — ensures vivid color on first render
    const fillColor = await fetchSketchColor(label);
    // Pass overrideScale=1.0 → buildPartGroup returns naturalW/naturalH at 1:1
    const result = await buildPartGroup(snap, parts, cx, cy, agentId, konvaLayer, category, label, 1.0, fillColor);

    if (!result || !result.naturalH || result.naturalH < 1) {
      console.warn(`[scaling] buildPartGroup failed for "${label}", using flat fallback`);
      const fbDataURL = snap.toDataURL('image/png');
      const fbResult  = await makeGroup(fbDataURL, cx, cy, agentId);
      if (!fbResult) return null;
      // Size the fallback group too
      const fbScale = targetH ? Math.min(MAX_H_PX, Math.max(MIN_H_PX, targetH)) / Math.max(fbResult.h, 1) : 1;
      fbResult.group.scaleX(fbScale);
      fbResult.group.scaleY(fbScale);
      fbResult.group._baseScale = fbScale;
      fbResult.w = fbResult.w * fbScale;
      fbResult.h = fbResult.h * fbScale;
      return fbResult;
    }

    // Compute unified scale: target display height ÷ natural pixel height
    const finalScale = targetH
      ? Math.min(10, Math.max(0.05, targetH / result.naturalH))
      : 1.0;

    // Apply scale uniformly
    result.group.scaleX(finalScale);
    result.group.scaleY(finalScale);

    // Re-center the group at (cx, cy) after scaling
    result.group.x(cx);
    result.group.y(cy);

    const displayW = result.naturalW * finalScale;
    const displayH = result.naturalH * finalScale;

    // Store as the PERMANENT base scale — nothing changes this after spawn.
    // storyRunner resets to this value after every beat to prevent drift.
    result.group._baseScale    = finalScale;
    result.group._scaleLocked  = true;   // debug sentinel
    result.w = displayW;
    result.h = displayH;

    console.log(
      `[scaling] "${label}" naturalH=${result.naturalH.toFixed(0)}px` +
      ` × scale=${finalScale.toFixed(3)} → display=${displayH.toFixed(0)}px tall`
    );

    konvaLayer.batchDraw();
    return result;
  }

  const [lg, rg] = await Promise.all([
    spawnSketch(leftSnap,  leftParts,  lR.label, lR.category, W*0.25, H*0.5, 'agent_left',  leftTargetH),
    spawnSketch(rightSnap, rightParts, rR.label, rR.category, W*0.75, H*0.5, 'agent_right', rightTargetH),
  ]);

  if (!lg || !rg) {
    console.error('[SquiggleWiggle] Failed to build Konva groups — aborting animation');
    return;
  }

  // ── Step 5: Register with animation engine ────────────────────────────────────
  // spawnScale MUST match the group's actual scaleX() or the engine will fight it.
  const lProf     = resolveProfile({ label: lR.label, category: lR.category, confidence: 0.9 });
  const rProf     = resolveProfile({ label: rR.label, category: rR.category, confidence: 0.9 });
  const lAnchored = lProf.tags.includes('anchored') || lProf.tags.includes('mostly_static');
  const rAnchored = rProf.tags.includes('anchored') || rProf.tags.includes('mostly_static');

  registerRecognizedSketch({
    id: 'agent_left',  label: lR.label,  category: lR.category, confidence: 0.92,
    bbox:             { x: W*0.25 - lg.w/2, y: H*0.5 - lg.h/2, width: lg.w, height: lg.h },
    layerRef:         lg.group,
    spawnScale:       lg.group._baseScale,
    behaviorOverride: lAnchored ? 'stay' : (sceneDesc?.left_behavior   ?? null),
    motionHint:       lAnchored ? 'idle' : (sceneDesc?.left_motion_hint ?? null),
  });

  registerRecognizedSketch({
    id: 'agent_right', label: rR.label, category: rR.category, confidence: 0.92,
    bbox:             { x: W*0.75 - rg.w/2, y: H*0.5 - rg.h/2, width: rg.w, height: rg.h },
    layerRef:         rg.group,
    spawnScale:       rg.group._baseScale,
    behaviorOverride: rAnchored ? 'stay' : (sceneDesc?.right_behavior   ?? null),
    motionHint:       rAnchored ? 'idle' : (sceneDesc?.right_motion_hint ?? null),
  });

  // ── Bottom dock: narrative text above End button, never overlapping ───────────
  // Build a single fixed container so both elements stack cleanly.
  const existingDock = document.getElementById('bottom-dock');
  if (existingDock) existingDock.remove();

  const dock = document.createElement('div');
  dock.id = 'bottom-dock';
  dock.style.cssText = [
    'position:fixed',
    'bottom:28px',
    'left:50%',
    'transform:translateX(-50%)',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'gap:12px',
    'z-index:9001',
    'pointer-events:none',
  ].join(';');

  if (sceneDesc?.narrative) {
    const nb = document.createElement('div');
    nb.id = 'scene-narrative';
    nb.style.cssText = [
      'background:rgba(20,10,40,0.82)',
      'color:#fff',
      'padding:11px 26px',
      'border-radius:24px',
      'font-family:system-ui,sans-serif',
      'font-size:15px',
      'pointer-events:none',
      'max-width:65vw',
      'text-align:center',
      'line-height:1.5',
      'letter-spacing:0.01em',
      'opacity:0',
      'transition:opacity 0.6s',
    ].join(';');
    nb.textContent = '💬 ' + sceneDesc.narrative;
    dock.appendChild(nb);
    requestAnimationFrame(() => { nb.style.opacity = '1'; });
  }

  // Move the End button inside the dock so it sits below the narrative
  const endBtnEl = document.getElementById('end-btn');
  if (endBtnEl) {
    // Reset the fixed positioning since it's now inside the dock flow
    endBtnEl.style.position = 'relative';
    endBtnEl.style.bottom   = 'auto';
    endBtnEl.style.left     = 'auto';
    endBtnEl.style.transform = 'none';
    endBtnEl.style.pointerEvents = 'all';
    dock.appendChild(endBtnEl);
  }

  document.body.appendChild(dock);

  console.log(`[SquiggleWiggle] "${lR.label}" × "${rR.label}" — animation started`);

  // Show the End button (it's now inside the dock)
  const endBtnAnim = document.getElementById('end-btn');
  if (endBtnAnim) endBtnAnim.classList.add('visible');

  setTimeout(() => startInteractionEngine(), 800);
}

// ─── End / Thank-you screen ───────────────────────────────────────────────────
const endBtn     = document.getElementById('end-btn');
const tyScreen   = document.getElementById('thankyou-screen');
const restartBtn = document.getElementById('restart-btn');

if (endBtn && tyScreen) {
  endBtn.addEventListener('click', () => {
    tyScreen.classList.add('visible');
    endBtn.classList.remove('visible');
  });
}

if (restartBtn) {
  restartBtn.addEventListener('click', () => {
    window.location.reload();
  });
}
