# Whisperio — runbook

How to run, build, release and configure everything in this monorepo.

## Desktop — run in development

All desktop commands run from `desktop/`:

```bash
cd desktop
npm install
npm run dev          # electron-vite dev (desktop/package.json:14)
```

Convenience wrappers:

- `dev-local.sh:1` / `dev-local.ps1:1` (repo root) — install deps + `npm run dev`.
- `desktop/start.sh:1` / `desktop/start.ps1:1` — zero-prereq bootstrap: downloads a portable
  Node into `./.node` if missing, then installs and starts (nothing written outside the repo
  folder).

## Desktop — build installers

```bash
cd desktop
npm run build        # electron-vite build (out/)
npm run build:win    # NSIS .exe        (desktop/package.json:21)
npm run build:mac    # dmg + zip, signed+notarized (desktop/package.json:22)
npm run build:linux  # AppImage + deb   (desktop/package.json:23)
```

Packaging config lives centrally at `.devops/electron-builder.yml:1` (the build scripts pass
`--config ../.devops/electron-builder.yml`). Notables:

- Publishes to GitHub Releases `draenger/whisperio` (`.devops/electron-builder.yml:16`).
- macOS: Developer ID signing + notarization (`.devops/electron-builder.yml:42`); the `zip`
  target is required for auto-update (`.devops/electron-builder.yml:46`).
- Windows: NSIS with a space-free artifact name so auto-update's `latest.yml` matches
  (`.devops/electron-builder.yml:33`).
- koffi is unpacked from asar (`.devops/electron-builder.yml:8`).

## Desktop — release pipeline (CI)

Push to the **`release`** branch triggers `.github/workflows/build.yml:5`:

1. **test** — Ubuntu, 12-min cap: `npm run typecheck` + `npm run test:coverage` (coverage
   thresholds are the release gate) (`.github/workflows/build.yml:21`).
2. **build** — Windows/macOS/Linux matrix, only after test passes
   (`.github/workflows/build.yml:45`); per-leg hard timeouts (mac 25 min — the safety net for
   a hung Apple notary; `.github/workflows/build.yml:63`); the Linux leg runs a headless
   xvfb launch smoke test (`.github/workflows/build.yml:118`).
3. **release** — publishes the GitHub Release with all artifacts
   (`.github/workflows/build.yml:207`, `.github/workflows/build.yml:225`).

`concurrency: cancel-in-progress` stops superseded runs. macOS signing secrets live in GitHub
Secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`,
`APPLE_API_ISSUER`; team id via `APPLE_TEAM_ID` env) — never in the repo. Note: workflows
**must** stay in `.github/workflows/` (GitHub only discovers them there); `.devops/` holds the
configs they consume (absorbed from the legacy `.devops/README.md`).

## Desktop — runtime configuration

No env vars or ports for end users. Everything is configured in the Settings window and
persisted to `userData/settings.json` (`desktop/src/main/settingsManager.ts:64`):

- **API keys**: OpenAI and/or ElevenLabs — bring your own; or a self-hosted OpenAI-compatible
  base URL (e.g. `http://localhost:8080/v1`) with the model your server expects
  (`desktop/src/main/transcribe.ts:116`).
- **Bundled local server** (Windows): runs on port `8178`
  (`desktop/src/main/localServer.ts:8`).
- **Linux**: auto-paste requires `xdotool` (X11)
  (`desktop/src/main/dictation/autoPaste.ts:65`).
- **macOS**: Accessibility permission is required for auto-paste
  (`desktop/src/main/dictation/autoPaste.ts:72`).

## Mobile — build & ship (TestFlight)

- Domain core: `cd mobile/WhisperioKit && swift build && swift test` (plain Swift package,
  no Xcode project needed; platforms in `mobile/WhisperioKit/Package.swift:9`).
- App: open `mobile/WhisperioApp/WhisperioApp.xcodeproj` in Xcode; targets = iPhone/iPad app,
  Watch app, keyboard extension, widget. App Group `group.ai.whisperio.mobile`
  (`mobile/WhisperioKit/Sources/WhisperioKit/SharedStore.swift:14`) must be enabled on the
  app, keyboard and widget targets (entitlement files sit next to the project:
  `mobile/WhisperioApp/WhisperioApp.entitlements`,
  `mobile/WhisperioApp/WhisperioKeyboard.entitlements`).
- Distribution is **TestFlight** (Internal Testing). App Store Connect copy (beta
  description, review notes, privacy answers, license choice) was archived to
  `docs/_legacy/testflight-info.md` — key operational bits:
  - Privacy policy URL `https://whisperio.danielkasprzyk.com/privacy.html` must return 200
    (it's served from `docs/privacy.html:1` via GitHub Pages) before saving in ASC.
  - No sign-in; reviewers need a BYO OpenAI test key (set a $5 hard limit).
  - `ITSAppUsesNonExemptEncryption = NO` (standard HTTPS only).

## Mobile — CloudKit sync & the native Mac app

The Apple-ecosystem history sync ([features/apple-sync.md](features/apple-sync.md)) depends on Apple
Developer portal + CloudKit Console setup that **cannot** live in the repo. Team is `953Q6T2WTB`.

- **Identifiers that must match the code verbatim:** iCloud container `iCloud.ai.whisperio.mobile`
  (`mobile/WhisperioKit/Sources/WhisperioKit/RecordingSyncStore.swift:63`), App Group
  `group.ai.whisperio.mobile` (`mobile/WhisperioKit/Sources/WhisperioKit/SharedStore.swift:14`), iOS
  bundle id `ai.whisperio.mobile`. The Mac app is a **universal** target on the *same* bundle id, so
  it inherits the provisioned App ID + CloudKit container.
- **CloudKit builds MUST go through Xcode Archive → Distribute.** A headless `xcodebuild`/altool
  export (the `whisperio-release` skill / `mobile/WhisperioApp/Scripts/release-testflight.sh`) strips
  the iCloud container entitlement → the app faults at launch when an iCloud account is present. Use
  the headless path only for **non-CloudKit** builds.
- **Deploy the CloudKit schema to Production before shipping.** SwiftData JIT-creates the schema only
  in the *Development* environment (on a Debug write). Seed it by running **WhisperioMac Debug** on a
  Mac signed into iCloud — the `#if DEBUG` seed
  (`mobile/WhisperioApp/MacApp/WhisperioMacApp.swift:40`) writes one record — then in the CloudKit
  Console **Deploy Schema Changes → Production** (`CD_RecordingEntity`). Skipping this = "works in
  Xcode, nothing syncs on TestFlight".
- **CloudKit Console shows the *developer* Apple ID's private DB**, usually a different account than
  the one on your test devices — it can look empty while device↔device sync works. Verify sync
  device→device, not via the Console.
- **Signing keychain:** the distribution cert lives in the `husar` keychain (password `husar`);
  answer the codesign prompt with it + "Always Allow".

## Website

`docs/` is the GitHub Pages root (CNAME `whisperio.danielkasprzyk.com` — `docs/CNAME:1`):
landing page `docs/index.html:1`, app preview `docs/app.html:1`, privacy policy
`docs/privacy.html:1`. Deploy = push to the default branch.

## Pre-PR verification

Run the repo-local `/pr` command (`.claude/commands/pr.md:1`): typecheck (node + web), Vitest,
optional eslint, full electron-vite build, secret scan for OpenAI/ElevenLabs keys, TODO audit,
electron-builder dry-run when packaging files changed.
