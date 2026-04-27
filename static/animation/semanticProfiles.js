/**
 * semanticProfiles.js
 * ─────────────────────────────────────────────────────────────────────────────
 * CATEGORY-BASED animation system.
 *
 * The classify-sketch backend returns { category, label, description }.
 * category  → determines HOW the sketch moves (motion, tags, params)
 * label     → used only for: story narrative, color selection, display
 *
 * All categories are MOBILE so every pair of sketches will always approach
 * each other and trigger a story interaction.
 *
 * CATEGORY TAXONOMY (21 categories):
 *   land_animal      flying_animal    aquatic_animal   insect
 *   mythical         human_character  plant            celestial
 *   weather          food             vehicle_land     vehicle_air
 *   vehicle_water    built_structure  tool_object      instrument
 *   sports_object    clothing         nature_element   geometric
 *   electronic
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Category Defaults ────────────────────────────────────────────────────────
// Every category MUST have mobile:true so the wander engine drives agents
// toward each other, guaranteeing a story interaction every time.

export const CATEGORY_DEFAULTS = {

  // ── Animals ──────────────────────────────────────────────────────────────

  land_animal: {
    defaultMotion: 'walk_bounce',
    tags: ['animal', 'mobile', 'ground_based', 'living'],
    motionParams: { travelRange: 70, speed: 0.4, bounceHeight: 8 },
  },

  flying_animal: {
    defaultMotion: 'flutter',
    tags: ['animal', 'mobile', 'flying', 'living'],
    motionParams: { amplitude: 35, speed: 0.55 },
  },

  aquatic_animal: {
    defaultMotion: 'swim',
    tags: ['animal', 'mobile', 'swimming', 'living', 'water_creature'],
    motionParams: { amplitude: 50, speed: 0.35 },
  },

  insect: {
    defaultMotion: 'zigzag_fly',
    tags: ['animal', 'mobile', 'flying', 'living', 'small'],
    motionParams: { amplitude: 25, speed: 0.7 },
  },

  mythical: {
    defaultMotion: 'flutter',
    tags: ['creature', 'mobile', 'flying', 'living', 'magical'],
    motionParams: { amplitude: 40, speed: 0.5 },
  },

  human_character: {
    defaultMotion: 'walk_bounce',
    tags: ['character', 'mobile', 'ground_based', 'living'],
    motionParams: { walkSpeed: 60, bounceHeight: 8, stepFreq: 2.0 },
  },

  // ── Nature ────────────────────────────────────────────────────────────────

  plant: {
    defaultMotion: 'sway_bloom',
    tags: ['plant', 'mobile', 'living', 'rooted', 'sways'],
    motionParams: { amplitude: 9, speed: 0.5, bloomAmplitude: 0.06, bloomSpeed: 0.8 },
  },

  celestial: {
    defaultMotion: 'slow_spin',
    tags: ['celestial', 'mobile', 'floating', 'sky_object'],
    motionParams: { amplitude: 3, speed: 0.15 },
  },

  weather: {
    defaultMotion: 'drift',
    tags: ['weather', 'mobile', 'floating', 'sky_object', 'affects_scene'],
    motionParams: { speed: 0.25 },
  },

  nature_element: {
    defaultMotion: 'drift',
    tags: ['nature', 'mobile', 'floating'],
    motionParams: { speed: 0.2 },
  },

  // ── Food ─────────────────────────────────────────────────────────────────

  food: {
    defaultMotion: 'walk_bounce',
    tags: ['food', 'mobile', 'ground_based', 'attractor'],
    motionParams: { travelRange: 55, speed: 0.38, bounceHeight: 7 },
  },

  // ── Vehicles ──────────────────────────────────────────────────────────────

  vehicle_land: {
    defaultMotion: 'drive',
    tags: ['vehicle', 'mobile', 'ground_based'],
    motionParams: { speed: 0.35 },
  },

  vehicle_air: {
    defaultMotion: 'zigzag_fly',
    tags: ['vehicle', 'mobile', 'flying'],
    motionParams: { amplitude: 30, speed: 0.45 },
  },

  vehicle_water: {
    defaultMotion: 'swim',
    tags: ['vehicle', 'mobile', 'swimming'],
    motionParams: { amplitude: 40, speed: 0.3 },
  },

  // ── Objects ───────────────────────────────────────────────────────────────

  built_structure: {
    defaultMotion: 'subtle_wiggle',
    tags: ['structure', 'mobile', 'ground_based', 'large'],
    motionParams: { amplitude: 3, speed: 0.3 },
  },

  tool_object: {
    defaultMotion: 'walk_bounce',
    tags: ['tool', 'mobile', 'ground_based', 'object'],
    motionParams: { travelRange: 60, speed: 0.4, bounceHeight: 6 },
  },

  instrument: {
    defaultMotion: 'walk_bounce',
    tags: ['instrument', 'mobile', 'ground_based', 'object'],
    motionParams: { travelRange: 55, speed: 0.35, bounceHeight: 5 },
  },

  sports_object: {
    defaultMotion: 'walk_bounce',
    tags: ['sports', 'mobile', 'ground_based', 'object'],
    motionParams: { travelRange: 65, speed: 0.5, bounceHeight: 12 },
  },

  clothing: {
    defaultMotion: 'flutter',
    tags: ['clothing', 'mobile', 'floating', 'object'],
    motionParams: { amplitude: 20, speed: 0.45 },
  },

  geometric: {
    defaultMotion: 'walk_bounce',
    tags: ['geometric', 'mobile', 'ground_based', 'abstract'],
    motionParams: { travelRange: 70, speed: 0.45, bounceHeight: 8 },
  },

  electronic: {
    defaultMotion: 'walk_bounce',
    tags: ['electronic', 'mobile', 'ground_based', 'object'],
    motionParams: { travelRange: 50, speed: 0.3, bounceHeight: 4 },
  },

  // ── Generic catch-alls (always mobile) ───────────────────────────────────

  object: {
    defaultMotion: 'walk_bounce',
    tags: ['object', 'mobile', 'ground_based', 'reactive'],
    motionParams: { travelRange: 60, speed: 0.4, bounceHeight: 6 },
  },

  abstract_unknown: {
    defaultMotion: 'walk_bounce',
    tags: ['unknown', 'mobile', 'ground_based', 'reactive'],
    motionParams: { travelRange: 60, speed: 0.4, bounceHeight: 6 },
  },
};


// ─── Resolve Profile ─────────────────────────────────────────────────────────

/**
 * Resolve a full semantic profile from a recognition result.
 * Uses CATEGORY as the primary key — label lookup is intentionally removed
 * so the system is purely category-driven.
 *
 * @param {{ label?: string, category?: string }} recog
 * @returns {{ category, defaultMotion, tags, motionParams }}
 */
export function resolveProfile(recog) {
  const category = (recog.category || '').toLowerCase().trim()
    // Normalise common GPT variations to our canonical IDs
    .replace(/^ground.animal$/, 'land_animal')
    .replace(/^air.animal$|^aerial.animal$/, 'flying_animal')
    .replace(/^water.animal$|^sea.animal$/, 'aquatic_animal')
    .replace(/^bug$|^bugs$/, 'insect')
    .replace(/^mythical.creature$|^fantasy$/, 'mythical')
    .replace(/^person$|^human$|^character$/, 'human_character')
    .replace(/^sky$|^sky.object$/, 'celestial')
    .replace(/^nature$/, 'nature_element')
    .replace(/^vehicle$/, 'vehicle_land')
    .replace(/^aircraft$|^air.vehicle$/, 'vehicle_air')
    .replace(/^watercraft$|^boat$/, 'vehicle_water')
    .replace(/^building$|^structure$/, 'built_structure')
    .replace(/^tool$/, 'tool_object')
    .replace(/^music.instrument$|^musical.instrument$|^music$/, 'instrument')
    .replace(/^sport$|^sports$|^sports.equipment$/, 'sports_object')
    .replace(/^shape$|^abstract$/, 'geometric')
    .replace(/^tech$|^technology$|^device$/, 'electronic');

  if (CATEGORY_DEFAULTS[category]) {
    return { category, ...CATEGORY_DEFAULTS[category] };
  }

  // Ultimate fallback — still mobile so interaction always happens
  return { category: 'abstract_unknown', ...CATEGORY_DEFAULTS.abstract_unknown };
}
