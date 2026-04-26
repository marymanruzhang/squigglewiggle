/**
 * animationController.js
 * Manages which animation is running per agent.
 * Bridges sceneObjects ↔ motionPresets.
 *
 * HOW TO ADD A NEW MOTION:
 *   Add it to motionPresets.js PRESETS map — the controller picks it up automatically.
 *
 * HOW STORY BEATS USE THIS:
 *   Story beat functions (storyBeatAnimations.js) receive `ctrl` (this controller)
 *   and call ctrl.moveTo / ctrl.playOnce / ctrl.returnToOrigin as needed.
 *   More complex motions (curved path, orbit) are handled directly by
 *   motionPresets utilities imported into storyBeatAnimations.js.
 */

import { getPreset, moveTo, orbitAround, wait } from './motionPresets.js';

export class AnimationController {
  constructor() {
    /** @type {Map<string, Function>}  agentId → cancelFn */
    this._active = new Map();
  }

  /** Start the agent's default idle animation (loops until stopped). */
  startIdle(agent) {
    // Cancel any previous animation — including wander travel RAF loops
    agent.cancelIdle?.();
    this.stop(agent.id);
    const preset = getPreset(agent.defaultMotion);
    const cancel = preset(agent, { ...agent.motionParams });
    this._active.set(agent.id, cancel);
    agent.cancelIdle = () => this.stop(agent.id);
  }

  /** Stop whatever animation is running for agentId. */
  stop(agentId) {
    const cancel = this._active.get(agentId);
    if (cancel) { cancel(); this._active.delete(agentId); }
  }

  /**
   * Play a one-shot animation on an agent and return a Promise that resolves when done.
   * @param {SceneAgent}        agent
   * @param {string|Function}   presetNameOrFn
   * @param {object}            params   — merged with agent.motionParams
   * @param {number}            durationMs
   */
  playOnce(agent, presetNameOrFn, params = {}, durationMs = 1500) {
    this.stop(agent.id);
    return new Promise(resolve => {
      const fn = typeof presetNameOrFn === 'function'
        ? presetNameOrFn
        : getPreset(presetNameOrFn);
      const cancel = fn(agent, {
        ...agent.motionParams,
        ...params,
        duration:   durationMs,
        onComplete: () => { this._active.delete(agent.id); resolve(); },
      });
      this._active.set(agent.id, cancel);
    });
  }

  /** Move agent smoothly to (x, y) using the moveTo utility. */
  moveTo(agent, x, y, durationMs = 700) {
    this.stop(agent.id);
    return new Promise(resolve => {
      moveTo(agent, x, y, durationMs).then(() => {
        this._active.delete(agent.id);
        resolve();
      });
    });
  }

  /**
   * Move agent along a quadratic Bézier curve through a control point (cpx, cpy).
   * Useful for flying objects that should arc rather than travel in straight lines.
   *
   * @param {SceneAgent} agent
   * @param {number} cpx   — control point x (determines the arc shape)
   * @param {number} cpy   — control point y
   * @param {number} ex    — end x
   * @param {number} ey    — end y
   * @param {number} durationMs
   */
  moveAlongCurve(agent, cpx, cpy, ex, ey, durationMs = 1200) {
    this.stop(agent.id);
    return new Promise(resolve => {
      const start = agent.adapter.getPosition();
      let t0 = null, raf;
      function lerp(a, b, t) { return a + (b - a) * t; }
      function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

      function tick(ts) {
        if (!t0) t0 = ts;
        const p = Math.min((ts - t0) / durationMs, 1);
        const e = easeInOut(p);
        // Quadratic Bézier
        const x = lerp(lerp(start.x, cpx, e), lerp(cpx, ex, e), e);
        const y = lerp(lerp(start.y, cpy, e), lerp(cpy, ey, e), e);
        agent.adapter.setPosition(x, y);
        if (p < 1) { raf = requestAnimationFrame(tick); }
        else { resolve(); }
      }
      raf = requestAnimationFrame(tick);
    });
  }

  /**
   * Orbit agent around point (cx, cy) at `radius` for `turns` full rotations.
   */
  orbitAround(agent, cx, cy, radius, turns, durationMs) {
    this.stop(agent.id);
    return orbitAround(agent, cx, cy, radius, turns, durationMs);
  }

  /** Return agent to its original spawn position (not the wander-mutated originPos). */
  async returnToOrigin(agent, durationMs = 500) {
    const home = agent.spawnPos || agent.originPos;
    await this.moveTo(agent, home.x, home.y, durationMs);
    agent.adapter.setRotation(0);
    // Restore AI-determined spawn scale, NOT hardcoded 1
    const base = agent.spawnScale ?? 1;
    agent.adapter.setScale(base);
    agent.adapter.setOpacity(1);
    // Reset any child image transforms (wing flap, leg squash, direction flip)
    // but preserve the group's base scale
    const img = agent.adapter.ref?.findOne?.('Image');
    if (img) { img.scaleX(1); img.scaleY(1); }
    agent.originPos = { ...home };
  }

  isActive(agentId)  { return this._active.has(agentId); }

  stopAll() {
    for (const cancel of this._active.values()) cancel();
    this._active.clear();
  }
}

