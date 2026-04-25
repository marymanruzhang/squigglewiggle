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

  try {
    const beats = template.beats;

    // Walk beats in order.
    // A beat with `parallel: true` is launched alongside the *previous* running beat.
    let pendingPromise = null;

    for (let i = 0; i < beats.length; i++) {
      if (aborted) break;

      const beat = beats[i];

      // Small inter-beat pause for readability (unless explicitly parallel)
      if (!beat.parallel && i > 0) {
        await wait(80);
        if (aborted) break;
      }

      const beatPromise = _executeBeat(beat, plan, controller);

      if (beat.parallel && pendingPromise) {
        // Run this beat in parallel with the previous one
        pendingPromise = Promise.all([pendingPromise, beatPromise]);
      } else {
        // Wait for any previously parallel group to finish first
        if (pendingPromise) await pendingPromise;
        pendingPromise = beatPromise;
      }
    }

    // Await the final outstanding beat(s)
    if (pendingPromise) await pendingPromise;

  } catch (err) {
    console.warn(`[StoryRunner] Story "${plan.id}" encountered an error:`, err);
  } finally {
    // Record cooldown and restore idle state
    recordCooldown(plan);

    _markIdle(source);
    _markIdle(target);

    // Snap rotation/scale back so nothing is left in a weird state
    source.adapter.setRotation(0);
    target.adapter.setRotation(0);

    // Restart idle animations
    controller.startIdle(source);
    controller.startIdle(target);

    // Reset wander timers so they pick new destinations naturally
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
