# Live design deltas queued during the parity sprint (2026-07-19)

Deltas detected by the main session's design refresh loop AFTER the workflow implement fleet started.
Apply in the post-workflow delta round unless the area agent already picked them up.

## mob-screens.jsx (updated on disk; prev at mob-screens.prev.jsx)
- NEW screen `PhoneJournalNew` — Journal composer: new page, blank or from picked notes.
  Modes: blank | from notes; layouts: AI-woven | raw stacked | one per page; filter chips
  (source: All/In-app/Keyboard; day: all/today/earlier), select-all, optional prompt, busy state.
  → being implemented by a dedicated agent (JournalComposerView.swift + AppShell route + JournalView + button).
- `PhoneDigest` gained a `seed` param (compose digest from picked notes).

## mob-settings.jsx (updated on disk)
- SETT_CATS system sub: "Appearance and installed models" → "Appearance and app info".
- `Manage models` row moved OUT of System into the Models category: new group
  "On-device models" with row (icon download, label "Manage models",
  sub "Download, update or remove Apple Speech + Whisper") → opens the models list page.
  SETT_PARENT.modelsList = 'models' (was 'system').
- Transcription page: the single "Mic behavior" group is split into FOUR groups:
  1. "Live" — Live transcription toggle (last=true)
  2. "Interruptions & silence" — When interrupted segmented + Auto-stop after silence stepper (last=true)
  3. "Engine behavior" — Apple online speech, Cleanup, Fallback engines (last=true)
  4. "History" — Save recordings (last=true)
  Copy unchanged, only regrouping + group titles.

## Status
- [x] Settings deltas applied to SettingsView.swift / ModelsView wiring
- [x] PhoneDigest seed verified in DigestDayView (Journal composer agent — seed param + raw-mode card)
