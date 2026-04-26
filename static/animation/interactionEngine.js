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
    this.wanderRadius = 500; // px — start nudging toward partner when within this range

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

  // ── Wander: give mobile objects new destinations over time ────────────────
  //
  // Two modes depending on the agent's idle preset:
  //
  //  a) SELF-MOVING agents (flutter/fly/swim/hover/drift/wave):
  //     Their idle preset already animates position (reads agent.originPos each
  //     frame). We just update originPos periodically — the preset will smoothly
  //     follow the new home. No competing RAF.
  //
  //  b) GROUND agents (walk_bounce/hop/prowl/etc.):
  //     Their idle preset is stationary (sways in place). We use _wanderMoveTo
  //     to physically drive the agent to a new position.

  static SELF_MOVING_PRESETS = new Set([
    // Flying — move via oscillation around originPos
    'flutter', 'fly', 'zigzag_fly', 'hover', 'drift', 'wave', 'orbit',
    // Aquatic — swim toward originPos with body wave
    'swim', 'slow_swim',
    // Ground — walk/hop/prowl toward originPos with limb animation
    'walk_bounce', 'slow_walk', 'hop', 'scurry', 'prowl', 'skeletal_walk',
  ]);

  _tickWander(agents) {
    const now = Date.now();
    const W = this.canvasW, H = this.canvasH;

    for (const agent of agents) {
      if (!agent.hasTag('mobile')) continue;
      if (agent.state !== 'idle') continue;

      if (!agent._wander) {
        // On first wander tick: immediately target the partner agent's position
        // so they walk straight toward each other rather than wandering randomly.
        const partner = agents.find(a => a.id !== agent.id);
        const partnerCenter = partner ? partner.getCenter() : null;

        const FLYING = new Set(['flutter','fly','zigzag_fly','hover','orbit']);
        const initDelay = FLYING.has(agent.defaultMotion)
          ? 1500 + Math.random() * 1000   // flying: settle briefly then head toward partner
          : 200  + Math.random() * 300;   // ground: start walking almost immediately

        const tx = partnerCenter ? partnerCenter.x : agent.originPos.x;
        const ty = partnerCenter ? partnerCenter.y : agent.originPos.y;
        agent._wander = { nextPickTime: now + initDelay, tx, ty, headingToPartner: true };
      }

      const w = agent._wander;
      if (now < w.nextPickTime) continue;

      const isSelfMoving = InteractionEngine.SELF_MOVING_PRESETS.has(agent.defaultMotion);
      const margin = 90;

      if (isSelfMoving) {
        // ── Self-moving: just update originPos, preset drifts to it ────────
        if (w.headingToPartner) {
          // First time: head toward partner
          const partner = agents.find(a => a.id !== agent.id);
          if (partner) {
            const pc = partner.getCenter();
            w.tx = pc.x; w.ty = pc.y;
            w.headingToPartner = false;
          }
        } else {
          w.tx = margin + Math.random() * (W - margin * 2);
          w.ty = margin + Math.random() * (H - margin * 2);
        }
        // Drift slowly — set nextPickTime after a travel period
        const dist = Math.hypot(w.tx - agent.originPos.x, w.ty - agent.originPos.y);
        w.nextPickTime = now + Math.max(2000, dist * 15) + Math.random() * 1500;
        // Update originPos — the idle preset (flutter/fly/swim) will follow
        agent.originPos = { x: w.tx, y: w.ty };

      } else {
        // ── Ground agent: drive via _wanderMoveTo RAF ───────────────────────
        if (w.headingToPartner) {
          // Head toward partner on first move
          const partner = agents.find(a => a.id !== agent.id);
          if (partner) {
            const pc = partner.getCenter();
            // Stop 120px short so they face each other without overlapping
            const selfPos = agent.adapter.getPosition();
            const dx = pc.x - selfPos.x, dy = pc.y - selfPos.y;
            const d  = Math.hypot(dx, dy);
            const stopDist = Math.max(80, d - 120);
            w.tx = selfPos.x + (dx / d) * stopDist;
            w.ty = selfPos.y + (dy / d) * stopDist;
          }
          w.headingToPartner = false;
        } else {
          w.tx = margin + Math.random() * (W - margin * 2);
          w.ty = margin + Math.random() * (H - margin * 2);
        }

        const pos     = agent.adapter.getPosition();
        const dist    = Math.hypot(w.tx - pos.x, w.ty - pos.y);
        const travelMs = (dist / 70) * 1000;
        w.nextPickTime = now + travelMs + 500 + Math.random() * 1500;

        agent.state = 'returning';
        this.controller.stop(agent.id);

        this._wanderMoveTo(agent, w.tx, w.ty, 70).then(() => {
          if (agent.state === 'returning') {
            agent.state = 'idle';
            agent.originPos = { x: w.tx, y: w.ty };
            this.controller.startIdle(agent);
          }
        });
      }
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

    const tc = tgt.getCenter();
    const sc = src.getCenter();
    const dist = Math.hypot(tc.x - sc.x, tc.y - sc.y);

    if (InteractionEngine.SELF_MOVING_PRESETS.has(src.defaultMotion)) {
      // Self-moving: steer originPos toward partner so the idle preset drifts them closer
      // Only nudge a fraction of the remaining distance each tick
      const nudgeFraction = 0.15;
      src.originPos = {
        x: src.originPos.x + (tc.x - src.originPos.x) * nudgeFraction,
        y: src.originPos.y + (tc.y - src.originPos.y) * nudgeFraction,
      };
    } else {
      // Ground agent: steer wander destination toward partner
      if (src._wander) {
        src._wander.tx = tc.x;
        src._wander.ty = tc.y;
      }
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
