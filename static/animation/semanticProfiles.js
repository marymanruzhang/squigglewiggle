/**
 * semanticProfiles.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Maps every recognized sketch label to a semantic profile:
 *   { label, category, defaultMotion, tags, motionParams }
 *
 * HOW TO ADD A NEW LABEL:
 *   Add an entry to PROFILES below.
 *   Pick a category from CATEGORY_DEFAULTS, choose a defaultMotion from
 *   motionPresets, and assign behavior tags.
 *
 * HOW TO ADD A NEW CATEGORY:
 *   Add an entry to CATEGORY_DEFAULTS with a defaultMotion and base tags,
 *   then reference it in PROFILES entries.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Category-level defaults ──────────────────────────────────────────────────
// Used as fallback when a label is known but its full profile is missing,
// or when only a category (not a label) is returned by recognition.

export const CATEGORY_DEFAULTS = {
  plant: {
    defaultMotion: 'sway',
    tags: ['plant', 'rooted', 'sways'],
    motionParams: { amplitude: 7, speed: 0.45 },
  },
  ground_animal: {
    defaultMotion: 'walk_bounce',
    tags: ['animal', 'mobile', 'ground_based'],
    motionParams: { travelRange: 70, speed: 0.4, bounceHeight: 7 },
  },
  flying_animal: {
    defaultMotion: 'hover',
    tags: ['animal', 'mobile', 'flying'],
    motionParams: { hoverHeight: 6, speed: 0.5 },
  },
  water_creature: {
    defaultMotion: 'swim',
    tags: ['animal', 'mobile', 'swimming', 'water_creature'],
    motionParams: { amplitude: 50, speed: 0.35 },
  },
  weather: {
    defaultMotion: 'drift',
    tags: ['weather', 'affects_scene'],
    motionParams: { speed: 0.2 },
  },
  celestial_light: {
    defaultMotion: 'pulse',
    tags: ['celestial', 'sky_object'],
    motionParams: { amplitude: 0.06, speed: 0.6 },
  },
  landscape_water: {
    defaultMotion: 'wave',
    tags: ['environment', 'water_zone', 'landscape'],
    motionParams: { amplitude: 8, speed: 0.5 },
  },
  vehicle: {
    defaultMotion: 'drive',
    tags: ['vehicle', 'mobile'],
    motionParams: { speed: 0.3 },
  },
  built_object: {
    defaultMotion: 'subtle_wiggle',
    tags: ['built_object', 'mostly_static'],
    motionParams: { amplitude: 1.5, speed: 0.3 },
  },
  abstract_unknown: {
    defaultMotion: 'wiggle',
    tags: ['unknown', 'fallback', 'reactive'],
    motionParams: { amplitude: 5, speed: 0.8 },
  },
  human_character: {
    defaultMotion: 'walk_bounce',
    tags: ['animal', 'mobile', 'ground_based', 'character'],
    motionParams: { travelRange: 60, speed: 0.35 },
  },
  food_attractor: {
    defaultMotion: 'pulse',
    tags: ['food', 'attractor', 'mostly_static'],
    motionParams: { amplitude: 0.07, speed: 1.0 },
  },
};


// ─── Full label profiles ───────────────────────────────────────────────────────
// Each entry overrides or extends the category default.
// motionParams here are merged on top of the category-level motionParams.

export const PROFILES = {

  // ── Plants ─────────────────────────────────────────────────────────────────

  flower: {
    category: 'plant',
    defaultMotion: 'sway_bloom',
    tags: ['plant', 'rooted', 'sways', 'bloomable', 'attracts_pollinators', 'affected_by_weather'],
    motionParams: { amplitude: 8, speed: 0.5, bloomAmplitude: 0.07, bloomSpeed: 0.8 },
  },
  tree: {
    category: 'plant',
    defaultMotion: 'slow_sway',
    tags: ['plant', 'rooted', 'sways', 'shelter', 'obstacle', 'affected_by_weather'],
    motionParams: { amplitude: 5, speed: 0.3 },
  },
  grass: {
    category: 'plant',
    defaultMotion: 'wave',
    tags: ['plant', 'rooted', 'sways', 'affected_by_weather'],
    motionParams: { amplitude: 10, speed: 0.6 },
  },
  bush: {
    category: 'plant',
    defaultMotion: 'sway',
    tags: ['plant', 'rooted', 'sways', 'shelter', 'affected_by_weather'],
    motionParams: { amplitude: 6, speed: 0.45 },
  },
  cactus: {
    category: 'plant',
    defaultMotion: 'subtle_wiggle',
    tags: ['plant', 'rooted', 'obstacle'],
    motionParams: { amplitude: 2, speed: 0.3 },
  },
  mushroom: {
    category: 'plant',
    defaultMotion: 'subtle_wiggle',
    tags: ['plant', 'rooted', 'food'],
    motionParams: { amplitude: 2, speed: 0.4 },
  },
  'house plant': {
    category: 'plant',
    defaultMotion: 'sway',
    tags: ['plant', 'rooted', 'sways', 'affected_by_weather'],
    motionParams: { amplitude: 6, speed: 0.4 },
  },
  leaf: {
    category: 'plant',
    defaultMotion: 'flutter',
    tags: ['plant', 'sways', 'affected_by_weather'],
    motionParams: { xFreq: 0.4, yFreq: 0.7, xAmp: 12, yAmp: 8 },
  },

  // ── Ground animals ─────────────────────────────────────────────────────────

  sheep: {
    category: 'ground_animal',
    defaultMotion: 'walk_bounce',
    tags: ['animal', 'mobile', 'ground_based', 'herbivore', 'curious'],
    motionParams: { travelRange: 75, speed: 0.35, bounceHeight: 6 },
  },
  rabbit: {
    category: 'ground_animal',
    defaultMotion: 'hop',
    tags: ['animal', 'mobile', 'ground_based', 'herbivore', 'prey', 'curious'],
    motionParams: { hopHeight: 22, hopSpeed: 0.7, travelRange: 55 },
  },
  dog: {
    category: 'ground_animal',
    defaultMotion: 'walk_bounce',
    tags: ['animal', 'mobile', 'ground_based', 'predator', 'pet', 'curious'],
    motionParams: { travelRange: 90, speed: 0.45, bounceHeight: 8 },
  },
  cat: {
    category: 'ground_animal',
    defaultMotion: 'prowl',
    tags: ['animal', 'mobile', 'ground_based', 'predator', 'pet', 'curious'],
    motionParams: { travelRange: 70, speed: 0.3 },
  },
  cow: {
    category: 'ground_animal',
    defaultMotion: 'slow_walk',
    tags: ['animal', 'mobile', 'ground_based', 'herbivore'],
    motionParams: { travelRange: 60, speed: 0.22, bounceHeight: 4 },
  },
  horse: {
    category: 'ground_animal',
    defaultMotion: 'walk_bounce',
    tags: ['animal', 'mobile', 'ground_based', 'herbivore'],
    motionParams: { travelRange: 100, speed: 0.5, bounceHeight: 10 },
  },
  mouse: {
    category: 'ground_animal',
    defaultMotion: 'scurry',
    tags: ['animal', 'mobile', 'ground_based', 'prey'],
    motionParams: { travelRange: 45, speed: 1.1, bounceHeight: 4 },
  },
  frog: {
    category: 'ground_animal',
    defaultMotion: 'hop',
    tags: ['animal', 'mobile', 'ground_based', 'prey', 'water_creature'],
    motionParams: { hopHeight: 28, hopSpeed: 0.55, travelRange: 60 },
  },
  kangaroo: {
    category: 'ground_animal',
    defaultMotion: 'hop',
    tags: ['animal', 'mobile', 'ground_based', 'herbivore'],
    motionParams: { hopHeight: 35, hopSpeed: 0.6, travelRange: 80 },
  },
  elephant: {
    category: 'ground_animal',
    defaultMotion: 'slow_walk',
    tags: ['animal', 'mobile', 'ground_based', 'herbivore', 'obstacle'],
    motionParams: { travelRange: 50, speed: 0.18, bounceHeight: 5 },
  },
  bear: {
    category: 'ground_animal',
    defaultMotion: 'walk_bounce',
    tags: ['animal', 'mobile', 'ground_based', 'predator'],
    motionParams: { travelRange: 70, speed: 0.3, bounceHeight: 7 },
  },
  lion: {
    category: 'ground_animal',
    defaultMotion: 'prowl',
    tags: ['animal', 'mobile', 'ground_based', 'predator'],
    motionParams: { travelRange: 90, speed: 0.35 },
  },
  tiger: {
    category: 'ground_animal',
    defaultMotion: 'prowl',
    tags: ['animal', 'mobile', 'ground_based', 'predator'],
    motionParams: { travelRange: 90, speed: 0.38 },
  },
  giraffe: {
    category: 'ground_animal',
    defaultMotion: 'slow_walk',
    tags: ['animal', 'mobile', 'ground_based', 'herbivore'],
    motionParams: { travelRange: 60, speed: 0.2, bounceHeight: 3 },
  },

  // ── Flying animals ─────────────────────────────────────────────────────────

  bee: {
    category: 'flying_animal',
    defaultMotion: 'hover',
    tags: ['animal', 'mobile', 'flying', 'hovering', 'pollinator', 'can_orbit'],
    motionParams: { hoverHeight: 5, speed: 0.8, xDrift: 6 },
  },
  butterfly: {
    category: 'flying_animal',
    defaultMotion: 'flutter',
    tags: ['animal', 'mobile', 'flying', 'pollinator', 'can_orbit'],
    motionParams: { xFreq: 0.3, yFreq: 0.55, xAmp: 35, yAmp: 20 },
  },
  bird: {
    category: 'flying_animal',
    defaultMotion: 'fly',
    tags: ['animal', 'mobile', 'flying', 'can_land'],
    motionParams: { xAmp: 80, yAmp: 18, speed: 0.4 },
  },
  bat: {
    category: 'flying_animal',
    defaultMotion: 'zigzag_fly',
    tags: ['animal', 'mobile', 'flying', 'night'],
    motionParams: { xAmp: 70, yAmp: 25, speed: 0.7 },
  },
  owl: {
    category: 'flying_animal',
    defaultMotion: 'hover',
    tags: ['animal', 'mobile', 'flying', 'predator', 'can_land'],
    motionParams: { hoverHeight: 4, speed: 0.4, xDrift: 8 },
  },
  parrot: {
    category: 'flying_animal',
    defaultMotion: 'flutter',
    tags: ['animal', 'mobile', 'flying', 'can_land'],
    motionParams: { xFreq: 0.4, yFreq: 0.65, xAmp: 30, yAmp: 15 },
  },
  duck: {
    category: 'flying_animal',
    defaultMotion: 'fly',
    tags: ['animal', 'mobile', 'flying', 'water_creature', 'can_land'],
    motionParams: { xAmp: 60, yAmp: 12, speed: 0.35 },
  },
  mosquito: {
    category: 'flying_animal',
    defaultMotion: 'zigzag_fly',
    tags: ['animal', 'mobile', 'flying', 'hovering'],
    motionParams: { xAmp: 40, yAmp: 30, speed: 1.0 },
  },
  dragon: {
    category: 'flying_animal',
    defaultMotion: 'fly',
    tags: ['animal', 'mobile', 'flying', 'predator'],
    motionParams: { xAmp: 100, yAmp: 25, speed: 0.45 },
  },

  // ── Water creatures ─────────────────────────────────────────────────────────

  fish: {
    category: 'water_creature',
    defaultMotion: 'swim',
    tags: ['animal', 'mobile', 'swimming', 'water_creature', 'prey', 'needs_water'],
    motionParams: { amplitude: 55, speed: 0.4, leanAngle: 8 },
  },
  whale: {
    category: 'water_creature',
    defaultMotion: 'slow_swim',
    tags: ['animal', 'mobile', 'swimming', 'water_creature'],
    motionParams: { amplitude: 40, speed: 0.22, leanAngle: 5 },
  },
  jellyfish: {
    category: 'water_creature',
    defaultMotion: 'pulse_float',
    tags: ['animal', 'mobile', 'floating', 'water_creature'],
    motionParams: { pulseAmp: 0.12, floatHeight: 10, speed: 0.5 },
  },
  crab: {
    category: 'water_creature',
    defaultMotion: 'side_shuffle',
    tags: ['animal', 'mobile', 'water_creature'],
    motionParams: { speed: 0.9, range: 50 },
  },
  shark: {
    category: 'water_creature',
    defaultMotion: 'swim',
    tags: ['animal', 'mobile', 'swimming', 'water_creature', 'predator'],
    motionParams: { amplitude: 70, speed: 0.45, leanAngle: 10 },
  },
  dolphin: {
    category: 'water_creature',
    defaultMotion: 'swim',
    tags: ['animal', 'mobile', 'swimming', 'water_creature'],
    motionParams: { amplitude: 60, speed: 0.5, leanAngle: 12 },
  },
  'sea turtle': {
    category: 'water_creature',
    defaultMotion: 'slow_swim',
    tags: ['animal', 'mobile', 'swimming', 'water_creature'],
    motionParams: { amplitude: 35, speed: 0.2, leanAngle: 4 },
  },
  octopus: {
    category: 'water_creature',
    defaultMotion: 'pulse_float',
    tags: ['animal', 'mobile', 'swimming', 'water_creature'],
    motionParams: { pulseAmp: 0.1, floatHeight: 12, speed: 0.4 },
  },

  // ── Weather ────────────────────────────────────────────────────────────────

  cloud: {
    category: 'weather',
    defaultMotion: 'drift',
    tags: ['weather', 'floating', 'rain_source', 'sky_object', 'affects_scene'],
    motionParams: { speed: 0.18, range: 120 },
  },
  rain: {
    category: 'weather',
    defaultMotion: 'fall',
    tags: ['weather', 'rain_source', 'water', 'affects_scene'],
    motionParams: { fallSpeed: 2.5, resetY: -20 },
  },
  snow: {
    category: 'weather',
    defaultMotion: 'fall_slow',
    tags: ['weather', 'cold_source', 'affects_scene'],
    motionParams: { fallSpeed: 0.8, drift: 5 },
  },
  wind: {
    category: 'weather',
    defaultMotion: 'drift',
    tags: ['weather', 'wind_source', 'affects_scene'],
    motionParams: { speed: 0.5, range: 200 },
  },
  lightning: {
    category: 'weather',
    defaultMotion: 'flash',
    tags: ['weather', 'storm_source', 'affects_scene'],
    motionParams: { flashDuration: 80, pauseDuration: 1400 },
  },
  tornado: {
    category: 'weather',
    defaultMotion: 'drift',
    tags: ['weather', 'wind_source', 'affects_scene'],
    motionParams: { speed: 0.6, range: 180 },
  },

  // ── Celestial / light ──────────────────────────────────────────────────────

  sun: {
    category: 'celestial_light',
    defaultMotion: 'pulse',
    tags: ['celestial', 'light_source', 'warmth_source', 'sky_object', 'affects_scene'],
    motionParams: { amplitude: 0.08, speed: 0.55 },
  },
  moon: {
    category: 'celestial_light',
    defaultMotion: 'slow_sway',
    tags: ['celestial', 'night_source', 'sky_object', 'floating'],
    motionParams: { amplitude: 4, speed: 0.25 },
  },
  star: {
    category: 'celestial_light',
    defaultMotion: 'twinkle',
    tags: ['celestial', 'light_source', 'sky_object', 'floating'],
    motionParams: { opacityMin: 0.55, opacityMax: 1.0, speed: 1.1 },
  },
  rainbow: {
    category: 'celestial_light',
    defaultMotion: 'shimmer',
    tags: ['celestial', 'sky_object', 'light_source'],
    motionParams: { opacityMin: 0.6, opacityMax: 1.0, speed: 0.4 },
  },

  // ── Landscape / water ──────────────────────────────────────────────────────

  river: {
    category: 'landscape_water',
    defaultMotion: 'flow',
    tags: ['environment', 'water_zone', 'habitat', 'landscape'],
    motionParams: { speed: 0.5 },
  },
  ocean: {
    category: 'landscape_water',
    defaultMotion: 'wave',
    tags: ['environment', 'water_zone', 'habitat', 'landscape'],
    motionParams: { amplitude: 10, speed: 0.4 },
  },
  pond: {
    category: 'landscape_water',
    defaultMotion: 'ripple',
    tags: ['environment', 'water_zone', 'habitat', 'landscape'],
    motionParams: { amplitude: 0.06, speed: 0.5 },
  },
  mountain: {
    category: 'landscape_water',
    defaultMotion: 'static',
    tags: ['environment', 'terrain', 'obstacle', 'landscape'],
    motionParams: {},
  },
  rock: {
    category: 'landscape_water',
    defaultMotion: 'static',
    tags: ['environment', 'terrain', 'obstacle'],
    motionParams: {},
  },

  // ── Vehicles ───────────────────────────────────────────────────────────────

  car: {
    category: 'vehicle',
    defaultMotion: 'drive',
    tags: ['vehicle', 'mobile', 'ground_vehicle'],
    motionParams: { speed: 0.35, range: 140 },
  },
  boat: {
    category: 'vehicle',
    defaultMotion: 'float',
    tags: ['vehicle', 'mobile', 'water_vehicle'],
    motionParams: { amplitude: 6, speed: 0.3 },
  },
  airplane: {
    category: 'vehicle',
    defaultMotion: 'fly_across',
    tags: ['vehicle', 'mobile', 'flying_vehicle'],
    motionParams: { speed: 0.5, yArc: 15 },
  },
  rocket: {
    category: 'vehicle',
    defaultMotion: 'fly_across',
    tags: ['vehicle', 'mobile', 'flying_vehicle', 'fast'],
    motionParams: { speed: 0.9, yArc: 40 },
  },
  helicopter: {
    category: 'vehicle',
    defaultMotion: 'hover',
    tags: ['vehicle', 'mobile', 'flying_vehicle'],
    motionParams: { hoverHeight: 8, speed: 0.4, xDrift: 15 },
  },
  bicycle: {
    category: 'vehicle',
    defaultMotion: 'drive',
    tags: ['vehicle', 'mobile', 'ground_vehicle'],
    motionParams: { speed: 0.3, range: 100 },
  },

  // ── Built objects ──────────────────────────────────────────────────────────

  house: {
    category: 'built_object',
    defaultMotion: 'subtle_wiggle',
    tags: ['built_object', 'shelter', 'mostly_static'],
    motionParams: { amplitude: 1.5, speed: 0.3 },
  },
  umbrella: {
    category: 'built_object',
    defaultMotion: 'open_close',
    tags: ['built_object', 'shelter', 'rain_reactive', 'mostly_static'],
    motionParams: { openScale: 1.08, speed: 0.35 },
  },
  cup: {
    category: 'built_object',
    defaultMotion: 'tilt',
    tags: ['built_object', 'container', 'mostly_static'],
    motionParams: { tiltAngle: 8, speed: 0.4 },
  },
  tent: {
    category: 'built_object',
    defaultMotion: 'subtle_wiggle',
    tags: ['built_object', 'shelter', 'mostly_static'],
    motionParams: { amplitude: 1.2, speed: 0.25 },
  },
  barn: {
    category: 'built_object',
    defaultMotion: 'subtle_wiggle',
    tags: ['built_object', 'shelter', 'mostly_static'],
    motionParams: { amplitude: 1.0, speed: 0.2 },
  },

  // ── Food attractors ────────────────────────────────────────────────────────

  apple: {
    category: 'food_attractor',
    defaultMotion: 'pulse',
    tags: ['food', 'attractor', 'fruit'],
    motionParams: { amplitude: 0.06, speed: 0.9 },
  },
  strawberry: {
    category: 'food_attractor',
    defaultMotion: 'pulse',
    tags: ['food', 'attractor', 'fruit'],
    motionParams: { amplitude: 0.06, speed: 1.0 },
  },
  carrot: {
    category: 'food_attractor',
    defaultMotion: 'subtle_wiggle',
    tags: ['food', 'attractor', 'vegetable'],
    motionParams: { amplitude: 2, speed: 0.5 },
  },
  banana: {
    category: 'food_attractor',
    defaultMotion: 'tilt',
    tags: ['food', 'attractor', 'fruit'],
    motionParams: { tiltAngle: 10, speed: 0.4 },
  },

  // ── Abstract / unknown ─────────────────────────────────────────────────────

  heart: {
    category: 'abstract_unknown',
    defaultMotion: 'pulse',
    tags: ['abstract', 'emotional', 'reactive'],
    motionParams: { amplitude: 0.12, speed: 1.1 },
  },
  spiral: {
    category: 'abstract_unknown',
    defaultMotion: 'rotate',
    tags: ['abstract', 'reactive'],
    motionParams: { speed: 0.5 },
  },
  blob: {
    category: 'abstract_unknown',
    defaultMotion: 'squish',
    tags: ['abstract', 'reactive'],
    motionParams: { amplitude: 0.14, speed: 0.7 },
  },
  star_shape: {
    category: 'abstract_unknown',
    defaultMotion: 'twinkle',
    tags: ['abstract', 'reactive'],
    motionParams: { opacityMin: 0.6, opacityMax: 1.0, speed: 1.2 },
  },
  unknown: {
    category: 'abstract_unknown',
    defaultMotion: 'wiggle',
    tags: ['unknown', 'fallback', 'reactive'],
    motionParams: { amplitude: 5, speed: 0.8 },
  },
};


// ─── Lookup helpers ───────────────────────────────────────────────────────────

/**
 * Resolve a full semantic profile from a recognition result.
 * Falls back to category default, then abstract_unknown.
 *
 * @param {{ label?: string, category?: string, confidence?: number }} recog
 * @returns {{ category, defaultMotion, tags, motionParams }}
 */
export function resolveProfile(recog) {
  const label    = (recog.label    || '').toLowerCase().trim();
  const category = (recog.category || '').toLowerCase().trim();

  // 1. Exact label match
  if (label && PROFILES[label]) {
    return { ...PROFILES[label] };
  }

  // 2. Label fuzzy match (handle slight variations e.g. "House Plant" → "house plant")
  const fuzzyKey = Object.keys(PROFILES).find(k => k.replace(/\s/g, '') === label.replace(/\s/g, ''));
  if (fuzzyKey) return { ...PROFILES[fuzzyKey] };

  // 3. Category-level fallback
  if (category && CATEGORY_DEFAULTS[category]) {
    return {
      category,
      ...CATEGORY_DEFAULTS[category],
    };
  }

  // 4. Ultimate fallback
  return {
    category: 'abstract_unknown',
    ...CATEGORY_DEFAULTS.abstract_unknown,
  };
}
