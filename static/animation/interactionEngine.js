/**
 * interactionEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Wander manager + Story-aware interaction checker.
 *
 * Every `checkMs` (≈350ms) this engine:
 *   1. Gives mobile agents new wander waypoints.
 *   2. Asks storyPlanner for the best story plan among all agent pairs.
 *   3. Hands the plan to storyRunner, which executes the full beat sequence.
 *
 * Only one story runs at a time (guarded by agent state checks in the planner).
 * Non-participating agents keep their idle animations running throughout.
 *
 * Backward compatibility: the `rules` constructor argument is accepted but
 * ignored — all interaction logic now flows through storyTemplates.js.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { selectBestPlan } from './storyPlanner.js';
import { runStory, interrupt } from './storyRunner.js';

export class InteractionEngine {
  /**
   * @param {SceneRegistry}       registry
   * @param {AnimationController} controller
   * @param {Array}               _rules       — kept for API compatibility; unused
   * @param {number}              canvasW
   * @param {number}              canvasH
   */
  constructor(registry, controller, _rules = [], canvasW = 800, canvasH = 600) {
    this.registry    = registry;
    this.controller  = controller;
    this.canvasW     = canvasW;
    this.canvasH     = canvasH;
    this._interval   = null;
    this.checkMs     = 350;
    this.wanderRadius = 380; // px — agents within this range start steering toward each other

    // Track whether a story is currently executing (prevents overlapping stories)
    this._storyRunning = false;
  }

  start() {
    if (this._interval) return;
    this._interval = setInterval(() => this._tick(), this.checkMs);
    console.log('[InteractionEngine] started (story mode)');
  }

  stop() { clearInterval(this._interval); this._interval = null; }

  /** Call when the canvas is resized. */
  resize(w, h) { this.canvasW = w; this.canvasH = h; }

  // ── Main tick ──────────────────────────────────────────────────────────────

  _tick() {
    const agents = this.registry.getAll();
    this._tickWander(agents);
    this._tickStory(agents);
  }

  // ── Wander: give mobile objects real destinations ─────────────────────────
  //
  // Mobile agents that are idle are given random waypoints so they traverse
  // the canvas. When near a potential story partner, they are nudged toward
  // that partner so the story trigger feels natural rather than teleported.

  _tickWander(agents) {
    const now = Date.now();
    const W = this.canvasW, H = this.canvasH;

    for (const agent of agents) {
      if (!agent.hasTag('mobile')) continue;
      if (agent.state !== 'idle') continue;

      // First-time init
      if (!agent._wander) {
        agent._wander = { nextPickTime: now, moving: false };
      }

      const w = agent._wander;
      if (now < w.nextPickTime) continue;

      // Pick a new random waypoint anywhere on canvas (with margin)
      const margin = 80;
      w.tx = margin + Math.random() * (W - margin * 2);
      w.ty = margin + Math.random() * (H - margin * 2);
      w.moving = true;

      const pos     = agent.adapter.getPosition();
      const dist    = Math.hypot(w.tx - pos.x, w.ty - pos.y);
      const travelMs = (dist / 90) * 1000; // ~90px/s
      w.nextPickTime = now + travelMs + 500 + Math.random() * 1500;

      // Use 'returning' so story can preempt the wander
      agent.state = 'returning';
      this.controller.stop(agent.id);

      const speed = agent.hasTag('flying') ? 100 : 70;
      this._wanderMoveTo(agent, w.tx, w.ty, speed).then(() => {
        if (agent.state === 'returning') {
          agent.state = 'idle';
          agent.originPos = { x: w.tx, y: w.ty };
          this.controller.startIdle(agent);
        }
      });
    }
  }

  /** rAF-based constant-speed move for wander travel. */
  _wanderMoveTo(agent, tx, ty, pxPerSec) {
    return new Promise(resolve => {
      let lastTs = null;
      let raf;
      const isFlying = agent.hasTag('flying');
      let phase = 0;

      const tick = ts => {
        if (!lastTs) lastTs = ts;
        const dt = Math.min((ts - lastTs) / 1000, 0.05);
        lastTs = ts;
        phase += dt;

        const pos  = agent.adapter.getPosition();
        const dx   = tx - pos.x;
        const dy   = ty - pos.y;
        const dist = Math.hypot(dx, dy);

        if (dist < 4) {
          agent.adapter.setPosition(tx, ty);
          cancelAnimationFrame(raf);
          resolve();
          return;
        }

        const step = Math.min(pxPerSec * dt, dist);
        const nx   = pos.x + (dx / dist) * step;

        if (isFlying) {
          const ny = pos.y + (dy / dist) * step + Math.sin(phase * 3) * 1.5;
          agent.adapter.setPosition(nx, ny);
          agent.adapter.setRotation(dx > 0 ? 5 : -5);
        } else {
          const bounce = 7 * Math.abs(Math.sin(phase * Math.PI * 2.5));
          agent.adapter.setPosition(nx, ty - bounce);
          agent.adapter.setRotation(dx > 0 ? 4 : -4);
        }

        raf = requestAnimationFrame(tick);
      };

      raf = requestAnimationFrame(tick);

      // Store cancel so a story can preempt the wander mid-travel
      const prev = agent.cancelIdle;
      agent.cancelIdle = () => {
        cancelAnimationFrame(raf);
        if (prev) prev();
        resolve();
      };
    });
  }

  // ── Nudge wandering agents toward potential story partners ─────────────────
  //
  // When a mobile agent is wandering and a story-capable partner is within
  // wanderRadius, gently steer the wander destination toward that partner.
  // This makes encounters feel intentional rather than random.

  _nudgeTowardPartners(agents) {
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const a = agents[i];
        const b = agents[j];
        const dist = this._dist(a.getCenter(), b.getCenter());
        if (dist > this.wanderRadius || dist < 50) continue;
        this._tryNudge(a, b);
        this._tryNudge(b, a);
      }
    }
  }

  _tryNudge(src, tgt) {
    if (!src.hasTag('mobile')) return;
    if (src.state !== 'idle' && src.state !== 'returning') return;
    if (tgt.state === 'story_active') return;
    // Steer wander destination toward target center
    if (src._wander) {
      const tc = tgt.getCenter();
      src._wander.tx = tc.x;
      src._wander.ty = tc.y;
    }
  }

  // ── Story selection and dispatch ───────────────────────────────────────────

  _tickStory(agents) {
    // Don't stack stories — wait for the current one to finish
    if (this._storyRunning) return;

    // Let wandering agents drift toward possible partners first
    this._nudgeTowardPartners(agents);

    // Ask the planner for the best possible story right now
    const plan = selectBestPlan(agents);
    if (!plan) return;

    // Guard: re-check agent states (planner checks were from a snapshot)
    if (plan.source.state !== 'idle' || plan.target.state !== 'idle') return;

    this._storyRunning = true;

    console.log(
      `[InteractionEngine] Dispatching story "${plan.id}":` +
      ` ${plan.source.label} ↔ ${plan.target.label}`
    );

    runStory(plan, this.controller)
      .catch(err => console.warn('[InteractionEngine] story error:', err))
      .finally(() => { this._storyRunning = false; });
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  _dist(p, q) { return Math.hypot(q.x - p.x, q.y - p.y); }

  /**
   * Interrupt any active story for the given agent.
   * Call this before removing an agent from the scene.
   */
  interruptAgent(agentId) {
    interrupt(agentId);
  }
}
