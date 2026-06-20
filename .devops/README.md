# .devops

Central home for the project's CI/CD and pipeline configuration.

| File | What it is |
|---|---|
| [`electron-builder.yml`](electron-builder.yml) | Desktop packaging pipeline — Windows NSIS, macOS dmg/zip + Developer ID signing & notarization, Linux AppImage/deb. Consumed by `electron-builder` (run from `desktop/`, which passes `--config ../.devops/electron-builder.yml`). |

## ⚠️ The GitHub Actions workflow is NOT here — and can't be

GitHub **requires** Actions workflow files to live in **`.github/workflows/`**. They
cannot be moved to `.devops/` (or anywhere else) and still run — GitHub only
discovers and executes workflows from that exact path. So the CI/CD workflow stays at:

- **[`.github/workflows/build.yml`](../.github/workflows/build.yml)** — the Build & Release pipeline.

This file is the single source of truth for CI/CD; `.devops/` holds the pipeline
configs it *consumes* that aren't location-locked.

## The pipeline at a glance

Triggered by a push to the **`release`** branch:

1. **`test`** (Ubuntu, 1× billing) — `typecheck` + `npm run test:coverage` (coverage
   thresholds). The expensive platform builds only run if this passes, so broken
   code never reaches the macOS runner (10× billing).
2. **`build`** (matrix: Windows / macOS / Linux) — packages installers via
   `electron-builder` using [`electron-builder.yml`](electron-builder.yml). Each leg
   has a hard `timeout-minutes` (mac 25 — the safety net for a hung Apple notary).
   The Linux leg also runs a headless **xvfb smoke test** to confirm the app launches.
3. **`release`** — publishes the GitHub Release with all artifacts.

`concurrency: cancel-in-progress` ensures a newer release push cancels an older
in-flight run (no duplicate, minute-burning macOS builds).

### Notes
- macOS signing/notarization secrets live in GitHub Secrets (never in the repo):
  `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`,
  `APPLE_API_ISSUER`. Team ID is passed via `APPLE_TEAM_ID` (not secret).
- Developer ID signing works; if Apple notarization hangs, the mac job's
  `timeout-minutes` caps the spend.
