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
let agentBadges  = {};
let agentRefs    = {};   // { 1: SceneAgent, 2: SceneAgent }
let storyRunning = false;

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
  const SIZE = 160;  // display size for the sprite on stage

  // Player 1: left-centre, Player 2: right-centre (well separated)
  const positions = [
    { x: W * 0.25, y: H * 0.5 },
    { x: W * 0.75, y: H * 0.5 },
  ];

  for (let pid = 1; pid <= 2; pid++) {
    const p   = players[pid];
    const pos = positions[pid - 1];
    const id  = `player${pid}`;

    const group = await makeKonvaGroup(p.imageDataURL, pos.x, pos.y, SIZE, id);

    const agent = registerRecognizedSketch({
      id,
      label:      p.label,
      confidence: 1.0,
      // bbox is centered on pos (the group's x,y IS the center)
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

    // State badge
    makeBadge(id, p.label, pid, group);
  }
}

// ── Build a Konva group from a canvas data URL ────────────────────────────────
// Auto-crops the drawn content, strips white background, then renders it
// centered on (cx, cy) at the requested display size.
function makeKonvaGroup(dataURL, cx, cy, size, id) {
  return new Promise(resolve => {
    const img = new window.Image();
    img.onload = () => {
      // ── Step 1: read pixels and auto-crop to drawn content ──────────────
      const src    = document.createElement('canvas');
      src.width    = img.width;
      src.height   = img.height;
      const sctx   = src.getContext('2d');
      sctx.drawImage(img, 0, 0);

      const idata  = sctx.getImageData(0, 0, src.width, src.height);
      const d      = idata.data;
      let minX = src.width, minY = src.height, maxX = 0, maxY = 0;

      for (let y = 0; y < src.height; y++) {
        for (let x = 0; x < src.width; x++) {
          const i = (y * src.width + x) * 4;
          const brightness = (d[i] + d[i+1] + d[i+2]) / 3;
          if (brightness < 220) {   // non-white pixel = ink
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      // Fallback if canvas is blank
      if (minX > maxX || minY > maxY) {
        minX = 0; minY = 0; maxX = src.width - 1; maxY = src.height - 1;
      }

      // Add a small padding around the crop
      const pad  = 8;
      minX = Math.max(0, minX - pad);
      minY = Math.max(0, minY - pad);
      maxX = Math.min(src.width  - 1, maxX + pad);
      maxY = Math.min(src.height - 1, maxY + pad);

      const cw = maxX - minX + 1;
      const ch = maxY - minY + 1;

      // ── Step 2: copy cropped region to output canvas, strip white ───────
      const tmp   = document.createElement('canvas');
      tmp.width   = cw;
      tmp.height  = ch;
      const tctx  = tmp.getContext('2d');
      tctx.drawImage(src, minX, minY, cw, ch, 0, 0, cw, ch);

      const odata = tctx.getImageData(0, 0, cw, ch);
      const od    = odata.data;
      for (let i = 0; i < od.length; i += 4) {
        const brightness = (od[i] + od[i+1] + od[i+2]) / 3;
        if (brightness > 230) od[i+3] = 0;
        else if (brightness > 180) od[i+3] = Math.round((255 - brightness) * 4);
      }
      tctx.putImageData(odata, 0, 0);

      // ── Step 3: place centered on group origin ───────────────────────────
      const kImg = new Konva.Image({
        image: tmp,
        x: -size / 2,
        y: -size / 2,
        width:  size,
        height: size,
      });
      const g = new Konva.Group({ x: cx, y: cy, draggable: true });
      g.setAttr('agentId', id);
      g.add(kImg);
      konvaLayer.add(g);
      konvaLayer.draw();
      resolve(g);
    };
    img.src = dataURL;
  });
}

// ── Floating state badge ──────────────────────────────────────────────────────
// Badges sit inside storyStageInner (position:relative). Konva coordinates are
// logical pixels set when the stage was created. If CSS scales the container,
// we must convert Konva → CSS pixels using the ratio of clientWidth/stageWidth.
function makeBadge(id, label, pid, group) {
  const badge = document.createElement('div');
  badge.className = 'swbadge';
  badge.innerHTML = `
    <div class="swbadge-label">${label}</div>
    <div class="swbadge-state idle" id="bstate_${id}">idle</div>`;

  storyStageInner.appendChild(badge);
  agentBadges[id] = badge;

  const agent = getRegistry().get(id);

  function syncBadge() {
    if (!agentBadges[id]) return;
    const pos = group.position();

    // Compute scale: CSS display size ÷ Konva logical size
    const scaleX = storyStageInner.clientWidth  / (konvaStage?.width()  || storyStageInner.clientWidth);
    const scaleY = storyStageInner.clientHeight / (konvaStage?.height() || storyStageInner.clientHeight);

    badge.style.left = (pos.x * scaleX) + 'px';
    badge.style.top  = (pos.y * scaleY - 82) + 'px';

    if (agent) {
      const s  = agent.state || 'idle';
      const el = document.getElementById(`bstate_${id}`);
      if (el && el.textContent !== s) {
        el.textContent = s;
        el.className   = `swbadge-state ${s}`;
      }
    }
    requestAnimationFrame(syncBadge);
  }
  syncBadge();
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
  Object.values(agentBadges).forEach(b => b.remove());
  agentBadges = {};
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
  Object.values(agentBadges).forEach(b => b.remove());
  agentBadges = {};
  agentRefs   = {};

  // Reset player states
  clearPlayer(1, ctx1);
  clearPlayer(2, ctx2);

  stagePhase.classList.add('hidden');
  drawPhase.classList.remove('hidden');
  beatTimeline.innerHTML = '';
  updateStatus();
});
