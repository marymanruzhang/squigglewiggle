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
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    agent.adapter.setRotation(amplitude * Math.sin(2 * Math.PI * t * speed));
    agent.adapter.setScale(1 + bloomAmplitude * Math.sin(2 * Math.PI * t * bloomSpeed));
    agent.adapter.setPosition(origin.x, origin.y);
  });
}

export function subtle_wiggle(agent, params = {}) {
  const { amplitude = 1.5, speed = 0.3 } = params;
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

export function walk_bounce(agent, params = {}) {
  const { travelRange = 80, speed = 0.4, bounceHeight = 8 } = params;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    const x = origin.x + travelRange * Math.sin(2 * Math.PI * t * speed);
    const y = origin.y - bounceHeight * Math.abs(Math.sin(4 * Math.PI * t * speed));
    // Lean slightly in direction of travel
    const lean = 5 * Math.cos(2 * Math.PI * t * speed);
    agent.adapter.setPosition(x, y);
    agent.adapter.setRotation(lean);
  });
}

export function slow_walk(agent, params = {}) {
  return walk_bounce(agent, { travelRange: 55, speed: 0.22, bounceHeight: 4, ...params });
}

export function hop(agent, params = {}) {
  const { hopHeight = 25, hopSpeed = 0.65, travelRange = 55 } = params;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    // Triangle-wave horizontal position
    const phase = (t * hopSpeed) % 1;
    const hx = origin.x + travelRange * Math.sin(2 * Math.PI * t * hopSpeed * 0.5);
    // Parabolic hop: max height at phase=0.5
    const hy = origin.y - hopHeight * Math.max(0, Math.sin(Math.PI * (phase)));
    // Squash at bottom, stretch at top
    const sy = phase < 0.1 || phase > 0.9 ? 0.82 : (phase > 0.45 && phase < 0.55 ? 1.18 : 1);
    agent.adapter.setPosition(hx, hy);
    agent.adapter.setScaleXY(2 - sy, sy);
  });
}

export function scurry(agent, params = {}) {
  return walk_bounce(agent, { travelRange: 42, speed: 1.2, bounceHeight: 4, ...params });
}

export function prowl(agent, params = {}) {
  const { travelRange = 75, speed = 0.3 } = params;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    const x = origin.x + travelRange * Math.sin(2 * Math.PI * t * speed);
    const lean = 3 * Math.cos(2 * Math.PI * t * speed);
    agent.adapter.setPosition(x, origin.y);
    agent.adapter.setRotation(lean);
  });
}

// ─── Flying animal motions ────────────────────────────────────────────────────

export function hover(agent, params = {}) {
  const { hoverHeight = 6, speed = 0.55, xDrift = 7 } = params;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    const y = origin.y + hoverHeight * Math.sin(2 * Math.PI * t * speed);
    const x = origin.x + xDrift * Math.sin(2 * Math.PI * t * speed * 0.7);
    agent.adapter.setPosition(x, y);
  });
}

export function flutter(agent, params = {}) {
  // Butterfly/moth: figure-8 flight path + fast wing-beat (scaleX squish)
  const { xFreq = 0.35, yFreq = 0.6, xAmp = 40, yAmp = 22,
          wingFreq = 4.5, wingMin = 0.45 } = params;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    // Figure-8 flight path
    const x = origin.x + xAmp * Math.sin(2 * Math.PI * t * xFreq)
                       + (xAmp * 0.3) * Math.sin(2 * Math.PI * t * xFreq * 2.7);
    const y = origin.y + yAmp * Math.sin(2 * Math.PI * t * yFreq)
                       + (yAmp * 0.4) * Math.sin(2 * Math.PI * t * yFreq * 1.6);
    // Gentle body tilt
    const r = 5 * Math.sin(2 * Math.PI * t * yFreq * 2);
    // Wing-beat: rapid scaleX oscillation between wingMin and 1.0
    const wingBeat = wingMin + (1 - wingMin) * 0.5 * (1 + Math.sin(2 * Math.PI * t * wingFreq));
    agent.adapter.setPosition(x, y);
    agent.adapter.setRotation(r);
    agent.adapter.setScaleXY(wingBeat, 1);
  });
}

export function fly(agent, params = {}) {
  // Bird: broad sweeping path + wing-beat scaleY (side-view flapping)
  const { xAmp = 90, yAmp = 22, speed = 0.38,
          wingFreq = 3.5, wingMin = 0.7 } = params;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    const x = origin.x + xAmp * Math.sin(2 * Math.PI * t * speed);
    const y = origin.y + yAmp * Math.sin(4 * Math.PI * t * speed);
    const r = 5 * Math.cos(2 * Math.PI * t * speed);
    // Wing-beat: compress Y to simulate flapping (side-view)
    const wingBeat = wingMin + (1 - wingMin) * 0.5 * (1 + Math.sin(2 * Math.PI * t * wingFreq));
    agent.adapter.setPosition(x, y);
    agent.adapter.setRotation(r);
    agent.adapter.setScaleXY(1, wingBeat);
  });
}

export function zigzag_fly(agent, params = {}) {
  const { xAmp = 70, yAmp = 28, speed = 0.7 } = params;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    const phase = (t * speed) % 1;
    // Sawtooth x, sine y
    const x = origin.x + xAmp * (2 * phase - 1);
    const y = origin.y + yAmp * Math.sin(4 * Math.PI * t * speed);
    agent.adapter.setPosition(x, y);
    agent.adapter.setRotation(12 * Math.sin(2 * Math.PI * t * speed * 2));
  });
}

export function orbit(agent, params = {}) {
  // Orbit around the agent's own origin position
  const { radius = 60, speed = 0.4 } = params;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    const angle = 2 * Math.PI * t * speed;
    agent.adapter.setPosition(origin.x + radius * Math.cos(angle), origin.y + radius * Math.sin(angle));
  });
}

// ─── Water creature motions ───────────────────────────────────────────────────

export function swim(agent, params = {}) {
  // Fish/aquatic: side-to-side with body-wave scaleX undulation
  const { amplitude = 55, speed = 0.4, leanAngle = 10, waveFreq = 2.2 } = params;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    const x    = origin.x + amplitude * Math.sin(2 * Math.PI * t * speed);
    const lean = leanAngle * Math.cos(2 * Math.PI * t * speed);
    // Body-wave: subtle scaleX oscillation simulates the fish's tail pushing side-to-side
    const bodyWave = 1 + 0.1 * Math.sin(2 * Math.PI * t * waveFreq);
    agent.adapter.setPosition(x, origin.y);
    agent.adapter.setRotation(lean);
    agent.adapter.setScaleXY(bodyWave, 1);
  });
}

export function slow_swim(agent, params = {}) {
  return swim(agent, { amplitude: 40, speed: 0.22, leanAngle: 5, ...params });
}

export function pulse_float(agent, params = {}) {
  const { pulseAmp = 0.12, floatHeight = 10, speed = 0.5 } = params;
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
    agent.adapter.setScale(1 + pulseAmp * Math.sin(2 * Math.PI * t * speed));
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
  const origin = agent.adapter.getPosition();
  return oneshotOrLoop(agent, params, t => {
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
  return oneshotOrLoop(agent, params, t => {
    agent.adapter.setScale(1 + amplitude * Math.sin(2 * Math.PI * t * speed));
  });
}

export function twinkle(agent, params = {}) {
  const { opacityMin = 0.55, opacityMax = 1.0, speed = 1.1 } = params;
  return oneshotOrLoop(agent, params, t => {
    const v = (Math.sin(2 * Math.PI * t * speed) + Math.sin(2 * Math.PI * t * speed * 1.7)) / 2;
    const opacity = opacityMin + (opacityMax - opacityMin) * (v * 0.5 + 0.5);
    agent.adapter.setOpacity(opacity);
    agent.adapter.setScale(1 + 0.04 * Math.sin(2 * Math.PI * t * speed * 1.3));
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
  return oneshotOrLoop(agent, params, t => {
    const s = 1 + amplitude * Math.sin(2 * Math.PI * t * speed);
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
  return oneshotOrLoop(agent, params, t => {
    const s = 1 + (openScale - 1) * (0.5 + 0.5 * Math.sin(2 * Math.PI * t * speed));
    agent.adapter.setScaleXY(s, 1 / s * 0.97 + 0.03);
  });
}

export function tilt(agent, params = {}) {
  const { tiltAngle = 8, speed = 0.4 } = params;
  return oneshotOrLoop(agent, params, t => {
    agent.adapter.setRotation(tiltAngle * Math.sin(2 * Math.PI * t * speed));
  });
}

// ─── Abstract / fallback motions ─────────────────────────────────────────────

export function static_motion(agent, params = {}) {
  // True no-op — tiny imperceptible breathe so it's not completely dead
  return oneshotOrLoop(agent, params, t => {
    agent.adapter.setScale(1 + 0.005 * Math.sin(2 * Math.PI * t * 0.15));
  });
}

export function rotate(agent, params = {}) {
  const { speed = 0.5 } = params;
  return oneshotOrLoop(agent, params, t => {
    agent.adapter.setRotation(360 * t * speed % 360);
  });
}

export function squish(agent, params = {}) {
  const { amplitude = 0.14, speed = 0.7 } = params;
  return oneshotOrLoop(agent, params, t => {
    const s = 1 + amplitude * Math.sin(2 * Math.PI * t * speed);
    agent.adapter.setScaleXY(1 / s, s);
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

// ─── Preset registry ──────────────────────────────────────────────────────────
// Maps string names (used in semanticProfiles) to functions

export const PRESETS = {
  sway, slow_sway, wave, sway_bloom, subtle_wiggle,
  walk_bounce, slow_walk, hop, scurry, prowl,
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
