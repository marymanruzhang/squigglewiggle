/**
 * interactionRules.js
 * Tag-based proximity interaction rules.
 *
 * Each rule:
 * {
 *   id:           string    — unique rule name
 *   priority:     number    — higher wins when multiple rules match
 *   radius:       number    — trigger distance in px (overrides engine default)
 *   cooldown:     number    — pair cooldown in ms after this rule fires
 *   bidirectional:boolean   — try (b,a) as well as (a,b)
 *   match(src, tgt) → bool  — tag/label predicate
 *   action(src, tgt, ctrl) → Promise  — the animation sequence
 * }
 *
 * HOW TO ADD A NEW RULE:
 *   Push a new object into the INTERACTION_RULES array below.
 *   Use src.hasTag() / tgt.hasTag() in match().
 *   In action(), call ctrl.moveTo / ctrl.playOnce / orbitAround and await them.
 *   Return a Promise (async functions do this automatically).
 */

import { orbitAround, moveTo, wait, easeInOut } from './motionPresets.js';

// ─── Helper: get center of an agent ──────────────────────────────────────────

function center(agent) { return agent.getCenter(); }

// ─── Helper: approach target without overlapping ──────────────────────────────

function approachPos(source, target, margin = 60) {
  const sc = center(source);
  const tc = center(target);
  const dx = tc.x - sc.x;
  const dy = tc.y - sc.y;
  const dist = Math.hypot(dx, dy) || 1;
  // Stop `margin` px away from target center
  const stopDist = Math.max(dist - margin, 20);
  return {
    x: sc.x + dx / dist * stopDist,
    y: sc.y + dy / dist * stopDist,
  };
}

// ─── Helper: flee from a pursuer ─────────────────────────────────────────────

function fleePos(source, threat, fleeRange = 120) {
  const sc = center(source);
  const tc = center(threat);
  const dx = sc.x - tc.x;
  const dy = sc.y - tc.y;
  const dist = Math.hypot(dx, dy) || 1;
  return { x: sc.x + dx / dist * fleeRange, y: sc.y + dy / dist * fleeRange };
}

// ─────────────────────────────────────────────────────────────────────────────
export const INTERACTION_RULES = [

  // ── 1. Pollinator → flower/plant with attracts_pollinators ───────────────
  {
    id: 'pollinator_flower',
    priority: 10,
    radius: 200,
    cooldown: 6000,
    bidirectional: true,
    match: (src, tgt) => src.hasTag('pollinator') && tgt.hasTag('attracts_pollinators'),
    async action(src, tgt, ctrl) {
      // Approach flower
      const ap = approachPos(src, tgt, 55);
      await ctrl.moveTo(src, ap.x, ap.y, 700);

      // Orbit flower 1.5 times while flower sways more
      const tc = center(tgt);
      const orbitR = 45;
      const orbitP  = orbitAround(src, tc.x, tc.y, orbitR, 1.5, 2200);
      const swayP   = ctrl.playOnce(tgt, 'sway', { amplitude: 16, speed: 0.7 }, 2200);
      await Promise.all([orbitP, swayP]);

      // Both return to origin
      await Promise.all([
        ctrl.returnToOrigin(src, 500),
        ctrl.returnToOrigin(tgt, 500),
      ]);
    },
  },

  // ── 2. Rain/cloud → plant ────────────────────────────────────────────────
  {
    id: 'rain_plant',
    priority: 8,
    radius: 180,
    cooldown: 7000,
    bidirectional: true,
    match: (src, tgt) => src.hasTag('rain_source') && tgt.hasTag('plant'),
    async action(src, tgt, ctrl) {
      const tc = center(tgt);
      // Move rain source above plant
      await ctrl.moveTo(src, tc.x - src.bbox.width / 2, tc.y - 110, 800);
      // Rain falls (source pulses) while plant grows slightly
      await Promise.all([
        ctrl.playOnce(src, 'pulse', { amplitude: 0.1, speed: 1.2 }, 1800),
        ctrl.playOnce(tgt, 'sway_bloom', { amplitude: 10, bloomAmplitude: 0.12 }, 1800),
      ]);
      // Plant settles at slightly larger scale
      tgt.adapter.setScale(1.05);
      await wait(300);
      tgt.adapter.setScale(1);
      await ctrl.returnToOrigin(src, 600);
    },
  },

  // ── 3. Light source → bloomable plant ────────────────────────────────────
  {
    id: 'light_bloom',
    priority: 7,
    radius: 220,
    cooldown: 8000,
    bidirectional: true,
    match: (src, tgt) => src.hasTag('light_source') && tgt.hasTag('bloomable'),
    async action(src, tgt, ctrl) {
      // Light pulses, plant blooms
      await Promise.all([
        ctrl.playOnce(src, 'pulse', { amplitude: 0.15, speed: 0.8 }, 2000),
        ctrl.playOnce(tgt, 'sway_bloom', { bloomAmplitude: 0.18, bloomSpeed: 1.0, amplitude: 10 }, 2000),
      ]);
      await ctrl.returnToOrigin(tgt, 400);
    },
  },

  // ── 4. Herbivore → plant ──────────────────────────────────────────────────
  {
    id: 'herbivore_plant',
    priority: 6,
    radius: 160,
    cooldown: 5000,
    bidirectional: true,
    match: (src, tgt) => src.hasTag('herbivore') && tgt.hasTag('plant'),
    async action(src, tgt, ctrl) {
      const ap = approachPos(src, tgt, 50);
      await ctrl.moveTo(src, ap.x, ap.y, 700);
      // Nod/bounce near plant, plant wiggles reactively
      await Promise.all([
        ctrl.playOnce(src, 'hop', { hopHeight: 14, hopSpeed: 1.0, travelRange: 10 }, 1000),
        ctrl.playOnce(tgt, 'subtle_wiggle', { amplitude: 4, speed: 1.0 }, 1000),
      ]);
      await wait(200);
      await ctrl.returnToOrigin(src, 600);
    },
  },

  // ── 5. Predator → prey chase ─────────────────────────────────────────────
  {
    id: 'predator_prey',
    priority: 9,
    radius: 180,
    cooldown: 6000,
    bidirectional: false,
    match: (src, tgt) => src.hasTag('predator') && tgt.hasTag('prey'),
    async action(src, tgt, ctrl) {
      // Prey flees, predator chases — run in two phases
      const fleeDest = fleePos(tgt, src, 130);
      const chaseDest = center(tgt);

      await Promise.all([
        ctrl.moveTo(src, chaseDest.x - 30, chaseDest.y, 900),
        ctrl.moveTo(tgt, fleeDest.x, fleeDest.y, 900),
      ]);
      await wait(300);
      // Both calm down and return
      await Promise.all([
        ctrl.returnToOrigin(src, 700),
        ctrl.returnToOrigin(tgt, 700),
      ]);
    },
  },

  // ── 6. Wind source → sways objects ──────────────────────────────────────
  {
    id: 'wind_sway',
    priority: 5,
    radius: 200,
    cooldown: 4000,
    bidirectional: false,
    match: (src, tgt) => src.hasTag('wind_source') && tgt.hasTag('sways'),
    async action(src, tgt, ctrl) {
      // Wind drifts, plant sways harder
      await Promise.all([
        ctrl.playOnce(src, 'drift', { speed: 0.6, range: 150 }, 2000),
        ctrl.playOnce(tgt, 'sway', { amplitude: 20, speed: 0.9 }, 2000),
      ]);
      await ctrl.returnToOrigin(tgt, 400);
    },
  },

  // ── 7. Water zone ↔ water creature ──────────────────────────────────────
  {
    id: 'water_zone_creature',
    priority: 7,
    radius: 200,
    cooldown: 5000,
    bidirectional: true,
    match: (src, tgt) => src.hasTag('water_zone') && tgt.hasTag('water_creature'),
    async action(src, tgt, ctrl) {
      const sc = center(src);
      // Creature swims toward water zone
      await ctrl.moveTo(tgt, sc.x + (Math.random() * 40 - 20), sc.y + (Math.random() * 20 - 10), 800);
      // Swim within zone, zone ripples
      await Promise.all([
        ctrl.playOnce(tgt, 'swim', { amplitude: 30, speed: 0.6 }, 2000),
        ctrl.playOnce(src, 'ripple', { amplitude: 0.06, speed: 0.8 }, 2000),
      ]);
    },
  },

  // ── 8. Animal → shelter ──────────────────────────────────────────────────
  {
    id: 'animal_shelter',
    priority: 5,
    radius: 160,
    cooldown: 6000,
    bidirectional: true,
    match: (src, tgt) => src.hasTag('animal') && tgt.hasTag('shelter'),
    async action(src, tgt, ctrl) {
      const ap = approachPos(src, tgt, 55);
      await ctrl.moveTo(src, ap.x, ap.y, 700);
      // Shelter wiggles/opens, animal pauses
      await Promise.all([
        ctrl.playOnce(tgt, 'subtle_wiggle', { amplitude: 4, speed: 0.8 }, 1000),
        wait(1000),
      ]);
      await ctrl.returnToOrigin(src, 500);
    },
  },

  // ── 9. Animal → food ─────────────────────────────────────────────────────
  {
    id: 'animal_food',
    priority: 6,
    radius: 160,
    cooldown: 5000,
    bidirectional: true,
    match: (src, tgt) => src.hasTag('animal') && tgt.hasTag('food'),
    async action(src, tgt, ctrl) {
      const ap = approachPos(src, tgt, 45);
      await ctrl.moveTo(src, ap.x, ap.y, 600);
      // Food bounces excitedly
      await Promise.all([
        ctrl.playOnce(tgt, 'hop', { hopHeight: 18, hopSpeed: 1.2, travelRange: 8 }, 900),
        ctrl.playOnce(src, 'hop', { hopHeight: 10, hopSpeed: 1.0, travelRange: 6 }, 900),
      ]);
      await ctrl.returnToOrigin(src, 500);
    },
  },

  // ── 10. Mobile → obstacle avoidance ─────────────────────────────────────
  {
    id: 'mobile_obstacle',
    priority: 4,
    radius: 120,
    cooldown: 3000,
    bidirectional: true,
    match: (src, tgt) => src.hasTag('mobile') && tgt.hasTag('obstacle'),
    async action(src, tgt, ctrl) {
      const sc = center(src);
      const tc = center(tgt);
      // Move away perpendicular to the obstacle
      const avoidX = sc.x + (sc.y > tc.y ? 80 : -80);
      const avoidY = sc.y + (sc.x > tc.x ? 40 : -40);
      await ctrl.moveTo(src, avoidX, avoidY, 500);
      await wait(200);
      await ctrl.returnToOrigin(src, 500);
    },
  },

  // ── 11. Rain source → rain-reactive object (umbrella) ───────────────────
  {
    id: 'rain_reactive',
    priority: 8,
    radius: 160,
    cooldown: 5000,
    bidirectional: true,
    match: (src, tgt) => src.hasTag('rain_source') && tgt.hasTag('rain_reactive'),
    async action(src, tgt, ctrl) {
      // Umbrella opens/closes in the rain
      await Promise.all([
        ctrl.playOnce(tgt, 'open_close', { openScale: 1.15, speed: 0.5 }, 2000),
        ctrl.playOnce(src, 'fall', {}, 2000),
      ]);
    },
  },

  // ── 12. Flying → land on shelter or tree ────────────────────────────────
  {
    id: 'flying_land',
    priority: 6,
    radius: 180,
    cooldown: 6000,
    bidirectional: true,
    match: (src, tgt) =>
      src.hasTag('flying') && (tgt.hasTag('shelter') || tgt.label === 'tree'),
    async action(src, tgt, ctrl) {
      const tc = center(tgt);
      // Fly to just above the target
      const landX = tc.x - src.bbox.width / 2;
      const landY = tc.y - tgt.bbox.height / 2 - 10;
      await ctrl.moveTo(src, landX, landY, 900);
      // Perch with a subtle wiggle
      await ctrl.playOnce(src, 'subtle_wiggle', { amplitude: 3, speed: 0.5 }, 1200);
      // Lift off and return
      await ctrl.returnToOrigin(src, 700);
    },
  },

];
