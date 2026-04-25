/**
 * index.js  —  SquiggleWiggle Animation Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Public API:
 *
 *   import { registerRecognizedSketch, removeSketch,
 *            startInteractionEngine, stopInteractionEngine,
 *            getEngine } from './animation/index.js';
 *
 *   // Called by your recognition system for each identified sketch:
 *   registerRecognizedSketch({
 *     id:         'obj_01',
 *     label:      'flower',
 *     category:   'plant',       // optional — resolved from label if omitted
 *     confidence: 0.87,
 *     bbox:       { x: 240, y: 160, width: 80, height: 120 },
 *     layerRef:   flowerKonvaGroup   // Konva.Group | Fabric object | generic ref
 *   });
 *
 *   startInteractionEngine();   // begin proximity checks
 *   stopInteractionEngine();    // pause
 *   removeSketch('obj_01');     // deregister and stop animations
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { SceneAgent, SceneRegistry }    from './sceneObjects.js';
import { resolveProfile }               from './semanticProfiles.js';
import { AnimationController }          from './animationController.js';
import { InteractionEngine }            from './interactionEngine.js';
import { INTERACTION_RULES }            from './interactionRules.js';

// ─── Singletons ───────────────────────────────────────────────────────────────

const registry   = new SceneRegistry();
const controller = new AnimationController();
const engine     = new InteractionEngine(registry, controller, INTERACTION_RULES);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a recognized sketch, apply idle animation, and enroll in the
 * interaction engine.
 *
 * @param {{
 *   id:         string,
 *   label:      string,
 *   category?:  string,
 *   confidence: number,
 *   bbox:       {x, y, width, height},
 *   layerRef:   *
 * }} recognitionResult
 * @returns {SceneAgent}
 */
export function registerRecognizedSketch(recognitionResult) {
  const { id, label, category, confidence, bbox, layerRef } = recognitionResult;

  // Resolve semantic profile (handles unknown labels gracefully)
  const profile = resolveProfile({ label, category, confidence });

  const agent = new SceneAgent({
    id,
    label:         label || 'unknown',
    category:      profile.category,
    tags:          profile.tags,
    defaultMotion: profile.defaultMotion,
    motionParams:  profile.motionParams || {},
    bbox,
    layerRef,
    confidence,
  });

  registry.register(agent);
  controller.startIdle(agent);

  console.log(
    `[SketchEngine] registered "${label}" → category:${profile.category}` +
    ` motion:${profile.defaultMotion} tags:[${profile.tags.join(', ')}]`
  );

  return agent;
}

/**
 * Remove a sketch from the scene and stop its animations.
 * @param {string} id
 */
export function removeSketch(id) {
  controller.stop(id);
  registry.unregister(id);
}

/**
 * Update a sketch's bounding box (call this if the user moves/resizes the layer).
 * @param {string} id
 * @param {{x, y, width, height}} bbox
 */
export function updateBBox(id, bbox) {
  const agent = registry.get(id);
  if (agent) {
    agent.bbox = { ...bbox };
    agent.originPos = { x: bbox.x, y: bbox.y };
  }
}

/** Begin the proximity-check interaction loop. */
export function startInteractionEngine() { engine.start(); }

/** Pause the interaction loop (idle animations keep running). */
export function stopInteractionEngine() { engine.stop(); }

/** Access the underlying engine / registry / controller if needed. */
export function getEngine()     { return engine; }
export function getRegistry()   { return registry; }
export function getController() { return controller; }

// ─── Konva.js integration helper ─────────────────────────────────────────────

/**
 * Convenience wrapper for Konva projects.
 * Automatically reads bbox from group.getClientRect().
 *
 * @param {string}      id
 * @param {string}      label
 * @param {Konva.Group} konvaGroup
 * @param {number}      confidence
 */
export function registerKonvaGroup(id, label, konvaGroup, confidence = 1.0) {
  const rect = konvaGroup.getClientRect({ skipTransform: false });
  return registerRecognizedSketch({
    id,
    label,
    confidence,
    bbox:     { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    layerRef: konvaGroup,
  });
}

// ─── Generic / library-agnostic helper ───────────────────────────────────────

/**
 * Convenience wrapper for objects that already implement the helper interface:
 *   setPosition(x,y), getPosition(), setRotation(deg),
 *   setScale(s), setOpacity(v), getBBox()
 */
export function registerGenericObject(id, label, obj, confidence = 1.0) {
  const bbox = obj.getBBox?.() || { x: 0, y: 0, width: 100, height: 100 };
  return registerRecognizedSketch({ id, label, confidence, bbox, layerRef: obj });
}
