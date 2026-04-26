/**
 * skeletonRig.js — Mesh-based LBS (guaranteed no gaps/tears)
 *
 * Instead of forward-mapping pixels (which leaves holes), we:
 * 1. Build a regular triangle mesh over the source canvas
 * 2. Deform mesh vertices using LBS (Linear Blend Skinning)
 * 3. Rasterize each deformed triangle — for every OUTPUT pixel inside
 *    a deformed triangle, barycentric-interpolate back to source coords
 *    and sample the source image there.
 * Zero gaps because we iterate over OUTPUT pixels, not source pixels.
 *
 * If GPT-4o joint detection fails, DEFAULT_JOINTS provides anatomically
 * reasonable positions so LBS always runs for limbed creatures.
 */

const MESH_STEP = 4;   // mesh vertex spacing (px) — smaller = more detail
const SIGMA     = 90;  // LBS bone influence radius (px)

// ─── Bone sets ────────────────────────────────────────────────────────────────
const BONE_SETS = {
  quadruped: [
    ['spine',   'root',   'spine'],   ['neck',    'spine',  'neck'],
    ['head',    'neck',   'head'],
    ['femur_L', 'root',   'hip_L'],   ['tibia_L', 'hip_L',  'knee_L'],
    ['femur_R', 'root',   'hip_R'],   ['tibia_R', 'hip_R',  'knee_R'],
  ],
  biped: [
    ['spine',   'root',       'spine'],  ['neck',    'spine',      'neck'],
    ['head',    'neck',       'head'],
    ['upper_L', 'spine',      'shoulder_L'], ['fore_L', 'shoulder_L', 'elbow_L'],
    ['upper_R', 'spine',      'shoulder_R'], ['fore_R', 'shoulder_R', 'elbow_R'],
    ['thigh_L', 'root',       'hip_L'],      ['shin_L', 'hip_L',      'knee_L'],
    ['thigh_R', 'root',       'hip_R'],      ['shin_R', 'hip_R',      'knee_R'],
  ],
  bird: [
    ['spine',  'root',       'spine'],   ['neck',  'spine', 'neck'],
    ['head',   'neck',       'head'],
    ['wing_L', 'spine',      'shoulder_L'], ['tip_L', 'shoulder_L', 'elbow_L'],
    ['wing_R', 'spine',      'shoulder_R'], ['tip_R', 'shoulder_R', 'elbow_R'],
    ['leg_L',  'root',       'hip_L'],      ['leg_R', 'root',       'hip_R'],
  ],
  fish: [
    ['body',  'root',  'spine'],
    ['tail1', 'spine', 'tail_base'],
    ['tail2', 'tail_base', 'tail_tip'],
  ],
};

// ─── Walk-cycle rotations (degrees) ──────────────────────────────────────────
function getRotations(type, phase) {
  const p = phase * Math.PI * 2;
  switch (type) {
    case 'quadruped': return {
      spine:   Math.sin(p * 2)           *  2,
      neck:    Math.sin(p * 2 + 0.4)    *  5,
      head:    Math.sin(p * 0.8)         *  4,
      femur_L: Math.sin(p)               * 18,
      tibia_L: Math.max(0,Math.sin(p+0.5))* 14,
      femur_R: Math.sin(p + Math.PI)     * 18,
      tibia_R: Math.max(0,Math.sin(p+Math.PI+0.5))*14,
    };
    case 'biped': return {
      spine:   Math.sin(p * 2)           *  2,
      neck:    Math.sin(p)               *  3,
      head:    Math.sin(p * 0.7)         *  4,
      upper_L: Math.sin(p + Math.PI)     * 18,
      fore_L:  Math.max(0,Math.sin(p+Math.PI+0.5))*14,
      upper_R: Math.sin(p)               * 18,
      fore_R:  Math.max(0,Math.sin(p+0.5))*14,
      thigh_L: Math.sin(p)               * 20,
      shin_L:  Math.max(0,Math.sin(p+0.6))*16,
      thigh_R: Math.sin(p + Math.PI)     * 20,
      shin_R:  Math.max(0,Math.sin(p+Math.PI+0.6))*16,
    };
    case 'bird': return {
      spine:  Math.sin(p*2) * 2,   neck: Math.sin(p) * 4, head: Math.sin(p) * 5,
      wing_L: Math.sin(p*3) * 30,  tip_L: Math.sin(p*3+0.5) * 18,
      wing_R: Math.sin(p*3) * 30,  tip_R: Math.sin(p*3+0.5) * 18,
      leg_L:  Math.sin(p) * 8,     leg_R: Math.sin(p+Math.PI) * 8,
    };
    case 'fish': return {
      body:  Math.sin(p*1.8)*10,
      tail1: Math.sin(p*1.8+0.5)*18,
      tail2: Math.sin(p*1.8+1.0)*24,
    };
    default: return {};
  }
}

// ─── Default joint positions (normalized 0-1) when GPT-4o fails ──────────────
// Anatomically reasonable for typical side-view sketches.
const DEFAULT_JOINTS = {
  quadruped: {
    root:[0.50,0.64], spine:[0.50,0.36], neck:[0.72,0.40], head:[0.86,0.28],
    hip_L:[0.30,0.64], knee_L:[0.26,0.82], ankle_L:[0.23,0.95],
    hip_R:[0.72,0.64], knee_R:[0.76,0.82], ankle_R:[0.79,0.95],
  },
  biped: {
    root:[0.50,0.58], spine:[0.50,0.34], neck:[0.50,0.18], head:[0.50,0.07],
    shoulder_L:[0.30,0.28], elbow_L:[0.22,0.44],
    shoulder_R:[0.70,0.28], elbow_R:[0.78,0.44],
    hip_L:[0.40,0.58], knee_L:[0.38,0.76],
    hip_R:[0.60,0.58], knee_R:[0.62,0.76],
  },
  bird: {
    root:[0.50,0.55], spine:[0.50,0.35], neck:[0.65,0.24], head:[0.76,0.14],
    shoulder_L:[0.34,0.35], elbow_L:[0.14,0.46],
    shoulder_R:[0.66,0.35], elbow_R:[0.86,0.46],
    hip_L:[0.42,0.60], hip_R:[0.58,0.60],
  },
  fish: {
    root:[0.65,0.50], spine:[0.38,0.50], tail_base:[0.20,0.50], tail_tip:[0.05,0.50],
  },
};

// ─── Determine skeleton type from label/category ──────────────────────────────
function determineType(lbl, cat) {
  const l = (lbl||'').toLowerCase(), c = (cat||'').toLowerCase();
  if (['butterfly','bee','moth','dragonfly','bat'].some(x=>l.includes(x))) return null; // wings handled separately
  if (['fish','shark','whale','dolphin'].some(x=>l.includes(x))) return 'fish';
  if (['bird','parrot','owl','penguin','duck','chicken','crow','eagle'].some(x=>l.includes(x))) return 'bird';
  if (['human','person','girl','boy','man','woman'].some(x=>l.includes(x))) return 'biped';
  if (c==='ground_animal'||['dog','cat','horse','cow','sheep','rabbit','fox',
      'deer','bear','lion','tiger','wolf','pig','turtle','tortoise','frog',
      'lizard','elephant','rhino','hippo','giraffe','zebra'].some(x=>l.includes(x)))
    return 'quadruped';
  return null;
}

// ─── Fetch joints from backend ────────────────────────────────────────────────
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
    console.warn('[skeletonRig] fetchJoints:', e.message);
    return null;
  }
}

// ─── Distance from point to line segment ─────────────────────────────────────
function distToSeg(px, py, p0, p1) {
  const dx = p1.x-p0.x, dy = p1.y-p0.y, L2 = dx*dx+dy*dy;
  if (L2===0) return Math.hypot(px-p0.x, py-p0.y);
  const t = Math.max(0,Math.min(1,((px-p0.x)*dx+(py-p0.y)*dy)/L2));
  return Math.hypot(px-(p0.x+t*dx), py-(p0.y+t*dy));
}

// ─── Compute LBS weights for one point ───────────────────────────────────────
function weightsAt(x, y, joints, bones) {
  const C = { x: 0, y: 0 }; // fallback
  const dists = bones.map(([,pj,cj], bi) => ({
    bi, dist: distToSeg(x, y, joints[pj]||C, joints[cj]||C),
  }));
  dists.sort((a,b)=>a.dist-b.dist);
  const top = dists.slice(0,3);
  const ws  = top.map(d => Math.exp(-d.dist*d.dist/(2*SIGMA*SIGMA)));
  const wS  = ws.reduce((a,b)=>a+b,0)||1;
  return top.map((d,k)=>({ bi:d.bi, w:ws[k]/wS }));
}

// ─── Apply LBS to a single point given bone transforms ───────────────────────
function applyLBS(x, y, bw, T) {
  let nx=0, ny=0;
  for (const {bi,w} of bw) {
    const t=T[bi], dx=x-t.Jx, dy=y-t.Jy;
    nx += w*(t.Jx + t.cos*dx - t.sin*dy);
    ny += w*(t.Jy + t.sin*dx + t.cos*dy);
  }
  return [nx, ny];
}

// ─── Rasterize one triangle — gapless inverse texture mapping ────────────────
function rasterizeTri(out, src, OW, OH, SW, SH,
  dx0,dy0, sx0,sy0,
  dx1,dy1, sx1,sy1,
  dx2,dy2, sx2,sy2) {

  // Bounding box
  const minX=Math.max(0,Math.floor(Math.min(dx0,dx1,dx2)));
  const maxX=Math.min(OW-1,Math.ceil(Math.max(dx0,dx1,dx2)));
  const minY=Math.max(0,Math.floor(Math.min(dy0,dy1,dy2)));
  const maxY=Math.min(OH-1,Math.ceil(Math.max(dy0,dy1,dy2)));

  const denom=(dy1-dy2)*(dx0-dx2)+(dx2-dx1)*(dy0-dy2);
  if (Math.abs(denom)<0.5) return;

  for (let py=minY; py<=maxY; py++) {
    for (let px=minX; px<=maxX; px++) {
      // Barycentric coords in deformed space
      const w0=((dy1-dy2)*(px-dx2)+(dx2-dx1)*(py-dy2))/denom;
      const w1=((dy2-dy0)*(px-dx2)+(dx0-dx2)*(py-dy2))/denom;
      const w2=1-w0-w1;
      if (w0<-0.01||w1<-0.01||w2<-0.01) continue;

      // Interpolate SOURCE position
      const sxi=Math.round(w0*sx0+w1*sx1+w2*sx2);
      const syi=Math.round(w0*sy0+w1*sy1+w2*sy2);
      if (sxi<0||sxi>=SW||syi<0||syi>=SH) continue;

      const si=(syi*SW+sxi)*4;
      if (src[si+3]<8) continue; // skip transparent source

      const di=(py*OW+px)*4;
      out[di]=src[si]; out[di+1]=src[si+1];
      out[di+2]=src[si+2]; out[di+3]=src[si+3];
    }
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────
export async function buildSkeletalRig(croppedCanvas, label, category, cx, cy, agentId, konvaLayer) {
  const SW=croppedCanvas.width, SH=croppedCanvas.height;

  // 1. Try GPT-4o joint detection
  let jointData = await fetchJoints(croppedCanvas, label, category);

  // 2. Fall back to anatomical defaults so LBS always runs
  if (!jointData?.joints) {
    const skType = determineType(label, category);
    if (!skType || !DEFAULT_JOINTS[skType]) {
      console.warn(`[skeletonRig] No joints and no default for "${label}" — skipping LBS`);
      return null;
    }
    console.log(`[skeletonRig] Using default joints for "${label}" (${skType})`);
    jointData = { type: skType, joints: DEFAULT_JOINTS[skType] };
  }

  const type  = jointData.type;
  const bones = BONE_SETS[type];
  if (!bones) return null;

  // Normalize joint coords
  const joints={};
  for (const [name,coords] of Object.entries(jointData.joints)) {
    if (Array.isArray(coords)&&coords.length===2)
      joints[name]={ x:coords[0]*SW, y:coords[1]*SH };
  }
  for (const [,pj,cj] of bones) {
    const c={x:SW/2,y:SH/2};
    if (!joints[pj]) joints[pj]={...c};
    if (!joints[cj]) joints[cj]={...c};
  }

  // Build mesh vertices + precompute LBS weights per vertex
  const mW=Math.floor(SW/MESH_STEP)+1, mH=Math.floor(SH/MESH_STEP)+1;
  const verts=[];
  for (let vy=0; vy<mH; vy++) {
    for (let vx=0; vx<mW; vx++) {
      const sx=Math.min(vx*MESH_STEP, SW-1);
      const sy=Math.min(vy*MESH_STEP, SH-1);
      verts.push({ sx, sy, bw: weightsAt(sx,sy,joints,bones) });
    }
  }
  console.log(`[skeletonRig] "${label}" type=${type} mesh=${mW}×${mH}=${verts.length} verts`);

  // Read source pixels
  const srcImg = croppedCanvas.getContext('2d').getImageData(0,0,SW,SH);

  // Padded output canvas (so deformed limbs outside original bounds don't clip)
  const PAD=60, OW=SW+PAD*2, OH=SH+PAD*2;
  const outCanvas=document.createElement('canvas');
  outCanvas.width=OW; outCanvas.height=OH;
  const outCtx=outCanvas.getContext('2d');

  const kImg=new Konva.Image({ image:outCanvas, x:-(OW/2), y:-(OH/2), width:OW, height:OH });
  const group=new Konva.Group({ x:cx, y:cy, id:agentId });
  group.add(kImg);
  konvaLayer.add(group);

  const FREQ={bird:2.0,fish:1.8,biped:1.4}[type]??1.6;
  let phase=0,lastTs=null,raf;

  const tick = ts => {
    if (!lastTs) lastTs=ts;
    phase += Math.min((ts-lastTs)/1000,0.05)*FREQ;
    lastTs=ts;

    // 1. Build bone transforms for this frame
    const rots=getRotations(type,phase);
    const T=bones.map(([name,pj])=>{
      const rad=(rots[name]||0)*Math.PI/180;
      const J=joints[pj]||{x:0,y:0};
      return {Jx:J.x,Jy:J.y,cos:Math.cos(rad),sin:Math.sin(rad)};
    });

    // 2. Deform all mesh vertices
    const dv=verts.map(v=>{
      const [nx,ny]=applyLBS(v.sx,v.sy,v.bw,T);
      return {dx:nx+PAD, dy:ny+PAD};
    });

    // 3. Rasterize all mesh quads as two triangles each
    const outData=outCtx.createImageData(OW,OH);
    const out=outData.data;
    const src=srcImg.data;

    for (let vy=0; vy<mH-1; vy++) {
      for (let vx=0; vx<mW-1; vx++) {
        const i00=vy*mW+vx, i10=i00+1, i01=i00+mW, i11=i01+1;
        const V00=verts[i00],D00=dv[i00];
        const V10=verts[i10],D10=dv[i10];
        const V01=verts[i01],D01=dv[i01];
        const V11=verts[i11],D11=dv[i11];
        // Triangle A
        rasterizeTri(out,src,OW,OH,SW,SH,
          D00.dx,D00.dy, V00.sx,V00.sy,
          D10.dx,D10.dy, V10.sx,V10.sy,
          D01.dx,D01.dy, V01.sx,V01.sy);
        // Triangle B
        rasterizeTri(out,src,OW,OH,SW,SH,
          D10.dx,D10.dy, V10.sx,V10.sy,
          D11.dx,D11.dy, V11.sx,V11.sy,
          D01.dx,D01.dy, V01.sx,V01.sy);
      }
    }

    outCtx.putImageData(outData,0,0);
    kImg.image(outCanvas);
    konvaLayer.batchDraw();
    raf=requestAnimationFrame(tick);
  };
  raf=requestAnimationFrame(tick);

  return { group, w:OW, h:OH, stop:()=>cancelAnimationFrame(raf) };
}
