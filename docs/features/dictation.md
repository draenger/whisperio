# Feature — Dictation (global hotkey → record → transcribe → auto-paste)

## What it does

The core product loop on desktop: from any application, press a global hotkey to start
recording, speak, press the hotkey again — Whisperio transcribes the audio and pastes the text
into the focused text field. Variants: **Dictate & Send** (presses Enter after pasting, for chat
apps) and **Output recording** (records system audio instead of the mic, e.g. meetings).

## User-facing flow

1. Press the dictation hotkey (custom from Settings, or the first free of
   `Ctrl+Shift+Space` / `Alt+Shift+Space` / `Ctrl+Alt+D` —
   `desktop/src/main/dictation/hotkeyManager.ts:15`).
2. A minimal always-on-top overlay appears on **every** connected display showing recording
   state (`desktop/src/main/dictation/overlayWindow.ts:186`).
3. Press the hotkey again to stop (or `Escape` to cancel —
   `desktop/src/main/dictation/hotkeyManager.ts:107`).
4. The transcript is auto-pasted into the app that had focus; with the Dictate & Send hotkey,
   Enter is pressed afterwards.

## How it works (code path)

1. `registerHotkey()` registers up to three global shortcuts — dictation, dictate-and-send,
   output-recording (`desktop/src/main/dictation/hotkeyManager.ts:243`); a failed custom
   hotkey falls back to the candidate list (`desktop/src/main/dictation/hotkeyManager.ts:303`).
2. `activate()` flips the state machine `idle → recording`
   (`desktop/src/main/dictation/hotkeyManager.ts:84`; states declared at
   `desktop/src/main/dictation/hotkeyManager.ts:12`). `activateAndSend()`
   (`desktop/src/main/dictation/hotkeyManager.ts:135`) sets the send-Enter flag;
   `activateOutput()` (`desktop/src/main/dictation/hotkeyManager.ts:140`) starts a
   system-audio session instead.
3. The overlay renderer records via `getUserMedia` + `MediaRecorder`
   (`desktop/src/renderer/hooks/useDictation.ts:64`); output recording uses
   `getDisplayMedia` loopback audio (`desktop/src/renderer/hooks/useDictation.ts:109`),
   which the main process grants picker-free (`desktop/src/main/index.ts:121`).
4. On stop, the renderer converts WebM/Opus to WAV in-process
   (`desktop/src/renderer/hooks/useDictation.ts:3`, used at
   `desktop/src/renderer/hooks/useDictation.ts:223`) and calls
   `window.api.dictation.transcribe(...)` → IPC `dictation:transcribe`
   (`desktop/src/main/index.ts:176`) → the provider chain
   (`desktop/src/main/transcribe.ts:36`, see
   [transcription-providers.md](transcription-providers.md)).
5. `handleResult()` validates the session id, then pastes
   (`desktop/src/main/dictation/hotkeyManager.ts:200`): text goes to the clipboard and a
   platform keystroke is synthesized — Windows `keybd_event` via koffi
   (`desktop/src/main/dictation/autoPaste.ts:28`), macOS `osascript` ⌘V
   (`desktop/src/main/dictation/autoPaste.ts:50`), Linux `xdotool`
   (`desktop/src/main/dictation/autoPaste.ts:65`). Dictate & Send then calls `sendEnter()`
   (`desktop/src/main/dictation/autoPaste.ts:112`).
6. Overlay windows are created per display and tracked as displays come and go
   (`desktop/src/main/dictation/overlayWindow.ts:192`).

## Command-line control (Stream Deck / scripts)

A running Whisperio can be driven from the command line:

| Flag | Effect |
|------|--------|
| `--toggle` | Same as the dictation hotkey (start, or stop and transcribe) |
| `--send` | Same as the Dictate & Send hotkey (toggle, then Enter after paste) |
| `--start` | Start recording only if idle |
| `--stop` | Stop and transcribe only if recording (also ends command-mode capture) |
| `--cancel` | Cancel the current session, if any |

The second process hands its argv to the running instance
(`app.on('second-instance')`, `desktop/src/main/cliControl.ts`) and exits; the settings
window is not shown when a flag is present. A launch without a flag still opens settings.

Cold start: if Whisperio is NOT running, launching it with a flag starts the app normally and
the command is ignored (logged) - it never begins recording on launch.

- Stream Deck: action "System: Open" -> `"C:\Users\<you>\AppData\Local\Programs\Whisperio\Whisperio.exe" --toggle`
  (use your real install path; one button per flag).
- macOS: call the binary directly so argv reaches the running instance:
  `/Applications/Whisperio.app/Contents/MacOS/Whisperio --toggle`.
  `open -a Whisperio --args --toggle` is not reliable for an already-running app (LaunchServices
  just activates it and does not spawn a second process with your args).
- Not yet verified on a real machine.

### whisperio:// links

Off by default. Enable in Settings > General > "Allow control via whisperio:// links"
(`allowUrlControl`). Security note: any website or app can open a `whisperio://` link, so the
feature is opt-in and deliberately narrow.

- By URL only `whisperio://stop` and `whisperio://cancel` work. `whisperio://toggle` and
  `whisperio://start` (they begin recording) additionally need "Also allow links to start
  recording" (`allowUrlStart`, default off). `whisperio://send` is never accepted by URL
  (use the `--send` CLI flag).
- Start-type links are rate-limited (ignored within 1 s of the previous one) and ignored while the
  screen is locked. stop/cancel always pass.
- Use from Raycast / Alfred ("Open URL"), Shortcuts ("Open URLs"), Stream Deck ("Website").
- Windows/Linux: the link reaches the running instance through second-instance argv; if any
  argv entry is a `whisperio:` link the whole call is treated as a URL: it must be the single,
  last entry, and CLI flags next to it are ignored. macOS: `app.on('open-url')`.
- Strict parsing: scheme and command are case-insensitive, one trailing `/` and any
  `?query` / `#fragment` are ignored (no parameters are read). Any other host, extra path,
  or scheme is rejected silently. Only the command name is logged, never the URL.
- Cold start: same rule as the CLI - a link that launches a not-running Whisperio just starts
  the app and the command is ignored (never records on launch).
- The scheme is registered with the OS only when URL control is on and the app is packaged
  (dev builds never touch the registry unless `WHISPERIO_DEV_PROTOCOL=1`); turning the setting
  off unregisters it. The installer also declares it (`protocols` in `.devops/electron-builder.yml`).

## Entry points (file:line)

- `desktop/src/main/dictation/index.ts:7` — `initDictation()` (called from
  `desktop/src/main/index.ts:268`).
- `desktop/src/main/dictation/hotkeyManager.ts:243` — hotkey registration.
- `desktop/src/main/dictation/hotkeyManager.ts:84` — `activate()` (the single trigger).
- `desktop/src/renderer/hooks/useDictation.ts:42` — renderer recording hook.
- `desktop/src/renderer/components/dictation/DictationOverlay.tsx:1` — overlay UI.
- `desktop/src/main/dictation/autoPaste.ts:85` — `autoPaste(text)`.

## Data touched

- Clipboard (transcript is written there as part of paste).
- Optional recording files + index in `userData/recordings`
  (`desktop/src/main/recordingStore.ts:22`) when **Save Recordings** is on — see
  [recording-history.md](recording-history.md).
- No transcript content is logged in packaged builds
  (`desktop/src/main/dictation/autoPaste.ts:7`).

## Edge cases

- **Stale results can't paste into the wrong app** — a monotonic session id is incremented on
  every start/cancel/reset; late transcriptions whose id no longer matches are dropped
  (`desktop/src/main/dictation/hotkeyManager.ts:36`).
- **Transcription hang** — a 60 s safety timer force-resets from `transcribing`
  (`desktop/src/main/dictation/hotkeyManager.ts:53`).
- **`Escape` cancel** is registered only while a session is active and unregistered after
  (`desktop/src/main/dictation/hotkeyManager.ts:107`).
- **macOS Accessibility** — synthesizing ⌘V needs the Accessibility permission; checked and
  optionally prompted via `ensureAccessibilityPermission()`
  (`desktop/src/main/dictation/autoPaste.ts:72`).
- **Linux requires `xdotool`** for auto-paste (`desktop/src/main/dictation/autoPaste.ts:65`).
- **`getDisplayMedia` failure (Wayland / denied macOS screen recording)** fails fast instead of
  hanging the overlay (`desktop/src/main/index.ts:131`).
- **Hotkey conflicts** — custom hotkey registration failures fall back to the candidate list;
  hotkeys are paused while the settings hotkey-recorder is capturing keys
  (`desktop/src/main/index.ts:172`).

## Related tests

- `desktop/tests/hotkeyManager.test.ts:1` — state machine, session invalidation, hotkey
  registration fallbacks.
- Overlay windows, auto-paste, and preload wiring are deliberately excluded from unit
  coverage (runtime-only; `desktop/vitest.config.ts:16`) and are exercised by the CI Linux
  xvfb smoke test (`.github/workflows/build.yml:118`).
