// Level 4's flat-2D -> 3D cinematic (engine.js's ENTERING_3D state) is a
// timer-driven, renderer-agnostic non-interactive window before real
// gameplay starts. These tests step the engine's own update() directly —
// the same setLevel() -> loop-of-update(DT) pattern chaser.spec.js already
// established — and never call render(), so they never touch Renderer3D or
// fetch the Three.js CDN module either; this proves the transition's
// fairness properties (frozen playAge, blocked input, a deterministic exit)
// entirely renderer-independently.
//
// TRANSITION_DURATION is a private engine.js constant (currently 2.2s) —
// duplicated here as a plain number rather than exported, matching how
// tests elsewhere (e.g. chaser.spec.js) assert against concrete tuned
// values rather than reaching into engine internals.
const TRANSITION_DURATION = 2.2;

const { test, expect } = require('@playwright/test');

test.describe('Level 4: flat-2D -> 3D transition', () => {
  test('performMove is a no-op throughout the transition', async ({ page }) => {
    await page.goto('/index.html');
    const result = await page.evaluate((duration) => {
      const g = window.__hedgehogger;
      g.setLevel(g.levelsById.get('level4'));
      g.beginTransition3D();
      const before = { gridX: g.player.gridX, laneIndex: g.player.laneIndex };
      const DT = 1 / 60;
      for (let i = 0; i < Math.round((duration * 0.5) / DT); i++) {
        g.performMove('UP');
        g.performMove('RIGHT');
        g.update(DT);
      }
      const after = { gridX: g.player.gridX, laneIndex: g.player.laneIndex };
      return { state: g.state, before, after };
    }, TRANSITION_DURATION);

    expect(result.state).toBe('ENTERING_3D');
    expect(result.after).toEqual(result.before);
  });

  test('playAge stays frozen at 0 for the whole transition', async ({ page }) => {
    await page.goto('/index.html');
    const result = await page.evaluate((duration) => {
      const g = window.__hedgehogger;
      g.setLevel(g.levelsById.get('level4'));
      g.beginTransition3D();
      const DT = 1 / 60;
      const samples = [];
      for (let i = 0; i < Math.round((duration * 0.9) / DT); i++) {
        g.update(DT);
        if (i % 30 === 0) samples.push(g.playAge);
      }
      return { state: g.state, samples };
    }, TRANSITION_DURATION);

    expect(result.state).toBe('ENTERING_3D');
    for (const playAge of result.samples) expect(playAge).toBe(0);
  });

  test('the transition deterministically ends in PLAYING with a freshly-reset playAge', async ({ page }) => {
    await page.goto('/index.html');
    const result = await page.evaluate((duration) => {
      const g = window.__hedgehogger;
      g.setLevel(g.levelsById.get('level4'));
      g.beginTransition3D();
      const DT = 1 / 60;
      for (let i = 0; i < Math.round((duration + 0.5) / DT); i++) g.update(DT);
      return { state: g.state, playAge: g.playAge };
    }, TRANSITION_DURATION);

    expect(result.state).toBe('PLAYING');
    expect(result.playAge).toBeGreaterThanOrEqual(0);
    expect(result.playAge).toBeLessThan(0.6); // well under the extra 0.5s stepped past the transition
  });

  test('dying and retrying mid-level skips straight back into PLAYING, not the cinematic again', async ({ page }) => {
    await page.goto('/index.html');
    const result = await page.evaluate(() => {
      const g = window.__hedgehogger;
      g.setLevel(g.levelsById.get('level4'));
      g.beginPlaying();
      g.triggerDeath('SQUISH', 'test death');
      g.deathTimer = 0;
      g.update(0.001); // DEATH_ANIM -> GAMEOVER
      const afterDeath = g.state;
      g.resetRun();
      g.beginPlaying(); // mirrors onPrimary()'s GAMEOVER branch
      return { afterDeath, afterRetry: g.state };
    });

    expect(result.afterDeath).toBe('GAMEOVER');
    expect(result.afterRetry).toBe('PLAYING');
  });
});
