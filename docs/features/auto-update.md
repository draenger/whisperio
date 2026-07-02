# Feature — Auto-update

## What it does

Desktop builds update themselves from GitHub Releases via `electron-updater`: updates download
in the background and install on quit, with a tray indication and a manual "check now" +
"install" path in Settings. The flow is fail-soft — updater problems never affect dictation.

## User-facing flow

1. App checks for updates on startup (packaged builds).
2. When an update is downloaded, the tray shows "Update ready" with an install action; the
   Settings window shows updater status and offers manual check/install.
3. Installing restarts the app into the new version; otherwise it installs on next quit.

## How it works (code path)

1. `initAutoUpdater()` wires `electron-updater` with `autoDownload` and
   `autoInstallOnAppQuit` (`desktop/src/main/autoUpdater.ts:69`, flags at
   `desktop/src/main/autoUpdater.ts:72`); events update an in-memory `UpdaterState`
   (`desktop/src/main/autoUpdater.ts:14`).
2. Manual check: `checkForUpdatesManual()` (`desktop/src/main/autoUpdater.ts:50`), IPC
   `updater:check` (`desktop/src/main/index.ts:245`); install: `installUpdate()` →
   `quitAndInstall` (`desktop/src/main/autoUpdater.ts:62`), IPC `updater:install`
   (`desktop/src/main/index.ts:249`).
3. Tray badge: `setUpdateReady()` (`desktop/src/main/tray.ts:91`).
4. Feed: electron-builder publishes to GitHub Releases
   (`.devops/electron-builder.yml:16`); macOS auto-update needs the `zip` target
   (`.devops/electron-builder.yml:46`) and a notarized Developer ID signature
   (`.devops/electron-builder.yml:42`); the Windows artifact name avoids spaces so
   `latest.yml` filename matching works (`.devops/electron-builder.yml:33`).

## Entry points (file:line)

- `desktop/src/main/autoUpdater.ts:69` — `initAutoUpdater()` (called at
  `desktop/src/main/index.ts:274`).
- `desktop/src/main/index.ts:244` — IPC `updater:*` handlers.
- `desktop/src/main/tray.ts:91` — tray "update ready".

## Data touched

- Downloaded installers in electron-updater's cache; no app data is modified until install.

## Edge cases

- **Unpackaged/dev builds** — `isUpdaterActive()` is false; every entry point no-ops
  (`desktop/src/main/autoUpdater.ts:51`, `desktop/src/main/autoUpdater.ts:70`).
- **Check failures are swallowed** (network offline, GitHub down) — status becomes an error
  state, dictation unaffected (`desktop/src/main/autoUpdater.ts:53`).
- **Older unsigned macOS builds** can't auto-update (Squirrel.Mac rejects them); users
  reinstall from the website/Releases (absorbed from the root README's install notes).

## Related tests

- `desktop/tests/autoUpdater.test.ts:1` — state transitions, manual check, install gating.
