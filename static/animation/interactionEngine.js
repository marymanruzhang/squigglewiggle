/**
 * interactionEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Wander manager + Story-aware interaction checker.
 *
 * Every `checkMs` (≈350ms) this engine:
 *   1. Gives mobile agents new wander waypoints (anchored objects are skipped).
 *   2. Pre-fetches GPT semantic stories when pairs come within wanderRadius.
 *   3. Asks storyPlanner for the best story plan among all agent pairs.
 *   4. Hands the plan to storyRunner, which executes the full beat sequence.
 *
 * Only one story runs at a time (guarded by agent state checks in the planner).
 * Non-participating agents keep their idle animations running throughout.
 *
 * Backward compatibility: the `rules` constructor argument is accepted but
 * ignored — all interaction logic now flows through storyTemplates.js.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { selectBestPlan, fetchSemanticStory } from './storyPlanner.js';
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
    this._tickFacing(agents);
  }

  // ── Facing: keep each sketch oriented toward its partner ──────────────────
  //
  // For sketches with a clear horizontal facing direction (animals, vehicles,
  // characters), we flip them so they always face the other sketch.
  // Neutral/symmetrical objects (flowers, stars, etc.) are never flipped.
  //
  // The formula:
  //   iAmLeft          = my center X < partner center X
  //   shouldFaceRight  = iAmLeft       (left agent should look right toward partner)
  //   naturallyRight   = naturalFacing === 'right'
  //   shouldFlip       = shouldFaceRight XOR naturallyRight
  //                    → flip when natural direction disagrees with desired direction

  _tickFacing(agents) {
    if (agents.length < 2) return;
    const now = Date.now();

    for (const agent of agents) {
      if (!agent.facingEnabled) continue;

      // Debounce — don't re-evaluate more than once per 350ms per agent
      if (agent._lastFacingUpdate && now - agent._lastFacingUpdate < 350) continue;
      agent._lastFacingUpdate = now;

      const partner = agents.find(a => a.id !== agent.id);
      if (!partner) continue;

      const myPos      = agent.adapter.getPosition();
      const partnerPos = partner.adapter.getPosition();

      const iAmLeft        = myPos.x < partnerPos.x;
      const shouldFaceRight = iAmLeft;
      const naturallyRight  = agent.naturalFacing === 'right';

      // shouldFlip = true when natural facing disagrees with desired direction
      const shouldFlip = shouldFaceRight !== naturallyRight;

      if (shouldFlip !== agent.adapter.getFlipX()) {
        agent.adapter.setFlipX(shouldFlip);
      }
    }
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
    'flutter', 'fly', 'zigzag_fly', 'hover', 'drift', 'wave', 'orbit',
    'swim', 'slow_swim',
  ]);

  _tickWander(agents) {
    const now = Date.now();
    const W = this.canvasW, H = this.canvasH;
    const margin = 220;   // safe inset from canvas edge for wander targets
                          // (must be ≥ largest preset oscillation amplitude so
                          //  the sketch never reaches the clamped boundary mid-swing)

    for (const agent of agents) {
      if (!agent.hasTag('mobile')) continue;
      if (agent.hasTag('anchored')) continue;
      if (agent.behaviorOverride === 'stay') continue;

      // ── Out-of-bounds rescue (runs for ALL states) ───────────────────────
      // Fires the moment the sketch center crosses the canvas boundary.
      // setPosition() now hard-clamps so this is mainly a safety net for
      // cases where originPos itself drifts out of bounds.
      const curPos = agent.adapter.getPosition();
      if (curPos.x < 0 || curPos.x > W || curPos.y < 0 || curPos.y > H) {
        const rx = W / 2 + (Math.random() - 0.5) * Math.min(200, W * 0.3);
        const ry = H / 2 + (Math.random() - 0.5) * Math.min(100, H * 0.2);
        agent.adapter.setPosition(rx, ry);
        agent.originPos = { x: rx, y: ry };
        agent.state = 'idle';
        agent._wander = { tx: rx, ty: ry, nextPickTime: 0, headingToPartner: false };
        this.controller.startIdle(agent);
        console.log(`[OOB] rescued "${agent.label}" → (${rx.toFixed(0)}, ${ry.toFixed(0)})`);
        continue;
      }

      if (agent.state !== 'idle') continue;

      if (!agent._wander) {
        const partner = agents.find(a => a.id !== agent.id);
        const partnerCenter = partner ? partner.getCenter() : null;

        const FLYING = new Set(['flutter','fly','zigzag_fly','hover','orbit']);
        const initDelay = FLYING.has(agent.defaultMotion)
          ? 1500 + Math.random() * 1000
          : 200  + Math.random() * 300;

        const tx = partnerCenter ? Math.max(margin, Math.min(W - margin, partnerCenter.x)) : agent.originPos.x;
        const ty = partnerCenter ? Math.max(margin, Math.min(H - margin, partnerCenter.y)) : agent.originPos.y;
        agent._wander = { nextPickTime: now + initDelay, tx, ty, headingToPartner: true };
      }

      const w = agent._wander;
      if (now < w.nextPickTime) continue;

      const isSelfMoving = InteractionEngine.SELF_MOVING_PRESETS.has(agent.defaultMotion);

      if (isSelfMoving) {
        if (w.headingToPartner) {
          const partner = agents.find(a => a.id !== agent.id);
          if (partner) {
            const pc = partner.getCenter();
            w.tx = Math.max(margin, Math.min(W - margin, pc.x));
            w.ty = Math.max(margin, Math.min(H - margin, pc.y));
            w.headingToPartner = false;
          }
        } else {
          w.tx = margin + Math.random() * (W - margin * 2);
          w.ty = margin + Math.random() * (H - margin * 2);
        }
        const dist = Math.hypot(w.tx - agent.originPos.x, w.ty - agent.originPos.y);
        w.nextPickTime = now + Math.max(2000, dist * 15) + Math.random() * 1500;
        agent.originPos = { x: w.tx, y: w.ty };

      } else {
        // ── Ground agent: drive via _wanderMoveTo RAF ─────────────────────
        if (w.headingToPartner) {
          const partner = agents.find(a => a.id !== agent.id);
          if (partner) {
            const pc = partner.getCenter();
            const selfPos = agent.adapter.getPosition();
            const dx = pc.x - selfPos.x, dy = pc.y - selfPos.y;
            const d  = Math.hypot(dx, dy) || 1;
            const stopDist = Math.max(80, d - 120);
            // Clamp stop position inside canvas
            w.tx = Math.max(margin, Math.min(W - margin, selfPos.x + (dx / d) * stopDist));
            w.ty = Math.max(margin, Math.min(H - margin, selfPos.y + (dy / d) * stopDist));
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
      }  // closes else
    }  // closes for loop
  }  // closes _tickWander


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
          // Incrementally move toward (tx,ty) in both axes.
          // The bob is applied as a Y offset on top of the correct path position
          // (not snapped to target Y) so diagonal walks look natural.
          const ny = pos.y + (dy / dist) * step;
          const bounce = 5 * Math.abs(Math.sin(phase * Math.PI * 2.5));
          agent.adapter.setPosition(nx, ny - bounce);
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


  // ── Semantic pre-fetch on proximity (Phase 2) ────────────────────────────
  //
  // When two agents come within wanderRadius of each other for the first time,
  // fire-and-forget a GPT live-story request. The result lands in the
  // storyPlanner's cache so by the time they actually meet, it's ready.

  _prefetchSemanticStories(agents) {
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const a = agents[i], b = agents[j];
        if (a.state !== 'idle' || b.state !== 'idle') continue;
        const dist = this._dist(a.getCenter(), b.getCenter());
        if (dist > this.wanderRadius * 1.5) continue;
        // fetchSemanticStory is a no-op if the pair is already cached
        fetchSemanticStory(a, b).catch(() => {});
      }
    }
  }

  // ── Story selection and dispatch ───────────────────────────────────────────

  _tickStory(agents) {
    // Don't stack stories — wait for the current one to finish
    if (this._storyRunning) return;

    // Pre-fetch semantic stories for pairs coming within range
    this._prefetchSemanticStories(agents);

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
