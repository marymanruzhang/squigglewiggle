/**
 * sceneObjects.js
 * ─────────────────────────────────────────────────────────────────────────────
 * LayerAdapter   — uniform interface over Konva / Fabric / generic layerRefs
 * SceneAgent     — runtime agent wrapping a recognized sketch
 * SceneRegistry  — global store + pair-cooldown tracking
 *
 * HOW TO ADD A NEW LIBRARY:
 *   Add a branch in LayerAdapter._detect() and in each set/get method.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── LayerAdapter ─────────────────────────────────────────────────────────────

export class LayerAdapter {
  /**
   * @param {*}      layerRef  Konva.Group | Fabric object | generic helper object
   * @param {string} library   'auto' | 'konva' | 'fabric' | 'generic'
   */
  constructor(layerRef, library = 'auto') {
    this.ref     = layerRef;
    this.library = library === 'auto' ? this._detect(layerRef) : library;

    // Internal state cache — always kept in sync
    this._x        = 0;
    this._y        = 0;
    this._rotation = 0;  // degrees
    this._scaleX   = 1;
    this._scaleY   = 1;
    this._opacity  = 1;

    this._syncFromRef();
  }

  // ── Library detection ──────────────────────────────────────────────────────
  _detect(ref) {
    if (!ref) return 'generic';
    // Konva nodes expose x() / y() as getter-setter functions
    if (typeof ref.x === 'function' && typeof ref.getLayer === 'function') return 'konva';
    // Fabric objects expose .set() and have a .canvas reference
    if (typeof ref.set === 'function' && ref.type !== undefined) return 'fabric';
    return 'generic';
  }

  _syncFromRef() {
    try {
      if (this.library === 'konva') {
        this._x        = this.ref.x();
        this._y        = this.ref.y();
        this._rotation = this.ref.rotation() || 0;
        this._scaleX   = this.ref.scaleX()   || 1;
        this._scaleY   = this.ref.scaleY()   || 1;
        this._opacity  = this.ref.opacity()  || 1;
      } else if (this.library === 'fabric') {
        this._x        = this.ref.left   || 0;
        this._y        = this.ref.top    || 0;
        this._rotation = this.ref.angle  || 0;
        this._scaleX   = this.ref.scaleX || 1;
        this._scaleY   = this.ref.scaleY || 1;
        this._opacity  = this.ref.opacity !== undefined ? this.ref.opacity : 1;
      } else {
        // Generic — call helper methods if available
        if (typeof this.ref.getPosition === 'function') {
          const p   = this.ref.getPosition();
          this._x   = p.x || 0;
          this._y   = p.y || 0;
        }
        this._opacity = typeof this.ref.getOpacity === 'function' ? this.ref.getOpacity() : 1;
      }
    } catch (e) {
      console.warn('[LayerAdapter] Could not sync from ref:', e);
    }
  }

  // ── Position ───────────────────────────────────────────────────────────────
  setPosition(x, y) {
    this._x = x; this._y = y;
    if (this.library === 'konva') {
      this.ref.x(x); this.ref.y(y);
      this._batchDraw();
    } else if (this.library === 'fabric') {
      this.ref.set({ left: x, top: y });
      this.ref.canvas?.requestRenderAll();
    } else {
      if (typeof this.ref.setPosition === 'function') this.ref.setPosition(x, y);
    }
  }

  getPosition() {
    if (this.library === 'konva')  return { x: this.ref.x(), y: this.ref.y() };
    if (this.library === 'fabric') return { x: this.ref.left || 0, y: this.ref.top || 0 };
    if (typeof this.ref.getPosition === 'function') return this.ref.getPosition();
    return { x: this._x, y: this._y };
  }

  // ── Rotation ───────────────────────────────────────────────────────────────
  setRotation(deg) {
    this._rotation = deg;
    if (this.library === 'konva') {
      this.ref.rotation(deg); this._batchDraw();
    } else if (this.library === 'fabric') {
      this.ref.set({ angle: deg }); this.ref.canvas?.requestRenderAll();
    } else {
      if (typeof this.ref.setRotation === 'function') this.ref.setRotation(deg);
    }
  }

  getRotation() {
    if (this.library === 'konva')  return this.ref.rotation();
    if (this.library === 'fabric') return this.ref.angle || 0;
    return this._rotation;
  }

  // ── Scale ─────────────────────────────────────────────────────────────────
  setScale(s) { this.setScaleXY(s, s); }

  setScaleXY(sx, sy) {
    this._scaleX = sx; this._scaleY = sy;
    if (this.library === 'konva') {
      this.ref.scaleX(sx); this.ref.scaleY(sy); this._batchDraw();
    } else if (this.library === 'fabric') {
      this.ref.set({ scaleX: sx, scaleY: sy }); this.ref.canvas?.requestRenderAll();
    } else {
      if (typeof this.ref.setScale    === 'function') this.ref.setScale(sx);
      if (typeof this.ref.setScaleXY  === 'function') this.ref.setScaleXY(sx, sy);
    }
  }

  // ── Opacity ───────────────────────────────────────────────────────────────
  setOpacity(v) {
    this._opacity = v;
    if (this.library === 'konva') {
      this.ref.opacity(v); this._batchDraw();
    } else if (this.library === 'fabric') {
      this.ref.set({ opacity: v }); this.ref.canvas?.requestRenderAll();
    } else {
      if (typeof this.ref.setOpacity === 'function') this.ref.setOpacity(v);
    }
  }

  /** Bring this object to the visual front (highest z-order within its layer). */
  bringToFront() {
    if (this.library === 'konva') {
      this.ref.moveToTop(); this._batchDraw();
    } else if (this.library === 'fabric') {
      this.ref.bringToFront?.(); this.ref.canvas?.requestRenderAll();
    }
  }

  // ── BBox ──────────────────────────────────────────────────────────────────
  getBBox() {
    if (this.library === 'konva') {
      const r = this.ref.getClientRect({ skipTransform: false });
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    if (this.library === 'fabric') {
      const b = this.ref.getBoundingRect();
      return { x: b.left, y: b.top, width: b.width, height: b.height };
    }
    if (typeof this.ref.getBBox === 'function') return this.ref.getBBox();
    return { x: this._x, y: this._y, width: 100, height: 100 };
  }

  // ── Internal ──────────────────────────────────────────────────────────────
  _batchDraw() {
    const layer = this.ref.getLayer?.();
    if (layer) layer.batchDraw();
  }
}


// ─── SceneAgent ───────────────────────────────────────────────────────────────

export class SceneAgent {
  /**
   * @param {{
   *   id:           string,
   *   label:        string,
   *   category:     string,
   *   tags:         string[],
   *   defaultMotion:string,
   *   motionParams: object,
   *   bbox:         {x,y,width,height},
   *   layerRef:     *,
   *   confidence:   number,
   *   frames:       string[]
   * }} opts
   */
  constructor({ id, label, category, tags, defaultMotion, motionParams, bbox, layerRef, confidence, frames, spawnScale, behaviorOverride, motionHint }) {
    this.id            = id;
    this.label         = label;
    this.category      = category;
    this.tags          = tags         || [];
    this.defaultMotion = defaultMotion || 'wiggle';
    this.motionParams  = motionParams  || {};
    this.bbox          = { ...bbox };
    this.confidence    = confidence    || 1.0;
    this.frames        = frames        || [];

    this.frameImages   = [];
    if (this.frames.length > 0) {
      this.frames.forEach(f => {
        const i = new window.Image();
        i.src = f;
        this.frameImages.push(i);
      });
    }

    this.adapter = new LayerAdapter(layerRef);

    const pos = this.adapter.getPosition();
    this.originPos = { x: pos.x, y: pos.y };
    this.spawnPos  = { x: pos.x, y: pos.y };
    this.spawnScale      = spawnScale      ?? this.adapter._scaleX ?? 1;
    // GPT-4o semantic scene hints
    this.behaviorOverride = behaviorOverride ?? null; // 'stay'|'approach'|'flee'|'orbit'|'wander'
    this.motionHint       = motionHint       ?? null; // 'walk'|'fly'|'idle'|'swim'|'sway'

    this.state               = 'idle';
    this.cancelIdle          = null;
    this.cooldowns           = {};
    this.activeStoryId       = null;
    this.lastInteractionTime = 0;
    this.homePosition        = null;
  }

  /**
   * Center point of the agent.
   * In this system, the Konva group's (x, y) IS the center of the sprite
   * (the image is placed at -size/2, -size/2 within the group), so we
   * return the adapter position directly.
   */
  getCenter() {
    return this.adapter.getPosition();
  }

  hasTag(tag) { return this.tags.includes(tag); }

  hasCooldown(pairKey) {
    return this.cooldowns[pairKey] !== undefined && Date.now() < this.cooldowns[pairKey];
  }

  setCooldown(pairKey, ms) {
    this.cooldowns[pairKey] = Date.now() + ms;
  }

  /** Snap back to the origin position (used after interactions) */
  resetToOrigin(animate = false) {
    if (!animate) {
      this.adapter.setPosition(this.originPos.x, this.originPos.y);
      return;
    }
    // Smooth return — handled by the motionPresets.moveTo utility
  }

  /** True while this agent is actively executing a story beat sequence. */
  get isInStory() { return this.state === 'story_active'; }
}


// ─── SceneRegistry ────────────────────────────────────────────────────────────

export class SceneRegistry {
  constructor() {
    /** @type {Map<string, SceneAgent>} */
    this.agents = new Map();
    /** @type {Map<string, number>}  pairKey → expiryTimestamp */
    this.pairCooldowns = new Map();
  }

  register(agent) {
    this.agents.set(agent.id, agent);
  }

  unregister(id) {
    const agent = this.agents.get(id);
    if (agent?.cancelIdle) agent.cancelIdle();
    this.agents.delete(id);
  }

  get(id) { return this.agents.get(id); }

  getAll() { return [...this.agents.values()]; }

  pairKey(id1, id2) { return [id1, id2].sort().join(':'); }

  hasPairCooldown(id1, id2) {
    const cd = this.pairCooldowns.get(this.pairKey(id1, id2));
    return !!cd && Date.now() < cd;
  }

  setPairCooldown(id1, id2, ms = 4000) {
    this.pairCooldowns.set(this.pairKey(id1, id2), Date.now() + ms);
  }
}
