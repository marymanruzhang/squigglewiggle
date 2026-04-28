/**
 * storyRunner.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Executes story plans produced by storyPlanner.js.
 *
 * Given a StoryPlan, the runner:
 *   1. Marks both agents as 'story_active' and cancels their idle animations.
 *   2. Walks the beat sequence in order.
 *      - Sequential beats are awaited one at a time.
 *      - Beats with `parallel: true` run concurrently with the previous beat.
 *   3. After all beats complete (or if interrupted), returns both agents to
 *      their idle animations and marks them 'idle'.
 *   4. Records the pair cooldown via storyPlanner.recordCooldown().
 *
 * Stories can be interrupted externally by calling storyRunner.interrupt(agentId).
 * This is used to handle edge cases (e.g. agent removed mid-story).
 *
 * HOW TO ADD BEATS:
 *   Add beat functions to storyBeatAnimations.js and reference them by name
 *   in storyTemplates.js — no changes needed in this file.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getBeat } from './storyBeatAnimations.js';
import { recordCooldown } from './storyPlanner.js';
import { wait } from './motionPresets.js';
import { getCaps } from './subjectCapabilities.js';

// ─── Narrative helpers ────────────────────────────────────────────────────────

/**
 * Build a human-readable narrative for a story plan.
 * Preference order:
 *   1. plan.liveStory.narrative  (GPT-written, label-specific)
 *   2. Interaction-type template with real agent labels
 *   3. Generic fallback
 */
function _narrativeForPlan(plan) {
  // 1. GPT live-story narrative (best — generated for this exact pair)
  if (plan.liveStory?.narrative) return plan.liveStory.narrative;

  // 2. Derive from template id / interaction type
  const src = plan.source?.label ?? 'one';
  const tgt = plan.target?.label ?? 'the other';
  const id  = (plan.id ?? '').toLowerCase();

  if (id.includes('greet') || id.includes('meet'))   return `The ${src} approaches the ${tgt} to say hello.`;
  if (id.includes('chase') || id.includes('run'))    return `The ${src} gives chase as the ${tgt} tries to escape!`;
  if (id.includes('avoid') || id.includes('flee'))   return `The ${src} keeps its distance from the ${tgt}.`;
  if (id.includes('shelter') || id.includes('hide')) return `The ${src} takes shelter beside the ${tgt}.`;
  if (id.includes('admire'))   return `The ${src} pauses to admire the ${tgt}.`;
  if (id.includes('play'))     return `The ${src} and ${tgt} enjoy a playful moment together.`;
  if (id.includes('orbit') || id.includes('walk_around')) return `The ${src} circles curiously around the ${tgt}.`;
  return `The ${src} and ${tgt} share a peaceful moment.`;
}

/** Beat types → narrative text functions. null = resolved dynamically below. */
const BEAT_NARRATIVES = {
  noticeTarget:     (src, tgt) => `The ${src} notices the ${tgt}…`,
  approachTarget:   (src, tgt) => `The ${src} makes its way toward the ${tgt}.`,
  approachWithCurve:(src, tgt) => `The ${src} curves gracefully toward the ${tgt}.`,
  fleeFromTarget:   (src, tgt) => `The ${tgt} dashes away from the ${src}!`,
  chaseTarget:      (src, tgt) => `The ${src} gives chase!`,
  orbitTarget:      (src, tgt) => `The ${src} circles around the ${tgt}.`,
  pauseAndLook:     (src, tgt) => `The ${src} pauses to admire the ${tgt}.`,
  sniffTarget:      (src, tgt) => `The ${src} sniffs curiously at the ${tgt}.`,
  nibbleTarget:     (src, tgt) => `The ${src} nibbles gently on the ${tgt}.`,
  landNearTarget:   (src, tgt) => `The ${src} lands softly near the ${tgt}.`,
  restNearTarget:   (src, tgt) => `The ${src} rests peacefully near the ${tgt}.`,
  hideUnderShelter: (src, tgt) => `The ${src} nestles beside the ${tgt}.`,
  rainOnTarget:     (src, tgt) => `The ${src} showers the ${tgt} with attention.`,
  reactSurprise:    (src, tgt) => `The ${src} is startled!`,
  returnToIdle:     null,  // silent — no text update on cleanup beats
  // Capability-sensitive — resolved in _executeBeat below:
  growOrBloom:      null,
  happyBounce:      null,
  reactBounce:      null,
  strongerSway:     null,
  reactWiggle:      null,
  pulseLight:       null,
};

/**
 * Pick a capability-aware narrative for beats whose text depends on
 * what the subject physically is (plant, building, animal, etc.).
 */
function _capNarrative(beatType, actorLabel, actorCategory) {
  const caps = getCaps(actorLabel, actorCategory);
  const name = actorLabel ?? 'it';

  switch (beatType) {
    case 'growOrBloom':
      if (caps.has('can_blossom')) return `The ${name} bursts into bloom!`;
      if (caps.has('can_glow'))    return `The ${name} glows warmly.`;
      if (caps.has('can_sway'))    return `The ${name} sways gently.`;
      return `The ${name} shimmers in response.`;

    case 'happyBounce':
      if (caps.has('can_bounce')) return `The ${name} bounces with excitement!`;
      if (caps.has('can_sway'))   return `The ${name} sways joyfully.`;
      return `The ${name} shakes with delight.`;

    case 'reactBounce':
      if (caps.has('can_bounce')) return `The ${name} jumps in response!`;
      return `The ${name} trembles gently.`;

    case 'strongerSway':
      if (caps.has('can_blossom')) return `The ${name} sways and rustles.`;
      return `The ${name} sways in place.`;

    case 'reactWiggle':
      if (caps.has('is_static'))   return `The ${name} trembles slightly.`;
      if (caps.has('is_animate'))  return `The ${name} wiggles in reaction.`;
      return `The ${name} shakes gently.`;

    case 'pulseLight':
      return `The ${name} pulses with light.`;

    default:
      return null;
  }
}

// ─── Active story tracking ────────────────────────────────────────────────────
// Maps agentId → { storyId, abortFn }
const _activeStories = new Map();

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _markStoryActive(agent, storyId, abortFn) {
  agent.state = 'story_active';
  agent.activeStoryId = storyId;
  _activeStories.set(agent.id, { storyId, abortFn });
}

function _markIdle(agent) {
  agent.state = 'idle';
  agent.activeStoryId = null;
  _activeStories.delete(agent.id);
}

/**
 * Resolve which agent plays which role in a beat.
 * 'source' → plan.source
 * 'target' → plan.target
 * 'both'   → both (handled by parallel execution in _executeBeat)
 */
function _resolveActor(plan, role) {
  if (role === 'source') return plan.source;
  if (role === 'target') return plan.target;
  return null; // 'both' handled separately
}

// ─── Beat executor ────────────────────────────────────────────────────────────

/**
 * Execute a single beat descriptor.
 * Returns a Promise that resolves when the beat is done.
 */
async function _executeBeat(beatDesc, plan, controller) {
  const { type, actor: actorRole, params = {} } = beatDesc;
  const beatFn = getBeat(type);

  // ── Live narrative update: swap dock text for key visible actions ──────────────
  if (typeof window?.squiggleSetNarrative === 'function') {
    const narrativeFn = BEAT_NARRATIVES[type];
    let beatNarrative = null;

    if (narrativeFn !== undefined && narrativeFn !== null) {
      // Static narrative function — apply source/target label perspective
      const srcLabel = plan.source?.label ?? 'one';
      const tgtLabel = plan.target?.label ?? 'the other';
      beatNarrative = actorRole === 'target'
        ? narrativeFn(tgtLabel, srcLabel)
        : narrativeFn(srcLabel, tgtLabel);
    } else if (narrativeFn === null && type in BEAT_NARRATIVES) {
      // Capability-sensitive beat — resolve dynamically from actor's caps
      const actor = actorRole === 'source' ? plan.source
                  : actorRole === 'target' ? plan.target
                  : null;
      if (actor) {
        beatNarrative = _capNarrative(type, actor.label, actor.category);
      }
    }

    if (beatNarrative) window.squiggleSetNarrative(beatNarrative);
  }

  if (actorRole === 'both') {
    // Run the same beat on both agents in parallel
    await Promise.all([
      beatFn(plan.source, plan.target, controller, params),
      beatFn(plan.target, plan.source, controller, params),
    ]);
    return;
  }

  // Determine which is actor and which is the passive "context" agent
  const actor  = _resolveActor(plan, actorRole);
  const other  = actorRole === 'source' ? plan.target : plan.source;

  if (!actor) return; // safety check
  await beatFn(actor, other, controller, params);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run a story plan to completion.
 * Handles state management, beat sequencing, and cleanup.
 *
 * @param {StoryPlan}         plan
 * @param {AnimationController} controller
 * @returns {Promise<void>}   resolves when story is fully complete
 */
export async function runStory(plan, controller) {
  const { source, target, template } = plan;

  let aborted = false;
  const abort = () => { aborted = true; };

  // Stop idle animations and mark agents busy
  controller.stop(source.id);
  controller.stop(target.id);
  source.cancelIdle?.();
  target.cancelIdle?.();

  _markStoryActive(source, plan.id, abort);
  _markStoryActive(target, plan.id, abort);

  console.log(`[StoryRunner] ▶ ${plan.id}: "${source.label}" + "${target.label}"`);

  // ── Story-level narrative: update dock text immediately when beats start ──────
  // This ensures the displayed text always matches what's actually animating.
  if (typeof window?.squiggleSetNarrative === 'function') {
    window.squiggleSetNarrative(_narrativeForPlan(plan));
  }

  // ── Dedicated draw loop ────────────────────────────────────────────────────
  // Beat functions like ctrl.moveTo() and orbitAround() update Konva node
  // positions but don't call layer.batchDraw(). If both agents' idle RAFs
  // are stopped, nothing re-renders. This loop keeps drawing alive for the
  // entire story duration.
  const layer = source.adapter.ref?.getLayer?.() ?? target.adapter.ref?.getLayer?.();
  let _drawRaf;
  const _startDraw = () => {
    const tick = () => { layer?.batchDraw(); _drawRaf = requestAnimationFrame(tick); };
    _drawRaf = requestAnimationFrame(tick);
  };
  const _stopDraw = () => cancelAnimationFrame(_drawRaf);
  _startDraw();

  try {
    const beats = template.beats;

    let pendingPromise = null;

    for (let i = 0; i < beats.length; i++) {
      if (aborted) break;

      const beat = beats[i];

      if (!beat.parallel && i > 0) {
        await wait(80);
        if (aborted) break;
      }

      const beatPromise = _executeBeat(beat, plan, controller);

      if (beat.parallel && pendingPromise) {
        pendingPromise = Promise.all([pendingPromise, beatPromise]);
      } else {
        if (pendingPromise) await pendingPromise;
        pendingPromise = beatPromise;
      }
    }

    if (pendingPromise) await pendingPromise;

  } catch (err) {
    console.warn(`[StoryRunner] Story "${plan.id}" encountered an error:`, err);
  } finally {
    _stopDraw();

    recordCooldown(plan);

    _markIdle(source);
    _markIdle(target);

    source.adapter.setRotation(0);
    target.adapter.setRotation(0);

    // ── Scale + rotation lock: always restore exact spawn values after every story ─
    // Safety net: no beat animation can permanently alter size or orientation.
    for (const agent of [source, target]) {
      const locked    = agent.spawnScale ?? 1;
      const lockedRot = agent.layerRef?._baseRotation ?? 0;
      agent.adapter.setScale(locked);
      agent.adapter.setRotation(lockedRot);
    }

    // ── Out-of-bounds recovery ────────────────────────────────────────────────
    for (const agent of [source, target]) {
      const stage = agent.adapter.ref?.getStage?.();
      if (stage) {
        const sw = stage.width(), sh = stage.height();
        const p  = agent.adapter.getPosition();
        if (p.x < -40 || p.x > sw + 40 || p.y < -40 || p.y > sh + 40) {
          agent.adapter.setPosition(sw / 2, sh / 2);
          if (agent._wander) agent._wander.nextPickTime = 0;
        }
      }
    }

    controller.startIdle(source);
    controller.startIdle(target);

    if (source._wander) source._wander.nextPickTime = Date.now() + 300;
    if (target._wander) target._wander.nextPickTime = Date.now() + 300;

    console.log(`[StoryRunner] ✓ ${plan.id} complete`);
  }
}

/**
 * Interrupt any active story that involves `agentId`.
 * Called when an agent is removed or the scene is reset.
 *
 * @param {string} agentId
 */
export function interrupt(agentId) {
  const entry = _activeStories.get(agentId);
  if (entry?.abortFn) entry.abortFn();
}

/**
 * Returns true if an agent is currently participating in a story.
 */
export function isInStory(agentId) {
  return _activeStories.has(agentId);
}
