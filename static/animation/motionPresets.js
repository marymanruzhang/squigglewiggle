/**
 * motionPresets.js
 * All motion presets. Each function signature:
 *   preset(agent, params={}) → cancelFn
 *
 * params.duration  → one-shot mode (ms); calls params.onComplete when done
 * no duration      → loops forever (idle mode)
 *
 * HOW TO ADD A PRESET:
 *   Export a new function below and reference it by name in semanticProfiles.js
 */

// ─── Shared utilities ─────────────────────────────────────────────────────────

export const easeInOut = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
export const lerp = (a, b, t) => a + (b - a) * t;

/** Animate position from current → (tx, ty) over durationMs, returns Promise */
export function moveTo(agent, tx, ty, durationMs = 600) {
  return new Promise(resolve => {
    const start = agent.adapter.getPosition();
    let t0 = null, raf;
    function tick(ts) {
      if (!t0) t0 = ts;
      const p = Math.min((ts - t0) / durationMs, 1);
      const e = easeInOut(p);
      agent.adapter.setPosition(lerp(start.x, tx, e), lerp(start.y, ty, e));
      if (p < 1) { raf = requestAnimationFrame(tick); } else resolve();
    }
    raf = requestAnimationFrame(tick);
  });
}

/** Orbit agent around (cx, cy) for `turns` rotations over durationMs, returns Promise */
export function orbitAround(agent, cx, cy, radius, turns, durationMs) {
  return new Promise(resolve => {
    const pos = agent.adapter.getPosition();
    const startAngle = Math.atan2(pos.y - cy, pos.x - cx);
    let t0 = null;
    function tick(ts) {
      if (!t0) t0 = ts;
      const p = Math.min((ts - t0) / durationMs, 1);
      const angle = startAngle + turns * 2 * Math.PI * p;
      agent.adapter.setPosition(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
      if (p < 1) { requestAnimationFrame(tick); } else resolve();
    }
    requestAnimationFrame(tick);
  });
}

/** Delay utility */
export const wait = ms => new Promise(r => setTimeout(r, ms));

// Internal RAF loop helper
function loop(fn) {
  let running = true, raf;
  function tick(ts) { if (!running) return; fn(ts); raf = requestAnimationFrame(tick); }
  raf = requestAnimationFrame(tick);
  return () => { running = false; cancelAnimationFrame(raf); };
}

function oneshotOrLoop(agent, params, applyFn) {
  const { duration, onComplete } = params;
  let t0 = null;
  const cancel = loop(ts => {
    if (!t0) t0 = ts;
    const elapsed = ts - t0;
    applyFn(elapsed / 1000, elapsed);
    if (duration && elapsed >= duration) { cancel(); onComplete?.(); }
  });
  return cancel;
}

// ─── Plant / rooted motions ───────────────────────────────────────────────────

export function sway(agent, params = {}) {
  const { amplitude = 8, speed = 0.5 } = params;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    agent.adapter.setRotation(amplitude * Math.sin(2 * Math.PI * t * speed));
    agent.adapter.setPosition(origin.x, origin.y);
  });
}

export function slow_sway(agent, params = {}) {
  return sway(agent, { amplitude: 5, speed: 0.3, ...params });
}

export function wave(agent, params = {}) {
  const { amplitude = 12, speed = 0.6 } = params;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    agent.adapter.setPosition(origin.x + amplitude * Math.sin(2 * Math.PI * t * speed), origin.y);
  });
}

export function sway_bloom(agent, params = {}) {
  const { amplitude = 8, speed = 0.5, bloomAmplitude = 0.07, bloomSpeed = 0.8 } = params;
  const base   = agent.spawnScale ?? agent.adapter._scaleX ?? 1;
  return oneshotOrLoop(agent, params, t => {
    const origin = agent.originPos;   // dynamic — wander updates this
    agent.adapter.setRotation(amplitude * Math.sin(2 * Math.PI * t * speed));
    agent.adapter.setScale(base * (1 + bloomAmplitude * Math.sin(2 * Math.PI * t * bloomSpeed)));
    agent.adapter.setPosition(origin.x, origin.y);
  });
}

export function subtle_wiggle(agent, params = {}) {
  const { amplitude = 0.5, speed = 0.3 } = params;  // reduced from 1.5 to stop visible shaking
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    // Combine two sine waves for organic feel
    const r = amplitude * Math.sin(2 * Math.PI * t * speed) +
              (amplitude * 0.4) * Math.sin(2 * Math.PI * t * speed * 2.3);
    agent.adapter.setRotation(r);
    agent.adapter.setPosition(origin.x, origin.y);
  });
}

// ─── Ground animal motions ────────────────────────────────────────────────────
// Architecture: each ground preset tracks its own worldX/worldY (the animal's
// true canvas position). The display position = world + animation overlay (bob,
// arc, etc.). This separation prevents the "vertical drift" bug where adding
// bob to getPosition() each frame causes dy to grow unboundedly.
// Wander steers by updating agent.originPos; presets smoothly move worldX/worldY
// toward that target while playing the walk/hop/prowl animation continuously.

export function walk_bounce(agent, params = {}) {
  const {
    bounceHeight = 8, stepFreq = 2.2, walkSpeed = 70,
    leanAmp = 5, speed = 0.4,   // speed kept for API compat, unused
  } = params;
  const imgNode = agent.adapter.ref?.findOne?.('Image') ?? null;
  let worldX = null, worldY = null, lastFacing = 1;

  return oneshotOrLoop(agent, params, t => {
    // Lazy-init world position from agent's current canvas position
    if (worldX === null) {
      const p = agent.adapter.getPosition();
      worldX = p.x; worldY = p.y;
    }

    const target = agent.originPos;
    const dx = target.x - worldX;
    const dy = target.y - worldY;
    const dist = Math.hypot(dx, dy);
    const moving = dist > 6;

    // Move world position toward target at walk speed
    if (moving) {
      const step = Math.min(dist, walkSpeed / 60);
      worldX += (dx / dist) * step;
      worldY += (dy / dist) * step;
    }

    // Walk animation — always running (idle bob even when stationary)
    const bobScale = moving ? 1.0 : 0.25;
    const bob  = -bounceHeight * bobScale * Math.abs(Math.sin(Math.PI * t * stepFreq * 2));
    const rock = leanAmp * bobScale * Math.sin(2 * Math.PI * t * stepFreq);

    agent.adapter.setPosition(worldX, worldY + bob);
    agent.adapter.setRotation(rock);

    // Direction flip on image child (not whole group — label stays upright)
    if (imgNode && moving) {
      const facing = dx < 0 ? -1 : 1;
      if (facing !== lastFacing) { imgNode.scaleX(facing); lastFacing = facing; }
    }
  });
}

export function slow_walk(agent, params = {}) {
  return walk_bounce(agent, { bounceHeight: 4, stepFreq: 1.4, walkSpeed: 35, leanAmp: 3, ...params });
}

export function hop(agent, params = {}) {
  // Rabbit: parabolic hops with squash/stretch on takeoff & landing
  const { hopHeight = 28, hopSpeed = 0.75, walkSpeed = 55 } = params;
  const imgNode = agent.adapter.ref?.findOne?.('Image') ?? null;
  let worldX = null, worldY = null, lastFacing = 1;

  return oneshotOrLoop(agent, params, t => {
    if (worldX === null) {
      const p = agent.adapter.getPosition();
      worldX = p.x; worldY = p.y;
    }

    const target = agent.originPos;
    const dx = target.x - worldX;
    const dy = target.y - worldY;
    const dist = Math.hypot(dx, dy);
    const moving = dist > 6;

    if (moving) {
      const step = Math.min(dist, walkSpeed / 60);
      worldX += (dx / dist) * step;
      worldY += (dy / dist) * step;
    }

    // Parabolic hop arc
    const phase  = (t * hopSpeed) % 1;
    const inAir  = phase > 0.08 && phase < 0.92;
    const arcY   = moving ? -hopHeight * Math.max(0, Math.sin(Math.PI * phase)) : 0;

    agent.adapter.setPosition(worldX, worldY + arcY);

    // Squash on landing, stretch at apex — image child only
    if (imgNode) {
      let sx = 1, sy = 1;
      if (!inAir && moving) {
        sx = 1.3; sy = 0.75; // wide squash on landing
      } else if (phase > 0.4 && phase < 0.6 && moving) {
        sx = 0.82; sy = 1.22; // tall stretch at apex
      }
      const facing = (dx < 0 && moving) ? -1 : 1;
      if (facing !== lastFacing) lastFacing = facing;
      imgNode.scaleX(lastFacing * sx);
      imgNode.scaleY(sy);
    }
  });
}

export function scurry(agent, params = {}) {
  return walk_bounce(agent, { bounceHeight: 3, stepFreq: 5, walkSpeed: 130, leanAmp: 3, ...params });
}

export function prowl(agent, params = {}) {
  // Cat: silent, low, smooth stalk
  const { walkSpeed = 40 } = params;
  const imgNode = agent.adapter.ref?.findOne?.('Image') ?? null;
  let worldX = null, worldY = null, lastFacing = 1;

  return oneshotOrLoop(agent, params, t => {
    if (worldX === null) {
      const p = agent.adapter.getPosition();
      worldX = p.x; worldY = p.y;
    }

    const target = agent.originPos;
    const dx = target.x - worldX;
    const dy = target.y - worldY;
    const dist = Math.hypot(dx, dy);
    const moving = dist > 6;

    if (moving) {
      const step = Math.min(dist, walkSpeed / 60);
      worldX += (dx / dist) * step;
      worldY += (dy / dist) * step;
    }

    // Cats are smooth — very subtle bob, gentle lean
    const bob  = -2.5 * Math.abs(Math.sin(Math.PI * t * 1.8 * 2)) * (moving ? 1 : 0.2);
    const lean =  3   * Math.sin(2 * Math.PI * t * 1.8)           * (moving ? 1 : 0.2);

    agent.adapter.setPosition(worldX, worldY + bob);
    agent.adapter.setRotation(lean);

    if (imgNode && moving) {
      const facing = dx < 0 ? -1 : 1;
      if (facing !== lastFacing) { imgNode.scaleX(facing); lastFacing = facing; }
    }
  });
}

// ─── Flying animal motions ────────────────────────────────────────────────────

export function hover(agent, params = {}) {
  // Bee/dragonfly: figure-8 hover + fast wing buzz on image child
  const { hoverHeight = 6, speed = 0.55, xDrift = 8, wingFreq = 8, wingMin = 0.4 } = params;
  const imgNode = agent.adapter.ref?.findOne?.('Image') ?? null;

  return oneshotOrLoop(agent, params, t => {
    const origin = agent.originPos;  // dynamic — wander updates this
    const y = origin.y + hoverHeight * Math.sin(2 * Math.PI * t * speed);
    const x = origin.x + xDrift    * Math.sin(2 * Math.PI * t * speed * 0.7);
    agent.adapter.setPosition(x, y);
    if (imgNode) {
      const wing = wingMin + (1 - wingMin) * Math.abs(Math.sin(Math.PI * t * wingFreq));
      imgNode.scaleX(wing);
    }
  });
}

export function flutter(agent, params = {}) {
  // Butterfly/moth: organic figure-8 flight path + wing-flapping
  // Reads agent.originPos each frame so wander can drift the home position.
  // Wing flap is applied ONLY to the sketch image child — label pill is unaffected.
  const { xFreq = 0.35, yFreq = 0.6, xAmp = 35, yAmp = 20,
          wingFreq = 3.5, wingMin = 0.2 } = params;
  // Grab the image child once; works for Konva groups
  const imgNode = agent.adapter.ref?.findOne?.('Image') ?? null;
  return oneshotOrLoop(agent, params, t => {
    const origin = agent.originPos;   // dynamic — wander updates this
    const x = origin.x + xAmp * Math.sin(2 * Math.PI * t * xFreq)
                       + (xAmp * 0.3) * Math.sin(2 * Math.PI * t * xFreq * 2.7);
    const y = origin.y + yAmp * Math.sin(2 * Math.PI * t * yFreq)
                       + (yAmp * 0.4) * Math.sin(2 * Math.PI * t * yFreq * 1.6);
    const r = 6 * Math.sin(2 * Math.PI * t * yFreq * 2);
    agent.adapter.setPosition(x, y);
    agent.adapter.setRotation(r);
    // Wing beat: scaleX on image node only (doesn't affect label)
    if (imgNode) {
      const wing = wingMin + (1 - wingMin) * Math.abs(Math.sin(Math.PI * t * wingFreq));
      imgNode.scaleX(wing);
    }
  });
}

export function fly(agent, params = {}) {
  // Bird: broad sweeping sine-wave path + wing-beat on image child
  const { xAmp = 85, yAmp = 20, speed = 0.4,
          wingFreq = 4.0, wingMin = 0.55 } = params;
  const imgNode = agent.adapter.ref?.findOne?.('Image') ?? null;
  return oneshotOrLoop(agent, params, t => {
    const origin = agent.originPos;   // dynamic — wander updates this
    const x = origin.x + xAmp * Math.sin(2 * Math.PI * t * speed);
    const y = origin.y + yAmp * Math.sin(4 * Math.PI * t * speed);
    agent.adapter.setPosition(x, y);
    agent.adapter.setRotation(4 * Math.cos(2 * Math.PI * t * speed));
    // Wing beat: compress image horizontally to simulate folding wings
    if (imgNode) {
      const wing = wingMin + (1 - wingMin) * Math.abs(Math.sin(Math.PI * t * wingFreq));
      imgNode.scaleX(wing);
    }
  });
}

export function zigzag_fly(agent, params = {}) {
  const { xAmp = 70, yAmp = 28, speed = 0.7 } = params;
  return oneshotOrLoop(agent, params, t => {
    const origin = agent.originPos;   // dynamic — wander can steer this
    const phase = (t * speed) % 1;
    const x = origin.x + xAmp * (2 * phase - 1);
    const y = origin.y + yAmp * Math.sin(4 * Math.PI * t * speed);
    agent.adapter.setPosition(x, y);
    agent.adapter.setRotation(12 * Math.sin(2 * Math.PI * t * speed * 2));
  });
}

export function orbit(agent, params = {}) {
  // Orbit around the agent's current wander position (dynamic — follows wander)
  const { radius = 60, speed = 0.4 } = params;
  return oneshotOrLoop(agent, params, t => {
    const origin = agent.originPos;   // dynamic — wander updates this
    const angle = 2 * Math.PI * t * speed;
    agent.adapter.setPosition(origin.x + radius * Math.cos(angle), origin.y + radius * Math.sin(angle));
  });
}

// ─── Water creature motions ───────────────────────────────────────────────────

export function swim(agent, params = {}) {
  // Fish/aquatic: side-to-side with lean rotation
  // Reads agent.originPos dynamically so wander can drift the home position
  const { amplitude = 55, speed = 0.4, leanAngle = 10 } = params;
  return oneshotOrLoop(agent, params, t => {
    const origin = agent.originPos;   // dynamic — wander updates this
    const x    = origin.x + amplitude * Math.sin(2 * Math.PI * t * speed);
    const lean = leanAngle * Math.cos(2 * Math.PI * t * speed);
    agent.adapter.setPosition(x, origin.y);
    agent.adapter.setRotation(lean);
  });
}

export function slow_swim(agent, params = {}) {
  return swim(agent, { amplitude: 40, speed: 0.22, leanAngle: 5, ...params });
}

export function pulse_float(agent, params = {}) {
  const { pulseAmp = 0.12, floatHeight = 10, speed = 0.5 } = params;
  const base   = agent.spawnScale ?? agent.adapter._scaleX ?? 1;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    agent.adapter.setScale(base * (1 + pulseAmp * Math.sin(2 * Math.PI * t * speed)));
    agent.adapter.setPosition(origin.x, origin.y + floatHeight * Math.sin(2 * Math.PI * t * speed * 0.6));
  });
}

export function side_shuffle(agent, params = {}) {
  const { speed = 0.9, range = 50 } = params;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    agent.adapter.setPosition(origin.x + range * Math.sin(2 * Math.PI * t * speed), origin.y);
  });
}

// ─── Weather motions ──────────────────────────────────────────────────────────

export function drift(agent, params = {}) {
  const { speed = 0.2, range = 120 } = params;
  return oneshotOrLoop(agent, params, t => {
    const origin = agent.originPos;   // dynamic — wander updates this
    agent.adapter.setPosition(origin.x + range * Math.sin(2 * Math.PI * t * speed), origin.y);
  });
}

export function fall(agent, params = {}) {
  const { fallSpeed = 2.5, resetY = -20 } = params;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    const yOffset = (t * fallSpeed * 60) % (origin.y - resetY + 200);
    agent.adapter.setPosition(origin.x, origin.y - (origin.y - resetY + 200) + yOffset);
  });
}

export function fall_slow(agent, params = {}) {
  const { fallSpeed = 0.8, drift: d = 5 } = params;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    const yOffset = (t * fallSpeed * 60) % 300;
    const xDrift = d * Math.sin(2 * Math.PI * t * 0.3);
    agent.adapter.setPosition(origin.x + xDrift, origin.y - 300 + yOffset);
  });
}

export function flash(agent, params = {}) {
  const { flashDuration = 80, pauseDuration = 1400 } = params;
  const cycle = flashDuration + pauseDuration;
  return oneshotOrLoop(agent, params, (t, elapsedMs) => {
    const phase = elapsedMs % cycle;
    agent.adapter.setOpacity(phase < flashDuration ? 1.0 : 0.0);
  });
}

export function push(agent, params = {}) {
  // Creates a ripple-scale pulse that visually "pushes"
  return pulse(agent, { amplitude: 0.15, speed: 1.5, ...params });
}

// ─── Celestial / light motions ────────────────────────────────────────────────

export function pulse(agent, params = {}) {
  const { amplitude = 0.07, speed = 0.6 } = params;
  const base = agent.spawnScale ?? agent.adapter._scaleX ?? 1;
  return oneshotOrLoop(agent, params, t => {
    agent.adapter.setScale(base * (1 + amplitude * Math.sin(2 * Math.PI * t * speed)));
  });
}

export function twinkle(agent, params = {}) {
  const { opacityMin = 0.55, opacityMax = 1.0, speed = 1.1 } = params;
  const base = agent.spawnScale ?? agent.adapter._scaleX ?? 1;
  return oneshotOrLoop(agent, params, t => {
    const v = (Math.sin(2 * Math.PI * t * speed) + Math.sin(2 * Math.PI * t * speed * 1.7)) / 2;
    const opacity = opacityMin + (opacityMax - opacityMin) * (v * 0.5 + 0.5);
    agent.adapter.setOpacity(opacity);
    agent.adapter.setScale(base * (1 + 0.04 * Math.sin(2 * Math.PI * t * speed * 1.3)));
  });
}

export function shimmer(agent, params = {}) {
  const { opacityMin = 0.6, opacityMax = 1.0, speed = 0.4 } = params;
  return oneshotOrLoop(agent, params, t => {
    const opacity = opacityMin + (opacityMax - opacityMin) * (0.5 + 0.5 * Math.sin(2 * Math.PI * t * speed));
    agent.adapter.setOpacity(opacity);
  });
}

// ─── Landscape / water motions ────────────────────────────────────────────────

export function flow(agent, params = {}) {
  const { speed = 0.5 } = params;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    // Horizontal offset that wraps
    const offset = (t * speed * 40) % 30;
    agent.adapter.setPosition(origin.x + offset - 15, origin.y);
  });
}

export function ripple(agent, params = {}) {
  const { amplitude = 0.06, speed = 0.5 } = params;
  const base = agent.spawnScale ?? agent.adapter._scaleX ?? 1;
  return oneshotOrLoop(agent, params, t => {
    const s = base * (1 + amplitude * Math.sin(2 * Math.PI * t * speed));
    agent.adapter.setScale(s);
    agent.adapter.setOpacity(1 - 0.05 * Math.abs(Math.sin(2 * Math.PI * t * speed)));
  });
}

// ─── Vehicle motions ──────────────────────────────────────────────────────────

export function drive(agent, params = {}) {
  const { speed = 0.35, range = 140 } = params;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    agent.adapter.setPosition(origin.x + range * Math.sin(2 * Math.PI * t * speed), origin.y);
    agent.adapter.setRotation(2 * Math.sin(2 * Math.PI * t * speed * 4));
  });
}

export function fly_across(agent, params = {}) {
  const { speed = 0.5, yArc = 15 } = params;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    const x = origin.x + 120 * Math.sin(2 * Math.PI * t * speed);
    const y = origin.y - yArc * Math.cos(2 * Math.PI * t * speed);
    agent.adapter.setPosition(x, y);
  });
}

export function float(agent, params = {}) {
  const { amplitude = 6, speed = 0.3 } = params;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    agent.adapter.setPosition(
      origin.x + 4 * Math.sin(2 * Math.PI * t * speed * 0.7),
      origin.y + amplitude * Math.sin(2 * Math.PI * t * speed)
    );
    agent.adapter.setRotation(3 * Math.sin(2 * Math.PI * t * speed));
  });
}

// ─── Built object motions ─────────────────────────────────────────────────────

export function open_close(agent, params = {}) {
  const { openScale = 1.08, speed = 0.35 } = params;
  const base = agent.spawnScale ?? agent.adapter._scaleX ?? 1;
  return oneshotOrLoop(agent, params, t => {
    const s = 1 + (openScale - 1) * (0.5 + 0.5 * Math.sin(2 * Math.PI * t * speed));
    // Multiply by base so the expand/contract is relative to spawnScale
    agent.adapter.setScaleXY(base * s, base * (1 / s * 0.97 + 0.03));
  });
}

export function tilt(agent, params = {}) {
  const { tiltAngle = 8, speed = 0.4 } = params;
  return oneshotOrLoop(agent, params, t => {
    agent.adapter.setRotation(tiltAngle * Math.sin(2 * Math.PI * t * speed));
  });
}

// ─── Abstract / fallback motions ─────────────────────────────────────────────

export function static_motion(agent, _params = {}) {
  // Completely inert — anchored objects must never oscillate.
  // We simply ensure the object is positioned at its origin and return
  // a no-op cancel function so the rest of the engine stays happy.
  const pos = agent.originPos;
  agent.adapter.setPosition(pos.x, pos.y);
  agent.adapter.setRotation(0);
  const base = agent.spawnScale ?? agent.adapter._scaleX ?? 1;
  agent.adapter.setScaleXY(base, base);
  return () => {}; // no RAF started — nothing to cancel
}

export function rotate(agent, params = {}) {
  const { speed = 0.5 } = params;
  return oneshotOrLoop(agent, params, t => {
    agent.adapter.setRotation(360 * t * speed % 360);
  });
}

export function squish(agent, params = {}) {
  const { amplitude = 0.14, speed = 0.7 } = params;
  const base = agent.spawnScale ?? agent.adapter._scaleX ?? 1;
  return oneshotOrLoop(agent, params, t => {
    const s = 1 + amplitude * Math.sin(2 * Math.PI * t * speed);
    // Multiply by base so the squish oscillates around spawnScale, not around 1.0
    agent.adapter.setScaleXY(base / s, base * s);
  });
}

export function wiggle(agent, params = {}) {
  const { amplitude = 5, speed = 0.8 } = params;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    agent.adapter.setRotation(amplitude * Math.sin(2 * Math.PI * t * speed));
    agent.adapter.setPosition(
      origin.x + (amplitude * 0.6) * Math.sin(2 * Math.PI * t * speed * 1.3),
      origin.y
    );
  });
}

export function skeletal_walk(agent, params = {}) {
  // Meta-style skeletal walking: cycles through pre-rendered frames
  // while traveling world position toward agent.originPos.
  const { walkSpeed = 65, fps = 12 } = params;
  const imgNode = agent.adapter.ref?.findOne?.('Image') ?? null;
  let worldX = null, worldY = null, lastFacing = 1;

  // Fallback to walk_bounce if no frames were generated by the backend
  if (!agent.frameImages || agent.frameImages.length === 0) {
    return walk_bounce(agent, params);
  }

  return oneshotOrLoop(agent, params, t => {
    if (worldX === null) {
      const p = agent.adapter.getPosition();
      worldX = p.x; worldY = p.y;
    }

    const target = agent.originPos;
    const dx = target.x - worldX;
    const dy = target.y - worldY;
    const dist = Math.hypot(dx, dy);
    const moving = dist > 6;

    if (moving) {
      const step = Math.min(dist, walkSpeed / 60);
      worldX += (dx / dist) * step;
      worldY += (dy / dist) * step;
    }

    agent.adapter.setPosition(worldX, worldY);

    // Individual limb movement: swap the image source to the next frame
    // We only cycle frames when actually moving or if it's a persistent idle
    const cycleT = moving ? t : t * 0.4; // slower cycle when "breathing" in place
    const frameIdx = Math.floor(cycleT * fps) % agent.frameImages.length;
    if (imgNode) {
      imgNode.image(agent.frameImages[frameIdx]);
    }

    // Direction flip
    if (imgNode && moving) {
      const facing = dx < 0 ? -1 : 1;
      if (facing !== lastFacing) { imgNode.scaleX(facing); lastFacing = facing; }
    }
  });
}

// ─── Preset registry ──────────────────────────────────────────────────────────
// Maps string names (used in semanticProfiles) to functions

export const PRESETS = {
  sway, slow_sway, wave, sway_bloom, subtle_wiggle,
  walk_bounce, slow_walk, hop, scurry, prowl, skeletal_walk,
  hover, flutter, fly, zigzag_fly, orbit,
  swim, slow_swim, pulse_float, side_shuffle,
  drift, fall, fall_slow, flash, push,
  pulse, twinkle, shimmer,
  flow, ripple,
  drive, fly_across, float,
  open_close, tilt,
  static: static_motion, static_motion,
  rotate, squish, wiggle,
};

export function getPreset(name) {
  return PRESETS[name] || PRESETS.wiggle;
}
