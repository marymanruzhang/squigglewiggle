/**
 * partAnimator.js  —  Plan A animation engine
 *
 * Two responsibilities:
 *  1. Fill the interior of each sketch with a soft pastel (flood-fill BFS)
 *  2. Split the sketch into animatable parts and run per-part RAF loops
 *
 * Wing flapping uses a simple horizontal-center split — no LLM bbox needed.
 * For ground animals the whole group moves; limb swing is overlaid via rotation.
 */

// ─── Public: call backend for part hints (optional — used for fallback params) ─
export async function detectParts(imageDataURL, label) {
  try {
    const r = await fetch('/api/detect-parts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageDataURL, label }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return d.error ? null : (d.parts || null);
  } catch (e) {
    console.warn('[partAnimator] detectParts failed:', e.message);
    return null;
  }
}

// ─── Public: build Konva.Group with per-part animation ────────────────────────
export function buildPartGroup(sourceCanvas, _parts, cx, cy, agentId, konvaLayer, category, label) {
  return new Promise(resolve => {
    // Step 1: apply interior flood-fill then strip exterior white
    const filled = applyFillAndStrip(sourceCanvas, label);
    if (!filled) { resolve(null); return; }

    const { canvas: paintedCanvas, x0, y0, cropW, cropH } = filled;

    // Step 2: build per-part Konva images based on category
    const group    = new Konva.Group({ x: cx, y: cy, id: agentId });
    const rafIds   = [];
    const cat      = (category || '').toLowerCase();
    const lbl      = (label    || '').toLowerCase();

    const isFlying = cat === 'flying_animal' ||
                     ['butterfly','bird','bee','moth','dragonfly','bat'].includes(lbl);

    if (isFlying) {
      buildWingParts(paintedCanvas, cropW, cropH, group, konvaLayer, rafIds);
    } else {
      buildWholeBody(paintedCanvas, cropW, cropH, group, konvaLayer, rafIds, cat, lbl);
    }

    if (group.children.length === 0) { resolve(null); return; }

    // Center the group on (cx, cy) — parts are in [0…cropW] × [0…cropH] space,
    // so shift by -cropW/2, -cropH/2
    group.offsetX(cropW / 2);
    group.offsetY(cropH / 2);

    konvaLayer.add(group);
    konvaLayer.draw();

    group._stopPartAnimations = () => {
      rafIds.forEach(id => cancelAnimationFrame(id));
      rafIds.length = 0;
    };

    resolve({ group, w: cropW, h: cropH,
              stop: group._stopPartAnimations });
  });
}

// ─── Wing split: left half + right half, each flaps toward center ─────────────
function buildWingParts(src, W, H, group, layer, rafIds) {
  const cx = Math.floor(W / 2);

  // Left wing — pivot at right edge (cx, H/2)
  const leftC = clipCanvas(src, 0, 0, cx, H);
  const kLeft = new Konva.Image({
    image: leftC, x: 0, y: 0, width: cx, height: H,
    offsetX: cx, offsetY: H / 2,   // pivot = right edge center
  });
  kLeft.x(cx); kLeft.y(H / 2);    // place pivot at center of sketch

  // Right wing — pivot at left edge (cx, H/2)
  const rightC = clipCanvas(src, cx, 0, W - cx, H);
  const kRight = new Konva.Image({
    image: rightC, x: 0, y: 0, width: W - cx, height: H,
    offsetX: 0, offsetY: H / 2,
  });
  kRight.x(cx); kRight.y(H / 2);

  group.add(kLeft);
  group.add(kRight);

  // Body float — whole image, subtle vertical bob
  const bodyC = clipCanvas(src, 0, 0, W, H);
  const kBody = new Konva.Image({
    image: bodyC, x: 0, y: 0, width: W, height: H,
    offsetX: W / 2, offsetY: H / 2, opacity: 0,   // invisible — wings carry the look
  });
  kBody.x(W / 2); kBody.y(H / 2);
  group.add(kBody);

  // ── Flap both wings in sync ────────────────────────────────────────────────
  const minScale = 0.06;
  const freq     = 2.8; // Hz
  let phase = 0, lastTs = null, raf;
  const tick = ts => {
    if (!lastTs) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    phase += dt * freq * Math.PI * 2;

    const s = (Math.cos(phase) + 1) / 2 * (1 - minScale) + minScale;
    kLeft.scaleX(s);   // folds right toward center
    kRight.scaleX(s);  // folds left toward center

    // gentle body float
    const bob = Math.sin(phase * 0.4) * 4;
    kLeft.y(H / 2 + bob);
    kRight.y(H / 2 + bob);

    layer.batchDraw();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  rafIds.push(raf);
}

// ─── Whole-body group: appropriate idle motion by category ────────────────────
function buildWholeBody(src, W, H, group, layer, rafIds, cat, lbl) {
  const kImg = new Konva.Image({
    image: src, x: 0, y: 0, width: W, height: H,
    offsetX: W / 2, offsetY: H / 2,
  });
  kImg.x(W / 2); kImg.y(H / 2);
  group.add(kImg);

  let phase = 0, lastTs = null, raf;

  const isPlant  = cat === 'plant' || ['flower','tree','grass','bush','cactus'].includes(lbl);
  const isSwim   = cat === 'water_creature';
  const isGround = cat === 'ground_animal';

  const tick = ts => {
    if (!lastTs) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    phase += dt;

    if (isPlant) {
      // Sway around base: rotate around bottom center
      kImg.offsetY(H * 0.9);           // pivot near bottom
      kImg.y(H * 0.9);
      kImg.rotation(Math.sin(phase * 1.4) * 8);

    } else if (isSwim) {
      // Side-to-side body wave
      kImg.rotation(Math.sin(phase * 2.0) * 12);
      kImg.x(W / 2 + Math.sin(phase * 2.0) * 6);

    } else if (isGround) {
      // Gentle bounce (vertical)
      kImg.y(H / 2 + Math.abs(Math.sin(phase * 2.5)) * -5);
      // Slight tilt in direction of travel
      kImg.rotation(Math.sin(phase * 1.2) * 3);

    } else {
      // Generic: gentle float
      kImg.y(H / 2 + Math.sin(phase * 1.0) * 6);
    }

    layer.batchDraw();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  rafIds.push(raf);
}

// ─── Interior flood-fill + exterior strip ────────────────────────────────────
const FILL_COLORS = {
  butterfly:[180,140,220,140], moth:[160,130,200,130],
  bird:[255,210,120,130],      parrot:[100,200,140,130],
  bee:[255,210,80,120],        dragonfly:[100,180,230,120],
  fish:[100,180,230,130],      whale:[80,160,210,120],
  octopus:[190,130,200,120],   jellyfish:[200,170,230,120],
  flower:[255,170,190,130],    rose:[240,120,140,130],
  tree:[130,200,130,120],      grass:[140,210,140,110],
  cat:[230,190,150,120],       dog:[220,185,145,120],
  rabbit:[230,215,205,120],    sheep:[220,220,215,120],
  turtle:[160,200,140,120],    tortoise:[170,200,140,120],
  sun:[255,230,100,130],       cloud:[210,225,240,120],
  cake:[255,210,180,130],      house:[210,190,170,120],
};

function applyFillAndStrip(src, label) {
  // Find tight content bounds
  const sctx = src.getContext('2d');
  const SW = src.width, SH = src.height;
  const raw = sctx.getImageData(0, 0, SW, SH);
  const d   = raw.data;

  let x0 = SW, y0 = SH, x1 = 0, y1 = 0;
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const i = (y * SW + x) * 4;
      if ((d[i]+d[i+1]+d[i+2])/3 < 220 && d[i+3] > 30) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x0 > x1 || y0 > y1) return null;

  const pad = 14;
  x0 = Math.max(0, x0-pad); y0 = Math.max(0, y0-pad);
  x1 = Math.min(SW-1, x1+pad); y1 = Math.min(SH-1, y1+pad);
  const CW = x1-x0+1, CH = y1-y0+1;

  // Crop to tight bounds
  const crop = document.createElement('canvas');
  crop.width = CW; crop.height = CH;
  const cc = crop.getContext('2d');
  cc.drawImage(src, x0, y0, CW, CH, 0, 0, CW, CH);

  const id = cc.getImageData(0, 0, CW, CH);
  const px = id.data;

  // Build ink mask
  const INK_THRESH = 180;
  const mask = new Uint8Array(CW * CH);
  for (let i = 0; i < CW * CH; i++) {
    const ii = i * 4;
    mask[i] = ((px[ii]+px[ii+1]+px[ii+2])/3 < INK_THRESH && px[ii+3] > 60) ? 1 : 0;
  }

  // Dilate ink 2px to seal gaps
  const dil = new Uint8Array(mask);
  for (let pass = 0; pass < 2; pass++) {
    const prev = new Uint8Array(dil);
    for (let y = 1; y < CH-1; y++) {
      for (let x = 1; x < CW-1; x++) {
        if (prev[y*CW+x]) {
          dil[(y-1)*CW+x]=1; dil[(y+1)*CW+x]=1;
          dil[y*CW+(x-1)]=1; dil[y*CW+(x+1)]=1;
        }
      }
    }
  }

  // BFS from border to find outside
  const outside = new Uint8Array(CW * CH);
  const queue = [];
  for (let x = 0; x < CW; x++) {
    if (!dil[x])          { outside[x]=1;          queue.push(x); }
    if (!dil[(CH-1)*CW+x]){ outside[(CH-1)*CW+x]=1; queue.push((CH-1)*CW+x); }
  }
  for (let y = 0; y < CH; y++) {
    if (!dil[y*CW])       { outside[y*CW]=1;       queue.push(y*CW); }
    if (!dil[y*CW+CW-1])  { outside[y*CW+CW-1]=1;  queue.push(y*CW+CW-1); }
  }
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    const cx2 = cur % CW, cy2 = Math.floor(cur / CW);
    for (const [nx2, ny2] of [[cx2-1,cy2],[cx2+1,cy2],[cx2,cy2-1],[cx2,cy2+1]]) {
      if (nx2<0||nx2>=CW||ny2<0||ny2>=CH) continue;
      const ni = ny2*CW+nx2;
      if (!outside[ni] && !dil[ni]) { outside[ni]=1; queue.push(ni); }
    }
  }

  // Apply: exterior→transparent, interior→pastel, ink stays
  const fc = FILL_COLORS[(label||'').toLowerCase()] || [230,220,210,120];
  for (let i = 0; i < CW * CH; i++) {
    const ii = i * 4;
    if (outside[i] && !mask[i]) {
      px[ii+3] = 0;                             // exterior → transparent
    } else if (!outside[i] && !mask[i]) {
      px[ii]=fc[0]; px[ii+1]=fc[1]; px[ii+2]=fc[2]; px[ii+3]=fc[3]; // interior fill
    }
    // ink pixels: keep original (already dark)
  }
  cc.putImageData(id, 0, 0);

  return { canvas: crop, x0, y0, cropW: CW, cropH: CH };
}

// ─── Clip a rectangular sub-region from a canvas ─────────────────────────────
function clipCanvas(src, sx, sy, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(src, sx, sy, w, h, 0, 0, w, h);
  return c;
}
