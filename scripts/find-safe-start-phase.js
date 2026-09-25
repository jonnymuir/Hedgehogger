#!/usr/bin/env node
// For the very first hazard lane a fresh run reaches, the player always
// arrives at ~t=0 at a FIXED column with zero prior chance to observe or
// deviate. Every other lane is covered by the exhaustive per-cycle proof in
// tests/lane-safety.spec.js (arrival time varies enough across a
// playthrough), but this one deserves a deliberately generous, provable
// safety window at t=0 specifically — see docs/design.md's "Fairness
// testing" section for the full reasoning, and level1.js/level2.js's row-2
// comments for where this script's output actually got used.
//
// Usage: node scripts/find-safe-start-phase.js
// Edit the CASES array below to search a new lane's obstacle config.

function wrapX(startX, dir, speed, t, width, margin) {
  const cycle = width + margin * 2;
  let x = startX + dir * speed * t;
  return ((x + margin) % cycle + cycle) % cycle - margin;
}

function evenlySpaced(count, width, margin, phaseOffset = 0) {
  const cycle = width + margin * 2;
  const spacing = cycle / count;
  const out = [];
  for (let k = 0; k < count; k++) {
    let x = k * spacing - margin + phaseOffset;
    if (x > width + margin) x -= cycle;
    out.push(x);
  }
  return out;
}

const W = 392; // logical width = cols(7) * laneSize(56)
const MARGIN = 100;
const START_COL_X = 3.5 * 56; // col 3 center

function firstDangerTime(starts, dir, speed, width, radiusThresh, maxT = 3) {
  const steps = 30000;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * maxT;
    for (const startX of starts) {
      const x = wrapX(startX, dir, speed, t, W, MARGIN);
      const closestX = Math.max(x, Math.min(START_COL_X, x + width));
      if (Math.abs(START_COL_X - closestX) < radiusThresh) return t;
    }
  }
  return Infinity;
}

function searchBestPhase(name, count, width, speed, dir, radiusThresh) {
  let best = { phase: 0, t: -1 };
  for (let phase = 0; phase < 296; phase += 2) {
    const starts = evenlySpaced(count, W, MARGIN, phase);
    const t = firstDangerTime(starts, dir, speed, width, radiusThresh);
    if (t > best.t) best = { phase, t };
  }
  console.log(`${name}: best phase=${best.phase}, safe until t=${best.t.toFixed(3)}s`);
  return best;
}

const PLAYER_RADIUS_THRESH = 56 * 0.33 * 0.72; // matches engine.js's ROAD hit-test

searchBestPhase('mowers (width70, speed78, dir+1)', 2, 70, 78, 1, PLAYER_RADIUS_THRESH);
searchBestPhase('mowers (width70, speed84, dir+1)', 2, 70, 84, 1, PLAYER_RADIUS_THRESH);
searchBestPhase('cats (width46, speed66, dir-1)', 2, 46, 66, -1, PLAYER_RADIUS_THRESH);
searchBestPhase('cats (width46, speed70, dir-1)', 2, 46, 70, -1, PLAYER_RADIUS_THRESH);
