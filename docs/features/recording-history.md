# Feature — Recording history (save, browse, replay, re-transcribe)

## What it does

When **Save Recordings** is on, every dictation's audio is kept locally with its transcript,
provider, duration and status. A dedicated Recordings window lets the user browse by date,
replay audio, copy transcripts, re-transcribe with the current provider chain, and delete
individual recordings, whole days, or everything.

## User-facing flow

1. Tray menu / Settings → open Recordings (`desktop/src/main/index.ts:184`).
2. Browse the list, play back audio, copy a transcript.
3. "Re-transcribe" reruns a saved recording through the current provider chain (useful after
   switching providers or fixing a key).
4. Delete one recording, one day, or all.

## How it works (code path)

1. After a dictation completes (and on failures too), the renderer saves the audio via IPC
   `recordings:save` (`desktop/src/main/index.ts:187`) → `saveRecording()` writes the WAV file
   plus an index entry (`desktop/src/main/recordingStore.ts:81`).
2. Storage layout: files + `index.json` under `userData/recordings`
   (`desktop/src/main/recordingStore.ts:22`); entries carry id, filename, timestamp, duration,
   provider, transcription, status (`desktop/src/main/recordingStore.ts:5`).
3. The Recordings window is a separate BrowserWindow
   (`desktop/src/main/recordingsWindow.ts:23`) rendering
   `desktop/src/renderer/components/recordings/RecordingsPanel.tsx:1` (entry page
   `desktop/src/renderer/recordings/recordings.tsx:1`).
4. Re-transcribe: `reprocessRecording()` loads the stored audio and reruns
   `transcribeAudio()`, updating status to `completed`/`failed`
   (`desktop/src/main/index.ts:53`, IPC at `desktop/src/main/index.ts:197`).
5. Deletion paths: single (`desktop/src/main/recordingStore.ts:135`), all
   (`desktop/src/main/recordingStore.ts:152`), by date
   (`desktop/src/main/recordingStore.ts:166`); audio bytes are read back for playback via
   `getRecordingAudio()` (`desktop/src/main/recordingStore.ts:193`).

## Entry points (file:line)

- `desktop/src/main/index.ts:184` — IPC `recordings:*` handlers.
- `desktop/src/main/recordingStore.ts:81` — `saveRecording()`.
- `desktop/src/main/recordingsWindow.ts:23` — the Recordings window.
- `desktop/src/renderer/components/recordings/RecordingsPanel.tsx:1` — UI.

## Data touched

- `userData/recordings/*.wav` + `userData/recordings/index.json`
  (`desktop/src/main/recordingStore.ts:22`, `desktop/src/main/recordingStore.ts:47`).
- Local-only: nothing is uploaded except during an explicit (re-)transcription, which goes to
  the configured provider.

## Edge cases

- **Saving is opt-out-able** — the `saveRecordings` setting defaults to `true`
  (`desktop/src/main/settingsManager.ts:9`).
- **Missing audio file** — `getRecordingAudio()` returns `null` and re-transcribe aborts
  cleanly (`desktop/src/main/index.ts:57`).
- **Failed transcriptions are still saved** with `status: 'failed'` and the error message, so
  they can be retried later (`desktop/src/main/index.ts:65`).
- **Index corruption** — `loadIndex()` falls back to an empty index rather than crashing
  (`desktop/src/main/recordingStore.ts:34`).

## Related tests

- `desktop/tests/recordingStore.test.ts:1` — index round-trip, save/update/delete, by-date
  deletion, audio readback.
