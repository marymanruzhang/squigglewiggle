/**
 * skeletonRig.js — GPT-4o joint detection + Linear Blend Skinning
 *
 * Key design:
 * - sigma=90px: large influence radius so body pixels near joints blend
 *   smoothly into limb motion — no hard seam at body/leg boundary
 * - Inverse mapping: for each OUTPUT pixel, find where it came from in the
 *   source — no holes, no gaps, seamless continuous deformation
 */

// ─── Bone sets ────────────────────────────────────────────────────────────────
const BONE_SETS = {
  quadruped: [
    ['spine',   'root',   'spine'],
    ['neck',    'spine',  'neck'],
    ['head',    'neck',   'head'],
    ['femur_L', 'root',   'hip_L'],
    ['tibia_L', 'hip_L',  'knee_L'],
    ['foot_L',  'knee_L', 'ankle_L'],
    ['femur_R', 'root',   'hip_R'],
    ['tibia_R', 'hip_R',  'knee_R'],
    ['foot_R',  'knee_R', 'ankle_R'],
  ],
  biped: [
    ['spine',   'root',       'spine'],
    ['neck',    'spine',      'neck'],
    ['head',    'neck',       'head'],
    ['upper_L', 'spine',      'shoulder_L'],
    ['fore_L',  'shoulder_L', 'elbow_L'],
    ['upper_R', 'spine',      'shoulder_R'],
    ['fore_R',  'shoulder_R', 'elbow_R'],
    ['thigh_L', 'root',       'hip_L'],
    ['shin_L',  'hip_L',      'knee_L'],
    ['thigh_R', 'root',       'hip_R'],
    ['shin_R',  'hip_R',      'knee_R'],
  ],
  bird: [
    ['spine',  'root',       'spine'],
    ['neck',   'spine',      'neck'],
    ['head',   'neck',       'head'],
    ['wing_L', 'spine',      'shoulder_L'],
    ['tip_L',  'shoulder_L', 'elbow_L'],
    ['wing_R', 'spine',      'shoulder_R'],
    ['tip_R',  'shoulder_R', 'elbow_R'],
    ['leg_L',  'root',       'hip_L'],
    ['leg_R',  'root',       'hip_R'],
  ],
  fish: [
    ['body',  'root',      'spine'],
    ['tail1', 'spine',     'tail_base'],
    ['tail2', 'tail_base', 'tail_tip'],
  ],
};

// ─── Walk-cycle rotations (degrees) ──────────────────────────────────────────
function getRotations(type, phase) {
  const p = phase * Math.PI * 2;
  switch (type) {
    case 'quadruped': return {
      spine:   Math.sin(p * 2) * 3,
      neck:    Math.sin(p * 2 + 0.4) * 6,
      head:    Math.sin(p * 0.8) * 5,
      femur_L: Math.sin(p) * 28,
      tibia_L: Math.max(0, Math.sin(p + 0.5)) * 22,
      foot_L:  Math.max(0, Math.sin(p + 0.9)) * 12,
      femur_R: Math.sin(p + Math.PI) * 28,
      tibia_R: Math.max(0, Math.sin(p + Math.PI + 0.5)) * 22,
      foot_R:  Math.max(0, Math.sin(p + Math.PI + 0.9)) * 12,
    };
    case 'biped': return {
      spine:   Math.sin(p * 2) * 3,
      neck:    Math.sin(p) * 4,
      head:    Math.sin(p * 0.7) * 5,
      upper_L: Math.sin(p + Math.PI) * 28,
      fore_L:  Math.max(0, Math.sin(p + Math.PI + 0.5)) * 22,
      upper_R: Math.sin(p) * 28,
      fore_R:  Math.max(0, Math.sin(p + 0.5)) * 22,
      thigh_L: Math.sin(p) * 32,
      shin_L:  Math.max(0, Math.sin(p + 0.6)) * 28,
      thigh_R: Math.sin(p + Math.PI) * 32,
      shin_R:  Math.max(0, Math.sin(p + Math.PI + 0.6)) * 28,
    };
    case 'bird': return {
      spine:  Math.sin(p * 2) * 3,
      neck:   Math.sin(p) * 5,
      head:   Math.sin(p) * 6,
      wing_L: Math.sin(p * 3) * 38,
      tip_L:  Math.sin(p * 3 + 0.5) * 22,
      wing_R: Math.sin(p * 3) * 38,
      tip_R:  Math.sin(p * 3 + 0.5) * 22,
      leg_L:  Math.sin(p) * 10,
      leg_R:  Math.sin(p + Math.PI) * 10,
    };
    case 'fish': return {
      body:  Math.sin(p * 1.8) * 12,
      tail1: Math.sin(p * 1.8 + 0.5) * 22,
      tail2: Math.sin(p * 1.8 + 1.0) * 28,
    };
    default: return {};
  }
}

// ─── Fetch joints from backend ─────────────────────────────────────────────────
async function fetchJoints(canvas, label, category) {
  try {
    const r = await fetch('/api/detect-joints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: canvas.toDataURL('image/png'), label, category }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return d;
  } catch (e) {
    console.warn('[skeletonRig] fetchJoints failed:', e.message);
    return null;
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────
export async function buildSkeletalRig(croppedCanvas, label, category, cx, cy, agentId, konvaLayer) {
  const W = croppedCanvas.width, H = croppedCanvas.height;

  const jointData = await fetchJoints(croppedCanvas, label, category);
  if (!jointData?.joints) return null;

  const type  = jointData.type;
  const bones = BONE_SETS[type];
  if (!bones) return null;

  // Convert normalized [0-1] → pixel coords
  const joints = {};
  const fallback = { x: W / 2, y: H / 2 };
  for (const [name, coords] of Object.entries(jointData.joints)) {
    if (Array.isArray(coords) && coords.length === 2) {
      joints[name] = { x: coords[0] * W, y: coords[1] * H };
    }
  }
  // Fill any missing joints
  for (const [, pj, cj] of bones) {
    if (!joints[pj]) joints[pj] = { ...fallback };
    if (!joints[cj]) joints[cj] = { ...fallback };
  }

  // Read source pixels
  const srcCtx = croppedCanvas.getContext('2d');
  const srcImg  = srcCtx.getImageData(0, 0, W, H);

  // Pre-compute skinning weights for every source pixel
  const skinData = buildSkinWeights(srcImg, joints, bones, W, H);
  console.log(`[skeletonRig] "${label}" type=${type} joints=${Object.keys(joints).length} skin_pixels=${skinData.length}`);

  // Output canvas + Konva.Image
  const outCanvas = document.createElement('canvas');
  outCanvas.width = W; outCanvas.height = H;
  const outCtx = outCanvas.getContext('2d');

  const kImg = new Konva.Image({ image: outCanvas, x: -W/2, y: -H/2, width: W, height: H });
  const group = new Konva.Group({ x: cx, y: cy, id: agentId });
  group.add(kImg);
  konvaLayer.add(group);

  // RAF loop
  const FREQ = { bird:2.0, fish:1.8, biped:1.4 }[type] ?? 1.6;
  let phase = 0, lastTs = null, raf;

  const tick = ts => {
    if (!lastTs) lastTs = ts;
    phase += Math.min((ts - lastTs) / 1000, 0.05) * FREQ;
    lastTs = ts;
    renderFrame(srcImg, skinData, bones, joints, getRotations(type, phase), outCtx, W, H);
    kImg.image(outCanvas);
    konvaLayer.batchDraw();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return { group, w: W, h: H, stop: () => cancelAnimationFrame(raf) };
}

// ─── Pre-compute skinning weights ─────────────────────────────────────────────
// SIGMA=90: large radius ensures body pixels near joints smoothly follow limbs
const SIGMA = 90;

function buildSkinWeights(imgData, joints, bones, W, H) {
  const px  = imgData.data;
  const result = [];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Include ALL pixels (not just ink) so the whole character deforms
      const i = (y * W + x) * 4;
      if (px[i + 3] < 10) continue;

      const dists = bones.map(([, pj, cj], bi) => ({
        bi,
        dist: distToSeg(x, y, joints[pj] ?? fallbackPt, joints[cj] ?? fallbackPt),
      }));
      dists.sort((a, b) => a.dist - b.dist);

      // Top 3 bones for smoother blending
      const top = dists.slice(0, 3);
      const ws  = top.map(d => Math.exp(-d.dist * d.dist / (2 * SIGMA * SIGMA)));
      const wSum = ws.reduce((a, b) => a + b, 0) || 1;

      result.push({
        x, y, i,
        bones: top.map((d, k) => ({ bi: d.bi, w: ws[k] / wSum })),
      });
    }
  }
  return result;
}
const fallbackPt = { x: 0, y: 0 };

function distToSeg(px, py, p0, p1) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const lenSq = dx*dx + dy*dy;
  if (lenSq === 0) return Math.hypot(px - p0.x, py - p0.y);
  const t = Math.max(0, Math.min(1, ((px-p0.x)*dx + (py-p0.y)*dy) / lenSq));
  return Math.hypot(px - (p0.x + t*dx), py - (p0.y + t*dy));
}

// ─── Inverse-mapping render ───────────────────────────────────────────────────
// For each output pixel we find where it came from in source — no holes.
// Algorithm:
//   1. Forward pass: build a sparse map from output→source coords
//   2. Gap fill: pixels not hit get the nearest known mapping via dilation
//   3. Sample source image at the found source coords
function renderFrame(srcImg, skinData, bones, joints, rotations, outCtx, W, H) {
  const src = srcImg.data;

  // Build per-bone 2D rotation transforms (rotate around parent joint)
  const T = bones.map(([name, pj]) => {
    const rad = (rotations[name] || 0) * Math.PI / 180;
    const J   = joints[pj] || fallbackPt;
    return { Jx: J.x, Jy: J.y, cos: Math.cos(rad), sin: Math.sin(rad) };
  });

  // --- Pass 1: forward map source → output, build srcX/srcY lookup ---
  // Use Float32Array: [srcX, srcY] per output pixel; -1 = unmapped
  const mapX = new Float32Array(W * H).fill(-1);
  const mapY = new Float32Array(W * H).fill(-1);

  for (const { x, y, bones: boneWeights } of skinData) {
    let nx = 0, ny = 0;
    for (const { bi, w } of boneWeights) {
      const t = T[bi];
      const dx = x - t.Jx, dy = y - t.Jy;
      nx += w * (t.Jx + t.cos*dx - t.sin*dy);
      ny += w * (t.Jy + t.sin*dx + t.cos*dy);
    }
    const ox = Math.round(nx), oy = Math.round(ny);
    if (ox >= 0 && ox < W && oy >= 0 && oy < H) {
      const oi = oy * W + ox;
      mapX[oi] = x; mapY[oi] = y;
    }
  }

  // --- Pass 2: gap fill by 3×3 dilation (2 passes for larger gaps) ---
  for (let pass = 0; pass < 2; pass++) {
    const prevX = new Float32Array(mapX), prevY = new Float32Array(mapY);
    for (let oy = 1; oy < H - 1; oy++) {
      for (let ox = 1; ox < W - 1; ox++) {
        if (mapX[oy * W + ox] >= 0) continue;
        // Find nearest mapped neighbor
        for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,1],[-1,1],[1,-1]]) {
          const ni = (oy+dy) * W + (ox+dx);
          if (prevX[ni] >= 0) { mapX[oy*W+ox] = prevX[ni]; mapY[oy*W+ox] = prevY[ni]; break; }
        }
      }
    }
  }

  // --- Pass 3: sample source and write output ---
  const outData = outCtx.createImageData(W, H);
  const out = outData.data;

  for (let oi = 0; oi < W * H; oi++) {
    const sx = mapX[oi], sy = mapY[oi];
    if (sx < 0) continue;
    const six = Math.round(sx), siy = Math.round(sy);
    if (six < 0 || six >= W || siy < 0 || siy >= H) continue;
    const si = (siy * W + six) * 4;
    const di = oi * 4;
    out[di]   = src[si];
    out[di+1] = src[si+1];
    out[di+2] = src[si+2];
    out[di+3] = src[si+3];
  }

  outCtx.putImageData(outData, 0, 0);
}
