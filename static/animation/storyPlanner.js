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
 * If no hardcoded template matches, falls back to a GPT-generated live story
 * fetched by fetchSemanticStory() and cached in _semanticCache.
 *
 * Output: a StoryPlan object (or null if nothing matches)
 *
 * {
 *   id:           string          — template id
 *   template:     StoryTemplate   — the matched template (or synthetic for live stories)
 *   source:       SceneAgent      — the "a" role in the story
 *   target:       SceneAgent      — the "b" role in the story
 *   priority:     number
 *   distance:     number          — px between agents at planning time
 *   liveStory?:   object          — GPT story data when using live path
 * }
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { STORY_TEMPLATES } from './storyTemplates.js';

// ─── Cooldown store ───────────────────────────────────────────────────────────
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

// ─── Semantic story cache (Phase 2) ──────────────────────────────────────────
const _semanticCache   = new Map();   // pairKey → GPT story data
const _pendingFetches  = new Set();   // pairKeys currently in-flight

function _pairKey(a, b) {
  return [a.label, b.label].sort().join('__');
}

/**
 * Fetch (and cache) a GPT-generated live story for a pair of agents.
 * Safe to call multiple times — only one fetch per pair is ever in-flight.
 *
 * @param {SceneAgent} agentA
 * @param {SceneAgent} agentB
 * @returns {Promise<object|null>}
 */
export async function fetchSemanticStory(agentA, agentB) {
  const key = _pairKey(agentA, agentB);
  if (_semanticCache.has(key)) return _semanticCache.get(key);
  if (_pendingFetches.has(key)) return null;

  _pendingFetches.add(key);
  try {
    const res = await fetch('/api/live-story', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label_a:    agentA.label,
        category_a: agentA.category,
        tags_a:     [...agentA.tags],
        label_b:    agentB.label,
        category_b: agentB.category,
        tags_b:     [...agentB.tags],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _semanticCache.set(key, data);

    console.log(
      `[StoryPlanner] 🤖 "${agentA.label}" + "${agentB.label}":`,
      data.narrative
    );

    // Apply GPT behavioral overrides immediately so wander steers correctly.
    // Sort labels to consistently map behavior_a → alphabetically-first agent.
    const isAFirst = agentA.label.localeCompare(agentB.label) <= 0;
    const src = isAFirst ? agentA : agentB;
    const tgt = isAFirst ? agentB : agentA;
    if (data.behavior_a === 'stay' && !src.behaviorOverride) src.behaviorOverride = 'stay';
    if (data.behavior_b === 'stay' && !tgt.behaviorOverride) tgt.behaviorOverride = 'stay';

    return data;
  } catch (err) {
    console.warn(
      `[StoryPlanner] semantic fetch failed (${agentA.label}+${agentB.label}):`, err.message
    );
    return null;
  } finally {
    _pendingFetches.delete(key);
  }
}

// ─── Distance helper ─────────────────────────────────────────────────────────

function _dist(a, b) {
  const ac = a.getCenter(), bc = b.getCenter();
  return Math.hypot(bc.x - ac.x, bc.y - ac.y);
}

// ─── Plan scoring ─────────────────────────────────────────────────────────────

function _scorePlan(plan) {
  let score = plan.priority * 1000;
  score += Math.max(0, 500 - plan.distance * 2);
  score += ((plan.source.confidence || 1) + (plan.target.confidence || 1)) * 50;
  return score;
}

// ─── Live-story beat maps ─────────────────────────────────────────────────────

function _beatsFromInteractionType(type) {
  const BEAT_MAPS = {
    greet: [
      { type: 'noticeTarget',   actor: 'source', params: { duration: 400 } },
      { type: 'approachTarget', actor: 'source', params: { margin: 60, duration: 1000 } },
      { type: 'noticeTarget',   actor: 'target', params: { duration: 400 } },
      { type: 'happyBounce',    actor: 'source', params: { hops: 2, hopHeight: 15, duration: 600 } },
      { type: 'happyBounce',    actor: 'target', params: { hops: 2, hopHeight: 15, duration: 600 }, parallel: true },
      { type: 'returnToIdle',   actor: 'source', params: { duration: 700 } },
      { type: 'returnToIdle',   actor: 'target', params: { duration: 700 }, parallel: true },
    ],
    chase: [
      { type: 'noticeTarget',   actor: 'source', params: { duration: 400 } },
      { type: 'fleeFromTarget', actor: 'target', params: { fleeRange: 130, duration: 800 } },
      { type: 'chaseTarget',    actor: 'source', params: { margin: 50,  duration: 900 } },
      { type: 'fleeFromTarget', actor: 'target', params: { fleeRange: 150, duration: 900 } },
      { type: 'reactSurprise',  actor: 'source', params: { duration: 350 } },
      { type: 'returnToIdle',   actor: 'source', params: { duration: 700 } },
      { type: 'returnToIdle',   actor: 'target', params: { duration: 700 }, parallel: true },
    ],
    avoid: [
      { type: 'noticeTarget',   actor: 'source', params: { duration: 400 } },
      { type: 'fleeFromTarget', actor: 'source', params: { fleeRange: 160, duration: 900 } },
      { type: 'noticeTarget',   actor: 'target', params: { duration: 400 } },
      { type: 'returnToIdle',   actor: 'source', params: { duration: 700 } },
      { type: 'returnToIdle',   actor: 'target', params: { duration: 700 }, parallel: true },
    ],
    shelter: [
      { type: 'approachTarget',   actor: 'source', params: { margin: 55, duration: 1200 } },
      { type: 'orbitTarget',      actor: 'source', params: { radius: 60, turns: 1, duration: 2200 } },
      { type: 'reactWiggle',      actor: 'target', params: { duration: 600, amplitude: 5 } },
      { type: 'hideUnderShelter', actor: 'source', params: { duration: 900 } },
      { type: 'returnToIdle',     actor: 'source', params: { duration: 600 } },
      { type: 'returnToIdle',     actor: 'target', params: { duration: 600 }, parallel: true },
    ],
    walk_around: [
      { type: 'noticeTarget',   actor: 'source', params: { duration: 350 } },
      { type: 'approachTarget', actor: 'source', params: { margin: 70, duration: 1100 } },
      { type: 'orbitTarget',    actor: 'source', params: { radius: 75, turns: 1.5, duration: 3000 } },
      { type: 'reactWiggle',    actor: 'target', params: { duration: 500, amplitude: 4 } },
      { type: 'returnToIdle',   actor: 'source', params: { duration: 700 } },
      { type: 'returnToIdle',   actor: 'target', params: { duration: 700 }, parallel: true },
    ],
    admire: [
      { type: 'approachWithCurve', actor: 'source', params: { margin: 70, duration: 1200 } },
      { type: 'noticeTarget',      actor: 'source', params: { duration: 500 } },
      { type: 'pauseAndLook',      actor: 'source', params: { duration: 800 } },
      { type: 'growOrBloom',       actor: 'target', params: { duration: 1000, bloomAmplitude: 0.12 } },
      { type: 'returnToIdle',      actor: 'source', params: { duration: 700 } },
      { type: 'returnToIdle',      actor: 'target', params: { duration: 700 }, parallel: true },
    ],
    play: [
      { type: 'noticeTarget',   actor: 'source', params: { duration: 400 } },
      { type: 'approachTarget', actor: 'source', params: { margin: 55, duration: 900 } },
      { type: 'happyBounce',    actor: 'source', params: { hops: 3, hopHeight: 18, duration: 700 } },
      { type: 'reactBounce',    actor: 'target', params: { duration: 500 }, parallel: true },
      { type: 'reactWiggle',    actor: 'source', params: { duration: 400, amplitude: 10 } },
      { type: 'reactWiggle',    actor: 'target', params: { duration: 400, amplitude: 10 }, parallel: true },
      { type: 'returnToIdle',   actor: 'source', params: { duration: 700 } },
      { type: 'returnToIdle',   actor: 'target', params: { duration: 700 }, parallel: true },
    ],
    coexist: [
      { type: 'noticeTarget',   actor: 'source', params: { duration: 350 } },
      { type: 'approachTarget', actor: 'source', params: { margin: 70, duration: 900 } },
      { type: 'reactWiggle',    actor: 'source', params: { duration: 450, amplitude: 7 } },
      { type: 'reactWiggle',    actor: 'target', params: { duration: 600, amplitude: 8 }, parallel: true },
      { type: 'returnToIdle',   actor: 'source', params: { duration: 600 } },
      { type: 'returnToIdle',   actor: 'target', params: { duration: 600 }, parallel: true },
    ],
  };
  // Map similar GPT-returned types to our implemented beat sequences
  const ALIASES = {
    'walk around': 'walk_around', circle: 'walk_around', orbit: 'walk_around',
    rest: 'shelter', hide: 'shelter', shade: 'shelter',
    approach: 'greet', meet: 'greet',
    run: 'chase', flee: 'chase',
  };
  const resolved = ALIASES[type] ?? type;
  return BEAT_MAPS[resolved] || BEAT_MAPS.coexist;
}

function _buildSyntheticTemplate(key, storyData) {
  if (!storyData) return null;
  const beats = _beatsFromInteractionType(storyData.interaction_type || 'coexist');
  return {
    id:       `live__${key}`,
    priority: 3,
    radius:   480,      // expanded from 350 so beats fire before agents fully stop
    cooldown: 12000,
    match:    () => true,
    beats,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Find the best story plan for a list of agents.
 * Returns the single highest-scored plan, or null if nothing is valid.
 *
 * @param {SceneAgent[]} agents
 * @returns {StoryPlan|null}
 */
export function selectBestPlan(agents) {
  const candidates = [];

  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i], b = agents[j];

      if (a.state !== 'idle' || b.state !== 'idle') continue;

      const dist = _dist(a, b);
      let matched = false;

      // ── Fast path: hardcoded templates ─────────────────────────────────
      for (const template of STORY_TEMPLATES) {
        if (dist > template.radius) continue;
        if (_hasCooldown(template.id, a, b)) continue;

        let source = null, target = null;
        if      (template.match(a, b)) { source = a; target = b; }
        else if (template.match(b, a)) { source = b; target = a; }
        if (!source) continue;

        matched = true;
        const plan = { id: template.id, template, source, target, priority: template.priority, distance: dist };
        candidates.push({ plan, score: _scorePlan(plan) });
        break;
      }

      // ── Live-story fallback: use cached GPT result ──────────────────────
      if (!matched) {
        const key = _pairKey(a, b);
        if (_semanticCache.has(key) && !_hasCooldown(`live__${key}`, a, b)) {
          const storyData = _semanticCache.get(key);
          const syntheticTemplate = _buildSyntheticTemplate(key, storyData);
          if (syntheticTemplate && dist <= syntheticTemplate.radius) {
            const plan = {
              id:        `live__${key}`,
              template:  syntheticTemplate,
              source:    a,
              target:    b,
              priority:  3,
              distance:  dist,
              liveStory: storyData,
            };
            candidates.push({ plan, score: _scorePlan(plan) });
          }
        }
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].plan;
}

/**
 * Mark a plan's pair as on cooldown.
 * Called by storyRunner after a story completes.
 */
export function recordCooldown(plan) {
  _setCooldown(plan.id, plan.source, plan.target, plan.template.cooldown ?? 6000);
}

/**
 * Clear all cooldowns (useful for scene reset).
 */
export function clearAllCooldowns() {
  _templateCooldowns.clear();
}

/**
 * Clear the semantic story cache (useful on scene reset).
 */
export function clearSemanticCache() {
  _semanticCache.clear();
}
