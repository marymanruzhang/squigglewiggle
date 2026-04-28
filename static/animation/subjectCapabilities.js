/**
 * subjectCapabilities.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for what each sketch subject can physically / narratively do.
 *
 * Used by:
 *   storyPlanner.js  → beat substitution  (replace impossible beats)
 *   storyRunner.js   → narrative text     (pick the right verb for each subject)
 *   app.py           → GPT prompts        (Python mirror dict in app.py)
 *
 * Capability flags:
 *   can_blossom  – can grow, bloom, open (flowers, plants, trees)
 *   can_glow     – can light up, shimmer (buildings, stars, sun, moon, lantern)
 *   can_bounce   – can hop/jump with joy (animals, characters, insects)
 *   can_flee     – can run away deliberately (any animate creature)
 *   can_chase    – can pursue deliberately (predatory / playful animals)
 *   can_sway     – can sway / wiggle passively (plants, clouds, flags)
 *   can_swim     – moves through water (fish, whale, dolphin, octopus)
 *   is_static    – cannot relocate by own choice (building, mountain, rock)
 *   is_animate   – has agency, makes its own decisions (animals, people, insects)
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── By broad category ────────────────────────────────────────────────────────
const CATEGORY_CAPS = {
  plant:      ['can_sway', 'can_blossom', 'is_static'],
  nature:     ['can_sway', 'can_blossom', 'is_static'],
  animal:     ['can_bounce', 'can_flee', 'can_chase', 'is_animate'],
  insect:     ['can_bounce', 'can_flee', 'is_animate'],
  bird:       ['can_bounce', 'can_flee', 'is_animate'],
  fish:       ['can_flee', 'can_swim', 'is_animate'],
  'sea creature': ['can_flee', 'can_swim', 'is_animate'],
  marine:     ['can_flee', 'can_swim', 'is_animate'],
  character:  ['can_bounce', 'can_flee', 'is_animate'],
  people:     ['can_bounce', 'can_flee', 'is_animate'],
  person:     ['can_bounce', 'can_flee', 'is_animate'],
  cosmic:     ['can_glow', 'can_sway'],
  weather:    ['can_sway'],
  celestial:  ['can_glow', 'can_sway'],
  vehicle:    ['is_static'],
  building:   ['is_static', 'can_glow'],
  object:     ['can_sway'],
  food:       ['can_sway'],
  landscape:  ['is_static', 'can_sway'],
};

// ── By specific label (overrides / augments category) ────────────────────────
const LABEL_CAPS = {
  // ── Plants / nature ─────────────────────────────────────────────────────
  flower:     ['can_sway', 'can_blossom', 'is_static'],
  rose:       ['can_sway', 'can_blossom', 'is_static'],
  tulip:      ['can_sway', 'can_blossom', 'is_static'],
  daisy:      ['can_sway', 'can_blossom', 'is_static'],
  sunflower:  ['can_sway', 'can_blossom', 'is_static'],
  lotus:      ['can_sway', 'can_blossom', 'is_static'],
  blossom:    ['can_sway', 'can_blossom', 'is_static'],
  tree:       ['can_sway', 'can_blossom', 'is_static'],
  bush:       ['can_sway', 'can_blossom', 'is_static'],
  plant:      ['can_sway', 'can_blossom', 'is_static'],
  cactus:     ['can_sway', 'is_static'],
  fern:       ['can_sway', 'can_blossom', 'is_static'],
  grass:      ['can_sway', 'is_static'],
  leaf:       ['can_sway'],
  mushroom:   ['can_sway', 'is_static'],
  // ── Animals — generic ────────────────────────────────────────────────────
  dog:        ['can_bounce', 'can_flee', 'can_chase', 'is_animate'],
  cat:        ['can_bounce', 'can_flee', 'can_chase', 'is_animate'],
  rabbit:     ['can_bounce', 'can_flee', 'is_animate'],
  sheep:      ['can_bounce', 'can_flee', 'is_animate'],
  cow:        ['can_bounce', 'can_flee', 'is_animate'],
  pig:        ['can_bounce', 'can_flee', 'is_animate'],
  horse:      ['can_bounce', 'can_flee', 'can_chase', 'is_animate'],
  deer:       ['can_bounce', 'can_flee', 'is_animate'],
  fox:        ['can_bounce', 'can_flee', 'can_chase', 'is_animate'],
  wolf:       ['can_bounce', 'can_flee', 'can_chase', 'is_animate'],
  bear:       ['can_bounce', 'can_flee', 'can_chase', 'is_animate'],
  lion:       ['can_bounce', 'can_flee', 'can_chase', 'is_animate'],
  tiger:      ['can_bounce', 'can_flee', 'can_chase', 'is_animate'],
  elephant:   ['can_bounce', 'can_flee', 'is_animate'],
  giraffe:    ['can_bounce', 'can_flee', 'is_animate'],
  turtle:     ['can_flee', 'is_animate'],
  frog:       ['can_bounce', 'can_flee', 'is_animate'],
  // ── Insects ──────────────────────────────────────────────────────────────
  butterfly:  ['can_bounce', 'can_flee', 'is_animate'],
  bee:        ['can_bounce', 'can_flee', 'is_animate'],
  dragonfly:  ['can_bounce', 'can_flee', 'is_animate'],
  moth:       ['can_bounce', 'can_flee', 'is_animate'],
  ant:        ['can_flee', 'is_animate'],
  ladybug:    ['can_bounce', 'can_flee', 'is_animate'],
  // ── Birds ────────────────────────────────────────────────────────────────
  bird:       ['can_bounce', 'can_flee', 'is_animate'],
  eagle:      ['can_bounce', 'can_flee', 'can_chase', 'is_animate'],
  owl:        ['can_bounce', 'can_flee', 'is_animate'],
  penguin:    ['can_bounce', 'can_flee', 'is_animate'],
  flamingo:   ['can_bounce', 'can_flee', 'is_animate'],
  parrot:     ['can_bounce', 'can_flee', 'is_animate'],
  duck:       ['can_bounce', 'can_flee', 'can_swim', 'is_animate'],
  // ── Sea creatures ────────────────────────────────────────────────────────
  fish:       ['can_flee', 'can_swim', 'is_animate'],
  shark:      ['can_flee', 'can_swim', 'can_chase', 'is_animate'],
  whale:      ['can_flee', 'can_swim', 'is_animate'],
  dolphin:    ['can_bounce', 'can_flee', 'can_swim', 'is_animate'],
  octopus:    ['can_flee', 'can_swim', 'is_animate'],
  crab:       ['can_flee', 'can_swim', 'is_animate'],
  // ── Reptiles ─────────────────────────────────────────────────────────────
  snake:      ['can_flee', 'can_chase', 'is_animate'],
  worm:       ['can_flee', 'is_animate'],
  caterpillar:['can_flee', 'is_animate'],
  snail:      ['can_flee', 'is_animate'],
  // ── Characters ───────────────────────────────────────────────────────────
  person:     ['can_bounce', 'can_flee', 'can_chase', 'is_animate'],
  human:      ['can_bounce', 'can_flee', 'can_chase', 'is_animate'],
  figure:     ['can_bounce', 'can_flee', 'is_animate'],
  robot:      ['can_bounce', 'can_flee', 'is_animate'],
  // ── Cosmic / celestial ───────────────────────────────────────────────────
  star:       ['can_glow', 'can_sway'],
  moon:       ['can_glow', 'can_sway'],
  sun:        ['can_glow', 'can_sway'],
  comet:      ['can_glow', 'can_sway'],
  planet:     ['can_glow', 'can_sway'],
  cloud:      ['can_sway'],
  rainbow:    ['can_glow'],
  lightning:  ['can_glow'],
  snowflake:  ['can_sway'],
  // ── Static structures ────────────────────────────────────────────────────
  house:      ['is_static', 'can_glow'],
  building:   ['is_static', 'can_glow'],
  castle:     ['is_static', 'can_glow'],
  bridge:     ['is_static'],
  tower:      ['is_static', 'can_glow'],
  mountain:   ['is_static', 'can_sway'],
  rock:       ['is_static'],
  cliff:      ['is_static'],
  // ── Objects / miscellaneous ──────────────────────────────────────────────
  crown:      ['can_glow', 'can_sway'],
  gem:        ['can_glow'],
  diamond:    ['can_glow'],
  ring:       ['can_glow'],
  lantern:    ['can_glow'],
  candle:     ['can_glow', 'can_sway'],
  fire:       ['can_glow', 'can_sway'],
  balloon:    ['can_sway'],
  hat:        ['can_sway'],
  ball:       ['can_bounce', 'can_sway'],
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return a Set of capability flags for a given label + category.
 * Merges category-level caps with label-level overrides.
 *
 * @param {string} label     e.g. 'butterfly'
 * @param {string} category  e.g. 'insect'
 * @returns {Set<string>}
 */
export function getCaps(label, category) {
  const ll = (label    ?? '').toLowerCase().trim();
  const cl = (category ?? '').toLowerCase().trim();
  return new Set([
    ...(CATEGORY_CAPS[cl] ?? []),
    ...(LABEL_CAPS[ll]    ?? []),
  ]);
}

/**
 * Return true if the subject has the named capability.
 */
export function hasCap(label, category, cap) {
  return getCaps(label, category).has(cap);
}

/**
 * Build a short human-readable constraint string for a subject.
 * Used in GPT prompts to constrain generation.
 * e.g. "house: is_static, can_glow (cannot move, flee, or blossom)"
 */
export function capSummary(label, category) {
  const caps = getCaps(label, category);
  const list = [...caps].join(', ') || 'none';
  const notes = [];
  if (caps.has('is_static'))   notes.push('cannot move or flee');
  if (!caps.has('is_animate')) notes.push('no agency');
  if (!caps.has('can_blossom') && !caps.has('can_glow')) notes.push('cannot bloom or glow');
  const noteStr = notes.length ? ` (${notes.join('; ')})` : '';
  return `${label}: ${list}${noteStr}`;
}
