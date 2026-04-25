/**
 * animationController.js
 * Manages which animation is running per agent.
 * Bridges sceneObjects ↔ motionPresets.
 *
 * HOW TO ADD A NEW MOTION:
 *   Add it to motionPresets.js PRESETS map — the controller picks it up automatically.
 */

import { getPreset, moveTo, wait } from './motionPresets.js';

export class AnimationController {
  constructor() {
    /** @type {Map<string, Function>}  agentId → cancelFn */
    this._active = new Map();
  }

  /** Start the agent's default idle animation (loops until stopped). */
  startIdle(agent) {
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
   * @param {SceneAgent} agent
   * @param {string|Function} presetNameOrFn
   * @param {object} params  — merged with agent.motionParams
   * @param {number} durationMs
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
        duration: durationMs,
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

  /** Return agent to its stored originPos. */
  async returnToOrigin(agent, durationMs = 500) {
    await this.moveTo(agent, agent.originPos.x, agent.originPos.y, durationMs);
    agent.adapter.setRotation(0);
    agent.adapter.setScale(1);
    agent.adapter.setOpacity(1);
  }

  isActive(agentId) { return this._active.has(agentId); }

  stopAll() {
    for (const cancel of this._active.values()) cancel();
    this._active.clear();
  }
}
