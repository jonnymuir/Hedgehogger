# Hedgehogger: Project Guide for Claude Code

## What this is

A small, deterministic garden-crossing puzzle game — plain HTML/CSS/JS, no build step, no
framework. Deployed as the undersold easter egg on [prismreference.com](https://prismreference.com)
(the home page of [`jonnymuir/Umbraco.Prism`](https://github.com/jonnymuir/Umbraco.Prism)'s
reference app links to `/games/hedgehogger/index.html`), but this repo has zero dependency on that
repo's code — the only coupling is the shared VPS path this repo's own deploy pipeline keeps
populated, and a plain link on that app's home page that never needs to change.

**Read [`docs/design.md`](docs/design.md) before making any gameplay or level-authoring change.**
It's the living source of truth for this game's design pillars (determinism, one-new-mechanic-per-
level pacing, telegraphed-never-unfair hazards), the level data format, the save schema, and —
critically — the fairness-testing methodology, which was hard-won across several real shipped
bugs that naive bot testing missed. Don't skip straight to code.

## Commands

```bash
npm install
npm run serve          # local dev server at http://localhost:8934, no build step

npx playwright install --with-deps chromium
npm test                # the full fairness-guarantee test suite (tests/)
```

## Key conventions

- **Every level is deterministic** — no `Math.random()` anywhere in gameplay-relevant data or
  timing. See `docs/design.md` rule 1.
- **Level 4 is a deliberate, scoped exception to "zero dependencies"** — its 3D chase-cam renderer
  (`js/renderer3d.js`) is the only file in the repo that imports Three.js, a pinned build **vendored
  same-origin** at `js/vendor/three.module.min.js` (not a CDN import — prismreference.com's CSP,
  `script-src 'self'`, blocks cross-origin scripts; see `docs/design.md`'s Level 4 mechanic spec for
  the real bug this caused), loaded only from that file's own `init()`, never at module load time.
  This is intentional, not drift — don't "fix" it away, and don't add a second dependency without the same
  scrutiny. See `docs/design.md`'s "Mechanic spec: the third-dimension shift (Level 4)".
- **One new mechanic per level, or a recombination of existing ones — never both, never more than
  one new thing.** See `docs/design.md` rule 2 and the "Mechanic ledger."
- **Never trust a bot's fairness verdict without understanding why it passed or failed.** This
  game's test suite exists because several early bot-based "fairness" checks were themselves
  wrong — see `docs/design.md`'s "Fairness testing" section for the specific failure modes (timing
  jitter from cross-process test drivers, bots that react faster than any human, absolute-time
  models that don't distinguish "idle" from "long level") before writing a new test or a new
  hazard mechanic.
- Adding a level: write a new `levelN.js`, add it to `main.js`'s `LEVELS` array, and add it to
  `tests/fairness.spec.js`'s/`tests/lane-safety.spec.js`'s level list. The engine itself should
  never need level-specific `if` branches — new mechanics go in `engine.js`/`sprites.js`
  generically, driven by data on the level object.
- Commits: plain, descriptive messages — no enforced conventional-commits format in this repo
  (unlike Umbraco.Prism).
- Branch/PR: every change goes through a PR; `.github/workflows/ci.yml` runs the full test suite
  and must pass before merging.

## Deployment

Manual-dispatch only (`.github/workflows/deploy.yml`) — see `docs/design.md`'s "Deployment"
section. Needs `PRISM_VPS_HOST`/`PRISM_VPS_USERNAME`/`PRISM_VPS_PASSWORD` as this repo's own
secrets (same VPS as Umbraco.Prism's own reference-app deploy, but secrets don't cross repos).
Static files only — no service restart needed, changes are live as soon as the SCP completes.
