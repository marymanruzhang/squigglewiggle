/**
 * storyBeatAnimations.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Reusable, composable animation beats for use in story sequences.
 * Each beat function is async and returns when the beat is complete.
 *
 * Beat functions signature:
 *   beatName(actor, target, controller, params?) → Promise<void>
 *
 * HOW TO ADD A NEW BEAT:
 *   1. Export an async function below following the same signature.
 *   2. Reference it by name in storyTemplates.js beat definitions.
 *   3. The beat system will call it with the resolved agents + controller.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { orbitAround, moveTo, wait, easeInOut, lerp } from './motionPresets.js';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Get the visual center of an agent. */
function center(agent) { return agent.getCenter(); }

/** Compute a position `margin` px away from target center, toward actor. */
function approachPos(actor, target, margin = 60) {
  const ac = center(actor);
  const tc = center(target);
  const dx = tc.x - ac.x;
  const dy = tc.y - ac.y;
  const dist = Math.hypot(dx, dy) || 1;
  const stopDist = Math.max(dist - margin, 20);
  return { x: ac.x + dx / dist * stopDist, y: ac.y + dy / dist * stopDist };
}

/** Compute a position `fleeRange` px away from threat, in the opposite direction. */
function fleePos(actor, threat, fleeRange = 130) {
  const ac = center(actor);
  const tc = center(threat);
  const dx = ac.x - tc.x;
  const dy = ac.y - tc.y;
  const dist = Math.hypot(dx, dy) || 1;
  return { x: ac.x + dx / dist * fleeRange, y: ac.y + dy / dist * fleeRange };
}

/** Animate rotation from current to `targetDeg` over `ms`, then snap. */
async function rotateToward(agent, targetDeg, ms = 300) {
  const startRot = agent.adapter.getRotation?.() ?? 0;
  await _tweenProp(ms, t => agent.adapter.setRotation(lerp(startRot, targetDeg, t)));
}

/** Animate scale from current to `targetScale` and back, creating a pulse. */
async function scalePulse(agent, targetScale = 1.25, halfDurationMs = 250) {
  const start = agent.adapter._scaleX ?? 1;
  await _tweenProp(halfDurationMs, t => agent.adapter.setScale(lerp(start, targetScale, t)));
  await _tweenProp(halfDurationMs, t => agent.adapter.setScale(lerp(targetScale, start, t)));
}

/** Generic tween from 0→1 using easeInOut over `ms`. */
function _tweenProp(ms, applyFn) {
  return new Promise(resolve => {
    let t0 = null;
    function tick(ts) {
      if (!t0) t0 = ts;
      const p = Math.min((ts - t0) / ms, 1);
      applyFn(easeInOut(p));
      if (p < 1) requestAnimationFrame(tick); else resolve();
    }
    requestAnimationFrame(tick);
  });
}

// ─── BEAT LIBRARY ─────────────────────────────────────────────────────────────
//
// Each exported function is a named beat.
// actor  = the agent doing the action
// target = the agent being acted upon (may be null for solo beats)
// ctrl   = AnimationController instance
// params = optional overrides for timing/magnitude

// ── Notice ────────────────────────────────────────────────────────────────────

/**
 * Actor briefly rotates or tilts toward the target — the "noticing" moment.
 * Very short; sets up the emotional read before approaching.
 */
export async function noticeTarget(actor, target, ctrl, params = {}) {
  const { duration = 500 } = params;
  const ac = center(actor);
  const tc = center(target);
  const tiltDir = tc.x > ac.x ? 8 : -8;

  ctrl.stop(actor.id);
  await rotateToward(actor, tiltDir, 200);
  await wait(duration - 200);
  // Don't snap back — the approach beat will carry the rotation naturally
}

// ── Approach ─────────────────────────────────────────────────────────────────

/**
 * Actor moves in a straight line toward target, stopping `margin` px away.
 */
export async function approachTarget(actor, target, ctrl, params = {}) {
  const { margin = 60, duration = 1200 } = params;
  const ap = approachPos(actor, target, margin);
  ctrl.stop(actor.id);
  // Lean slightly in direction of travel during move
  const tc = center(target);
  const ac = center(actor);
  const lean = tc.x > ac.x ? 5 : -5;
  actor.adapter.setRotation(lean);
  await ctrl.moveTo(actor, ap.x, ap.y, duration);
  actor.adapter.setRotation(0);
}

/**
 * Actor approaches in a gentle curved arc (for flying/fluttering objects).
 * Uses a series of waypoints that arc around before arriving.
 */
export async function approachWithCurve(actor, target, ctrl, params = {}) {
  const { margin = 55, duration = 1600 } = params;
  const ac = center(actor);
  const tc = center(target);
  const dx = tc.x - ac.x;
  const dy = tc.y - ac.y;

  // Arc midpoint: perpendicular offset to create a curved path
  const midX = ac.x + dx * 0.45 + dy * 0.3;
  const midY = ac.y + dy * 0.45 - dx * 0.25;

  ctrl.stop(actor.id);
  await ctrl.moveTo(actor, midX, midY, duration * 0.5);
  const ap = approachPos(actor, target, margin);
  await ctrl.moveTo(actor, ap.x, ap.y, duration * 0.5);
}

// ── Orbit ─────────────────────────────────────────────────────────────────────

/**
 * Actor orbits around the target's center.
 * Ideal for pollinators circling flowers.
 */
export async function orbitTarget(actor, target, ctrl, params = {}) {
  const { turns = 1.5, radius = 50, duration = 2200 } = params;
  const tc = center(target);
  ctrl.stop(actor.id);
  await orbitAround(actor, tc.x, tc.y, radius, turns, duration);
}

// ── Inspect / Sniff ───────────────────────────────────────────────────────────

/**
 * Actor leans in and bobs slightly near target — the "sniffing" moment.
 */
export async function sniffTarget(actor, target, ctrl, params = {}) {
  const { cycles = 3, duration = 1000 } = params;
  const cycleMs = duration / cycles;
  ctrl.stop(actor.id);
  for (let i = 0; i < cycles; i++) {
    await _tweenProp(cycleMs * 0.4, t => {
      actor.adapter.setRotation(lerp(0, 12, t));
      const pos = actor.adapter.getPosition();
      actor.adapter.setPosition(pos.x, pos.y);
    });
    await _tweenProp(cycleMs * 0.6, t => {
      actor.adapter.setRotation(lerp(12, 0, t));
    });
  }
  actor.adapter.setRotation(0);
}

/**
 * Actor performs a pause and looks (small tilt hold) — curiosity moment.
 */
export async function pauseAndLook(actor, target, ctrl, params = {}) {
  const { duration = 600 } = params;
  ctrl.stop(actor.id);
  const ac = center(actor);
  const tc = center(target);
  const tilt = tc.x > ac.x ? 6 : -6;
  await rotateToward(actor, tilt, 200);
  await wait(duration - 200);
}

// ── Eat / Nibble ──────────────────────────────────────────────────────────────

/**
 * Actor does a nibbling animation — quick forward-back peck toward target.
 */
export async function nibbleTarget(actor, target, ctrl, params = {}) {
  const { bites = 3, duration = 900 } = params;
  const biteMs = duration / bites;
  const startPos = actor.adapter.getPosition();
  const tc = center(target);
  const ac = center(actor);
  const dx = tc.x - ac.x;
  const dy = tc.y - ac.y;
  const dist = Math.hypot(dx, dy) || 1;
  const peekX = startPos.x + dx / dist * 18;
  const peekY = startPos.y + dy / dist * 18;

  ctrl.stop(actor.id);
  for (let i = 0; i < bites; i++) {
    await _tweenProp(biteMs * 0.35, t =>
      actor.adapter.setPosition(lerp(startPos.x, peekX, t), lerp(startPos.y, peekY, t))
    );
    await _tweenProp(biteMs * 0.65, t =>
      actor.adapter.setPosition(lerp(peekX, startPos.x, t), lerp(peekY, startPos.y, t))
    );
  }
}

// ── Reactions ─────────────────────────────────────────────────────────────────

/**
 * Actor does a happy bounce — excitement or success reaction.
 */
export async function happyBounce(actor, _target, ctrl, params = {}) {
  const { hops = 3, hopHeight = 22, duration = 700 } = params;
  await ctrl.playOnce(actor, 'hop', {
    hopHeight,
    hopSpeed: hops / (duration / 1000),
    travelRange: 8,
    duration,
  }, duration);
}

/**
 * Target wiggles reactively — food bouncing, plant reacting, etc.
 */
export async function reactWiggle(actor, _target, ctrl, params = {}) {
  const { duration = 600, amplitude = 10 } = params;
  await ctrl.playOnce(actor, 'wiggle', { amplitude, speed: 1.4, duration }, duration);
}

/**
 * Target bounces once as if surprised or jostled.
 */
export async function reactBounce(actor, _target, ctrl, params = {}) {
  const { duration = 500, hopHeight = 18 } = params;
  await ctrl.playOnce(actor, 'hop', {
    hopHeight, hopSpeed: 1.5, travelRange: 6, duration,
  }, duration);
}

/**
 * Scale-pulse surprise: quick squash/stretch when something happens.
 */
export async function reactSurprise(actor, _target, ctrl, params = {}) {
  const { duration = 400 } = params;
  ctrl.stop(actor.id);
  await scalePulse(actor, 1.3, duration / 2);
}

/**
 * Plant sways more strongly — responding to weather, visitor, excitement.
 */
export async function strongerSway(actor, _target, ctrl, params = {}) {
  const { duration = 2000, amplitude = 18, speed = 0.8 } = params;
  await ctrl.playOnce(actor, 'sway', { amplitude, speed, duration }, duration);
}

/**
 * Plant blooms — scale up with sway, responding to sun/rain/pollinator.
 */
export async function growOrBloom(actor, _target, ctrl, params = {}) {
  const { duration = 2200, bloomAmplitude = 0.15, amplitude = 12 } = params;
  await ctrl.playOnce(actor, 'sway_bloom', {
    amplitude, bloomAmplitude, bloomSpeed: 0.9, duration,
  }, duration);
  // Linger slightly larger before settling
  actor.adapter.setScale(1.04);
  await wait(300);
  actor.adapter.setScale(1);
}

/**
 * Rain effect: source moves above target and pulses.
 */
export async function rainOnTarget(actor, target, ctrl, params = {}) {
  const { duration = 1800 } = params;
  const tc = center(target);
  const rainX = tc.x - actor.bbox.width / 2;
  const rainY = tc.y - target.bbox.height / 2 - 90;
  ctrl.stop(actor.id);
  await ctrl.moveTo(actor, rainX, rainY, 800);
  await ctrl.playOnce(actor, 'pulse', { amplitude: 0.12, speed: 1.4, duration }, duration);
}

/**
 * Light source pulses warmly toward bloomable target.
 */
export async function pulseLight(actor, _target, ctrl, params = {}) {
  const { duration = 2000, amplitude = 0.16, speed = 0.75 } = params;
  await ctrl.playOnce(actor, 'pulse', { amplitude, speed, duration }, duration);
}

// ── Movement beats ────────────────────────────────────────────────────────────

/**
 * Actor flees away from target. For prey escaping predator.
 */
export async function fleeFromTarget(actor, threat, ctrl, params = {}) {
  const { fleeRange = 140, duration = 900 } = params;
  const fp = fleePos(actor, threat, fleeRange);
  ctrl.stop(actor.id);
  // Lean away during flee
  const ac = center(actor);
  const tc = center(threat);
  const lean = ac.x > tc.x ? 8 : -8;
  actor.adapter.setRotation(lean);
  await ctrl.moveTo(actor, fp.x, fp.y, duration);
  actor.adapter.setRotation(0);
}

/**
 * Actor chases target toward its current position.
 */
export async function chaseTarget(actor, target, ctrl, params = {}) {
  const { margin = 40, duration = 900 } = params;
  const ap = approachPos(actor, target, margin);
  ctrl.stop(actor.id);
  const ac = center(actor);
  const tc = center(target);
  const lean = tc.x > ac.x ? 7 : -7;
  actor.adapter.setRotation(lean);
  await ctrl.moveTo(actor, ap.x, ap.y, duration);
  actor.adapter.setRotation(0);
}

/**
 * Actor lands near target and settles. Ideal for birds landing on trees.
 */
export async function landNearTarget(actor, target, ctrl, params = {}) {
  const { durationMs = 900, yOffsetFromTop = 10 } = params;
  const tc = center(target);
  const landX = tc.x - actor.bbox.width / 2;
  const landY = tc.y - target.bbox.height / 2 - yOffsetFromTop;
  ctrl.stop(actor.id);
  await ctrl.moveTo(actor, landX, landY, durationMs);
  // Small settle bounce
  await _tweenProp(200, t => actor.adapter.setScale(lerp(1, 0.9, t)));
  await _tweenProp(150, t => actor.adapter.setScale(lerp(0.9, 1, t)));
}

/**
 * Actor hovers briefly above target, then descends slightly — calm resting.
 */
export async function restNearTarget(actor, _target, ctrl, params = {}) {
  const { duration = 1200 } = params;
  await ctrl.playOnce(actor, 'hover', {
    hoverHeight: 3, speed: 0.4, xDrift: 2, duration,
  }, duration);
}

/**
 * Actor moves back toward its home (originPos), rotation reset.
 * Call at the end of any story to gracefully finish.
 */
export async function returnToIdle(actor, _target, ctrl, params = {}) {
  const { duration = 600 } = params;
  await ctrl.returnToOrigin(actor, duration);
}

/**
 * Actor hides near / under a shelter: approaches and dims slightly.
 */
export async function hideUnderShelter(actor, shelter, ctrl, params = {}) {
  const { duration = 900 } = params;
  const ap = approachPos(actor, shelter, 30);
  ctrl.stop(actor.id);
  await ctrl.moveTo(actor, ap.x, ap.y, duration);
  actor.adapter.setOpacity(0.65);
  await wait(800);
  actor.adapter.setOpacity(1);
}

/**
 * Actor swims into a water zone.
 */
export async function swimIntoWater(actor, waterZone, ctrl, params = {}) {
  const { duration = 1000 } = params;
  const wc = center(waterZone);
  const destX = wc.x + (Math.random() * 40 - 20);
  const destY = wc.y + (Math.random() * 20 - 10);
  ctrl.stop(actor.id);
  await ctrl.moveTo(actor, destX, destY, duration);
  await ctrl.playOnce(actor, 'swim', { amplitude: 30, speed: 0.7, duration: 1600 }, 1600);
}

/**
 * Actor avoids an obstacle: sidesteps and returns.
 */
export async function avoidObstacle(actor, obstacle, ctrl, params = {}) {
  const { duration = 500 } = params;
  const ac = center(actor);
  const oc = center(obstacle);
  const avoidX = ac.x + (ac.y > oc.y ? 80 : -80);
  const avoidY = ac.y + (ac.x > oc.x ? 40 : -40);
  ctrl.stop(actor.id);
  await ctrl.moveTo(actor, avoidX, avoidY, duration);
  await wait(200);
  await ctrl.returnToOrigin(actor, duration);
}

// ─── Beat registry ────────────────────────────────────────────────────────────
// Maps beat type names (strings) to functions.
// Used by storyRunner.js to look up and execute beats from templates.

export const BEATS = {
  // Approach family
  noticeTarget,
  approachTarget,
  approachWithCurve,

  // Inspect / interact
  orbitTarget,
  sniffTarget,
  pauseAndLook,
  nibbleTarget,

  // Positive reactions
  happyBounce,
  growOrBloom,
  strongerSway,
  restNearTarget,
  landNearTarget,
  pulseLight,
  rainOnTarget,

  // Defensive / negative
  fleeFromTarget,
  chaseTarget,
  hideUnderShelter,
  avoidObstacle,
  swimIntoWater,

  // Generic reactions
  reactWiggle,
  reactBounce,
  reactSurprise,

  // Cleanup
  returnToIdle,
};

/**
 * Look up a beat function by name.
 * Falls back to a safe no-op if the name is unrecognised.
 */
export function getBeat(name) {
  if (BEATS[name]) return BEATS[name];
  console.warn(`[StoryBeats] Unknown beat "${name}" — using no-op.`);
  return async () => {};
}
