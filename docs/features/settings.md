# Feature — Settings (window, hotkey recorder, themes, persistence)

## What it does

A single settings window controls everything: provider chain + API keys, custom vocabulary,
transcription prompt and language, AI post-processing, three configurable global hotkeys
(dictation / dictate-and-send / output recording) captured with a game-style key recorder,
audio input/output devices, save-recordings toggle, launch-at-startup, dark/light theme and
accent color.

## User-facing flow

1. Open Settings from the tray menu (or on macOS by clicking the Dock icon —
   `desktop/src/main/index.ts:282`; a second app launch also opens it —
   `desktop/src/main/index.ts:47`).
2. Edit values in the form; saving applies immediately (hotkeys re-register, autostart entry
   updates).
3. Record a hotkey: click the hotkey field, press any combination — global hotkeys are paused
   while recording so the keypress isn't swallowed.

## How it works (code path)

1. Schema + defaults: `AppSettings` (`desktop/src/main/settingsManager.ts:9`) with defaults at
   `desktop/src/main/settingsManager.ts:41` (including a developer-centric default vocabulary,
   `desktop/src/main/settingsManager.ts:32`).
2. Persistence: plain JSON at `userData/settings.json`
   (`desktop/src/main/settingsManager.ts:64`); `loadSettings()` merges defaults
   (`desktop/src/main/settingsManager.ts:68`), `saveSettings()` writes atomically via
   temp-file + rename (`desktop/src/main/settingsManager.ts:96`).
   ⚠️ API keys are stored **in this plain-text file**, not the OS secure store — see the
   divergence note in [architecture.md](../architecture.md#key-invariants).
3. IPC: `settings:load` / `settings:save` (`desktop/src/main/index.ts:156`); saving hotkey
   fields triggers `reRegisterHotkeys()` (`desktop/src/main/index.ts:165`), and
   `launchAtStartup` updates the OS login item (`desktop/src/main/index.ts:159`, packaged
   builds only — `desktop/src/main/index.ts:148`).
4. Hotkey recorder: renderer sends `hotkeys:pause` / `hotkeys:resume`
   (`desktop/src/main/index.ts:172`) around key capture
   (`desktop/src/main/dictation/hotkeyManager.ts:347`).
5. UI: window at `desktop/src/main/settingsWindow.ts:14`, form at
   `desktop/src/renderer/components/settings/SettingsForm.tsx:1`; theming via
   `desktop/src/renderer/theme.ts:1` + `desktop/src/renderer/ThemeContext.tsx:1`; custom
   title bar (`desktop/src/renderer/components/common/TitleBar.tsx:1`) backed by
   `window:minimize/maximize/close` IPC (`desktop/src/main/index.ts:252`).
6. App version badge asks the main process (`desktop/src/main/index.ts:265`).

## Entry points (file:line)

- `desktop/src/main/settingsWindow.ts:14` — `openSettingsWindow()`.
- `desktop/src/main/index.ts:156` — IPC `settings:*`.
- `desktop/src/main/settingsManager.ts:68` — `loadSettings()`.
- `desktop/src/renderer/components/settings/SettingsForm.tsx:1` — the form (also hosts model
  management and updater UI).

## Data touched

- `userData/settings.json` — the whole `AppSettings` object, **including API keys in plain
  text** (`desktop/src/main/settingsManager.ts:96`).
- OS login items (autostart) (`desktop/src/main/index.ts:149`).

## Edge cases

- **Unparseable/missing settings file** → defaults are returned instead of crashing
  (`desktop/src/main/settingsManager.ts:68`).
- **Partial saves merge over current settings** — `saveSettings(Partial<AppSettings>)`
  (`desktop/src/main/settingsManager.ts:96`).
- **Dev builds skip autostart registration** to avoid a bogus "Electron" entry
  (`desktop/src/main/index.ts:145`).
- **Custom hotkey fails to register** → candidate fallback list
  (`desktop/src/main/dictation/hotkeyManager.ts:303`).

## Related tests

- `desktop/tests/settingsManager.test.ts:1` — defaults, merge, persistence round-trip.
- `desktop/tests/theme.test.ts:1` — theme/accent tokens.
- `desktop/tests/hotkeyManager.test.ts:1` — re-registration and pause/resume.
