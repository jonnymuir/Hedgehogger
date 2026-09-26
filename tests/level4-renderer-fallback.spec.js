// A real, shipped bug: when Renderer3D.init() fails (originally: prismreference.com's
// CSP — script-src 'self' — silently blocked loading Three.js from a CDN; now
// that js/renderer3d.js vendors a same-origin build, this covers any other
// load failure instead, e.g. a flaky connection), ensureRenderer3D()'s catch
// branch replaces `game.renderer3D` with a plain fallback marker object.
// resize() calls `renderer3D?.handleResize(...)` unconditionally for any
// render3D level, regardless of load success — `?.` only guards the
// property itself being null/undefined, not a *missing method* being
// called — so a fallback object without a real handleResize() threw on the
// very next resize(), which happens inside setLevel(), which runs
// BEFORE resetRun() — so retrying Level 4 after a failed 3D load left the
// engine stuck showing the previous run's stale state (its own
// LEVEL_COMPLETE banner, with no way to actually play again).
//
// This intercepts the real vendored module request (still entirely
// same-origin/offline — no external network involved either way) to
// reproduce the genuine failure path end to end, rather than hand-asserting
// against a shape that could silently drift from what the real catch branch
// produces.

const { test, expect } = require('@playwright/test');

test.describe('Level 4: 3D renderer load failure fallback', () => {
  test('a failed 3D load falls back safely, and retrying afterward does not corrupt state', async ({ page }) => {
    await page.route('**/vendor/three.module.min.js', (route) => route.abort());
    await page.goto('/index.html');

    const result = await page.evaluate(async () => {
      const g = window.__hedgehogger;
      g.setLevel(g.levelsById.get('level4'));
      await g.ensureRenderer3D();
      const afterLoadFailure = { ready: g.renderer3D?.ready, failed: g.renderer3D?.failed };

      let threw = null;
      try {
        g.resize();
      } catch (err) {
        threw = err.message;
      }

      // Simulate winning, then retrying from the hub — exactly the
      // sequence that used to get stuck on the old LEVEL_COMPLETE banner.
      g.triggerWin();
      g.setLevel(g.levelsById.get('level4'));

      return { afterLoadFailure, threwOnResize: threw, stateAfterRetry: g.state };
    });

    expect(result.afterLoadFailure).toEqual({ ready: false, failed: true });
    expect(result.threwOnResize).toBeNull();
    expect(result.stateAfterRetry).toBe('START');
  });
});
