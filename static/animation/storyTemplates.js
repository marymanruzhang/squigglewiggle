/**
 * storyTemplates.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Story template definitions. Each template describes:
 *   - which pair of objects can participate (via label-pair or tag matching)
 *   - a sequence of story beats (referencing names from storyBeatAnimations.js)
 *   - priority, cooldown, and radius
 *
 * The storyPlanner.js selects the best matching template for a given pair
 * of scene objects, then storyRunner.js executes it.
 *
 * HOW TO ADD A NEW STORY TEMPLATE:
 *   Push a new object into STORY_TEMPLATES below. Key fields:
 *     id:         Unique string ID.
 *     priority:   Higher = selected first. Use 10+ for iconic pairs,
 *                 5-9 for semantic relationships, 1-4 for tag fallbacks.
 *     radius:     Maximum distance (px) between agents to trigger this story.
 *     cooldown:   Milliseconds before the same pair can replay this story.
 *     match(a, b) → bool:  Predicate. Return true when this story is valid.
 *                  a = source/actor, b = target. storyPlanner tries both
 *                  directions automatically.
 *     beats:      Array of beat descriptors. Each beat is:
 *       { type: 'beatName', actor: 'source'|'target'|'both',
 *         params: {}, parallel: false }
 *       actor:    'source' → first agent, 'target' → second, 'both' → run in parallel
 *       parallel: if true, this beat runs alongside the previous beat
 *       params:   forwarded to the beat function as-is
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────────────────────
export const STORY_TEMPLATES = [

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 1 — ICONIC EXACT-PAIR STORIES  (priority 10+)
  // ══════════════════════════════════════════════════════════════════════════

  // ── Butterfly + Flower ───────────────────────────────────────────────────
  // Butterfly notices flower, flutters over in a curve, circles it,
  // lands/hovers, flower blooms, both rest, then return to idle.
  {
    id: 'butterfly_flower',
    priority: 12,
    radius: 280,
    cooldown: 9000,
    match: (a, b) => a.label === 'butterfly' && b.label === 'flower',
    beats: [
      { type: 'noticeTarget',     actor: 'source', params: { duration: 450 } },
      { type: 'approachWithCurve', actor: 'source', params: { margin: 60, duration: 1600 } },
      { type: 'orbitTarget',      actor: 'source', params: { turns: 1.5, radius: 45, duration: 2200 } },
      { type: 'growOrBloom',      actor: 'target', params: { duration: 1200, bloomAmplitude: 0.18 }, parallel: true },
      { type: 'restNearTarget',   actor: 'source', params: { duration: 1000 } },
      { type: 'strongerSway',     actor: 'target', params: { duration: 800, amplitude: 12 }, parallel: true },
      { type: 'returnToIdle',     actor: 'source', params: { duration: 700 } },
      { type: 'returnToIdle',     actor: 'target', params: { duration: 700 }, parallel: true },
    ],
  },

  // ── Bee + Flower ─────────────────────────────────────────────────────────
  // Bee hovers close, orbits tightly (pollinating), flower sways, bee rests.
  {
    id: 'bee_flower',
    priority: 12,
    radius: 250,
    cooldown: 8000,
    match: (a, b) => a.label === 'bee' && b.label === 'flower',
    beats: [
      { type: 'noticeTarget',     actor: 'source', params: { duration: 350 } },
      { type: 'approachTarget',   actor: 'source', params: { margin: 55, duration: 900 } },
      { type: 'orbitTarget',      actor: 'source', params: { turns: 2, radius: 35, duration: 2600 } },
      { type: 'growOrBloom',      actor: 'target', params: { duration: 2400 }, parallel: true },
      { type: 'restNearTarget',   actor: 'source', params: { duration: 700 } },
      { type: 'returnToIdle',     actor: 'source', params: { duration: 500 } },
      { type: 'returnToIdle',     actor: 'target', params: { duration: 500 }, parallel: true },
    ],
  },

  // ── Dog + Cake ──────────────────────────────────────────────────────────
  // Dog notices, trots over, pauses, sniffs, cake wiggles, dog bounces happily,
  // then nibbles, cake reacts, dog satisfied, both settle.
  {
    id: 'dog_cake',
    priority: 11,
    radius: 260,
    cooldown: 8000,
    match: (a, b) => a.label === 'dog' && (b.label === 'cake' || b.hasTag?.('food')),
    beats: [
      { type: 'noticeTarget',   actor: 'source', params: { duration: 500 } },
      { type: 'approachTarget', actor: 'source', params: { margin: 50, duration: 1200 } },
      { type: 'pauseAndLook',   actor: 'source', params: { duration: 500 } },
      { type: 'sniffTarget',    actor: 'source', params: { cycles: 3, duration: 1000 } },
      { type: 'reactWiggle',    actor: 'target', params: { duration: 600, amplitude: 12 } },
      { type: 'happyBounce',    actor: 'source', params: { hops: 3, hopHeight: 20, duration: 700 } },
      { type: 'nibbleTarget',   actor: 'source', params: { bites: 3, duration: 900 } },
      { type: 'reactBounce',    actor: 'target', params: { duration: 500 } },
      { type: 'returnToIdle',   actor: 'source', params: { duration: 700 } },
      { type: 'returnToIdle',   actor: 'target', params: { duration: 700 }, parallel: true },
    ],
  },

  // ── Cat + Bird ──────────────────────────────────────────────────────────
  // Cat prowls toward bird, bird notices and flees, cat chases, bird escapes,
  // cat watches, both reset.
  {
    id: 'cat_bird',
    priority: 11,
    radius: 260,
    cooldown: 8000,
    match: (a, b) => a.label === 'cat' && b.label === 'bird',
    beats: [
      { type: 'noticeTarget',   actor: 'source', params: { duration: 600 } },
      { type: 'pauseAndLook',   actor: 'source', params: { duration: 500 } },
      { type: 'fleeFromTarget', actor: 'target', params: { fleeRange: 140, duration: 800 } },
      { type: 'chaseTarget',    actor: 'source', params: { margin: 50, duration: 850 } },
      { type: 'fleeFromTarget', actor: 'target', params: { fleeRange: 160, duration: 900 } },
      { type: 'reactSurprise',  actor: 'source', params: { duration: 400 } },
      { type: 'returnToIdle',   actor: 'source', params: { duration: 700 } },
      { type: 'returnToIdle',   actor: 'target', params: { duration: 700 }, parallel: true },
    ],
  },

  // ── Cloud + Flower ──────────────────────────────────────────────────────
  // Cloud drifts above flower, rains, flower grows/blooms, both settle.
  {
    id: 'cloud_flower',
    priority: 11,
    radius: 260,
    cooldown: 9000,
    match: (a, b) => a.label === 'cloud' && (b.label === 'flower' || b.label === 'tree' || b.hasTag?.('plant')),
    beats: [
      { type: 'rainOnTarget',  actor: 'source', params: { duration: 1800 } },
      { type: 'growOrBloom',   actor: 'target', params: { duration: 2200, bloomAmplitude: 0.2 }, parallel: true },
      { type: 'returnToIdle',  actor: 'source', params: { duration: 700 } },
      { type: 'returnToIdle',  actor: 'target', params: { duration: 700 }, parallel: true },
    ],
  },

  // ── Sun + Flower / Tree ─────────────────────────────────────────────────
  // Sun pulses warmly, plant blooms in response, both linger, then settle.
  {
    id: 'sun_plant',
    priority: 11,
    radius: 300,
    cooldown: 10000,
    match: (a, b) => a.label === 'sun' && b.hasTag?.('bloomable'),
    beats: [
      { type: 'pulseLight',   actor: 'source', params: { duration: 2000, amplitude: 0.18 } },
      { type: 'growOrBloom',  actor: 'target', params: { duration: 2000, bloomAmplitude: 0.2 }, parallel: true },
      { type: 'pulseLight',   actor: 'source', params: { duration: 1000 } },
      { type: 'strongerSway', actor: 'target', params: { duration: 800, amplitude: 10 }, parallel: true },
      { type: 'returnToIdle', actor: 'source', params: { duration: 500 } },
      { type: 'returnToIdle', actor: 'target', params: { duration: 500 }, parallel: true },
    ],
  },

  // ── Rabbit + Carrot / Plant ─────────────────────────────────────────────
  // Rabbit hops toward food, sniffs, nibbles enthusiastically.
  {
    id: 'rabbit_carrot',
    priority: 11,
    radius: 240,
    cooldown: 7000,
    match: (a, b) =>
      a.label === 'rabbit' &&
      (b.label === 'carrot' || b.label === 'flower' || b.label === 'grass' || b.hasTag?.('food')),
    beats: [
      { type: 'noticeTarget',   actor: 'source', params: { duration: 400 } },
      { type: 'approachTarget', actor: 'source', params: { margin: 45, duration: 1000 } },
      { type: 'sniffTarget',    actor: 'source', params: { cycles: 2, duration: 700 } },
      { type: 'reactWiggle',    actor: 'target', params: { duration: 500, amplitude: 8 } },
      { type: 'nibbleTarget',   actor: 'source', params: { bites: 4, duration: 1100 } },
      { type: 'reactBounce',    actor: 'target', params: { duration: 400 } },
      { type: 'happyBounce',    actor: 'source', params: { hops: 2, hopHeight: 25, duration: 700 } },
      { type: 'returnToIdle',   actor: 'source', params: { duration: 600 } },
      { type: 'returnToIdle',   actor: 'target', params: { duration: 600 }, parallel: true },
    ],
  },

  // ── Sheep + Grass / Flower ──────────────────────────────────────────────
  // Sheep ambles toward plant, nibbles, plant reacts.
  {
    id: 'sheep_plant',
    priority: 10,
    radius: 220,
    cooldown: 7000,
    match: (a, b) =>
      a.label === 'sheep' &&
      (b.label === 'grass' || b.label === 'flower' || b.hasTag?.('plant')),
    beats: [
      { type: 'approachTarget', actor: 'source', params: { margin: 50, duration: 1300 } },
      { type: 'pauseAndLook',   actor: 'source', params: { duration: 400 } },
      { type: 'nibbleTarget',   actor: 'source', params: { bites: 4, duration: 1200 } },
      { type: 'reactWiggle',    actor: 'target', params: { duration: 700, amplitude: 10 } },
      { type: 'returnToIdle',   actor: 'source', params: { duration: 700 } },
      { type: 'returnToIdle',   actor: 'target', params: { duration: 700 }, parallel: true },
    ],
  },

  // ── Bird + Tree ─────────────────────────────────────────────────────────
  // Bird flies toward tree, lands, perches briefly with a subtle settle, lifts off.
  {
    id: 'bird_tree',
    priority: 10,
    radius: 260,
    cooldown: 8000,
    match: (a, b) => a.label === 'bird' && b.label === 'tree',
    beats: [
      { type: 'approachWithCurve', actor: 'source', params: { margin: 50, duration: 1400 } },
      { type: 'landNearTarget',    actor: 'source', params: { durationMs: 800, yOffsetFromTop: 8 } },
      { type: 'restNearTarget',    actor: 'source', params: { duration: 1400 } },
      { type: 'strongerSway',      actor: 'target', params: { duration: 1000, amplitude: 8 } },
      { type: 'returnToIdle',      actor: 'source', params: { duration: 800 } },
      { type: 'returnToIdle',      actor: 'target', params: { duration: 600 }, parallel: true },
    ],
  },

  // ── Bird + Cake ─────────────────────────────────────────────────────────
  // Bird spots the cake, flies over with curiosity, pecks at it,
  // cake wobbles in protest, bird bounces happily, then flies home.
  {
    id: 'bird_cake',
    priority: 11,
    radius: 280,
    cooldown: 8000,
    match: (a, b) => a.label === 'bird' && (b.label === 'cake' || b.hasTag?.('food')),
    beats: [
      { type: 'noticeTarget',      actor: 'source', params: { duration: 500 } },
      { type: 'approachWithCurve', actor: 'source', params: { margin: 55, duration: 1500 } },
      { type: 'pauseAndLook',      actor: 'source', params: { duration: 500 } },
      { type: 'nibbleTarget',      actor: 'source', params: { bites: 3, duration: 900 } },
      { type: 'reactWiggle',       actor: 'target', params: { duration: 700, amplitude: 14 } },
      { type: 'happyBounce',       actor: 'source', params: { hops: 3, hopHeight: 20, duration: 700 } },
      { type: 'reactBounce',       actor: 'target', params: { duration: 500 }, parallel: true },
      { type: 'returnToIdle',      actor: 'source', params: { duration: 800 } },
      { type: 'returnToIdle',      actor: 'target', params: { duration: 800 }, parallel: true },
    ],
  },

  // ── Fish + Pond / Ocean / River ─────────────────────────────────────────
  // Fish swims into the water zone, splashes, stays briefly, returns.
  {
    id: 'fish_water',
    priority: 10,
    radius: 240,
    cooldown: 7000,
    match: (a, b) =>
      a.label === 'fish' &&
      (b.label === 'pond' || b.label === 'ocean' || b.label === 'river' || b.hasTag?.('water_zone')),
    beats: [
      { type: 'swimIntoWater', actor: 'source', params: { duration: 1000 } },
      { type: 'reactWiggle',   actor: 'target', params: { duration: 800, amplitude: 6 } },
      { type: 'returnToIdle',  actor: 'source', params: { duration: 700 } },
      { type: 'returnToIdle',  actor: 'target', params: { duration: 600 }, parallel: true },
    ],
  },

  // ── Rain / Cloud + Umbrella ─────────────────────────────────────────────
  // Rain falls above umbrella, umbrella opens (scale), settles.
  {
    id: 'rain_umbrella',
    priority: 10,
    radius: 200,
    cooldown: 7000,
    match: (a, b) =>
      (a.label === 'rain' || a.label === 'cloud') &&
      (b.label === 'umbrella' || b.hasTag?.('rain_reactive')),
    beats: [
      { type: 'rainOnTarget',  actor: 'source', params: { duration: 1600 } },
      { type: 'reactSurprise', actor: 'target', params: { duration: 500 } },
      { type: 'reactWiggle',   actor: 'target', params: { duration: 1200, amplitude: 6 } },
      { type: 'returnToIdle',  actor: 'source', params: { duration: 600 } },
      { type: 'returnToIdle',  actor: 'target', params: { duration: 600 }, parallel: true },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 2 — STRONG SEMANTIC RELATIONSHIPS  (priority 8–9)
  // ══════════════════════════════════════════════════════════════════════════

  // ── Pollinator → attracts_pollinators ────────────────────────────────────
  {
    id: 'pollinator_flower_generic',
    priority: 9,
    radius: 220,
    cooldown: 7000,
    match: (a, b) => a.hasTag?.('pollinator') && b.hasTag?.('attracts_pollinators'),
    beats: [
      { type: 'approachWithCurve', actor: 'source', params: { margin: 55, duration: 1400 } },
      { type: 'orbitTarget',       actor: 'source', params: { turns: 1.5, radius: 45, duration: 2200 } },
      { type: 'growOrBloom',       actor: 'target', params: { duration: 2000 }, parallel: true },
      { type: 'restNearTarget',    actor: 'source', params: { duration: 800 } },
      { type: 'returnToIdle',      actor: 'source', params: { duration: 600 } },
      { type: 'returnToIdle',      actor: 'target', params: { duration: 600 }, parallel: true },
    ],
  },

  // ── Predator → prey ───────────────────────────────────────────────────────
  {
    id: 'predator_prey_chase',
    priority: 9,
    radius: 200,
    cooldown: 7000,
    match: (a, b) => a.hasTag?.('predator') && b.hasTag?.('prey'),
    beats: [
      { type: 'noticeTarget',   actor: 'source', params: { duration: 500 } },
      { type: 'pauseAndLook',   actor: 'source', params: { duration: 400 } },
      { type: 'fleeFromTarget', actor: 'target', params: { fleeRange: 130, duration: 850 } },
      { type: 'chaseTarget',    actor: 'source', params: { margin: 45, duration: 900 } },
      { type: 'fleeFromTarget', actor: 'target', params: { fleeRange: 150, duration: 900 } },
      { type: 'returnToIdle',   actor: 'source', params: { duration: 700 } },
      { type: 'returnToIdle',   actor: 'target', params: { duration: 700 }, parallel: true },
    ],
  },

  // ── Rain source → plant ───────────────────────────────────────────────────
  {
    id: 'rain_source_plant',
    priority: 8,
    radius: 220,
    cooldown: 8000,
    match: (a, b) => a.hasTag?.('rain_source') && b.hasTag?.('plant'),
    beats: [
      { type: 'rainOnTarget',  actor: 'source', params: { duration: 1800 } },
      { type: 'growOrBloom',   actor: 'target', params: { duration: 2200 }, parallel: true },
      { type: 'returnToIdle',  actor: 'source', params: { duration: 700 } },
      { type: 'returnToIdle',  actor: 'target', params: { duration: 700 }, parallel: true },
    ],
  },

  // ── Light source → bloomable ──────────────────────────────────────────────
  {
    id: 'light_source_bloomable',
    priority: 8,
    radius: 260,
    cooldown: 9000,
    match: (a, b) => a.hasTag?.('light_source') && b.hasTag?.('bloomable'),
    beats: [
      { type: 'pulseLight',   actor: 'source', params: { duration: 2200 } },
      { type: 'growOrBloom',  actor: 'target', params: { duration: 2200 }, parallel: true },
      { type: 'returnToIdle', actor: 'source', params: { duration: 500 } },
      { type: 'returnToIdle', actor: 'target', params: { duration: 500 }, parallel: true },
    ],
  },

  // ── Herbivore → plant / food ──────────────────────────────────────────────
  {
    id: 'herbivore_plant_generic',
    priority: 7,
    radius: 200,
    cooldown: 6000,
    match: (a, b) =>
      a.hasTag?.('herbivore') && (b.hasTag?.('plant') || b.hasTag?.('food')),
    beats: [
      { type: 'approachTarget', actor: 'source', params: { margin: 50, duration: 1100 } },
      { type: 'sniffTarget',    actor: 'source', params: { cycles: 2, duration: 700 } },
      { type: 'nibbleTarget',   actor: 'source', params: { bites: 3, duration: 900 } },
      { type: 'reactWiggle',    actor: 'target', params: { duration: 500, amplitude: 9 } },
      { type: 'returnToIdle',   actor: 'source', params: { duration: 600 } },
      { type: 'returnToIdle',   actor: 'target', params: { duration: 600 }, parallel: true },
    ],
  },

  // ── Animal → food ─────────────────────────────────────────────────────────
  {
    id: 'animal_food_generic',
    priority: 6,
    radius: 200,
    cooldown: 6000,
    match: (a, b) => a.hasTag?.('animal') && b.hasTag?.('food'),
    beats: [
      { type: 'noticeTarget',   actor: 'source', params: { duration: 400 } },
      { type: 'approachTarget', actor: 'source', params: { margin: 50, duration: 1000 } },
      { type: 'sniffTarget',    actor: 'source', params: { cycles: 2, duration: 700 } },
      { type: 'reactWiggle',    actor: 'target', params: { duration: 500, amplitude: 10 } },
      { type: 'happyBounce',    actor: 'source', params: { hops: 2, hopHeight: 16, duration: 600 } },
      { type: 'returnToIdle',   actor: 'source', params: { duration: 600 } },
      { type: 'returnToIdle',   actor: 'target', params: { duration: 600 }, parallel: true },
    ],
  },

  // ── Flying animal → shelter / tree ───────────────────────────────────────
  {
    id: 'flying_land_shelter',
    priority: 6,
    radius: 220,
    cooldown: 7000,
    match: (a, b) =>
      a.hasTag?.('flying') && (b.hasTag?.('shelter') || b.label === 'tree'),
    beats: [
      { type: 'approachWithCurve', actor: 'source', params: { margin: 50, duration: 1400 } },
      { type: 'landNearTarget',    actor: 'source', params: { durationMs: 700 } },
      { type: 'restNearTarget',    actor: 'source', params: { duration: 1200 } },
      { type: 'returnToIdle',      actor: 'source', params: { duration: 700 } },
    ],
  },

  // ── Water creature → water zone ───────────────────────────────────────────
  {
    id: 'water_creature_zone',
    priority: 7,
    radius: 220,
    cooldown: 6000,
    match: (a, b) => a.hasTag?.('water_creature') && b.hasTag?.('water_zone'),
    beats: [
      { type: 'swimIntoWater', actor: 'source', params: { duration: 1000 } },
      { type: 'reactWiggle',   actor: 'target', params: { duration: 900, amplitude: 5 } },
      { type: 'returnToIdle',  actor: 'source', params: { duration: 700 } },
      { type: 'returnToIdle',  actor: 'target', params: { duration: 600 }, parallel: true },
    ],
  },

  // ── Animal → shelter ─────────────────────────────────────────────────────
  {
    id: 'animal_shelter_generic',
    priority: 5,
    radius: 180,
    cooldown: 6000,
    match: (a, b) => a.hasTag?.('animal') && b.hasTag?.('shelter'),
    beats: [
      { type: 'approachTarget',   actor: 'source', params: { margin: 45, duration: 1000 } },
      { type: 'hideUnderShelter', actor: 'source', params: { duration: 900 } },
      { type: 'reactWiggle',      actor: 'target', params: { duration: 600, amplitude: 5 } },
      { type: 'returnToIdle',     actor: 'source', params: { duration: 600 } },
    ],
  },

  // ── Mobile → obstacle ─────────────────────────────────────────────────────
  {
    id: 'mobile_obstacle_generic',
    priority: 4,
    radius: 120,
    cooldown: 4000,
    match: (a, b) => a.hasTag?.('mobile') && b.hasTag?.('obstacle'),
    beats: [
      { type: 'avoidObstacle', actor: 'source', params: { duration: 500 } },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 3 — PLAYFUL FALLBACK REACTIONS  (priority 1–3)
  // ══════════════════════════════════════════════════════════════════════════

  // ── Curious animal meets reactive/unknown object ──────────────────────────
  {
    id: 'curious_investigates',
    priority: 3,
    radius: 160,
    cooldown: 5000,
    match: (a, b) => a.hasTag?.('curious') && b.hasTag?.('reactive'),
    beats: [
      { type: 'noticeTarget',   actor: 'source', params: { duration: 400 } },
      { type: 'approachTarget', actor: 'source', params: { margin: 55, duration: 1000 } },
      { type: 'sniffTarget',    actor: 'source', params: { cycles: 2, duration: 700 } },
      { type: 'reactSurprise',  actor: 'target', params: { duration: 400 } },
      { type: 'reactWiggle',    actor: 'target', params: { duration: 500, amplitude: 8 } },
      { type: 'returnToIdle',   actor: 'source', params: { duration: 600 } },
      { type: 'returnToIdle',   actor: 'target', params: { duration: 600 }, parallel: true },
    ],
  },

  // ── Any two mobile objects meet ───────────────────────────────────────────
  // Full narrative: spot each other → approach → mutual surprise → inspect →
  // both react → one retreats slightly → settle apart
  {
    id: 'two_mobiles_meet',
    priority: 2,
    radius: 180,
    cooldown: 6000,
    match: (a, b) => a.hasTag?.('mobile') && b.hasTag?.('mobile'),
    beats: [
      { type: 'noticeTarget',   actor: 'source', params: { duration: 400 } },
      { type: 'pauseAndLook',   actor: 'target', params: { duration: 300 }, parallel: true },
      { type: 'approachTarget', actor: 'source', params: { margin: 55, duration: 1000 } },
      { type: 'reactSurprise',  actor: 'source', params: { duration: 350 } },
      { type: 'reactSurprise',  actor: 'target', params: { duration: 350 }, parallel: true },
      { type: 'sniffTarget',    actor: 'source', params: { cycles: 2, duration: 800 } },
      { type: 'reactWiggle',    actor: 'target', params: { duration: 500, amplitude: 10 }, parallel: true },
      { type: 'reactBounce',    actor: 'source', params: { duration: 500 } },
      { type: 'reactBounce',    actor: 'target', params: { duration: 500 }, parallel: true },
      { type: 'returnToIdle',   actor: 'source', params: { duration: 700 } },
      { type: 'returnToIdle',   actor: 'target', params: { duration: 700 }, parallel: true },
    ],
  },

  // ── Fallback: any two objects near each other ─────────────────────────────
  // Even completely unknown pairs get a small story: one notices,
  // approaches, they react to each other, then settle back home.
  {
    id: 'generic_proximity_react',
    priority: 1,
    radius: 140,
    cooldown: 6000,
    match: () => true, // catches everything
    beats: [
      { type: 'noticeTarget',   actor: 'source', params: { duration: 350 } },
      { type: 'approachTarget', actor: 'source', params: { margin: 65, duration: 900 } },
      { type: 'reactWiggle',    actor: 'source', params: { duration: 450, amplitude: 8 } },
      { type: 'reactWiggle',    actor: 'target', params: { duration: 600, amplitude: 10 }, parallel: true },
      { type: 'reactBounce',    actor: 'source', params: { duration: 450 } },
      { type: 'returnToIdle',   actor: 'source', params: { duration: 600 } },
      { type: 'returnToIdle',   actor: 'target', params: { duration: 600 }, parallel: true },
    ],
  },

];

