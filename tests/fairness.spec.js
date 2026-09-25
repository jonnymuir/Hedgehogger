// The complementary half of fairness testing to lane-safety.spec.js's
// exhaustive proof: a continuously-reactive bot that actually plays each
// level start to finish, 20 times, checking its own current tile's danger
// every ~90ms rather than only when deciding to advance. That distinction
// matters — see docs/design.md: several early "failures" while building
// this game turned out to be a less careful bot simply standing still in
// the middle of a live road/sprinkler lane for its whole poll interval,
// which is genuinely dangerous but also not something an attentive player
// would ever do. The bar here is 20/20 — a single death means a real bug.

const { test, expect } = require('@playwright/test');
const { installBot } = require('./helpers');

const LEVEL_IDS = ['level1', 'level2', 'level3'];
const TRIALS = 20;

test.describe('informed-dodge fairness sweep', () => {
  for (const levelId of LEVEL_IDS) {
    test(`${levelId}: an attentive player wins ${TRIALS}/${TRIALS}`, async ({ page }) => {
      await page.goto('/index.html');
      await installBot(page);

      const results = [];
      for (let i = 0; i < TRIALS; i++) {
        results.push(await page.evaluate((id) => window.runReactivePlay(id), levelId));
      }

      const failures = results.filter((r) => r.state !== 'LEVEL_COMPLETE');
      expect(failures, `unexpected deaths: ${JSON.stringify(failures)}`).toHaveLength(0);
    });
  }
});
