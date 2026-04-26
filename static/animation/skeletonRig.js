/**
 * skeletonRig.js  —  Linear Blend Skinning engine
 *
 * Usage:
 *   const rig = await buildSkeletalRig(croppedCanvas, label, category);
 *   if (rig) {
 *     startSkeletalAnimation(rig, konvaLayer);
 *     // rig.group is the Konva.Group to add to the stage
 *     // rig.stop() cancels the RAF
 *   }
 */

// ─── Bone hierarchy definitions ───────────────────────────────────────────────
// Each bone = [name, parentJoint, childJoint]
// Rotation is applied at parentJoint around its position.

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
    ['spine',     'root',       'spine'],
    ['neck',      'spine',      'neck'],
    ['head',      'neck',       'head'],
    ['upper_L',   'spine',      'shoulder_L'],
    ['fore_L',    'shoulder_L', 'elbow_L'],
    ['upper_R',   'spine',      'shoulder_R'],
    ['fore_R',    'shoulder_R', 'elbow_R'],
    ['thigh_L',   'root',       'hip_L'],
    ['shin_L',    'hip_L',      'knee_L'],
    ['calf_L',    'knee_L',     'ankle_L'],
    ['thigh_R',   'root',       'hip_R'],
    ['shin_R',    'hip_R',      'knee_R'],
    ['calf_R',    'knee_R',     'ankle_R'],
  ],
  bird: [
    ['spine',   'root',       'spine'],
    ['neck',    'spine',      'neck'],
    ['head',    'neck',       'head'],
    ['wing_L',  'spine',      'shoulder_L'],
    ['tip_L',   'shoulder_L', 'elbow_L'],
    ['wing_R',  'spine',      'shoulder_R'],
    ['tip_R',   'shoulder_R', 'elbow_R'],
    ['leg_L',   'root',       'hip_L'],
    ['leg_R',   'root',       'hip_R'],
  ],
  fish: [
    ['body',   'root',      'spine'],
    ['tail1',  'spine',     'tail_base'],
    ['tail2',  'tail_base', 'tail_tip'],
  ],
};

// ─── Walk-cycle bone rotations (degrees) by type ──────────────────────────────
function getRotations(type, phase) {
  const p = phase * Math.PI * 2;
  switch (type) {
    case 'quadruped': return {
      spine:   Math.sin(p * 2)           *  3,
      neck:    Math.sin(p * 2 + 0.4)    *  6,
      head:    Math.sin(p * 0.8)         *  5,
      femur_L: Math.sin(p)               * 28,
      tibia_L: Math.max(0, Math.sin(p + 0.5)) * 22,
      foot_L:  Math.max(0, Math.sin(p + 0.9)) * 12,
      femur_R: Math.sin(p + Math.PI)     * 28,
      tibia_R: Math.max(0, Math.sin(p + Math.PI + 0.5)) * 22,
      foot_R:  Math.max(0, Math.sin(p + Math.PI + 0.9)) * 12,
    };
    case 'biped': return {
      spine:   Math.sin(p * 2)           *  3,
      neck:    Math.sin(p)               *  4,
      head:    Math.sin(p * 0.7)         *  5,
      upper_L: Math.sin(p + Math.PI)     * 28,
      fore_L:  Math.max(0, Math.sin(p + Math.PI + 0.5)) * 22,
      upper_R: Math.sin(p)               * 28,
      fore_R:  Math.max(0, Math.sin(p + 0.5)) * 22,
      thigh_L: Math.sin(p)               * 32,
      shin_L:  Math.max(0, Math.sin(p + 0.6)) * 28,
      calf_L:  Math.max(0, Math.sin(p + 1.0)) * 15,
      thigh_R: Math.sin(p + Math.PI)     * 32,
      shin_R:  Math.max(0, Math.sin(p + Math.PI + 0.6)) * 28,
      calf_R:  Math.max(0, Math.sin(p + Math.PI + 1.0)) * 15,
    };
    case 'bird': return {
      spine:  Math.sin(p * 2) * 3,
      neck:   Math.sin(p)     * 5,
      head:   Math.sin(p)     * 6,
      wing_L: Math.sin(p * 3) * 35,
      tip_L:  Math.sin(p * 3 + 0.4) * 20,
      wing_R: Math.sin(p * 3) * 35,   // same phase — both wings flap together
      tip_R:  Math.sin(p * 3 + 0.4) * 20,
      leg_L:  Math.sin(p)     * 10,
      leg_R:  Math.sin(p + Math.PI) * 10,
    };
    case 'fish': return {
      body:  Math.sin(p * 1.8) * 12,
      tail1: Math.sin(p * 1.8 + 0.5) * 20,
      tail2: Math.sin(p * 1.8 + 1.0) * 25,
    };
    default: return {};
  }
}

// ─── Fetch joints from backend ─────────────────────────────────────────────────
async function fetchJoints(croppedCanvas, label, category) {
  try {
    const resp = await fetch('/api/detect-joints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: croppedCanvas.toDataURL('image/png'),
        label, category,
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const d = await resp.json();
    if (d.error) throw new Error(d.error);
    return d; // { type, joints: { root:[fx,fy], ... } }
  } catch (e) {
    console.warn('[skeletonRig] fetchJoints failed:', e.message);
    return null;
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────
export async function buildSkeletalRig(croppedCanvas, label, category, cx, cy, agentId, konvaLayer) {
  const W = croppedCanvas.width, H = croppedCanvas.height;

  // 1. Get joints from GPT-4o
  const jointData = await fetchJoints(croppedCanvas, label, category);
  if (!jointData || !jointData.joints) return null;

  const type   = jointData.type;
  const bones  = BONE_SETS[type];
  if (!bones) return null;

  // 2. Convert normalized [0-1] coords → pixel coords
  const joints = {};
  for (const [name, [fx, fy]] of Object.entries(jointData.joints)) {
    joints[name] = { x: fx * W, y: fy * H };
  }

  // Fill any missing joints with body center
  const center = joints.root || { x: W/2, y: H/2 };
  for (const [, pj, cj] of bones) {
    if (!joints[pj]) joints[pj] = { ...center };
    if (!joints[cj]) joints[cj] = { ...center };
  }

  // 3. Read source pixels
  const srcCtx = croppedCanvas.getContext('2d');
  const srcImg  = srcCtx.getImageData(0, 0, W, H);

  // 4. Pre-compute skinning weights (per non-transparent pixel)
  const skinData = buildSkinWeights(srcImg, joints, bones, W, H);
  console.log(`[skeletonRig] "${label}" (${type}): ${skinData.length} skin pixels, ${bones.length} bones`);

  // 5. Create output canvas + Konva.Image
  const outCanvas = document.createElement('canvas');
  outCanvas.width = W; outCanvas.height = H;
  const outCtx = outCanvas.getContext('2d');

  const kImg = new Konva.Image({
    image: outCanvas, x: -W/2, y: -H/2, width: W, height: H,
  });
  const group = new Konva.Group({ x: cx, y: cy, id: agentId });
  group.add(kImg);
  konvaLayer.add(group);

  // 6. Start animation RAF
  let phase = 0, lastTs = null, raf;
  const FREQ = type === 'bird' ? 2.0 : type === 'fish' ? 1.8 : type === 'biped' ? 1.4 : 1.6;

  const tick = ts => {
    if (!lastTs) lastTs = ts;
    phase += Math.min((ts - lastTs) / 1000, 0.05) * FREQ;
    lastTs = ts;

    const rotations = getRotations(type, phase);
    renderFrame(srcImg, skinData, bones, joints, rotations, outCtx, W, H);
    kImg.image(outCanvas);
    konvaLayer.batchDraw();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    group,
    w: W, h: H,
    stop: () => cancelAnimationFrame(raf),
  };
}

// ─── Pre-compute skinning weights ─────────────────────────────────────────────
const SIGMA = 40; // spatial influence falloff (px)

function buildSkinWeights(imgData, joints, bones, W, H) {
  const px = imgData.data;
  const result = [];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (px[i + 3] < 20) continue;

      // Compute distance to each bone segment
      const dists = bones.map(([name, pj, cj], bi) => {
        const p0 = joints[pj] || { x: W/2, y: H/2 };
        const p1 = joints[cj] || { x: W/2, y: H/2 };
        return { bi, dist: distToSeg(x, y, p0, p1) };
      });
      dists.sort((a, b) => a.dist - b.dist);

      const d0 = dists[0], d1 = dists[1] || dists[0];
      const w0r = Math.exp(-d0.dist * d0.dist / (2 * SIGMA * SIGMA));
      const w1r = Math.exp(-d1.dist * d1.dist / (2 * SIGMA * SIGMA));
      const wSum = (w0r + w1r) || 1;

      result.push({
        x, y, i,
        b0: d0.bi, w0: w0r / wSum,
        b1: d1.bi, w1: w1r / wSum,
      });
    }
  }
  return result;
}

function distToSeg(px, py, p0, p1) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const lenSq = dx*dx + dy*dy;
  if (lenSq === 0) return Math.hypot(px - p0.x, py - p0.y);
  const t = Math.max(0, Math.min(1, ((px-p0.x)*dx + (py-p0.y)*dy) / lenSq));
  return Math.hypot(px - (p0.x + t*dx), py - (p0.y + t*dy));
}

// ─── Per-frame render with LBS ────────────────────────────────────────────────
function renderFrame(srcImg, skinData, bones, joints, rotations, outCtx, W, H) {
  const outData = outCtx.createImageData(W, H);
  const out = outData.data;
  const src = srcImg.data;

  // Build transform for each bone (rotation around its parent joint)
  const T = bones.map(([name, pj]) => {
    const deg = rotations[name] || 0;
    const rad = deg * Math.PI / 180;
    const J   = joints[pj] || { x: W/2, y: H/2 };
    return { Jx: J.x, Jy: J.y, cos: Math.cos(rad), sin: Math.sin(rad) };
  });

  for (const { x, y, i, b0, w0, b1, w1 } of skinData) {
    const T0 = T[b0], T1 = T[b1];

    // Rotate x,y around joint J0
    const dx0 = x - T0.Jx, dy0 = y - T0.Jy;
    const rx0  = T0.Jx + T0.cos*dx0 - T0.sin*dy0;
    const ry0  = T0.Jy + T0.sin*dx0 + T0.cos*dy0;

    // Rotate x,y around joint J1
    const dx1 = x - T1.Jx, dy1 = y - T1.Jy;
    const rx1  = T1.Jx + T1.cos*dx1 - T1.sin*dy1;
    const ry1  = T1.Jy + T1.sin*dx1 + T1.cos*dy1;

    // Blend
    const nx = Math.round(w0*rx0 + w1*rx1);
    const ny = Math.round(w0*ry0 + w1*ry1);

    // Splat 2×2 to avoid holes from forward mapping
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const ox = nx + dx, oy = ny + dy;
        if (ox < 0 || ox >= W || oy < 0 || oy >= H) continue;
        const oi = (oy * W + ox) * 4;
        out[oi]   = src[i];
        out[oi+1] = src[i+1];
        out[oi+2] = src[i+2];
        out[oi+3] = src[i+3];
      }
    }
  }
  outCtx.putImageData(outData, 0, 0);
}
