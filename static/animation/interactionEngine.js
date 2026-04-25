/**
 * interactionEngine.js
 * - Wander manager: gives mobile agents real waypoints so they traverse the canvas
 * - Interaction checker: fires tag-based rules when objects are within radius
 */

export class InteractionEngine {
  constructor(registry, controller, rules, canvasW = 800, canvasH = 600) {
    this.registry   = registry;
    this.controller = controller;
    this.rules      = [...rules].sort((a, b) => b.priority - a.priority);
    this.canvasW    = canvasW;
    this.canvasH    = canvasH;
    this._interval  = null;
    this.checkMs    = 350;
    this.defaultRadius = 200;
    this.wanderRadius  = 380;   // begin drifting toward a target at this range
  }

  start() {
    if (this._interval) return;
    this._interval = setInterval(() => this._tick(), this.checkMs);
    console.log('[InteractionEngine] started');
  }

  stop() { clearInterval(this._interval); this._interval = null; }

  /** Call when the canvas is resized. */
  resize(w, h) { this.canvasW = w; this.canvasH = h; }

  // ── Main tick ──────────────────────────────────────────────────────────────

  _tick() {
    const agents = this.registry.getAll();
    this._tickWander(agents);
    this._tickInteractions(agents);
  }

  // ── Wander: give mobile objects real destinations ─────────────────────────

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
      // Next pick: after travel time (distance / speed estimate) + 0.5-2s pause
      const pos  = agent.adapter.getPosition();
      const dist = Math.hypot(w.tx - pos.x, w.ty - pos.y);
      const travelMs = (dist / 90) * 1000;  // ~90px/s travel
      w.nextPickTime = now + travelMs + 500 + Math.random() * 1500;

      // Move to waypoint — this temporarily replaces idle
      agent.state = 'returning';  // use returning to allow interaction to preempt
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

  /** Custom moveTo using rAF at a constant pixel/sec speed (not fixed duration). */
  _wanderMoveTo(agent, tx, ty, pxPerSec) {
    return new Promise(resolve => {
      let lastTs = null;
      let raf;
      const isFlying = agent.hasTag('flying');
      let phase = 0;  // for bounce

      const tick = ts => {
        if (!lastTs) lastTs = ts;
        const dt  = Math.min((ts - lastTs) / 1000, 0.05);
        lastTs = ts;
        phase += dt;

        const pos = agent.adapter.getPosition();
        const dx  = tx - pos.x;
        const dy  = ty - pos.y;
        const dist = Math.hypot(dx, dy);

        if (dist < 4) {
          agent.adapter.setPosition(tx, ty);
          cancelAnimationFrame(raf);
          resolve();
          return;
        }

        const step = Math.min(pxPerSec * dt, dist);
        const nx = pos.x + (dx / dist) * step;

        if (isFlying) {
          // Sinusoidal y-drift for flying feel
          const ny = pos.y + (dy / dist) * step + Math.sin(phase * 3) * 1.5;
          agent.adapter.setPosition(nx, ny);
          agent.adapter.setRotation(dx > 0 ? 5 : -5);
        } else {
          // Bounce for ground animals
          const bounce = 7 * Math.abs(Math.sin(phase * Math.PI * 2.5));
          agent.adapter.setPosition(nx, ty - bounce);
          agent.adapter.setRotation(dx > 0 ? 4 : -4);
        }

        raf = requestAnimationFrame(tick);
      };

      raf = requestAnimationFrame(tick);

      // Store cancel so interactions can preempt the wander
      const prev = agent.cancelIdle;
      agent.cancelIdle = () => {
        cancelAnimationFrame(raf);
        if (prev) prev();
        resolve();
      };
    });
  }

  // ── Interaction checker ───────────────────────────────────────────────────

  _tickInteractions(agents) {
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const a = agents[i], b = agents[j];
        if (this.registry.hasPairCooldown(a.id, b.id)) continue;

        const dist = this._dist(a.getCenter(), b.getCenter());

        // Full interaction: both idle, within radius
        if (a.state === 'idle' && b.state === 'idle') {
          const match = this._findRule(a, b, dist);
          if (match) { this._dispatch(match); continue; }
        }

        // Approach: one is wandering (returning), other is idle — nudge source toward target
        if (dist < this.wanderRadius && dist > this.defaultRadius) {
          this._nudgeToward(a, b);
        }
      }
    }
  }

  /** Gently steer a mobile agent toward a potential interaction partner. */
  _nudgeToward(a, b) {
    // Find which one is the potential "source" (has mobile tag, currently wandering)
    const tryNudge = (src, tgt) => {
      if (!src.hasTag('mobile')) return false;
      if (src.state !== 'idle' && src.state !== 'returning') return false;
      if (this.registry.hasPairCooldown(src.id, tgt.id)) return false;

      // Check if there's a matching rule for this pair
      const hasRule = this.rules.some(r =>
        (r.radius ?? this.defaultRadius) >= this._dist(src.getCenter(), tgt.getCenter()) * 0.7 &&
        (r.match(src, tgt) || (r.bidirectional !== false && r.match(tgt, src)))
      );
      if (!hasRule) return false;

      // Steer wander destination toward target
      if (src._wander) {
        const tc = tgt.getCenter();
        src._wander.tx = tc.x;
        src._wander.ty = tc.y;
      }
      return true;
    };

    tryNudge(a, b) || tryNudge(b, a);
  }

  _dist(p, q) { return Math.hypot(q.x - p.x, q.y - p.y); }

  _findRule(a, b, dist) {
    for (const rule of this.rules) {
      const radius = rule.radius ?? this.defaultRadius;
      if (dist > radius) continue;
      if (rule.match(a, b)) return { rule, source: a, target: b };
      if (rule.bidirectional !== false && rule.match(b, a)) return { rule, source: b, target: a };
    }
    return null;
  }

  _dispatch({ rule, source, target }) {
    source.state = 'interacting';
    target.state = 'interacting';
    source.cancelIdle?.();
    target.cancelIdle?.();
    this.controller.stop(source.id);
    this.controller.stop(target.id);
    this.registry.setPairCooldown(source.id, target.id, rule.cooldown ?? 5000);

    console.log(`[InteractionEngine] ${rule.id}: ${source.label} → ${target.label}`);

    Promise.resolve(rule.action(source, target, this.controller))
      .catch(err => console.warn('[InteractionEngine] action error:', err))
      .finally(() => {
        source.state = 'idle';
        target.state = 'idle';
        // Reset wander timers so they pick new destinations
        if (source._wander) source._wander.nextPickTime = Date.now() + 500;
        if (target._wander) target._wander.nextPickTime = Date.now() + 500;
        this.controller.startIdle(source);
        this.controller.startIdle(target);
      });
  }
}
