# Whisperio — testing

## How to run the suite

Desktop (Vitest, from `desktop/`):

```bash
cd desktop
npm test               # vitest run                (desktop/package.json:24)
npm run test:watch     # watch mode
npm run test:coverage  # + v8 coverage thresholds — the release gate (desktop/package.json:26)
npm run typecheck      # tsc for main+preload (node) and renderer (web)
```

Mobile domain core (swift-testing, from `mobile/WhisperioKit/`):

```bash
cd mobile/WhisperioKit
swift build
swift test
```

Watch app unit/UI test targets (`mobile/WhisperioApp/WhisperioWatch Watch AppTests/`,
`mobile/WhisperioApp/WhisperioWatch Watch AppUITests/`) run from Xcode.

## Test workflows (e2e / integration)

- **CI gate** — every release push runs typecheck + `test:coverage` on Ubuntu first; platform
  installers build only if it passes (`.github/workflows/build.yml:21`,
  `.github/workflows/build.yml:45`).
- **Launch smoke test** — the CI Linux leg boots the packaged AppImage headlessly under xvfb
  and asserts it starts (`.github/workflows/build.yml:118`). This is the only automated
  end-to-end runtime check; hotkey → paste flows are verified manually per platform.
- **Pre-PR** — the repo-local `/pr` command chains typecheck, tests, build, secret scan
  (`.claude/commands/pr.md:1`).

## Coverage expectations

Enforced by `desktop/vitest.config.ts:31`: statements 90 / branches 82 / functions 90 /
lines 90. Coverage measures `src/**/*.{ts,tsx}` but deliberately excludes runtime-only wiring
that can't be unit-tested without a live Electron/DOM (window+tray+IPC bootstrap, preload,
overlay/autoPaste, React components) — `desktop/vitest.config.ts:16`. Don't "fix" a coverage
drop by adding exclusions; add tests.

## How to add a test

- Desktop: drop a `<module>.test.ts` into `desktop/tests/` mirroring the module under
  `desktop/src/main/` (existing examples: `desktop/tests/transcribe.test.ts:1`,
  `desktop/tests/hotkeyManager.test.ts:1`, `desktop/tests/settingsManager.test.ts:1`,
  `desktop/tests/recordingStore.test.ts:1`, `desktop/tests/modelManager.test.ts:1`,
  `desktop/tests/localServer.test.ts:1`, `desktop/tests/autoUpdater.test.ts:1`,
  `desktop/tests/errorHandler.test.ts:1`, `desktop/tests/fallback.test.ts:1`,
  `desktop/tests/theme.test.ts:1`). Environment is node (`desktop/vitest.config.ts:5`); mock
  `electron` imports as the existing tests do.
- Mobile: add a swift-testing file under
  `mobile/WhisperioKit/Tests/WhisperioKitTests/` (examples:
  `mobile/WhisperioKit/Tests/WhisperioKitTests/ProviderChainTests.swift:1`).

## Known gaps

- No automated e2e for the dictation loop (hotkey → record → transcribe → paste) — the
  session-id/timeout logic is unit-tested, but real keystroke injection and overlay behavior
  are manual + the CI smoke test.
- Renderer React components (`SettingsForm.tsx`, `RecordingsPanel.tsx`,
  `DictationOverlay.tsx`) have no component tests (excluded from coverage —
  `desktop/vitest.config.ts:16`), though testing-library deps are installed
  (`desktop/package.json:39`).
- The iOS app layer (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/`) has no unit tests;
  only WhisperioKit is covered by `swift test`.
- No tests for the GitHub Pages site (static HTML).
