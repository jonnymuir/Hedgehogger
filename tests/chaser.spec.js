// The prowling cat, verified directly against engine state rather than via
// bot play. This is deliberate: the chaser's one real shipped bug (an
// absolute-elapsed-time model that read as an immediate, unavoidable catch
// for any player who took more than an instant to make their first move)
// was invisible to every bot test, because a bot reacts within the same JS
// tick — faster than any human ever could. It was only caught by stepping
// the engine's own update() with the player deliberately left idle. See
// docs/design.md's "Mechanic spec: the prowling cat" for the full story.
//
// Looped over every level that has a `chaser` config (currently Level 3 and
// Level 4 — Level 4 reuses the same mechanic under its 3D renderer, but
// these tests never touch rendering, only engine state, so they apply
// identically regardless of how the level is drawn).

const { test, expect } = require('@playwright/test');

const CHASER_LEVEL_IDS = ['level3', 'level4'];

for (const levelId of CHASER_LEVEL_IDS) {
  test.describe(`${levelId} chaser: idle-grace period`, () => {
    test('any hesitation shorter than idleGrace before the first move is always safe', async ({ page }) => {
      await page.goto('/index.html');
      const results = await page.evaluate((id) => {
        const g = window.__hedgehogger;
        const idleGrace = g.levelsById.get(id).chaser.idleGrace;
        const out = [];
        for (const hesitateS of [0.1, 1, idleGrace - 0.2]) {
          g.setLevel(g.levelsById.get(id));
          g.beginPlaying();
          const DT = 1 / 60;
          for (let i = 0; i < Math.round(hesitateS / DT); i++) g.update(DT);
          out.push({ hesitateS, state: g.state });
        }
        return out;
      }, levelId);
      for (const r of results) {
        expect(r.state, `hesitating ${r.hesitateS}s before the first move should be safe`).toBe('PLAYING');
      }
    });

    test('sustained idling well beyond idleGrace eventually becomes dangerous', async ({ page }) => {
      await page.goto('/index.html');
      const result = await page.evaluate((id) => {
        const g = window.__hedgehogger;
        g.setLevel(g.levelsById.get(id));
        g.beginPlaying();
        const DT = 1 / 60;
        for (let i = 0; i < 60 * 30; i++) g.update(DT); // 30s of doing nothing at all
        return { state: g.state, deathCause: g.deathCause };
      }, levelId);
      expect(result.state).not.toBe('PLAYING');
      expect(result.deathCause).toContain('prowling cat');
    });

    test('any move resets the idle clock, giving a fresh grace period', async ({ page }) => {
      await page.goto('/index.html');
      const result = await page.evaluate((id) => {
        const g = window.__hedgehogger;
        g.setLevel(g.levelsById.get(id));
        g.beginPlaying();
        const DT = 1 / 60;
        const idleGrace = g.level.chaser.idleGrace;
        // Repeatedly wait just under idleGrace, then sidestep — should never
        // accumulate enough idle time to become dangerous.
        for (let cycle = 0; cycle < 6; cycle++) {
          for (let i = 0; i < Math.round((idleGrace - 0.3) / DT); i++) g.update(DT);
          g.performMove(cycle % 2 === 0 ? 'RIGHT' : 'LEFT');
        }
        return { state: g.state };
      }, levelId);
      expect(result.state).toBe('PLAYING');
    });
  });

  test.describe(`${levelId} chaser: catch boundary`, () => {
    async function setupChaser(page, { gapRows, sameCol, extra = {} }) {
      return page.evaluate(({ id, gapRows, sameCol, extra }) => {
        const g = window.__hedgehogger;
        g.setLevel(g.levelsById.get(id));
        g.beginPlaying();
        g.player.laneIndex = 9; // a SAFE lane, away from other hazards, in every chaser level
        g.player.gridX = 3;
        g.updatePlayerWorldTarget(true);
        g.player.jumpProgress = extra.jumpProgress ?? 1;
        g.player.isRolling = extra.isRolling ?? false;
        g.chaser.row = 9 - gapRows;
        g.chaser.col = sameCol ? 3 : 5;
        g.chaser.idleTime = 999; // well past idleGrace
        g.update(0.001);
        return { state: g.state };
      }, { id: levelId, gapRows, sameCol, extra });
    }

    test('just outside catchRange is safe', async ({ page }) => {
      await page.goto('/index.html');
      const { state } = await setupChaser(page, { gapRows: 0.65, sameCol: true });
      expect(state).toBe('PLAYING');
    });

    test('just inside catchRange catches you', async ({ page }) => {
      await page.goto('/index.html');
      const { state } = await setupChaser(page, { gapRows: 0.55, sameCol: true });
      expect(state).toBe('DEATH_ANIM');
    });

    test('a different column protects you even at close row range', async ({ page }) => {
      await page.goto('/index.html');
      const { state } = await setupChaser(page, { gapRows: 0.1, sameCol: false });
      expect(state).toBe('PLAYING');
    });

    test('rolling protects you from a pounce', async ({ page }) => {
      await page.goto('/index.html');
      const { state } = await setupChaser(page, { gapRows: 0.1, sameCol: true, extra: { isRolling: true } });
      expect(state).toBe('PLAYING');
    });

    test('mid-air (not yet landed) protects you from a pounce', async ({ page }) => {
      await page.goto('/index.html');
      const { state } = await setupChaser(page, { gapRows: 0.1, sameCol: true, extra: { jumpProgress: 0.2 } });
      expect(state).toBe('PLAYING');
    });
  });
}
