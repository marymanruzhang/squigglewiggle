/**
 * SquiggleWiggle AI — Unified Draw + Story Controller
 *
 * Flow:
 *   Phase 1 (DRAW):  Each player draws on their canvas and types a label.
 *                    Both press "✓ Ready!" → Phase 2.
 *
 *   Phase 2 (STORY): Both sketches appear on a shared Konva stage,
 *                    wander around and execute the story interaction layer
 *                    (storyPlanner → storyRunner → storyBeatAnimations).
 *
 * The storyRunner is limited to exactly 2 agents at a time.
 * "New Story" replays with the same sketches; "Draw Again" resets to Phase 1.
 */

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

// ── Known labels (for autocomplete suggestions) ──────────────────────────────
const KNOWN_LABELS = [
  'flower','bee','butterfly','bird','cloud','sun','rabbit','carrot','tree',
  'cat','dog','fish','pond','mushroom','sheep','umbrella','rain','star',
  'heart','whale','bear','frog','duck','horse','cow','elephant','leaf',
  'cactus','bush','grass','river','ocean','rock','mountain','mouse',
  'lion','tiger','shark','jellyfish','octopus','crab','bat','owl',
  'parrot','dragon','snake','pig','monkey','ant','spider','cake','apple',
  'banana','strawberry','house','tent','cup','boat','car','airplane','rocket',
];

// ── DOM refs ─────────────────────────────────────────────────────────────────
const drawPhase   = document.getElementById('drawPhase');
const stagePhase  = document.getElementById('stagePhase');

const canvas1     = document.getElementById('canvas1');
const canvas2     = document.getElementById('canvas2');
const ctx1        = canvas1.getContext('2d');
const ctx2        = canvas2.getContext('2d');

const clearBtn1   = document.getElementById('clearBtn1');
const clearBtn2   = document.getElementById('clearBtn2');
const doneBtn1    = document.getElementById('doneBtn1');
const doneBtn2    = document.getElementById('doneBtn2');

const labelInput1 = document.getElementById('labelInput1');
const labelInput2 = document.getElementById('labelInput2');
const suggestions1 = document.getElementById('suggestions1');
const suggestions2 = document.getElementById('suggestions2');

const done1El     = document.getElementById('done1');
const done2El     = document.getElementById('done2');
const statusMsg   = document.getElementById('statusMsg');

const storyHeader      = document.getElementById('storyHeader');
const storyPairLabel   = document.getElementById('storyPairLabel');
const p1Name           = document.getElementById('p1Name');
const p2Name           = document.getElementById('p2Name');
const beatTimeline     = document.getElementById('beatTimeline');
const storyStageInner  = document.getElementById('storyStageInner');

const replayBtn   = document.getElementById('replayBtn');
const resetBtn    = document.getElementById('resetBtn');

// ── Per-player state ──────────────────────────────────────────────────────────
const players = {
  1: { drawn: false, done: false, label: '', drawing: false,
       strokes: [], curX: [], curY: [], imageDataURL: null },
  2: { drawn: false, done: false, label: '', drawing: false,
       strokes: [], curX: [], curY: [], imageDataURL: null },
};

// ── Canvas init ───────────────────────────────────────────────────────────────
function initCtx(ctx) {
  ctx.fillStyle   = '#ffffff';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.lineWidth   = 7;
  ctx.strokeStyle = '#1a1a2e';
}
initCtx(ctx1);
initCtx(ctx2);

// ── Drawing handlers ──────────────────────────────────────────────────────────
function getXY(e, cvs) {
  const r  = cvs.getBoundingClientRect();
  const sx = cvs.width  / r.width;
  const sy = cvs.height / r.height;
  const ev = e.touches ? e.touches[0] : e;
  return { x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sy };
}

function makeHandlers(pid, ctx) {
  const p = players[pid];
  return {
    start(e) {
      e.preventDefault();
      p.drawing = true;
      p.drawn   = true;
      const { x, y } = getXY(e, ctx.canvas);
      p.curX = [x]; p.curY = [y];
      ctx.beginPath(); ctx.moveTo(x, y);
      checkDoneEnabled(pid);
    },
    move(e) {
      if (!p.drawing) return;
      e.preventDefault();
      const { x, y } = getXY(e, ctx.canvas);
      ctx.lineTo(x, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y);
      p.curX.push(x); p.curY.push(y);
    },
    end() {
      if (p.drawing && p.curX.length > 0) {
        p.strokes.push([p.curX.slice(), p.curY.slice()]);
        p.curX = []; p.curY = [];
      }
      p.drawing = false;
    },
  };
}

function attach(cvs, h) {
  cvs.addEventListener('mousedown',  h.start);
  cvs.addEventListener('mousemove',  h.move);
  cvs.addEventListener('mouseup',    h.end);
  cvs.addEventListener('mouseleave', h.end);
  cvs.addEventListener('touchstart', h.start, { passive: false });
  cvs.addEventListener('touchmove',  h.move,  { passive: false });
  cvs.addEventListener('touchend',   h.end);
}

attach(canvas1, makeHandlers(1, ctx1));
attach(canvas2, makeHandlers(2, ctx2));

// ── Label autocomplete ────────────────────────────────────────────────────────
function makeSuggestions(input, suggestEl, pid) {
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    suggestEl.innerHTML = '';
    if (q.length < 1) return;
    const matches = KNOWN_LABELS.filter(l => l.startsWith(q)).slice(0, 6);
    matches.forEach(m => {
      const chip = document.createElement('button');
      chip.className   = 'suggest-chip';
      chip.textContent = m;
      chip.type        = 'button';
      chip.addEventListener('mousedown', (e) => {
        e.preventDefault(); // keep focus
        input.value = m;
        suggestEl.innerHTML = '';
        players[pid].label = m;
        checkDoneEnabled(pid);
      });
      suggestEl.appendChild(chip);
    });
    players[pid].label = input.value.trim().toLowerCase();
    checkDoneEnabled(pid);
  });
  input.addEventListener('blur', () => setTimeout(() => suggestEl.innerHTML = '', 200));
}

makeSuggestions(labelInput1, suggestions1, 1);
makeSuggestions(labelInput2, suggestions2, 2);

// ── Done button gating ────────────────────────────────────────────────────────
function checkDoneEnabled(pid) {
  const p = players[pid];
  const input = pid === 1 ? labelInput1 : labelInput2;
  p.label = input.value.trim().toLowerCase();
  const enabled = p.drawn && p.label.length >= 1;
  const btn = pid === 1 ? doneBtn1 : doneBtn2;
  btn.disabled = !enabled;
  updateStatus();
}

// ── Clear ─────────────────────────────────────────────────────────────────────
function clearPlayer(pid, ctx) {
  initCtx(ctx);
  const p = players[pid];
  Object.assign(p, { drawn: false, done: false, label: '',
                     strokes: [], curX: [], curY: [], drawing: false, imageDataURL: null });
  (pid === 1 ? labelInput1 : labelInput2).value = '';
  (pid === 1 ? done1El     : done2El    ).textContent = '';
  (pid === 1 ? doneBtn1    : doneBtn2   ).disabled = true;
  updateStatus();
}

clearBtn1.addEventListener('click', () => clearPlayer(1, ctx1));
clearBtn2.addEventListener('click', () => clearPlayer(2, ctx2));

// ── Done buttons ──────────────────────────────────────────────────────────────
function markDone(pid, ctx) {
  const p = players[pid];
  if (!p.drawn || !p.label) return;
  p.done = true;
  p.imageDataURL = ctx.canvas.toDataURL('image/png');
  (pid === 1 ? done1El : done2El).textContent = `✓ ${p.label}`;
  updateStatus();
  if (players[1].done && players[2].done) beginStory();
}

doneBtn1.addEventListener('click', () => markDone(1, ctx1));
doneBtn2.addEventListener('click', () => markDone(2, ctx2));

// ── Status text ───────────────────────────────────────────────────────────────
function updateStatus() {
  const { drawn: d1, done: dn1, label: l1 } = players[1];
  const { drawn: d2, done: dn2, label: l2 } = players[2];

  if (dn1 && dn2) { statusMsg.textContent = 'Let the story begin! ✨'; return; }

  const p1ready = d1 && l1;
  const p2ready = d2 && l2;

  if (!d1 && !d2) { statusMsg.textContent = 'Draw something on each side, then name it!'; return; }
  if (!p1ready && !p2ready) { statusMsg.textContent = 'Draw + label each sketch, then press ✓ Ready!'; return; }
  if (p1ready && !dn1 && !p2ready) { statusMsg.textContent = `Player 1 has "${l1}" — waiting for Player 2…`; return; }
  if (p2ready && !dn2 && !p1ready) { statusMsg.textContent = `Player 2 has "${l2}" — waiting for Player 1…`; return; }
  if (dn1 && !p2ready) { statusMsg.textContent = `Player 1 is ready with "${l1}" — Player 2, your turn!`; return; }
  if (dn2 && !p1ready) { statusMsg.textContent = `Player 2 is ready with "${l2}" — Player 1, your turn!`; return; }
  if (p1ready && !dn1 && dn2) { statusMsg.textContent = `Player 2 (${l2}) is waiting — Player 1, press ✓ Ready!`; return; }
  if (p2ready && !dn2 && dn1) { statusMsg.textContent = `Player 1 (${l1}) is waiting — Player 2, press ✓ Ready!`; return; }
  statusMsg.textContent = 'Both ready — press ✓ Ready! to start the story!';
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 2: STORY STAGE
// ══════════════════════════════════════════════════════════════════════════════

let konvaStage   = null;
let konvaLayer   = null;
let agentRefs    = {};   // { 1: SceneAgent, 2: SceneAgent }
// Labels are now Konva Text nodes inside each group — no separate DOM tracking needed.

// ── Show the story stage ──────────────────────────────────────────────────────
async function beginStory() {
  // Capture canvases before switching phases
  players[1].imageDataURL = players[1].imageDataURL || ctx1.canvas.toDataURL('image/png');
  players[2].imageDataURL = players[2].imageDataURL || ctx2.canvas.toDataURL('image/png');

  // Update name labels
  p1Name.textContent = players[1].label;
  p2Name.textContent = players[2].label;

  // Switch to stage phase
  drawPhase.classList.add('hidden');
  stagePhase.classList.remove('hidden');

  await setupKonva();
  await spawnBothSketches();
  interceptStoryLogs();
  clearAllCooldowns();
  startInteractionEngine();
}

// ── Konva stage setup ─────────────────────────────────────────────────────────
async function setupKonva() {
  // Tear down previous instance if any
  if (konvaStage) {
    stopInteractionEngine();
    getRegistry().getAll().forEach(a => removeSketch(a.id));
    konvaStage.destroy();
    konvaStage = null;
    konvaLayer = null;
    Object.values(agentBadges).forEach(b => b.remove());
    agentBadges = {};
    agentRefs   = {};
  }

  storyStageInner.innerHTML = '';

  // Wait one frame so the browser has laid out the newly-visible stagePhase
  await new Promise(r => requestAnimationFrame(r));

  const W = storyStageInner.clientWidth  || storyStageInner.offsetWidth  || 800;
  const H = storyStageInner.clientHeight || storyStageInner.offsetHeight || 420;

  console.log(`[SquiggleWiggle] Stage size: ${W}×${H}`);

  konvaStage = new Konva.Stage({ container: 'storyStageInner', width: W, height: H });
  konvaLayer = new Konva.Layer();
  konvaStage.add(konvaLayer);

  getEngine().resize(W, H);
}


// ── Spawn both players' sketches on the Konva stage ──────────────────────────
async function spawnBothSketches() {
  const W = konvaStage.width();
  const H = konvaStage.height();
  const SIZE = 160;

  // Spawn in left-centre and right-centre, with comfortable spacing
  const positions = [
    { x: W * 0.30, y: H * 0.50 },
    { x: W * 0.70, y: H * 0.50 },
  ];

  for (let pid = 1; pid <= 2; pid++) {
    const p   = players[pid];
    const pos = positions[pid - 1];
    const id  = `player${pid}`;

    // Label is baked into the Konva group — no separate DOM element needed
    const group = await makeKonvaGroup(p.imageDataURL, p.label, pos.x, pos.y, SIZE, id);

    const agent = registerRecognizedSketch({
      id,
      label:      p.label,
      confidence: 1.0,
      bbox:       { x: pos.x - SIZE/2, y: pos.y - SIZE/2, width: SIZE, height: SIZE },
      layerRef:   group,
    });

    agentRefs[pid] = agent;

    // Update origin on drag
    group.on('dragend', () => {
      const gx = group.x(), gy = group.y();
      agent.bbox      = { x: gx - SIZE/2, y: gy - SIZE/2, width: SIZE, height: SIZE };
      agent.originPos = { x: gx, y: gy };
      if (agent._wander) agent._wander.nextPickTime = Date.now() + 800;
    });
  }
}

// ── Build a Konva group from a canvas data URL ────────────────────────────────
// Auto-crops, strips white background, then renders centered on (cx, cy).
// The label is baked in as a Konva.Text node so it moves with the sketch.
function makeKonvaGroup(dataURL, labelText, cx, cy, size, id) {
  return new Promise(resolve => {
    const img = new window.Image();
    img.onload = () => {
      // ── Step 1: auto-crop to drawn content ─────────────────────────────
      const src   = document.createElement('canvas');
      src.width   = img.width;
      src.height  = img.height;
      const sctx  = src.getContext('2d');
      sctx.drawImage(img, 0, 0);

      const idata = sctx.getImageData(0, 0, src.width, src.height);
      const d     = idata.data;
      let minX = src.width, minY = src.height, maxX = 0, maxY = 0;

      for (let y = 0; y < src.height; y++) {
        for (let x = 0; x < src.width; x++) {
          const i = (y * src.width + x) * 4;
          if ((d[i] + d[i+1] + d[i+2]) / 3 < 220) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
      }
      if (minX > maxX || minY > maxY) {
        minX = 0; minY = 0; maxX = src.width - 1; maxY = src.height - 1;
      }
      const pad = 8;
      minX = Math.max(0, minX - pad);
      minY = Math.max(0, minY - pad);
      maxX = Math.min(src.width  - 1, maxX + pad);
      maxY = Math.min(src.height - 1, maxY + pad);
      const cw = maxX - minX + 1, ch = maxY - minY + 1;

      // ── Step 2: strip white background ──────────────────────────────────
      const tmp  = document.createElement('canvas');
      tmp.width  = cw; tmp.height = ch;
      const tctx = tmp.getContext('2d');
      tctx.drawImage(src, minX, minY, cw, ch, 0, 0, cw, ch);
      const od = tctx.getImageData(0, 0, cw, ch);
      const od_d = od.data;
      for (let i = 0; i < od_d.length; i += 4) {
        const br = (od_d[i] + od_d[i+1] + od_d[i+2]) / 3;
        if (br > 230) od_d[i+3] = 0;
        else if (br > 180) od_d[i+3] = Math.round((255 - br) * 4);
      }
      tctx.putImageData(od, 0, 0);

      // ── Step 2b: smart flood-fill enclosed regions ───────────────────────
      // Pick a soft pastel fill color per label for personality
      const FILL_COLORS = {
        butterfly: [180, 140, 220, 130], moth: [160, 130, 200, 120],
        bird: [255, 210, 120, 120],      parrot: [100, 200, 140, 130],
        fish: [100, 180, 230, 120],      whale: [80, 160, 210, 110],
        octopus: [190, 130, 200, 120],   shark: [130, 160, 200, 110],
        flower: [255, 170, 190, 120],    rose: [240, 120, 140, 130],
        tree: [130, 200, 130, 110],      grass: [140, 210, 140, 100],
        cat: [230, 190, 150, 110],       dog: [220, 185, 145, 110],
        rabbit: [230, 215, 205, 110],    sheep: [220, 220, 215, 110],
        sun: [255, 230, 100, 120],       cloud: [210, 225, 240, 110],
        cake: [255, 210, 180, 120],      pizza: [255, 200, 140, 120],
        house: [210, 190, 170, 110],     car: [160, 190, 230, 110],
      };
      const lk = labelText.toLowerCase();
      const fc = FILL_COLORS[lk] || [230, 220, 210, 100]; // warm cream default

      // Build ink mask (1 = ink, 0 = empty)
      const W2 = cw, H2 = ch;
      const fresh = tctx.getImageData(0, 0, W2, H2);
      const px = fresh.data;
      const INK = 160; // darkness threshold for "ink"
      const mask = new Uint8Array(W2 * H2); // 0=empty, 1=ink
      for (let i = 0; i < W2 * H2; i++) {
        const idx = i * 4;
        const br = (px[idx] + px[idx+1] + px[idx+2]) / 3;
        const a  = px[idx+3];
        mask[i] = (a > 60 && br < INK) ? 1 : 0;
      }

      // Dilate ink by 2px to seal gaps in hand-drawn lines
      const dilated = new Uint8Array(mask);
      const DILATION = 2;
      for (let pass = 0; pass < DILATION; pass++) {
        const prev = new Uint8Array(dilated);
        for (let y = 1; y < H2 - 1; y++) {
          for (let x = 1; x < W2 - 1; x++) {
            if (prev[y * W2 + x]) {
              dilated[(y-1)*W2+x] = 1; dilated[(y+1)*W2+x] = 1;
              dilated[y*W2+(x-1)] = 1; dilated[y*W2+(x+1)] = 1;
            }
          }
        }
      }

      // BFS flood-fill from all border pixels → marks "outside"
      const outside = new Uint8Array(W2 * H2);
      const queue = [];
      for (let x = 0; x < W2; x++) {
        if (!dilated[x])              { outside[x] = 1;              queue.push(x); }
        if (!dilated[(H2-1)*W2+x])   { outside[(H2-1)*W2+x] = 1;   queue.push((H2-1)*W2+x); }
      }
      for (let y = 0; y < H2; y++) {
        if (!dilated[y*W2])           { outside[y*W2] = 1;           queue.push(y*W2); }
        if (!dilated[y*W2+(W2-1)])    { outside[y*W2+(W2-1)] = 1;    queue.push(y*W2+(W2-1)); }
      }
      let qi = 0;
      const dirs4 = [-1, 1, -W2, W2];
      while (qi < queue.length) {
        const cur = queue[qi++];
        const cx2 = cur % W2, cy2 = Math.floor(cur / W2);
        for (const d of dirs4) {
          const nxt = cur + d;
          if (nxt < 0 || nxt >= W2 * H2) continue;
          const nx2 = nxt % W2;
          // Prevent horizontal wrap-around
          if (Math.abs(cx2 - nx2) > 1) continue;
          if (!outside[nxt] && !dilated[nxt]) { outside[nxt] = 1; queue.push(nxt); }
        }
      }

      // Paint enclosed interior pixels with the pastel fill color
      // Only paint pixels that were originally empty (not ink)
      for (let i = 0; i < W2 * H2; i++) {
        if (!outside[i] && !mask[i]) {
          const idx = i * 4;
          px[idx]   = fc[0];
          px[idx+1] = fc[1];
          px[idx+2] = fc[2];
          px[idx+3] = fc[3];
        }
      }
      tctx.putImageData(fresh, 0, 0);

      // ── Step 3: build Konva group (image already has fill baked in) ──────
      const g = new Konva.Group({ x: cx, y: cy, draggable: true });
      g.setAttr('agentId', id);

      // Sketch image (with baked-in fill for enclosed regions)
      g.add(new Konva.Image({
        image: tmp,
        x: -size / 2, y: -size / 2,
        width: size, height: size,
      }));


      // Label pill sitting just below the sketch, centered horizontally
      const displayLabel = labelText.toLowerCase();
      const charW = 8;  // approx pixels per character at font size 12
      const pillW = Math.max(displayLabel.length * charW + 16, 44);
      const pillH = 22;
      const pillY = size / 2 + 6;   // just below the image

      const pill = new Konva.Group({ x: 0, y: pillY });

      pill.add(new Konva.Rect({
        x: -pillW / 2, y: 0,
        width: pillW, height: pillH,
        fill: 'rgba(10,10,30,0.72)',
        cornerRadius: 11,
      }));
      pill.add(new Konva.Text({
        text: displayLabel,
        fontSize: 12, fontStyle: 'bold',
        fontFamily: 'Outfit, Inter, sans-serif',
        fill: '#fff',
        width: pillW, height: pillH,
        align: 'center', verticalAlign: 'middle',
        x: -pillW / 2, y: 0,
      }));

      g.add(pill);

      konvaLayer.add(g);
      konvaLayer.draw();
      resolve(g);
    };
    img.src = dataURL;
  });
}


// ── Story bar: intercept console.log from storyRunner ────────────────────────
function interceptStoryLogs() {
  const orig = console.log.bind(console);
  console.log = (...a) => {
    orig(...a);
    const m = a.join(' ');
    if (m.includes('[StoryRunner] ▶')) {
      const match = m.match(/▶ (\S+): "(.+?)" \+ "(.+?)"/);
      if (match) showBeatTimeline(match[1]);
    } else if (m.includes('[StoryRunner] ✓')) {
      // All chips → done after short delay, then clear
      setTimeout(() => {
        beatTimeline.querySelectorAll('.beat-chip').forEach(c => c.className = 'beat-chip done');
        setTimeout(() => { beatTimeline.innerHTML = ''; }, 1200);
      }, 300);
    }
  };
}

function showBeatTimeline(storyId) {
  const t = STORY_TEMPLATES.find(t => t.id === storyId);
  if (!t) return;
  beatTimeline.innerHTML = '';
  const chips = [];
  t.beats.forEach((b, i) => {
    const chip = document.createElement('span');
    chip.className   = 'beat-chip';
    chip.textContent = b.type.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
    chip.id          = `chip_${i}`;
    beatTimeline.appendChild(chip);
    chips.push(chip);
  });

  // Animate chips as time passes (approximate per-beat durations)
  let elapsed = 0;
  t.beats.forEach((b, i) => {
    const beatDuration = (b.params?.duration ?? 800) + (b.parallel ? 0 : 80);
    setTimeout(() => {
      chips.forEach((c, ci) => {
        if (ci < i)  c.className = 'beat-chip done';
        if (ci === i) c.className = 'beat-chip active';
      });
    }, elapsed);
    if (!b.parallel) elapsed += beatDuration;
  });
}

// ── Replay / Draw Again ───────────────────────────────────────────────────────
replayBtn.addEventListener('click', async () => {
  stopInteractionEngine();
  getRegistry().getAll().forEach(a => removeSketch(a.id));
  agentRefs   = {};
  beatTimeline.innerHTML = '';
  clearAllCooldowns();

  // Rebuild on same stage
  await setupKonva();
  await spawnBothSketches();
  startInteractionEngine();
});

resetBtn.addEventListener('click', () => {
  stopInteractionEngine();
  getRegistry().getAll().forEach(a => removeSketch(a.id));
  if (konvaStage) { konvaStage.destroy(); konvaStage = null; }
  agentRefs = {};

  // Reset player states
  clearPlayer(1, ctx1);
  clearPlayer(2, ctx2);

  stagePhase.classList.add('hidden');
  drawPhase.classList.remove('hidden');
  beatTimeline.innerHTML = '';
  updateStatus();
});

