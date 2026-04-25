// ─── Config ───────────────────────────────────────────────────────────────────
const OPENAI_KEY = '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';
const MIN_STROKES_FOR_DONE_BTN = 1;

const state = {
  activeZones: { left: false, right: false },
  submitted:   { left: false, right: false },
  drawing: false,
  drawSettings: {
    left:  { color: '#1a1a1a', size: 6, erasing: false },
    right: { color: '#1a1a1a', size: 6, erasing: false },
  },
  lastX: 0, lastY: 0,
  strokesByZone: { left: [], right: [] },
  currentStroke: null,
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
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerUp);
  canvas.setPointerCapture = canvas.setPointerCapture || (() => {});
}

function getZoneForX(x) {
  return x < window.innerWidth / 2 ? 'left' : 'right';
}

function onPointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  const zone = getZoneForX(e.clientX);
  if (!state.activeZones[zone]) return;
  if (state.analyzing[zone]) return;

  const s = state.drawSettings[zone];
  state.drawing = true;
  state.lastX = e.clientX;
  state.lastY = e.clientY;

  state.currentStroke = {
    zone,
    color: s.erasing ? 'rgba(0,0,0,1)' : s.color,
    size:  s.erasing ? s.size * 4 : s.size,
    points: [{ x: e.clientX, y: e.clientY }],
    erasing: s.erasing,
  };
}

function onPointerMove(e) {
  if (!state.drawing || !state.currentStroke) return;
  const zone = getZoneForX(e.clientX);
  if (zone !== state.currentStroke.zone) return; // Don't cross zones

  state.currentStroke.points.push({ x: e.clientX, y: e.clientY });

  // Draw incrementally
  ctx.globalCompositeOperation = state.currentStroke.erasing ? 'destination-out' : 'source-over';
  ctx.beginPath();
  ctx.strokeStyle = state.currentStroke.color;
  ctx.lineWidth   = state.currentStroke.size;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.moveTo(state.lastX, state.lastY);
  ctx.lineTo(e.clientX, e.clientY);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over'; // reset

  state.lastX = e.clientX;
  state.lastY = e.clientY;
}

function onPointerUp() {
  if (!state.drawing || !state.currentStroke) return;
  state.drawing = false;

  if (state.currentStroke.points.length > 1) {
    const { zone } = state.currentStroke;
    state.strokesByZone[zone].push(state.currentStroke);

    // Update SVG path record
    const pts = state.currentStroke.points;
    let d = `M${pts[0].x},${pts[0].y}`;
    pts.slice(1).forEach(p => d += ` L${p.x},${p.y}`);
    state.svgPaths[zone].push({
      d, color: state.currentStroke.color, size: state.currentStroke.size,
      erasing: state.currentStroke.erasing,
    });

    // Show/hide done button based on non-erase strokes
    updateDoneBtn(zone);
  }
  state.currentStroke = null;
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

  // Capture zone canvas (includes cloud SVG)
  const zoneCanvas = await captureZoneCanvas(zone);
  const dataUrl = zoneCanvas.toDataURL('image/png');

  try {
    const result = await identifyDoodle(dataUrl);
    state.results[zone] = result;
    state.submitted[zone] = true;

    // Mark zone as submitted — hides text prompt, keeps SVG
    const zoneEl = zone === 'left' ? zoneLeft : zoneRight;
    zoneEl.classList.add('submitted');

    catEl.textContent  = result.category;
    lblEl.textContent  = result.label;
    res.classList.add('visible');
    spin.classList.remove('visible');

    checkSaveAll();
  } catch (e) {
    spin.classList.remove('visible');
    btn.disabled = false;
    btn.textContent = '⚠ Retry';
    state.analyzing[zone] = false;
    console.error('Analysis failed:', e);
    setStatus('⚠ API error – check console');
  }
}

async function captureZoneCanvas(zone) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const half = W / 2;
  const xOff = zone === 'left' ? 0 : half;
  const offscreen = document.createElement('canvas');
  offscreen.width  = half;
  offscreen.height = H;
  const oc = offscreen.getContext('2d');

  // 1. Background
  oc.fillStyle = '#f8f5f0';
  oc.fillRect(0, 0, half, H);

  // 2. Draw cloud SVG at its screen position
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
      img.onload = () => {
        oc.drawImage(img, rect.left - xOff, rect.top, rect.width, rect.height);
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = resolve;
      img.src = url;
    });
  }

  // 3. User strokes on top
  oc.drawImage(canvas, xOff, 0, half, H, 0, 0, half, H);
  return offscreen;
}

// ─── OpenAI API ──────────────────────────────────────────────────────────────
async function identifyDoodle(dataUrl) {
  const base64 = dataUrl.split(',')[1];

  const body = {
    model: 'gpt-4o',
    max_tokens: 200,
    messages: [
      {
        role: 'system',
        content: `You are an expert doodle recognizer. The image shows a whiteboard zone with:
1. A hand-drawn cloud shape (the original visual prompt)
2. Additional strokes drawn BY THE USER on top of or around the cloud

Your task: identify what the COMPLETE drawing represents — what has the user transformed the cloud into?
Respond with ONLY valid JSON in this exact format:
{"category": "<broad category e.g. animal, plant, vehicle, food, building, object>", "label": "<specific name e.g. daisy, school bus, hot air balloon>", "description": "<one sentence describing the complete drawing's key visual features, useful for animation>"}
If the canvas shows only the cloud with no user additions, return: {"category": "cloud", "label": "cloud", "description": "An unmodified cloud shape."}`
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What doodle is drawn on this whiteboard section?' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}`, detail: 'low' } }
        ]
      }
    ]
  };

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  const content = data.choices[0].message.content.trim();

  // Strip markdown code fences if present
  const cleaned = content.replace(/```json\s*/g, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned);
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
  });
}

function undoZone(zone) {
  if (state.strokesByZone[zone].length === 0) return;
  state.strokesByZone[zone].pop();
  state.svgPaths[zone].pop();
  redrawAll();
  updateDoneBtn(zone);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setStatus(msg) {
  statusBar.textContent = msg;
}
