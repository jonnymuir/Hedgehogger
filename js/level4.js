/**
 * Level 4: "Twilight Chase"
 *
 * The new thing here isn't a hazard type — it's the rendering paradigm
 * itself: after the player taps to begin, a one-time cinematic morphs the
 * view from this game's ordinary flat 2D into a full 3D third-person
 * chase-cam scene (see engine.js's ENTERING_3D state and js/renderer3d.js).
 * That's the direct parallel to how Level 2's new thing was "the scrolling
 * camera itself" and Level 3's was "the chaser" (docs/design.md's Mechanic
 * ledger) — so this level deliberately reuses Level 3's exact hazard
 * vocabulary (road/river/sprinkler/chaser) in a fresh arrangement rather
 * than introducing anything new to survive.
 *
 * One layout rule specific to this level, driven by the 3D chase camera's
 * narrower per-instant field of view versus the old full-lane-width
 * top-down view (see docs/design.md's Level 4 mechanic spec): every hazard
 * lane is followed by a SAFE buffer row, never back-to-back, to give the
 * player extra margin. Row 9 is kept SAFE in particular so
 * tests/chaser.spec.js's shared catch-boundary fixture (which plants the
 * player at a known SAFE lane away from other hazards) keeps working
 * unmodified once generalized across levels.
 */

import { evenlySpaced } from './level-utils.js';

const W = 392; // logical width = cols(7) * laneSize(56)

export const LEVEL_4 = {
  id: 'level4',
  name: 'Twilight Chase',
  render3D: true,
  cols: 7,
  rows: 21,
  viewportRows: 11,
  laneSize: 56,
  startCol: 3,
  goalCols: [1, 3, 5],
  introText: 'The garden feels bigger tonight — keep your eyes on what\'s just ahead.',
  chaser: {
    idleGrace: 2.2,
    climbRate: 0.55,
    turnSpeed: 2.6,
    prowlRange: 2.5,
    catchRange: 0.6,
  },
  lanes: [
    // 0 — start
    { type: 'SAFE' },

    // 1 — buffer, first collectibles
    { type: 'SAFE', items: [{ col: 2, type: 'APPLE' }, { col: 4, type: 'APPLE' }] },

    // 2 — road, mowers moving right
    {
      type: 'ROAD',
      dir: 1,
      speed: 88,
      obstacles: evenlySpaced(2, W, 100, 20).map((startX) => ({ kind: 'MOWER', width: 70, height: 34, startX })),
    },

    // 3 — safe buffer
    { type: 'SAFE', items: [{ col: 3, type: 'BEETLE' }] },

    // 4 — river, logs drifting left
    {
      type: 'RIVER',
      dir: -1,
      speed: 58,
      obstacles: evenlySpaced(3, W, 100, 50).map((startX) => ({ kind: 'LOG', width: 120, height: 40, startX })),
    },

    // 5 — safe buffer
    { type: 'SAFE', items: [{ col: 1, type: 'APPLE' }, { col: 5, type: 'APPLE' }] },

    // 6 — telegraphed sprinkler pair
    {
      type: 'SPRINKLER',
      sprinklers: [
        { col: 2, radius: 72, cycle: 3.5, idleFor: 1.9, chargeFor: 0.6, burstFor: 1.0, phase: 0 },
        { col: 4, radius: 72, cycle: 3.5, idleFor: 1.9, chargeFor: 0.6, burstFor: 1.0, phase: 1.75 },
      ],
    },

    // 7 — safe buffer
    { type: 'SAFE', items: [{ col: 2, type: 'BEETLE' }] },

    // 8 — road, cats moving left
    {
      type: 'ROAD',
      dir: -1,
      speed: 92,
      obstacles: evenlySpaced(2, W, 100, 80).map((startX) => ({ kind: 'CAT', width: 46, height: 30, startX })),
    },

    // 9 — safe buffer (kept clean — see tests/chaser.spec.js's shared fixture)
    { type: 'SAFE', items: [{ col: 4, type: 'APPLE' }] },

    // 10 — tighter river crossing
    {
      type: 'RIVER',
      dir: 1,
      speed: 60,
      obstacles: evenlySpaced(4, W, 100, 10).map((startX) => ({ kind: 'LOG', width: 86, height: 40, startX })),
    },

    // 11 — safe buffer
    { type: 'SAFE', items: [{ col: 1, type: 'APPLE' }, { col: 5, type: 'APPLE' }] },

    // 12 — three-sprinkler gauntlet
    {
      type: 'SPRINKLER',
      sprinklers: [
        { col: 1, radius: 68, cycle: 3.6, idleFor: 1.9, chargeFor: 0.6, burstFor: 1.1, phase: 0 },
        { col: 3, radius: 68, cycle: 3.6, idleFor: 1.9, chargeFor: 0.6, burstFor: 1.1, phase: 1.2 },
        { col: 5, radius: 68, cycle: 3.6, idleFor: 1.9, chargeFor: 0.6, burstFor: 1.1, phase: 2.4 },
      ],
    },

    // 13 — safe buffer
    { type: 'SAFE', items: [{ col: 3, type: 'BEETLE' }] },

    // 14 — road lane mixing a mower and a cat
    {
      type: 'ROAD',
      dir: 1,
      speed: 84,
      obstacles: [
        { kind: 'MOWER', width: 70, height: 34, startX: -80 },
        { kind: 'CAT', width: 46, height: 30, startX: 210 },
      ],
    },

    // 15 — safe buffer
    { type: 'SAFE', items: [{ col: 2, type: 'APPLE' }] },

    // 16 — river crossing
    {
      type: 'RIVER',
      dir: -1,
      speed: 64,
      obstacles: evenlySpaced(3, W, 100, 30).map((startX) => ({ kind: 'LOG', width: 130, height: 40, startX })),
    },

    // 17 — safe buffer
    { type: 'SAFE', items: [{ col: 4, type: 'BEETLE' }] },

    // 18 — final road, fast mowers
    {
      type: 'ROAD',
      dir: -1,
      speed: 100,
      obstacles: evenlySpaced(2, W, 100, 45).map((startX) => ({ kind: 'MOWER', width: 70, height: 34, startX })),
    },

    // 19 — safe buffer before the goal
    { type: 'SAFE', items: [{ col: 3, type: 'APPLE' }] },

    // 20 — goal row
    { type: 'GOAL' },
  ],
};
