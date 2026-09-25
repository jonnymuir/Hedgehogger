// Regression test for a real shipped bug: collectibles (apples/beetles) live
// on the level's own data object, so `collected` was never reset between
// runs — once eaten, an item stayed collected forever, even across restarts.

const { test, expect } = require('@playwright/test');

test('a collected item is collectible again after a restart', async ({ page }) => {
  await page.goto('/index.html');

  await page.evaluate(() => {
    const g = window.__hedgehogger;
    g.setLevel(g.levelsById.get('level1'));
    g.beginPlaying();
  });

  // Level 1's row 1 has apples at columns 1 and 5; walk onto the col-1 one.
  await page.evaluate(() => window.__hedgehogger.performMove('UP'));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__hedgehogger.performMove('LEFT'));
  await page.evaluate(() => window.__hedgehogger.performMove('LEFT'));
  await page.waitForTimeout(200);

  const firstPlaythrough = await page.evaluate(() => ({
    apples: window.__hedgehogger.apples,
    collectedFlag: window.__hedgehogger.level.lanes[1].items[0].collected,
  }));
  expect(firstPlaythrough).toEqual({ apples: 1, collectedFlag: true });

  await page.evaluate(() => {
    const g = window.__hedgehogger;
    g.resetRun();
    g.beginPlaying();
  });

  const afterReset = await page.evaluate(() => window.__hedgehogger.level.lanes[1].items[0].collected);
  expect(afterReset).toBe(false);

  await page.evaluate(() => window.__hedgehogger.performMove('UP'));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__hedgehogger.performMove('LEFT'));
  await page.evaluate(() => window.__hedgehogger.performMove('LEFT'));
  await page.waitForTimeout(200);

  const secondPlaythrough = await page.evaluate(() => window.__hedgehogger.apples);
  expect(secondPlaythrough).toBe(1);
});
