/**
 * partAnimator.js — Semantic sizing + per-limb animation
 * Tries GPT-4o + LBS skeletal rig first; falls back to geometric split.
 */
import { buildSkeletalRig } from './skeletonRig.js';

// ─── Semantic scale table (relative to a "baseline dog" = 1.0) ────────────────
const SEMANTIC_SCALE = {
  // Landscapes / large objects
  mountain:2.8, rock:1.8, volcano:2.5, island:2.0, cliff:2.2,
  ocean:2.5, river:2.0, lake:1.8, waterfall:2.0,
  tree:2.2, forest:2.5, palm:2.0, cactus:1.2,
  house:1.8, castle:2.2, building:2.0, tent:1.4, bridge:2.2,
  // Large animals
  elephant:2.0, whale:2.2, horse:1.6, cow:1.5, bear:1.8,
  lion:1.5, tiger:1.5, dinosaur:2.2, crocodile:1.6, hippo:1.8,
  camel:1.7, giraffe:2.4, rhino:1.9, rhinoceros:1.9, buffalo:1.8,
  bison:1.8, moose:1.9, elk:1.7, yak:1.6, zebra:1.5,
  // Medium animals / people
  dog:1.0, cat:1.0, human:1.2, person:1.2, girl:1.2, boy:1.2,
  sheep:0.9, deer:1.3, fox:0.9, pig:0.9, wolf:1.2,
  // Small animals
  rabbit:0.7, duck:0.65, frog:0.6, turtle:0.75, tortoise:0.8,
  lizard:0.6, squirrel:0.6, hedgehog:0.55,
  // Insects / tiny flying
  butterfly:0.55, bee:0.45, ant:0.35, ladybug:0.4,
  bird:0.65, parrot:0.7, owl:0.7, penguin:0.75,
  // Aquatic (small)
  fish:0.65, crab:0.55, jellyfish:0.65, starfish:0.5, octopus:0.8,
  // Plants
  flower:0.7, sunflower:0.85, rose:0.65, bush:1.0, grass:0.9,
  // Celestial / weather
  sun:1.6, moon:1.4, cloud:1.5, rainbow:2.2, star:0.9, lightning:1.4,
  // Vehicles
  car:1.4, bus:1.9, truck:2.0, boat:1.5, airplane:1.8, rocket:1.6,
  // Food / misc
  cake:0.85, pizza:0.9, apple:0.5, heart:0.75,
};

export function getSemanticScale(label) {
  return SEMANTIC_SCALE[(label||'').toLowerCase()] ?? 1.0;
}

/** Set of all labels present in the hand-calibrated semantic scale table. */
export const SEMANTIC_SCALE_KNOWN = new Set(Object.keys(SEMANTIC_SCALE));

// ─── Backend part hints (optional) ────────────────────────────────────────────
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
    console.warn('[partAnimator] detectParts:', e.message);
    return null;
  }
}

// ─── Main builder ─────────────────────────────────────────────────────────────
// overrideScale: if provided, uses this instead of SEMANTIC_SCALE lookup.
// Returns { group, w, h, naturalW, naturalH, stop }
export function buildPartGroup(sourceCanvas, _parts, cx, cy, agentId, konvaLayer, category, label, overrideScale, fillColor) {
  return new Promise(async resolve => {
    const filled = applyFillAndStrip(sourceCanvas, label, fillColor);
    if (!filled) { resolve(null); return; }
    const { canvas: src, cropW: W, cropH: H } = filled;

    const cat = (category || '').toLowerCase();
    const lbl = (label    || '').toLowerCase();

    // ── Static / anchored objects — no animation whatsoever ───────────────────
    // Built structures and landscape elements must never bounce, rotate, or sway.
    // Celestial bodies are also static here — their gentle motion (slow rock/spin)
    // is driven by the motion-preset system after spawning, not by a local RAF.
    const isStatic = [
      // Built structures
      'house','home','building','castle','barn','shed','cabin','cottage','bungalow',
      'skyscraper','tower','church','temple','mosque','lighthouse','windmill',
      'tent','igloo','hut','treehouse','mansion','villa','palace',
      // Landscape
      'mountain','volcano','cliff','rock','boulder','island','hill',
      'bridge','fence','wall','gate','arch','pillar','statue',
      'road','path','sidewalk','street',
      // Celestial / space (gentle motion from motion preset, not internal RAF)
      'planet','saturn','earth','globe','moon','sun','comet','asteroid',
      'meteor','star','nebula','galaxy','space','universe',
    ].includes(lbl) || cat === 'built_object' || cat === 'landscape' || cat === 'celestial';

    if (isStatic) {
      const group = new Konva.Group({ x: cx, y: cy, id: agentId });
      const kImg  = new Konva.Image({
        image: src, x: 0, y: 0, width: W, height: H,
      });
      group.add(kImg);
      group.offsetX(W / 2);
      group.offsetY(H / 2);
      const scale = overrideScale !== undefined ? overrideScale : getSemanticScale(lbl);
      group.scaleX(scale);
      group.scaleY(scale);
      konvaLayer.add(group);
      konvaLayer.draw();
      // No RAF started — completely inert
      group._stopPartAnimations = () => {};
      resolve({ group, w: W * scale, h: H * scale, naturalW: W, naturalH: H,
                stop: group._stopPartAnimations });
      return;
    }

    const isFlying  = cat === 'flying_animal'  || ['butterfly','bird','bee','moth','bat','dragonfly'].includes(lbl);
    const isGround  = cat === 'ground_animal'  || [
      'dog','cat','rabbit','sheep','horse','cow','turtle','tortoise','fox',
      'deer','frog','lizard','pig','wolf','bear','lion','tiger','elephant',
      'camel','donkey','goat','llama','zebra','rhino','rhinoceros','hippo',
      'ox','buffalo','giraffe','moose','reindeer','hyena','cheetah','leopard',
      'panther','jaguar','puma','cougar','coyote','boar','bison','yak',
    ].includes(lbl);
    const isHuman   = cat === 'human_character'|| ['human','person','girl','boy'].includes(lbl);
    const isPlant   = cat === 'plant'          || ['flower','tree','grass','bush','cactus','sunflower','rose'].includes(lbl);
    const isSwim    = cat === 'water_creature' || ['fish','whale','shark','octopus','jellyfish','crab'].includes(lbl);
    const hasLimbs  = isGround || isHuman || (isFlying && !['butterfly','bee','moth'].includes(lbl));

    // ── Try Plan A: GPT-4o joints + LBS skeleton (limbed creatures only) ──────
    if (hasLimbs) {
      try {
        const rigResult = await buildSkeletalRig(src, lbl, cat, cx, cy, agentId, konvaLayer);
        if (rigResult) {
          const scale = overrideScale !== undefined ? overrideScale : getSemanticScale(lbl);
          rigResult.group.scaleX(scale);
          rigResult.group.scaleY(scale);
          rigResult.group._stopPartAnimations = rigResult.stop;
          konvaLayer.draw();
          resolve({ group: rigResult.group, w: W * scale, h: H * scale,
                    naturalW: W, naturalH: H, stop: rigResult.stop });
          return;
        }
      } catch (e) {
        console.warn('[partAnimator] Skeletal rig failed, falling back:', e.message);
      }
    }

    // ── Fallback: geometric / bounce ──────────────────────────────────────────
    const group  = new Konva.Group({ x: cx, y: cy, id: agentId });
    const rafIds = [];

    if (isFlying) {
      buildWings(src, W, H, group, konvaLayer, rafIds, lbl);
    } else if (isPlant) {
      buildPlant(src, W, H, group, konvaLayer, rafIds);
    } else if (isSwim) {
      buildSwimmer(src, W, H, group, konvaLayer, rafIds);
    } else if (isGround) {
      // Quadruped: detect individual legs and animate with diagonal trot gait
      buildQuadrupedWalk(src, W, H, group, konvaLayer, rafIds);
    } else {
      // Biped / unknown fallback
      buildWholeBodyBounce(src, W, H, group, konvaLayer, rafIds, isHuman);
    }

    if (group.children.length === 0) { resolve(null); return; }

    group.offsetX(W / 2);
    group.offsetY(H / 2);

    const scale = overrideScale !== undefined ? overrideScale : getSemanticScale(lbl);
    group.scaleX(scale);
    group.scaleY(scale);

    konvaLayer.add(group);
    konvaLayer.draw();

    group._stopPartAnimations = () => { rafIds.forEach(cancelAnimationFrame); rafIds.length = 0; };
    resolve({ group, w: W * scale, h: H * scale, naturalW: W, naturalH: H,
              stop: group._stopPartAnimations });
  });
}

// ─── Flying: split at center-X, each half flaps toward body ──────────────────
function buildWings(src, W, H, group, layer, rafIds, lbl) {
  const cx   = Math.floor(W / 2);
  const freq = ['bee','dragonfly'].includes(lbl) ? 5.0 : ['bat'].includes(lbl) ? 3.5 : 2.8;

  const kLeft = makeKImg(clipCanvas(src, 0, 0, cx, H),
    { x: cx, y: H/2, offX: cx, offY: H/2 });      // pivot = right edge
  const kRight = makeKImg(clipCanvas(src, cx, 0, W-cx, H),
    { x: cx, y: H/2, offX: 0, offY: H/2 });         // pivot = left edge
  group.add(kLeft); group.add(kRight);

  animRAF(rafIds, (phase) => {
    const s = (Math.cos(phase * freq * Math.PI * 2) + 1) / 2 * 0.94 + 0.06;
    kLeft.scaleX(s); kRight.scaleX(s);
    const bob = Math.sin(phase * 1.2 * Math.PI * 2) * 5;
    kLeft.y(H/2 + bob); kRight.y(H/2 + bob);
    layer.batchDraw();
  });
}

// ─── Whole-body bounce fallback (no splitting, no seams) ─────────────────────
// Used when LBS skeleton fails. Animates the intact full sketch with a
// walk-cycle bounce so it at least looks alive without any visible cuts.
function buildWholeBodyBounce(src, W, H, group, layer, rafIds, isBiped) {
  const kImg = makeKImg(clipCanvas(src, 0, 0, W, H),
    { x: W/2, y: H/2, offX: W/2, offY: H/2 });
  group.add(kImg);

  const FREQ = isBiped ? 1.4 : 1.6;
  animRAF(rafIds, (phase) => {
    const t = phase * FREQ * Math.PI * 2;
    // Vertical bounce (2 bounces per walk cycle = 2 steps)
    kImg.y(H/2 - Math.abs(Math.sin(t * 2)) * 5);
    // Slight lean into direction of travel
    kImg.rotation(Math.sin(t) * 2.5);
    layer.batchDraw();
  });
}

// ─── Quadruped walk: whole-body walk cycle ────────────────────────────────────
//
// We render the sketch as a single, uncut image.
// Splitting the image into body + leg slabs creates visible seams and gaps
// whenever the pieces animate independently — this was the root cause of the
// "body and legs separating" bug.
//
// Instead we convey walking through two simultaneous motions applied to the
// whole image:
//   1. Vertical bob  — 2 rises per stride (one per diagonal step pair)
//   2. Lateral lean  — gentle ±LEAN_DEG tilt, synced to the stride
//
// Combined with the lateral translation from _wanderMoveTo, the animal looks
// convincingly like it's walking across the canvas.
//
function buildQuadrupedWalk(src, W, H, group, layer, rafIds) {
  const kImg = makeKImg(clipCanvas(src, 0, 0, W, H),
    { x: W/2, y: H/2, offX: W/2, offY: H/2 });
  group.add(kImg);

  const WALK_FREQ = 0.9;   // strides per second (≈ natural quadruped pace)
  const BOB_PX    = 4;     // vertical rise per step (px, before scale)
  const LEAN_DEG  = 4;     // left/right lean amplitude (degrees)

  animRAF(rafIds, (phase) => {
    const t = phase * WALK_FREQ * Math.PI * 2;
    // Two bobs per stride — one for each diagonal pair of legs
    kImg.y(H/2 - Math.abs(Math.sin(t * 2)) * BOB_PX);
    // Lean: smoothly alternates left/right with each stride
    kImg.rotation(Math.sin(t) * LEAN_DEG);
    layer.batchDraw();
  });
}

// ─── Plant: sway from base ────────────────────────────────────────────────────
function buildPlant(src, W, H, group, layer, rafIds) {
  const kImg = makeKImg(clipCanvas(src, 0, 0, W, H),
    { x: W/2, y: H*0.85, offX: W/2, offY: H*0.85 });  // pivot near base
  group.add(kImg);

  animRAF(rafIds, (phase) => {
    kImg.rotation(Math.sin(phase * 1.3 * Math.PI * 2) * 9);
    layer.batchDraw();
  });
}

// ─── Swimmer: sinusoidal body wave + tail ────────────────────────────────────
function buildSwimmer(src, W, H, group, layer, rafIds) {
  const kBody = makeKImg(clipCanvas(src, 0, 0, W, H),
    { x: W/2, y: H/2, offX: W/2, offY: H/2 });
  group.add(kBody);

  animRAF(rafIds, (phase) => {
    kBody.rotation(Math.sin(phase * 1.8 * Math.PI * 2) * 14);
    kBody.x(W/2 + Math.sin(phase * 1.8 * Math.PI * 2) * 8);
    layer.batchDraw();
  });
}

// ─── Generic fallback ─────────────────────────────────────────────────────────
function buildGeneric(src, W, H, group, layer, rafIds) {
  const kImg = makeKImg(clipCanvas(src, 0, 0, W, H),
    { x: W/2, y: H/2, offX: W/2, offY: H/2 });
  group.add(kImg);

  animRAF(rafIds, (phase) => {
    kImg.y(H/2 + Math.sin(phase * 1.0 * Math.PI * 2) * 7);
    layer.batchDraw();
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeKImg(canvas, { x, y, offX, offY }) {
  const k = new Konva.Image({
    image: canvas,
    x, y,
    width: canvas.width, height: canvas.height,
    offsetX: offX, offsetY: offY,
  });
  return k;
}

function clipCanvas(src, sx, sy, w, h) {
  w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(src, sx, sy, w, h, 0, 0, w, h);
  return c;
}

function animRAF(rafIds, fn) {
  let phase = 0, lastTs = null, raf;
  const tick = ts => {
    if (!lastTs) lastTs = ts;
    phase += Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    fn(phase);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  rafIds.push(raf);
}

// ─── Interior flood-fill + exterior strip ─────────────────────────────────────
const FILL_COLORS = {
  // ── Insects / small flying ────────────────────────────────────────────────
  butterfly:[180,140,220,160], moth:[160,130,200,150], bee:[255,210,60,160],
  bird:[120,190,255,150], parrot:[80,200,120,160], bat:[100,80,130,150],
  dragonfly:[80,200,230,150], owl:[200,175,130,150],
  // ── Aquatic ───────────────────────────────────────────────────────────────
  fish:[80,190,240,150], whale:[70,150,200,140], shark:[130,155,185,140],
  octopus:[200,130,200,140], jellyfish:[210,170,235,140], crab:[225,110,90,150],
  starfish:[255,160,100,150], seahorse:[255,180,100,150],
  // ── Plants ────────────────────────────────────────────────────────────────
  flower:[255,160,195,160], sunflower:[255,220,60,160], rose:[245,110,140,160],
  tree:[100,190,110,150], grass:[130,210,120,140], bush:[110,185,100,150],
  cactus:[90,175,90,150], 'house plant':[110,200,120,150],
  // ── Common pets ──────────────────────────────────────────────────────────
  cat:[230,190,145,155], dog:[215,180,135,155], rabbit:[230,215,205,155],
  hamster:[230,200,160,150], guinea:[215,195,160,150],
  // ── Farm / herbivores ─────────────────────────────────────────────────────
  sheep:[215,215,210,155], cow:[220,205,185,155], horse:[195,165,130,155],
  pig:[255,185,185,155], goat:[210,200,180,155], donkey:[185,175,165,155],
  // ── Desert / exotic ──────────────────────────────────────────────────────
  camel:[210,185,140,165], llama:[220,205,185,155], yak:[140,120,100,155],
  zebra:[230,225,215,155], giraffe:[255,210,120,160],
  // ── Large predators ──────────────────────────────────────────────────────
  lion:[245,200,130,160], tiger:[245,165,85,160], bear:[155,120,90,155],
  wolf:[180,175,165,150], fox:[235,155,90,155],
  cheetah:[245,210,130,150], leopard:[240,200,130,150], jaguar:[205,170,110,150],
  // ── Other large animals ───────────────────────────────────────────────────
  elephant:[175,175,185,155], hippo:[155,155,165,150], rhino:[165,160,155,150],
  rhinoceros:[165,160,155,150], crocodile:[110,175,110,150],
  deer:[205,175,130,155], moose:[165,135,105,150], reindeer:[190,160,130,150],
  kangaroo:[210,170,130,150],
  // ── Reptiles / amphibians ─────────────────────────────────────────────────
  turtle:[140,195,130,150], tortoise:[155,190,130,150], frog:[100,210,110,160],
  lizard:[130,200,110,150], snake:[120,190,120,150],
  // ── Birds ────────────────────────────────────────────────────────────────
  duck:[255,230,100,155], penguin:[50,50,50,150], flamingo:[255,160,200,155],
  eagle:[160,140,110,150], pigeon:[180,175,170,150],
  // ── People ───────────────────────────────────────────────────────────────
  human:[240,210,185,150], person:[240,210,185,150],
  girl:[255,200,215,150], boy:[190,220,250,150],
  man:[220,195,170,150], woman:[255,200,215,150],
  // ── Celestial / weather ───────────────────────────────────────────────────
  sun:[255,230,80,150], cloud:[205,225,245,140], star:[255,245,140,155],
  moon:[225,220,175,145], rainbow:[200,235,255,140], lightning:[255,240,130,155],
  planet:[90,120,230,185], saturn:[200,170,120,180], earth:[80,160,230,185],
  globe:[80,160,230,185], comet:[160,200,255,170], asteroid:[175,165,155,160],
  meteor:[200,140,100,165], nebula:[180,100,230,175], galaxy:[110,80,200,175],
  // ── Vehicles ─────────────────────────────────────────────────────────────
  car:[150,190,235,150], bus:[255,210,80,150], truck:[180,200,165,150],
  boat:[100,175,235,150], airplane:[200,215,235,150],
  // ── Structures ────────────────────────────────────────────────────────────
  house:[215,195,170,145], castle:[190,185,185,145], barn:[200,130,100,145],
  bridge:[180,185,190,140], tent:[215,200,170,140],
  // ── Nature / landscape ────────────────────────────────────────────────────
  mountain:[180,190,205,130], volcano:[210,150,100,140], rock:[185,180,170,130],
  island:[140,210,160,140], hill:[160,200,140,130], cliff:[175,170,160,130],
  // ── Food / misc ──────────────────────────────────────────────────────────
  cake:[255,210,185,155], pizza:[255,200,130,155], apple:[220,80,80,160],
  heart:[255,100,130,165], acorn:[180,140,90,160], mushroom:[200,100,80,155],
  pumpkin:[235,145,60,160], banana:[255,235,80,160], strawberry:[230,80,100,160],
};

function applyFillAndStrip(src, label, fillColor) {
  const sctx = src.getContext('2d');
  const SW = src.width, SH = src.height;
  const raw = sctx.getImageData(0, 0, SW, SH).data;

  let x0=SW, y0=SH, x1=0, y1=0;
  for (let y=0;y<SH;y++) for (let x=0;x<SW;x++) {
    const i=(y*SW+x)*4;
    if ((raw[i]+raw[i+1]+raw[i+2])/3 < 220 && raw[i+3]>30) {
      if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
    }
  }
  if (x0>x1||y0>y1) return null;
  const pad=16;
  x0=Math.max(0,x0-pad); y0=Math.max(0,y0-pad);
  x1=Math.min(SW-1,x1+pad); y1=Math.min(SH-1,y1+pad);
  const CW=x1-x0+1, CH=y1-y0+1;

  const crop=document.createElement('canvas');
  crop.width=CW; crop.height=CH;
  const cc=crop.getContext('2d');
  cc.drawImage(src,x0,y0,CW,CH,0,0,CW,CH);
  const id=cc.getImageData(0,0,CW,CH), px=id.data;

  // Ink mask
  const mask=new Uint8Array(CW*CH);
  for(let i=0;i<CW*CH;i++){
    const ii=i*4;
    mask[i]=((px[ii]+px[ii+1]+px[ii+2])/3<180 && px[ii+3]>60)?1:0;
  }

  // Dilate 4px — thicker barrier closes ring intersections and other complex
  // outlines so the BFS exterior flood-fill can't leak through gaps.
  const dil=new Uint8Array(mask);
  for(let p=0;p<4;p++){
    const prev=new Uint8Array(dil);
    for(let y=1;y<CH-1;y++) for(let x=1;x<CW-1;x++) if(prev[y*CW+x]){
      dil[(y-1)*CW+x]=1; dil[(y+1)*CW+x]=1;
      dil[y*CW+x-1]=1;   dil[y*CW+x+1]=1;
    }
  }

  // BFS from border → outside
  const out=new Uint8Array(CW*CH), q=[];
  const seed=(i)=>{ if(!out[i]&&!dil[i]){out[i]=1;q.push(i);} };
  for(let x=0;x<CW;x++){ seed(x); seed((CH-1)*CW+x); }
  for(let y=0;y<CH;y++){ seed(y*CW); seed(y*CW+CW-1); }
  for(let qi=0;qi<q.length;qi++){
    const cur=q[qi], cx2=cur%CW, cy2=Math.floor(cur/CW);
    if(cx2>0)   seed(cur-1);
    if(cx2<CW-1)seed(cur+1);
    if(cy2>0)   seed(cur-CW);
    if(cy2<CH-1)seed(cur+CW);
  }

  // Paint
  // Paint — use AI-provided color if available, else FILL_COLORS table, else default
  const fc = fillColor || FILL_COLORS[(label||'').toLowerCase()] || [220,210,195,150];
  for(let i=0;i<CW*CH;i++){
    const ii=i*4;
    if(out[i]&&!mask[i]){ px[ii+3]=0; }
    else if(!out[i]&&!mask[i]){ px[ii]=fc[0];px[ii+1]=fc[1];px[ii+2]=fc[2];px[ii+3]=fc[3]; }
  }
  cc.putImageData(id,0,0);
  return { canvas:crop, cropW:CW, cropH:CH };
}
