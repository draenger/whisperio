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
