// The progress hub — the game's home screen. See docs/design.md's
// "The progress hub" section for the coexistence architecture (the hub and
// the engine are two independent objects sharing one canvas, each gated by
// its own `active` flag).

const { test, expect } = require('@playwright/test');

// Matches hub.js's own tile layout constants.
const HEADER_H = 96;
const TILE_H = 108;
const TILE_GAP = 14;

async function tapTile(page, index) {
  await page.evaluate(({ index, HEADER_H, TILE_H, TILE_GAP }) => {
    const c = document.getElementById('gameCanvas');
    const rect = c.getBoundingClientRect();
    // logicalHeight = HEADER_H + (levels+1 tiles) * (TILE_H+TILE_GAP) + PAD(18)
    const g = window.__hedgehogger;
    const logicalHeight = HEADER_H + (g.levels.length + 1) * (TILE_H + TILE_GAP) + 18;
    const yFrac = (HEADER_H + index * (TILE_H + TILE_GAP) + TILE_H / 2) / logicalHeight;
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + yFrac * rect.height;
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX, clientY, bubbles: true, pointerId: 1, isPrimary: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { clientX, clientY, bubbles: true, pointerId: 1, isPrimary: true }));
  }, { index, HEADER_H, TILE_H, TILE_GAP });
}

async function tapCanvasCenter(page) {
  await page.evaluate(() => {
    const c = document.getElementById('gameCanvas');
    const rect = c.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX, clientY, bubbles: true, pointerId: 1, isPrimary: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { clientX, clientY, bubbles: true, pointerId: 1, isPrimary: true }));
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(300);
});

test('fresh load shows the hub, not a level', async ({ page }) => {
  const state = await page.evaluate(() => ({
    gameActive: window.__hedgehogger.active,
    gameHasLevel: !!window.__hedgehogger.level,
    mapLinkHidden: document.getElementById('map-link').hidden,
  }));
  expect(state).toEqual({ gameActive: false, gameHasLevel: false, mapLinkHidden: true });
});

test('a locked level tile does nothing when tapped', async ({ page }) => {
  await tapTile(page, 1); // Level 2, locked on a fresh save
  await page.waitForTimeout(150);
  const active = await page.evaluate(() => window.__hedgehogger.active);
  expect(active).toBe(false);
});

test('tapping an unlocked tile starts playing immediately, no extra tap needed', async ({ page }) => {
  await tapTile(page, 0); // Level 1, always unlocked
  await page.waitForTimeout(150);
  const state = await page.evaluate(() => ({
    active: window.__hedgehogger.active,
    state: window.__hedgehogger.state,
    levelId: window.__hedgehogger.level?.id,
    mapLinkHidden: document.getElementById('map-link').hidden,
  }));
  expect(state).toEqual({ active: true, state: 'PLAYING', levelId: 'level1', mapLinkHidden: false });
});

test('completing a level returns to the hub and unlocks the next one', async ({ page }) => {
  await tapTile(page, 0);
  await page.waitForTimeout(150);
  // Force a deterministic win rather than blind-rushing the level's real
  // hazards (which can legitimately die — that's the game being a game,
  // see docs/design.md; this test is only about the hub's own reaction to
  // LEVEL_COMPLETE, already covered separately by fairness.spec.js).
  await page.evaluate(() => {
    const g = window.__hedgehogger;
    g.player.laneIndex = g.level.rows - 1;
    g.player.gridX = g.level.goalCols[0];
    g.updatePlayerWorldTarget(true);
    g.player.jumpProgress = 1;
    g.triggerWin();
  });
  await page.waitForTimeout(200);
  await tapCanvasCenter(page); // "BACK TO MAP" on the LEVEL_COMPLETE banner

  await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({
    active: window.__hedgehogger.active,
    mapLinkHidden: document.getElementById('map-link').hidden,
    progress: JSON.parse(localStorage.getItem('hh_progress')),
  }));
  expect(after.active).toBe(false);
  expect(after.mapLinkHidden).toBe(true);
  expect(after.progress.unlocked).toContain('level2');

  await tapTile(page, 1); // now-unlocked Level 2
  await page.waitForTimeout(150);
  const levelId = await page.evaluate(() => window.__hedgehogger.level?.id);
  expect(levelId).toBe('level2');
});

test('the Map link returns to the hub mid-level without completing it', async ({ page }) => {
  await tapTile(page, 0);
  await page.waitForTimeout(150);
  await page.evaluate(() => document.getElementById('map-link').click());
  await page.waitForTimeout(150);
  const state = await page.evaluate(() => ({
    active: window.__hedgehogger.active,
    mapLinkHidden: document.getElementById('map-link').hidden,
  }));
  expect(state).toEqual({ active: false, mapLinkHidden: true });
});

test('an already-completed level can be replayed from the hub', async ({ page }) => {
  // Seed a completed state directly — the win mechanic itself is covered by
  // fairness.spec.js; this test is only about the hub's own replay behavior.
  await page.evaluate(() => {
    localStorage.setItem('hh_progress', JSON.stringify({ unlocked: ['level1', 'level2'], lastPlayed: 'level1' }));
    localStorage.setItem('hh_level1_bestscore', '330');
    localStorage.setItem('hh_level1_besttime', '3300');
  });
  await page.reload();
  await page.waitForTimeout(300);
  await tapTile(page, 0);
  await page.waitForTimeout(150);
  const state = await page.evaluate(() => ({ active: window.__hedgehogger.active, levelId: window.__hedgehogger.level?.id, state: window.__hedgehogger.state }));
  expect(state).toEqual({ active: true, levelId: 'level1', state: 'PLAYING' });
});
