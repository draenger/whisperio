# Feature — Rewrite presets (mobile AI reformatting)

## What it does

On mobile, a raw transcript can be **rewritten** by a cloud LLM into a chosen format — e.g. clean-up,
bullet points, an email, a commit message. The formats are **presets**: a built-in catalog plus
user-created/edited ones. A special "meta" preset acts as a template builder that produces a new
preset.

## User-facing flow

1. Open a recording → **Rewrite**, then pick a preset from the sheet
   (`mobile/WhisperioApp/Sources/WhisperioApp/DetailView.swift:114`). Rewrite requires cloud consent +
   an API key; without a key it routes to Settings
   (`mobile/WhisperioApp/Sources/WhisperioApp/DetailView.swift:120`).
2. The rewritten text appears as a render card, saved back onto the recording.
3. Manage presets in Settings — create/edit in the preset editor
   (`mobile/WhisperioApp/Sources/WhisperioApp/PresetEditorView.swift:7`; opened via
   `openPresetEditor` at `mobile/WhisperioApp/Sources/WhisperioApp/SettingsView.swift:16` and the
   `.presetEditor` screen at `mobile/WhisperioApp/Sources/WhisperioApp/AppShell.swift:128`), or restore
   defaults.

## How it works (code path)

1. **Model + catalog (pure).** A `RewritePreset`
   (`mobile/WhisperioKit/Sources/WhisperioKit/RewritePresets.swift:17`) is stored in a
   `RewritePresetState` (`mobile/WhisperioKit/Sources/WhisperioKit/RewritePresets.swift:48`).
   `RewritePresetCatalog` merges built-ins with user overrides
   (`mobile/WhisperioKit/Sources/WhisperioKit/RewritePresets.swift:136`) and provides pure
   upsert/delete/restore transforms
   (`mobile/WhisperioKit/Sources/WhisperioKit/RewritePresets.swift:159`,
   `mobile/WhisperioKit/Sources/WhisperioKit/RewritePresets.swift:146`,
   `mobile/WhisperioKit/Sources/WhisperioKit/RewritePresets.swift:173`).
2. **Prompt (pure).** `RewritePromptBuilder.messages(preset:transcript:)` builds the system/user
   messages for the LLM (`mobile/WhisperioKit/Sources/WhisperioKit/RewritePresets.swift:186`).
3. **Persistence.** `PresetStore` holds the resolved presets and saves state as JSON in UserDefaults
   (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/PresetStore.swift:9`), with upsert/delete/restore
   delegating to the catalog transforms
   (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/PresetStore.swift:34`).
4. **Execution.** `SettingsStore.makeRewriter()` builds a `Rewriter`
   (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/SettingsStore.swift:94`,
   `mobile/WhisperioApp/Sources/WhisperioApp/Engine/SettingsStore.swift:139`) whose
   `run(preset:transcript:)` calls the chat LLM
   (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/SettingsStore.swift:147`). Detail's
   `runRewrite` invokes it and stores the render onto the recording
   (`mobile/WhisperioApp/Sources/WhisperioApp/DetailView.swift:136`); a meta preset routes through the
   template builder instead (`mobile/WhisperioApp/Sources/WhisperioApp/DetailView.swift:152`).

## Entry points (file:line)

- `mobile/WhisperioKit/Sources/WhisperioKit/RewritePresets.swift:76` — the preset catalog + transforms.
- `mobile/WhisperioKit/Sources/WhisperioKit/RewritePresets.swift:186` — the rewrite prompt builder.
- `mobile/WhisperioApp/Sources/WhisperioApp/Engine/PresetStore.swift:9` — preset persistence.
- `mobile/WhisperioApp/Sources/WhisperioApp/Engine/SettingsStore.swift:139` — the `Rewriter` runner.
- `mobile/WhisperioApp/Sources/WhisperioApp/PresetEditorView.swift:7` — the create/edit UI.

## Data touched

- Presets stored as JSON in UserDefaults (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/PresetStore.swift:22`).
- Sends the transcript to the configured cloud LLM only on explicit rewrite.
- Writes the produced render back onto the recording (see [recording history](recording-history.md)).

## Edge cases

- **No key / no consent** — rewrite is gated and routes to Settings
  (`mobile/WhisperioApp/Sources/WhisperioApp/DetailView.swift:120`).
- **Meta preset** — routed to the template builder rather than a direct rewrite
  (`mobile/WhisperioApp/Sources/WhisperioApp/DetailView.swift:152`).
- **Restore defaults** — user overrides are dropped and built-ins re-exposed
  (`mobile/WhisperioKit/Sources/WhisperioKit/RewritePresets.swift:173`).

## Related tests

- `mobile/WhisperioKit/Tests/WhisperioKitTests/RewritePresetTests.swift:1` — catalog merge,
  upsert/delete/restore, prompt building.
