# Hedgehogger

A small, deterministic garden-crossing puzzle game. Hop a hedgehog across roads, rivers, and
sprinkler-studded lawns to reach a burrow, without getting squished, drowned, soaked, or (from
Level 3 on) pounced.

Live at [prismreference.com/games/hedgehogger](https://prismreference.com/games/hedgehogger/index.html)
— the undersold easter egg on the home page of
[`jonnymuir/Umbraco.Prism`](https://github.com/jonnymuir/Umbraco.Prism)'s reference app. This repo
is fully standalone: plain HTML/CSS/JS, no build step, no framework, no dependency on that repo's
code — see [`docs/design.md`](docs/design.md) for the full design doc (pillars, level format, save
schema, and the fairness-testing methodology this game is built on).

## Running locally

```bash
npm install
npm run serve
# open http://localhost:8934
```

No build step — `server.js` is a zero-dependency static file server; the game itself is plain ES
modules loaded directly by the browser.

## Testing

```bash
npm install
npx playwright install --with-deps chromium
npm test
```

The test suite (`tests/`) is the actual fairness guarantee this game makes — see
[`docs/design.md`](docs/design.md#fairness-testing) for what each layer proves and why. Runs on
every PR via `.github/workflows/ci.yml`.

## Deploying

`.github/workflows/deploy.yml`, manual dispatch (Actions tab → Deploy to prismreference.com → Run
workflow). Needs `PRISM_VPS_HOST`/`PRISM_VPS_USERNAME`/`PRISM_VPS_PASSWORD` set as this repo's own
GitHub Actions secrets — see [`docs/design.md`](docs/design.md#deployment) for why.

## License

MIT — see [`LICENSE`](LICENSE).
