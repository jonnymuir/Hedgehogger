// Shared test helpers. The in-browser bot runs entirely inside the page (no
// Playwright round-trips during its decision loop) specifically because an
// earlier version of this test suite that drove moves from Node, one
// `page.evaluate()` call at a time, suffered enough cross-process timing
// jitter to produce false-positive "unfair" failures that weren't real. See
// docs/design.md's "Fairness testing" section for the full story.

const REACTIVE_BOT_SRC = `
window.runReactivePlay = async function runReactivePlay(levelId, opts) {
  opts = opts || {};
  const g = window.__hedgehogger;
  const TICK = 90; // continuous-attention polling interval
  const LOOKAHEAD = 0.12; // matches the engine's own landing-check delay
  const level = g.levelsById.get(levelId);
  g.setLevel(level);
  g.beginPlaying();

  function isSafeAt(lane, col, t) {
    const cx = (col + 0.5) * g.colWidth;
    const savedAge = g.playAge;
    g.playAge = t;
    let safe = true;
    if (lane.type === 'ROAD') {
      safe = !lane.obstacles.some((obs) => {
        const x = g.obstacleX(lane, obs);
        const closestX = Math.max(x, Math.min(cx, x + obs.width));
        return Math.abs(cx - closestX) < g.player.radius * 0.72;
      });
    } else if (lane.type === 'RIVER') {
      safe = lane.obstacles.some((obs) => {
        const x = g.obstacleX(lane, obs);
        return cx >= x + 4 && cx <= x + obs.width - 4;
      });
    } else if (lane.type === 'SPRINKLER') {
      safe = !lane.sprinklers.some((spr) => {
        const { state } = g.sprinklerState(spr);
        if (state !== 'burst') return false;
        const sx = (spr.col + 0.5) * g.colWidth;
        return Math.abs(cx - sx) < spr.radius * 0.8;
      });
    }
    g.playAge = savedAge;
    return safe;
  }

  function isSafeSpan(lane, col, t, span, samples) {
    for (let i = 0; i <= samples; i++) if (!isSafeAt(lane, col, t + (span * i) / samples)) return false;
    return true;
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  let steps = 0;
  let dawdled = false;
  while (steps++ < (opts.maxSteps || 400)) {
    if (g.state !== 'PLAYING') break;
    const lane = g.player.laneIndex;
    const col = g.player.gridX;
    const curLaneData = level.lanes[lane];
    const t = g.playAge;

    if (curLaneData.type === 'ROAD' || curLaneData.type === 'SPRINKLER') {
      if (!isSafeSpan(curLaneData, col, t, 0.25, 3)) {
        const evadeCandidates = [col - 1, col + 1].filter((c) => c >= 0 && c < level.cols);
        let evaded = false;
        for (const c of evadeCandidates) {
          if (isSafeSpan(curLaneData, c, t + LOOKAHEAD, 0.2, 2)) {
            if (c < col) g.performMove('LEFT'); else g.performMove('RIGHT');
            evaded = true;
            break;
          }
        }
        if (evaded) { await sleep(TICK); continue; }
      }
    }

    if (opts.dawdleAtLane !== undefined && lane === opts.dawdleAtLane && curLaneData.type === 'SAFE' && !dawdled) {
      dawdled = true;
      await sleep(opts.dawdleMs || 0);
      continue;
    }

    if (lane === level.rows - 1) {
      const goalCols = level.goalCols.slice().sort((a, b) => Math.abs(a - col) - Math.abs(b - col));
      if (goalCols[0] < col) g.performMove('LEFT');
      else if (goalCols[0] > col) g.performMove('RIGHT');
      await sleep(TICK);
      continue;
    }

    const targetLane = level.lanes[Math.min(level.rows - 1, lane + 1)];
    const arrivalT = t + LOOKAHEAD;
    const candidates = [col, col - 1, col + 1].filter((c) => c >= 0 && c < level.cols);
    let best = null;
    for (const c of candidates) {
      if (isSafeAt(targetLane, c, arrivalT) && isSafeSpan(targetLane, c, arrivalT, 0.2, 2)) { best = c; break; }
    }
    if (best === null) { await sleep(TICK); continue; }
    if (best < col) g.performMove('LEFT');
    else if (best > col) g.performMove('RIGHT');
    else g.performMove('UP');
    await sleep(TICK);
  }

  return {
    state: g.state,
    lane: g.player.laneIndex,
    col: g.player.gridX,
    deathCause: g.deathCause,
    playAge: g.playAge,
    levelId: g.level.id,
    steps,
  };
};
`;

async function installBot(page) {
  await page.evaluate(REACTIVE_BOT_SRC);
}

module.exports = { installBot };
