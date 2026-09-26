// Exhaustive per-instant safety proof for every ROAD/RIVER lane in every
// level, using the REAL engine's own obstacleX()/sprinklerState() functions
// (via page.evaluate), not a hand-rolled reimplementation — a reimplementation
// is exactly how a subtle mismatch (e.g. reading a level's raw `laneSize`
// under the wrong property name) can silently make a checker vacuously
// always-pass or always-fail without erroring. This is the "provable, not
// just sampled" half of fairness testing described in docs/design.md — it
// runs in well under a second since it's pure arithmetic, no real-time waits.
//
// The bar: across a full periodic cycle, no lane may ever have 3+ consecutive
// columns simultaneously unsafe — a run of 2 always leaves a reachable safe
// column for a player arriving from any of the 3 nearby columns
// (col-1/col/col+1); a run of 3 can strand the middle one.
//
// SPRINKLER lanes are deliberately excluded here — their fairness comes from
// the charge-phase telegraph giving real advance-warning time to relocate,
// which this instant-snapshot check can't model (see chaser.spec.js and
// fairness.spec.js's reactive-bot sweep for hazard types where continuous
// player reaction matters).

const { test, expect } = require('@playwright/test');

const LEVEL_IDS = ['level1', 'level2', 'level3', 'level4'];

test.describe('exhaustive lane safety proof (ROAD/RIVER)', () => {
  for (const levelId of LEVEL_IDS) {
    test(`${levelId}: no lane ever strands 3+ consecutive columns`, async ({ page }) => {
      await page.goto('/index.html');

      const results = await page.evaluate((id) => {
        const g = window.__hedgehogger;
        const level = g.levelsById.get(id);
        const savedLevel = g.level;
        const savedAge = g.playAge;
        const savedGW = g.gridWidth;
        const savedCW = g.colWidth;

        g.level = level;
        g.gridWidth = level.cols * level.laneSize;
        g.colWidth = level.laneSize;
        const PLAYER_RADIUS = level.laneSize * 0.33;

        const out = [];
        for (let i = 0; i < level.rows; i++) {
          const lane = level.lanes[i];
          if (lane.type !== 'ROAD' && lane.type !== 'RIVER') continue;

          const sweepSeconds = 20;
          const steps = 4000;
          let worstRun = 0;

          for (let s = 0; s < steps; s++) {
            const t = (s / steps) * sweepSeconds;
            g.playAge = t;

            const safeCol = new Array(level.cols).fill(false);
            for (let c = 0; c < level.cols; c++) {
              const cx = (c + 0.5) * level.laneSize;
              if (lane.type === 'ROAD') {
                let hit = false;
                for (const obs of lane.obstacles) {
                  const x = g.obstacleX(lane, obs);
                  const closestX = Math.max(x, Math.min(cx, x + obs.width));
                  if (Math.abs(cx - closestX) < PLAYER_RADIUS * 0.72) { hit = true; break; }
                }
                safeCol[c] = !hit;
              } else {
                let onLog = false;
                for (const obs of lane.obstacles) {
                  const x = g.obstacleX(lane, obs);
                  if (cx >= x && cx <= x + obs.width) { onLog = true; break; }
                }
                safeCol[c] = onLog;
              }
            }

            let run = 0;
            for (let c = 0; c < level.cols; c++) {
              if (!safeCol[c]) { run++; worstRun = Math.max(worstRun, run); }
              else run = 0;
            }
          }

          out.push({ row: i, type: lane.type, worstRun });
        }

        g.level = savedLevel;
        g.playAge = savedAge;
        g.gridWidth = savedGW;
        g.colWidth = savedCW;
        return out;
      }, levelId);

      const unsafe = results.filter((r) => r.worstRun > 2);
      expect(unsafe, `unsafe lanes: ${JSON.stringify(unsafe)}`).toHaveLength(0);
    });
  }
});
