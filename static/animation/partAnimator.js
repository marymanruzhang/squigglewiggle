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
export function buildPartGroup(sourceCanvas, _parts, cx, cy, agentId, konvaLayer, category, label) {
  return new Promise(async resolve => {
    const filled = applyFillAndStrip(sourceCanvas, label);
    if (!filled) { resolve(null); return; }
    const { canvas: src, cropW: W, cropH: H } = filled;

    const cat = (category || '').toLowerCase();
    const lbl = (label    || '').toLowerCase();

    const isFlying  = cat === 'flying_animal'  || ['butterfly','bird','bee','moth','bat','dragonfly'].includes(lbl);
    const isGround  = cat === 'ground_animal'  || ['dog','cat','rabbit','sheep','horse','cow','turtle','tortoise','fox','deer','frog','lizard','pig','wolf','bear','lion','tiger','elephant'].includes(lbl);
    const isHuman   = cat === 'human_character'|| ['human','person','girl','boy'].includes(lbl);
    const isPlant   = cat === 'plant'          || ['flower','tree','grass','bush','cactus','sunflower','rose'].includes(lbl);
    const isSwim    = cat === 'water_creature' || ['fish','whale','shark','octopus','jellyfish','crab'].includes(lbl);
    const hasLimbs  = isGround || isHuman || (isFlying && !['butterfly','bee','moth'].includes(lbl));

    // ── Try Plan A: GPT-4o joints + LBS skeleton (limbed creatures only) ──────
    if (hasLimbs) {
      try {
        const rigResult = await buildSkeletalRig(src, lbl, cat, cx, cy, agentId, konvaLayer);
        if (rigResult) {
          // Apply semantic scale to the group
          const scale = getSemanticScale(lbl);
          rigResult.group.scaleX(scale);
          rigResult.group.scaleY(scale);
          rigResult.group._stopPartAnimations = rigResult.stop;
          konvaLayer.draw();
          resolve({ group: rigResult.group, w: W * scale, h: H * scale, stop: rigResult.stop });
          return;
        }
      } catch (e) {
        console.warn('[partAnimator] Skeletal rig failed, falling back to geometric:', e.message);
      }
    }

    // ── Fallback: geometric canvas split ──────────────────────────────────────
    const group  = new Konva.Group({ x: cx, y: cy, id: agentId });
    const rafIds = [];

    if (isFlying) {
      buildWings(src, W, H, group, konvaLayer, rafIds, lbl);
    } else if (isPlant) {
      buildPlant(src, W, H, group, konvaLayer, rafIds);
    } else if (isSwim) {
      buildSwimmer(src, W, H, group, konvaLayer, rafIds);
    } else {
      // Ground animals, bipeds, and anything else: whole-body bounce
      // (never split — splitting always creates visible seams)
      buildWholeBodyBounce(src, W, H, group, konvaLayer, rafIds, isHuman);
    }

    if (group.children.length === 0) { resolve(null); return; }

    group.offsetX(W / 2);
    group.offsetY(H / 2);

    const scale = getSemanticScale(lbl);
    group.scaleX(scale);
    group.scaleY(scale);

    konvaLayer.add(group);
    konvaLayer.draw();

    group._stopPartAnimations = () => { rafIds.forEach(cancelAnimationFrame); rafIds.length = 0; };
    resolve({ group, w: W * scale, h: H * scale, stop: group._stopPartAnimations });
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
  butterfly:[180,140,220,140], moth:[160,130,200,130], bee:[255,210,80,130],
  bird:[255,210,120,130], parrot:[100,200,140,130], bat:[100,90,130,120],
  dragonfly:[100,180,230,130], owl:[200,180,140,120],
  fish:[100,180,230,130], whale:[80,160,210,120], shark:[140,160,190,120],
  octopus:[190,130,200,120], jellyfish:[200,170,230,120], crab:[220,130,100,120],
  flower:[255,170,190,130], sunflower:[255,220,80,130], rose:[240,120,140,130],
  tree:[130,200,130,120], grass:[140,210,140,110], bush:[120,190,110,120],
  cactus:[100,180,100,120],
  cat:[230,190,150,120], dog:[220,185,145,120], rabbit:[230,215,205,120],
  sheep:[220,220,215,120], horse:[200,175,145,120], cow:[220,210,190,120],
  fox:[230,160,100,120], deer:[210,180,140,120], bear:[160,130,100,120],
  turtle:[160,200,140,120], tortoise:[170,200,140,120], frog:[120,200,120,130],
  lizard:[140,200,120,120],
  human:[240,210,190,120], person:[240,210,190,120], girl:[250,200,210,120], boy:[200,220,240,120],
  elephant:[180,180,190,120], lion:[240,200,140,120], tiger:[240,180,100,120],
  sun:[255,230,100,130], cloud:[210,225,240,120], star:[255,240,150,130],
  moon:[220,220,180,120], rainbow:[200,230,255,120],
  car:[160,190,230,120], house:[210,190,170,120], cake:[255,210,180,130],
  mountain:[180,190,200,110], rock:[190,185,175,110],
};

function applyFillAndStrip(src, label) {
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

  // Dilate 2px
  const dil=new Uint8Array(mask);
  for(let p=0;p<2;p++){
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
  const fc=FILL_COLORS[(label||'').toLowerCase()]||[230,220,210,120];
  for(let i=0;i<CW*CH;i++){
    const ii=i*4;
    if(out[i]&&!mask[i]){ px[ii+3]=0; }
    else if(!out[i]&&!mask[i]){ px[ii]=fc[0];px[ii+1]=fc[1];px[ii+2]=fc[2];px[ii+3]=fc[3]; }
  }
  cc.putImageData(id,0,0);
  return { canvas:crop, cropW:CW, cropH:CH };
}
