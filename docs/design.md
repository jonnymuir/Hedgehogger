# Hedgehogger: game design document

Hedgehogger is a small, deterministic garden-crossing puzzle game, deployed as the undersold
easter egg on [prismreference.com](https://prismreference.com) — a plain 🦔 link, no card, no
icon, on the home page of [`jonnymuir/Umbraco.Prism`](https://github.com/jonnymuir/Umbraco.Prism)'s
reference app (`homePage.cshtml`). This repo owns the game entirely — source, tests, docs, and its
own deploy pipeline — and has no dependency on that repo's code; Umbraco.Prism just links to
`/games/hedgehogger/index.html`, a path this repo's own deploy pipeline keeps populated on the
same VPS. Built with zero dependencies and no build step (plain ES modules, loaded directly by the
browser) — the only tooling in this repo is for tests and deployment, not the game itself. Level
4 is a single, deliberate, scoped exception to "zero dependencies" — see "Mechanic spec: the
third-dimension shift (Level 4)" below — but it's still no-build-step: `js/renderer3d.js` is the
only file that touches its one dependency (Three.js), and it's a **vendored, pinned build checked
into `js/vendor/`**, not a CDN import and not added to `package.json`. This isn't a style
preference — prismreference.com serves every response with a strict CSP (`script-src 'self'`,
confirmed via `curl -I https://prismreference.com/`), which silently blocks any cross-origin
`import()`. A CDN-hosted Three.js shipped once and quietly degraded Level 4 to its plain 2D
fallback on the live site with no error visible to a player; see the mechanic spec below for the
full story, including a second bug that fallback path itself triggered.

## Design pillars

These are the rules we've agreed on. Treat them as load-bearing — a change that breaks one of
these should be a deliberate decision, not a side effect.

1. **Every level is deterministic.** No `Math.random()` anywhere in a level's gameplay-relevant
   data or timing. Obstacle positions, speeds, and hazard cycles are all fixed numbers, or pure
   functions of elapsed play time (`playAge`). The same level plays out identically every single
   run, on every device. This is what makes a level a *puzzle* instead of a slot machine — it's
   learnable and masterable, and a screenshot/video of a run is reproducible.
2. **The game evolves into a puzzle game, one mechanic at a time.** Each new level either
   introduces exactly one new mechanic, or recombines existing mechanics in a new arrangement/
   difficulty. Never both at once, and never more than one brand-new mechanic per level — that's
   how the pacing teaches players instead of overwhelming them. See "Mechanic ledger" below for
   the running list of what's been taught and when.
3. **Pacing should always feel fun, never unfair.** A death must always be something the player
   could have seen coming and reacted to. Concretely: hazards are telegraphed before they're
   lethal (see the sprinkler's charge-up glow), hazard checks only apply once a hop has actually
   landed (no mid-air/instant deaths), and gaps/timings are generous enough that an attentive
   player — not a lucky one — always has a route through. We verify this with real, committed
   tests (see "Fairness testing" below), not by eyeballing it.
4. **Progress and scores persist locally.** No backend — everything lives in `localStorage`.
   See "Save data" below for the exact schema.
5. **Timing matters.** Every level is scored on both a running point total *and* completion
   time, and the completion time is what's remembered as the level's "best" (alongside best
   score). Speed is a real skill axis here, not a decoration — a level's obstacle pacing should
   be tuned so that a clean, no-hesitation run is meaningfully faster than a cautious one, which
   is what gives the timer teeth.

## Scoring rules

| Event | Points |
|---|---|
| Advancing to a new furthest lane (first time only, per run) | +10 per lane |
| Eating an apple | +15 |
| Eating a beetle | +30 |
| Reaching the goal (completing the level) | +200 |

Score and best-time are tracked **per level** (see save schema) — a longer, harder level
naturally scores higher, so comparing raw scores across levels isn't meaningful.

## Repo layout

```
index.html          — page shell: TWO stacked canvases (see Level 4 below), the back-to-app link,
                       the map link, loads js/main.js
game.css              — layout/letterboxing/link styling only; all game visuals are Canvas
js/
  main.js             — orchestrator: builds the level roster, owns hub<->engine mode switching
  engine.js            — state machine, physics, collision, camera, save data, rendering orchestration
  hub.js                — the level-select home screen (see "The progress hub" below)
  sprites.js             — every 2D visual: layered/shaded Canvas 2D vector art, zero image assets
  renderer3d.js           — Level 4 only: the 3D chase-cam scene (see "Mechanic spec: the
                            third-dimension shift" below) — the repo's one Three.js dependency lives
                            entirely in this file
  vendor/three.module.min.js — the vendored, pinned Three.js build itself (same-origin, checked
                            into the repo — see why in the mechanic spec below)
  level-utils.js          — shared level-authoring helpers (e.g. `evenlySpaced` obstacle placement)
  level1.js, level2.js, level3.js, level4.js, ...  — one file per level, pure declarative data
tests/                — Playwright test suite (see "Fairness testing" below)
scripts/               — one-off authoring tools, e.g. find-safe-start-phase.js
server.js               — zero-dependency static server, used for local dev and by the tests
docs/design.md            — this file
.github/workflows/
  ci.yml                — runs the full test suite on every PR and push to main
  deploy.yml              — manual-dispatch deploy to prismreference.com (see "Deployment" below)
```

Adding a level means writing a new `levelN.js` data file and adding it to the `LEVELS` array in
`main.js` — the engine itself should never need level-specific `if` branches. If a new mechanic
needs new engine code (a new lane `type`, a new hazard shape), that code goes in `engine.js` +
`sprites.js` generically, driven entirely by data on the level object, not hardcoded to a level
id.

### Level data shape

```js
{
  id: 'level2',            // used for save-data keys; must be unique and stable once shipped
  name: 'Rain Garden',       // shown in the HUD and START banner
  nextLevelId: 'level3',     // used by the hub's unlock-on-win logic; omit on the last level
  introText: '...',          // optional level-specific blurb on the START banner
  cols: 7,                   // playing-field width, in columns
  rows: 11,                  // level LENGTH, in rows — can exceed the viewport (see below)
  viewportRows: 11,          // optional; how many rows are visible on screen at once.
                              // Omit it (or set it equal to `rows`) for a single-screen level
                              // with no camera scroll, like Level 1. Set it smaller than `rows`
                              // for a longer level the camera scrolls through as you climb.
  laneSize: 56,               // px per row/column (logical, pre-DPR/scale)
  startCol: 3,
  goalCols: [1, 3, 5],        // burrow columns on the GOAL row (the last row)
  chaser: { ... },            // optional — see "Mechanic spec: the prowling cat" below
  lanes: [ /* one entry per row, index 0 = start (bottom) */ ],
}
```

Lane `type`s implemented so far: `SAFE`, `ROAD` (`MOWER`/`CAT` obstacles), `RIVER` (`LOG`
obstacles), `SPRINKLER` (telegraphed radial hazard), `GOAL` (the last row; only present once,
must be `rows - 1`).

### Fixed playing field, scrollable when a level needs length

The **viewport** (what's rendered on screen, i.e. `logicalWidth` × `logicalHeight`) is always a
fixed, letterboxed-to-fit size — that's what makes the puzzle "the same playing field on every
device." A level's own length (`rows`) is independent of that: a short level like Level 1 sets
no `viewportRows`, so the whole level fits on one screen and the camera never moves (`cameraY`
stays `0` for its whole run, verified — this is a special case of the general camera logic below,
not a separate code path). A longer level sets `viewportRows` below `rows`, and the engine's
camera follows the player upward, clamped to the level's bounds, panning through a level that's
taller than what's ever on screen at once.

### Fairness testing

Level fairness isn't judged by eye, and a naive "bot" isn't automatically trustworthy either —
building this out turned up several ways a fairness test can lie to you. The methodology, now
codified as real committed tests rather than ad-hoc scripts:

1. **Exhaustive proof for continuous hazards (ROAD/RIVER)** — `tests/lane-safety.spec.js`. These
   have no advance-warning telegraph, so their fairness bar is: *at every instant, across a
   lane's full periodic cycle, is there never a run of 3+ consecutive columns that are all
   simultaneously unsafe?* A run of 2 is fine (a player arriving from any of the 3 reachable
   columns — `col-1`/`col`/`col+1` — always has at least one safe option); a run of 3 can strand
   the middle column. This calls the *real* engine functions (`obstacleX()`, `sprinklerState()`)
   directly against a fine-grained time sweep across one full cycle — not a hand-rolled
   reimplementation of the collision math, which is exactly how a subtle mismatch (e.g. reading a
   level's raw `laneSize` under the wrong property name) can silently make a checker vacuously
   always-pass or always-fail without erroring. This check is time-independent: if it passes, the
   lane is safe *no matter when* a player arrives, which matters because arrival time varies
   across playthroughs.
2. **A generous fixed-time margin for the very first hazard lane specifically** —
   `scripts/find-safe-start-phase.js`. Every other lane gets visited at a time that varies with
   how the player actually played, which is what makes the exhaustive per-cycle proof above
   sufficient on its own. The *first* hazard lane (Level 1/2/3's row 2) is a special case: a fresh
   run always reaches it at ~0 seconds in, at a fixed column, with zero prior chance to observe or
   react. A lane can pass the general exhaustive proof and *still* have a narrow real danger
   window right at t=0 if its phase happens to place an obstacle near the start column early on —
   that's exactly what shipped in Level 1 originally (danger only until t≈0.17s, narrow enough
   that testing with realistic reaction speeds missed it, but a fast enough double-hop could still
   hit it). The fix: search for the obstacle phase that maximizes the safe window at the start
   column specifically, and target a couple of seconds of margin, not fractions of a second — this
   is the one lane where "provably safe forever" isn't the bar, but "safe for any
   humanly-plausible arrival speed, with real margin" is.
3. **A continuously-reactive bot for telegraphed hazards (SPRINKLER) and as a final end-to-end
   check** — `tests/fairness.spec.js`, driven by `tests/helpers.js`. The exhaustive per-instant
   check above will show sprinkler lanes as "unsafe" (a burst's radius can span 3 columns) —
   that's an expected false positive, because it doesn't model the 0.6s charge-phase warning a
   real player gets to react to. For these, and as a final full-level sanity check, this uses a
   bot that polls frequently (~90ms) and, at *every* tick, checks whether its *current* tile is
   becoming unsafe soon — not just whether the *next* lane is safe before advancing. That
   distinction matters: several earlier "failures" while building this turned out to be an
   earlier, less careful bot simply standing still in the middle of a live road/sprinkler lane for
   the length of its whole poll interval — which is genuinely dangerous (cars keep moving,
   sprinklers keep cycling), but is also not something an attentive player would ever do. "Keep
   moving once you're on a hazard lane, don't idle in traffic" is a basic, expected rule of this
   genre, not a hidden unfairness — the reactive bot's job is to model *that*, not to model an
   unrealistic player who freezes. The bot runs entirely inside the page (no Playwright
   round-trips during its decision loop) — an earlier version that drove moves from Node, one
   `page.evaluate()` call at a time, suffered enough cross-process timing jitter to produce
   false-positive failures that weren't real.
4. **Direct engine-state verification for reactive hazards (the chaser)** —
   `tests/chaser.spec.js`. See "Mechanic spec: the prowling cat" below — a bot that reacts within
   the same JS tick is *faster than any human ever could be*, which means it can structurally miss
   an entire class of bug that only bites a player who hesitates. These tests step the engine's
   own `update()` directly, with the player deliberately left idle, rather than relying on bot
   play at all.
5. Separately, a "blind rush" test (always move the same direction, ignore all hazards) is
   expected to die sometimes — that's the game being a game. None of the tests above model that;
   don't confuse the two.
6. **Level 4 reuses all of 1-4 above unmodified** — its `render3D` flag only changes how the level
   is drawn, never the underlying grid/collision model those tests query, so `tests/lane-safety.
   spec.js`/`tests/fairness.spec.js` simply include `'level4'` in their existing level lists, and
   `tests/chaser.spec.js` loops over every level that has a `chaser` config. None of this suite
   ever calls the engine's `render()` — every one of these tests drives `update()`/`performMove()`/
   `setLevel()` directly — so Level 4's one dependency (a same-origin vendored Three.js build,
   loaded only inside `js/renderer3d.js`'s `init()`) is never touched by `npm test`, and CI stays
   fully offline (the load doesn't even need external network access any more — see the mechanic
   spec below for why it's vendored, not CDN-loaded). What
   this suite structurally *cannot* check is whether the 3D chase camera itself keeps enough of the
   board on screen to satisfy rule 3 — it only ever queries engine state, never pixels or camera
   framing — so that one property is a manual-playtest sign-off, not an automated guarantee; see
   "Mechanic spec: the third-dimension shift" below.

The bar for 1–4 is **zero deaths**. A death there means a real bug, not a skill check — and
`npm test` runs all of them on every PR via `.github/workflows/ci.yml`.

## Save data (localStorage)

| Key | Shape | Meaning |
|---|---|---|
| `hh_progress` | `{ unlocked: string[], lastPlayed: string \| null }` | Which level ids are unlocked (Level 1's id is always force-unlocked, persisted immediately on boot — see the hub note below), and which one was last played (tracked, not currently used to skip the hub). |
| `hh_<levelId>_bestscore` | integer | Best score ever reached on that level, saved incrementally as it's beaten (lane advances, collectibles), not only on a full win. |
| `hh_<levelId>_besttime` | integer (ms) | Fastest completion time on that level (only set on an actual win). |

Saving progress means: completing a level immediately unlocks and persists the next one, and your
best score/time per level persists whether or not you actually finish that particular run. It does
**not** mean mid-level checkpointing — every level run always starts fresh from row 0, by design
(rule 1: deterministic, replayable, no partial/resumed state to keep in sync).

## The progress hub

The hub (`hub.js`) is the game's home screen and the actual point of the whole save system: **the
real game is maximizing your score on each level**, not just reaching the end once — the hub is
where that becomes visible and actionable. It shows every level as a tile (name, lock state, best
score, best time) plus one trailing "coming soon" placeholder tile for whichever level doesn't
exist yet, reading everything straight from `localStorage` — it has no dependency on a live engine
instance. Tapping an unlocked tile starts that level immediately (skips the engine's own START
banner, since tapping the tile already *is* the "play" action); tapping a locked tile does nothing.

Completing a level, or dying out of one, **always returns to the hub** rather than auto-advancing
to whatever's next — the hub is where the player chooses: replay an already-beaten level to
improve their score, or move on to a newly-unlocked one. The one exception is dying mid-level:
`GAMEOVER`'s primary tap retries the same level directly (no hub round-trip for "let me try
again"), but a small persistent "🗺 Map" link (bottom-left, shown whenever a level is active) is
always available to bail out to the hub instead.

### Coexistence architecture

The hub and the engine (`HedgehoggerGame`) are two independent objects that both exist for the
whole page lifetime and share one canvas, each with its own `active` flag gating both its own
`requestAnimationFrame` work and its own input handlers — only one is ever actually doing anything.
`main.js` is the thin orchestrator: it owns the single window `resize` listener (dispatching to
whichever of the two is currently active — letting both listen independently would mean they fight
over sizing the canvas) and wires the hub's `onSelect` callback to `game.startLevel(id)` and the
engine's `onExit` option back to showing the hub. `HedgehoggerGame.setLevel()` sets `active = true`
as a side effect (so direct-manipulation test scripts that call it without going through the hub
keep working unmodified); `deactivate()` sets it back to `false`.

One real bug from building this: the engine's constructor computes Level 1's forced-unlock
in-memory, but used to only *persist* that to `localStorage` inside `setLevel()` — harmless when
a level always auto-loaded on boot, but once the hub became the entry point, `setLevel()` might
never run before the player's first tap, so the hub would read an empty `unlocked` list and treat
even Level 1 as locked. Fixed by persisting that initial unlock immediately in the constructor,
not deferred to whenever a level happens to load.

## Mechanic ledger

Tracks what each level introduces, so pacing decisions are visible at a glance.

| Level | New mechanic(s) | Reused/recombined |
|---|---|---|
| 1 — Garden Crossing | Road (mower/cat traffic), river (logs), telegraphed sprinkler hazard, goal burrows, apples/beetles | — (this is the tutorial level) |
| 2 — Rain Garden | The scrolling camera / extended length itself — a level too long to see all at once, so the player has to plan ahead without seeing the whole board | Longer arrangement of the same road/river/sprinkler vocabulary from Level 1, no new hazard *type* |
| 3 — Midnight Prowl | The prowling cat (see spec below) | Same terrain as Level 2, lane for lane — the only difference is the cat; roll gains a second meaning (see below) |
| 4 — Twilight Chase | The 3D chase-cam rendering shift itself (see spec below) | Same road/river/sprinkler/chaser vocabulary as Level 3, recombined into a fresh, slightly longer arrangement — no new hazard type |

Rule 2, applied here: scrolling and "the prowling cat" are each their own new thing, so they get
their own levels rather than landing together — Level 2 is deliberately just "the existing
vocabulary, but longer, and you can't see it all at once," with zero new hazard types. Level 3
then goes further: it doesn't even introduce new *terrain*, only the cat, isolating the one new
mechanic as cleanly as possible. Level 4 follows the same discipline at a much bigger scale: the
one new thing is the rendering paradigm itself (flat 2D becoming a full 3D chase-cam scene), so its
lane vocabulary is deliberately unchanged from Level 3's, not a new hazard riding along with it.

### Mechanic spec: the prowling cat (Level 3)

The forcing hazard is a single chaser cat, climbing the garden from below (`level.chaser` on the
level data; engine state lives in `this.chaser`, see `engine.js`'s chaser block in `update()`).
Design goals: it must still satisfy rule 3 (telegraphed, never a surprise) and rule 1
(deterministic — see the note below on what that means for a reactive hazard).

- **Vertical position** (`chaser.row`, world-space, float) only climbs while the player has gone
  `idleGrace` seconds **without moving at all** — any move, forward, lateral, or even backward,
  resets that idle clock back to zero. This is not an incidental detail, it's the load-bearing
  design decision: the first implementation climbed on *absolute elapsed time since the level
  started* instead, and it was a real, serious bug — since the chaser's row is clamped to never
  exceed the player's own row, and a fresh run starts with both at row 0 by definition, an
  absolute-time model read as an immediate, unavoidable catch on the very first frame for any
  player who took more than an instant to make their first move. No real human reacts within one
  rendered frame of tapping "play." It only went undetected by bot-driven testing because a bot
  reacts inside the same JS tick — faster than any human ever could — so it always beat the race
  before the bug could fire. It was caught by testing hesitation directly (stepping the engine's
  own `update()` in a loop with the player deliberately left stationary — see
  `tests/chaser.spec.js`), not by playing the game via a bot. Idle-time-based climbing fixes this
  categorically: it gives a fresh grace period after *every* legitimate pause (reading the intro
  text, sidestepping while timing a sprinkler), not just once at t=0, and it's the only signal
  that actually means "hasn't moved in a while" as opposed to "the level is long."
- **Horizontal position** (`chaser.col`, float) eases toward the player's current column at a
  capped rate (`turnSpeed`, columns/sec) — it's always visibly hunting your column, but can never
  teleport onto you.
- **Telegraph ("stalking")**: once idle time exceeds `idleGrace` *and* the chaser's row closes to
  within `prowlRange` of the player, its sprite switches to a crouched, tail-flicking stalking
  pose (flattened ears, narrowed glowing eyes) — a clear warning before it's actually dangerous.
- **Pounce/catch**: only once idle time exceeds `idleGrace`, the row gap is within `catchRange`
  (smaller than `prowlRange`), the column matches, and the hop has landed, does it actually catch
  you — same landing-grace rule as every other hazard, so there's no mid-air surprise.
- **The cat can only ever be behind/below the player**, never ahead — it approaches from a fixed,
  known direction and is always on screen before it's a threat.
- **Rolling dodges it.** A hedgehog's actual real-world defense against a predator is rolling
  into a spiky ball — so the existing roll move (until now, purely a "cross hazards faster and
  briefly invulnerable" tool) becomes narratively double-purposed: it's now explicitly how you
  shrug off the cat's pounce too. No new input, no new rule — a payoff for reusing rule 2
  ("recombine an existing mechanic in a new way") in the most literal sense.

Level 3's shipped tuning: `idleGrace: 2.5`s, `climbRate: 0.5` rows/sec, `turnSpeed: 2.5`,
`prowlRange: 2.5`, `catchRange: 0.6`. Verified directly (stepping the engine, not just bot play,
see `tests/chaser.spec.js`): any single pause under 2.5s is always completely safe regardless of
when it happens; a genuinely stationary player is eventually caught, but only after a real,
sustained idle stretch (tuned deliberately generous for a third level — "adds jeopardy, doesn't
difficulty-spike"); catchRange, rolling, and mid-air immunity all verified at their exact
boundaries; the full 20-trial informed-dodge sweep passes 20/20 on all three levels with this
tuning.

A note on "deterministic" for a reactive hazard like this: rule 1 means *no `Math.random()`
anywhere in gameplay-relevant state* — most other hazards in this game are a pure function of
`playAge` alone, but the cat is deliberately also a function of the player's own move history
(specifically, how long since their last move). That's still fully deterministic (replay the same
inputs at the same times and you get the identical run); it's the whole point of a *chaser*. It
just means fairness testing for this mechanic can't rely purely on a fast bot (see above) — it
needs the engine's own state stepped directly, with the player deliberately left idle, to catch
the class of bug an instant-reacting bot can never trigger.

### Mechanic spec: the third-dimension shift (Level 4)

Level 4 is Level 3's exact hazard vocabulary (road/river/sprinkler/chaser) recombined into a fresh,
slightly longer arrangement, rendered through a completely different pipeline: a full 3D scene
with a third-person chase camera, via Three.js (see the top of this doc and `js/renderer3d.js`).
The load-bearing design decision, matching this game's other "new mechanic" specs: **the
deterministic 2D grid simulation is entirely unchanged.** `update()`, `obstacleX()`,
`sprinklerState()`, the chaser block, collision, scoring, and save data don't know or care whether
a level is drawn in 2D or 3D — only `render()` does. This is what let the existing fairness proofs
extend to Level 4 with a two-line diff (see "Fairness testing," point 6 above) instead of a
parallel test suite.

- **`level.render3D: true`** is the only thing that marks a level as 3D — `render()`
  (`js/engine.js`) dispatches on this flag, not a level id, keeping the engine's "no per-level `if`
  branches" rule intact.
- **The flat-2D START banner is identical to every other level** — a `render3D` level's `START`
  state renders through the exact same 2D path as Levels 1-3. The 3D scene doesn't even have to be
  loaded yet for this to work.
- **A one-time, non-interactive cinematic (`ENTERING_3D` state)** plays once the player taps to
  begin, crossfading the flat 2D canvas into the 3D canvas underneath it (two stacked `<canvas>`
  elements, see `index.html`/`game.css`) while the camera swoops from a top-down starting pose to
  the chase-cam pose along a quadratic Bezier, over a fixed `TRANSITION_DURATION` (2.2s). Both
  camera poses, and every distance/FOV constant behind them, live in `js/renderer3d.js`
  (`getTopDownPose()`/`getChasePose()`) — not duplicated in `engine.js` — so the cinematic's ending
  pose and the ongoing gameplay camera share exactly one definition.
- **`playAge` is deliberately frozen at 0 for the whole cinematic** (see `update()`'s `ENTERING_3D`
  branch) — the same fairness reasoning as the chaser's idle-time model above, applied here at the
  level-start moment itself: every hazard the player sees during the cutscene is at its exact
  `playAge=0` phase, the identical frame they're standing in front of the instant `PLAYING`
  actually begins, so nothing can become newly unsafe mid-cutscene. `performMove()`'s existing
  `state !== 'PLAYING'` gate blocks input for free throughout.
- **Dying and retrying mid-level skips the cinematic** — `GAMEOVER` always goes straight back to
  `beginPlaying()`. The cinematic is a one-time, level-start-only beat, not something replayed on
  every death.
- **Three.js is vendored (`js/vendor/three.module.min.js`), not CDN-loaded** — a real bug shipped
  once because of this: the first version of this feature loaded Three.js from a CDN
  (`cdn.jsdelivr.net`), which worked in every local/manual/automated check but silently failed on
  the actual live site, because prismreference.com serves every response with a strict CSP
  (`script-src 'self'` — confirmed with `curl -I https://prismreference.com/`), which blocks a
  cross-origin `import()` outright with no exception surfaced to the page beyond a console error.
  The result: Level 4 quietly fell back to its plain 2D rendering path in production — "the same as
  Level 3, in 2D" — exactly the kind of bug this repo's whole testing philosophy warns about
  finding *after* it ships, because nothing in local dev or CI has that CSP, so nothing caught it
  before a real player did. The fix is to vendor the exact build Three.js publishes for CDN use
  (`three.module.min.js`, unmodified, MIT-licensed) as a same-origin static file, imported via a
  relative URL (`new URL('./vendor/three.module.min.js', import.meta.url)`) instead of a CDN
  specifier — same "no build step" property, same pinned-version discipline, just same-origin, so
  `script-src 'self'` allows it. **Bumping the vendored version is a deliberate, re-tested action**
  (re-download the file, re-run `npm test`, re-verify against a real CSP if possible) — not a
  routine dependency bump.
- **The Three.js load is still isolated and deferred**, both for the "zero dependencies" exception's
  own sake and for CI: `js/renderer3d.js` is the only file that ever imports it, and only inside its
  `init()` method — never at module load time. `engine.js` only ever calls `ensureRenderer3D()`
  (which calls `init()`) from `startLevel()` (prewarms while the player's reading the START banner)
  and, as a safety net, from the real `onPrimary()` tap handler — **never** from `setLevel()` or
  `update()`. That's what keeps every existing/extended automated test offline: they all drive the
  engine via direct `setLevel()`/`update()`/`performMove()` calls, never through the hub tap or
  `onPrimary()`, so `npm test` never even requests the vendored module. If the load fails (or hasn't
  finished by tap time), `render()` holds on the plain 2D frame — the `ENTERING_3D` timer keeps
  running renderer-agnostically regardless, so the game can't soft-lock; a permanent failure just
  degrades the rest of that run to the ordinary 2D path, level 1-3 style. **A second real bug lived
  in exactly this fallback**: `ensureRenderer3D()`'s catch branch replaced `this.renderer3D` with a
  plain `{ready: false}` marker object, but `resize()` calls
  `this.renderer3D?.handleResize(...)` unconditionally for any `render3D` level — `?.` only guards
  `renderer3D` itself being null/undefined, not a *missing method* being called on it — so the very
  next `resize()` (which runs inside `setLevel()`, before `resetRun()`) threw, and `resetRun()`
  never ran. A player who won Level 4 (the CDN bug above meant this was the *only* way anyone hit
  it) and then retried from the hub got stuck re-shown the previous run's stale `LEVEL_COMPLETE`
  banner, with no way to actually play again. Fixed by giving that fallback object a real (no-op)
  `handleResize()`; see `tests/level4-renderer-fallback.spec.js`, which reproduces the failure via
  Playwright request interception (not a hand-asserted object shape) so it would have caught both
  the original crash and any future regression in the same catch branch.
- **The chase camera is tuned for fairness first, cinematics second.** A close third-person
  perspective fundamentally shows less of the board at once than the old full-lane-width top-down
  view — far lanes converge toward a vanishing point, and a tight/narrow lens can hide hazards near
  the frustum's edges. `getChasePose()`'s constants (a wide 58° FOV, camera height/distance/
  lookahead all expressed in `laneSize` units) deliberately favor visibility over a tighter,
  more dramatic lens, and Level 4's own lane layout (`js/level4.js`) adds a mandatory `SAFE` buffer
  row between every hazard lane to give this narrower-feeling view extra margin. **This is the one
  fairness property in this game that the automated suite cannot verify** — `lane-safety.spec.js`
  and `fairness.spec.js` only ever query `obstacleX()`/`sprinklerState()`, never pixels or camera
  framing — so it needs an explicit manual playtest sign-off (does every hazard telegraph stay
  visible ~2 lanes ahead, in a real browser, before shipping a tuning change here), the same honest
  admission this doc already makes about bots elsewhere.
- **Meshes are procedural primitives, no textures/GLTF** (`js/renderer3d.js`'s `makeCatMesh()`/
  `makeMowerMesh()`/`makeLogMesh()`/`makePlayerGroup()`/`makeAppleMesh()`/`makeBeetleMesh()`/
  `makeSprinklerMesh()`/etc.) — the 3D analogue of `sprites.js`'s "every visual is drawn fresh from
  plain numbers" philosophy, so Level 4 needs no asset pipeline even though it drops the
  zero-dependency rule for its one library. The sprinkler in particular is a real, composed model
  (ground spike, riser, housing, three pinwheel spray arms that idle-drift/judder/spin depending on
  state) rather than a post-and-glow placeholder — it needs to read as "a sprinkler" at a glance
  even at rest, matching the same bar `sprites.js`'s 2D version was held to. On burst, each arm
  fires a real arcing water stream (a `QuadraticBezierCurve3` + `TubeGeometry`, not a straight cone
  stub — a straight jet reads as "a light beam," an arc reads as "water," the same visual shorthand
  a real garden sprinkler's rainbow-shaped spray uses) with droplets continuously traveling along
  the curve each frame, all additive-blended/unlit (`MeshBasicMaterial`) rather than lit
  (`MeshStandardMaterial`) so it stays bright and legible against the level's night scene instead of
  depending on scene lighting to pick out a thin, dim shape — the same treatment already used for
  the hazard-radius glow. `sprites.js`'s 2D burst got the equivalent treatment (a quadratic-curve
  arc via `quadraticCurveTo`, traveling droplets, a splash ring, plus a soft mist puff and an
  occasional idle drip) so both renderings read as "spraying water," not just "glowing."

A follow-up pass fixed `makeCatMesh()`'s actual *shape and color*, not just its scale: it was built
with a near-black body (`0x1d1d1d`/`0x0b0b0b` at its two call sites, versus `sprites.js`'s warm
orange tabby gradient) stretched noticeably front-to-back, with a thin, proportionally-longer-
than-the-body tail — the combination read as a rat, not a cat. Both call sites now use the same
warm orange `sprites.js` uses (the chaser recolor was invented, not something the 2D version
actually does — `renderChaser()` calls the exact same `drawCat()` as road cats, no separate
"midnight" tint, so the 3D one shouldn't have one either), the body is rounder/chubbier, the ears
are wider-based, the nose is a small sphere instead of a pointed cone, and the tail is thicker,
shorter, and has a small fluffy tip sphere.

Two more real bugs caught while building this detail pass, worth recording alongside the others:
- **`makeCatMesh()` was never parameterized by `laneSize` at all** — every dimension was authored
  against a bare unit (~1) sphere, so both the road-obstacle cats and the chaser rendered at
  roughly 1/30th their intended size (a couple of world units against a 56-unit lane). It read as
  plausible in an up-close test shot (a small object very close to the camera still fills a
  reasonable fraction of frame) but would have been nearly invisible at the real gameplay chase-cam
  distance — exactly the kind of bug a close test shot can hide and only the real in-game camera
  distance reveals. Fixed by folding `laneSize` into the `scale` argument at both call sites, so
  every already-proportional line in the function needed no changes.
- **`renderBanner()`'s `footer` text was never word-wrapped**, only `subtitle` was — a single
  `ctx.fillText()` call that silently overflowed past the card (and the canvas itself) for any
  footer longer than the card width. This is a pre-existing bug in code Level 4 never touched, not
  something it introduced — it was simply never visible before, because `footer` carries a level's
  own `introText` on the `START` banner, and Level 4 is the *first* level whose `START` banner is
  ever actually shown during real play (every other level's hub-tap skips straight to `PLAYING`);
  GAMEOVER/LEVEL_COMPLETE's own footers (`Best score: N` / `Score: N`) are always short enough to
  never trigger it. Fixed by measuring both `subtitle` and `footer`'s wrap *before* laying out the
  card, so the card grows to fit variable-length content instead of a fixed height that clips or
  overflows longer text — see `wrapLines()`/`drawLines()`.

One real bug caught while building this, worth recording the same way "The progress hub" section
above records its own: the hub and the engine share one `<canvas>` and each attaches its own
`pointerup` listener to it (hub's registered first). A single tap on a hub tile fires ONE
`pointerup` event that reaches BOTH listeners — hub's runs first and, via its `onSelect` callback,
synchronously flips the engine's `active` to `true` mid-event (inside `setLevel()`) — and then the
*same* event continues on to the engine's own `pointerup` listener, which would otherwise see
itself as freshly active and react to that same tap immediately. For Levels 1-3 this was invisible
by coincidence (`startLevel()` already called `beginPlaying()` synchronously, so the bled-through
event just fell through to harmless swipe-threshold math). Level 4 surfaced it for real: tapping
its hub tile was instantly ending the `START` banner and beginning the cinematic, skipping the
"read the banner, then tap again" flow entirely. Fixed by recording `activeAtPointerDown` at
`pointerdown` time (before any mid-event activation can happen) and gating `pointerup` on that
recorded value instead of re-checking `active` fresh — closing the gap for every level, not just
Level 4's.

## Deployment

This repo owns its own deploy to prismreference.com — `.github/workflows/deploy.yml`, manual
dispatch. The game is served as pure static files by the reference app's own ASP.NET Core static
file middleware, straight from `wwwroot/games/hedgehogger/` on that app's VPS — there's no build
step and no need to restart the host app or its systemd service for a change to take effect, so
this deploy is just an SCP of `index.html`/`game.css`/`js/` onto that path, a permissions fix, and
a health check against the live URL. It needs the same VPS credentials
(`PRISM_VPS_HOST`/`PRISM_VPS_USERNAME`/`PRISM_VPS_PASSWORD`) as
[`jonnymuir/Umbraco.Prism`](https://github.com/jonnymuir/Umbraco.Prism)'s own
`deploy-prism-reference.yml`, added as this repo's own GitHub Actions secrets (secrets don't cross
repos, so these are separate entries even though they point at the same VPS/credentials).

This repo has no dependency on Umbraco.Prism's code or build — the only coupling is the shared VPS
path and the plain `<a href="/games/hedgehogger/index.html">🦔</a>` link on that app's home page,
which doesn't need to change when this game does.

## Open design questions

- none currently.
