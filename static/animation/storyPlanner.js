/**
 * storyPlanner.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Selects the best story plan for a given pair of scene agents.
 *
 * Selection priority:
 *   1. Highest template.priority where match(a, b) OR match(b, a) is true
 *   2. Within same priority: prefer shorter distance between agents
 *   3. Both agents must be in 'idle' state (not already in a story)
 *   4. The pair must not be on cooldown for this template
 *   5. Distance must be ≤ template.radius
 *
 * Output: a StoryPlan object (or null if nothing matches)
 *
 * {
 *   id:           string          — template id
 *   template:     StoryTemplate   — the matched template
 *   source:       SceneAgent      — the "a" role in the story
 *   target:       SceneAgent      — the "b" role in the story
 *   priority:     number
 *   distance:     number          — px between agents at planning time
 * }
 *
 * HOW TO EXTEND:
 *   - Add new templates to storyTemplates.js — the planner picks them up automatically.
 *   - To adjust scoring, modify _scorePlan() below.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { STORY_TEMPLATES } from './storyTemplates.js';

// ─── Cooldown store ───────────────────────────────────────────────────────────
// Maps "templateId:agentId1:agentId2" → expiry timestamp
const _templateCooldowns = new Map();

function _cooldownKey(templateId, id1, id2) {
  return `${templateId}:${[id1, id2].sort().join(':')}`;
}

function _hasCooldown(templateId, a, b) {
  const key = _cooldownKey(templateId, a.id, b.id);
  const exp = _templateCooldowns.get(key);
  return !!exp && Date.now() < exp;
}

function _setCooldown(templateId, a, b, ms) {
  const key = _cooldownKey(templateId, a.id, b.id);
  _templateCooldowns.set(key, Date.now() + ms);
}

// ─── Distance helper ─────────────────────────────────────────────────────────

function _dist(a, b) {
  const ac = a.getCenter();
  const bc = b.getCenter();
  return Math.hypot(bc.x - ac.x, bc.y - ac.y);
}

// ─── Plan scoring ─────────────────────────────────────────────────────────────
// Higher score = preferred plan.

function _scorePlan(plan) {
  // Primary: template priority (0–100 range expected)
  let score = plan.priority * 1000;
  // Secondary: closer agents score higher (max bonus ~500)
  score += Math.max(0, 500 - plan.distance * 2);
  // Bonus: higher combined confidence
  score += ((plan.source.confidence || 1) + (plan.target.confidence || 1)) * 50;
  return score;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Find the best story plan for a list of agents.
 * Called once per engine tick; returns the single highest-scored plan,
 * or null if nothing is valid.
 *
 * @param {SceneAgent[]} agents
 * @returns {StoryPlan|null}
 */
export function selectBestPlan(agents) {
  const candidates = [];

  // Check every pair
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i];
      const b = agents[j];

      // Both must be idle
      if (a.state !== 'idle' || b.state !== 'idle') continue;

      const dist = _dist(a, b);

      // Try every template for this pair (in both directions)
      for (const template of STORY_TEMPLATES) {
        if (dist > template.radius) continue;
        if (_hasCooldown(template.id, a, b)) continue;

        let source = null, target = null;

        if (template.match(a, b)) {
          source = a; target = b;
        } else if (template.match(b, a)) {
          source = b; target = a;
        }

        if (!source) continue;

        const plan = {
          id:       template.id,
          template,
          source,
          target,
          priority: template.priority,
          distance: dist,
        };

        candidates.push({ plan, score: _scorePlan(plan) });
        break; // only one template per pair per tick — take the first match (sorted by priority)
      }
    }
  }

  if (candidates.length === 0) return null;

  // Return the highest-scored plan
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].plan;
}

/**
 * Mark a plan's pair as on cooldown so the same story doesn't replay immediately.
 * Called by storyRunner after a story completes.
 */
export function recordCooldown(plan) {
  _setCooldown(plan.id, plan.source, plan.target, plan.template.cooldown ?? 6000);
}

/**
 * Clear all cooldowns (useful for testing / resetting the scene).
 */
export function clearAllCooldowns() {
  _templateCooldowns.clear();
}
