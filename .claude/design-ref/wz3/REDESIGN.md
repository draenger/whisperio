# wz3 redesign delta (from Claude Design project 21e16e40-c28e-4854-ab8e-12f95ea75beb, 2026-07-24)

Delta-ADD across all platforms. **Never remove existing functionality** — restyle/add only.
Electron has **no iCloud/CloudKit sync** (git mirror only); everything else keeps its sync.
Design decisions below were made by the implementer where the design files were pick-a-variant
galleries (the project's "…Options"/"…Variants"/"…Lab" HTMLs are A/B/C style pickers, not a
single blessed spec).

## 1. iPhone/iPad · Settings → Models · NEW "In use now" chip pair  (from "Settings Chip Options.html")
A new panel at the TOP of the on-device models screen (`ModelsView.swift`) titled **"In use now"**
showing the two active engines as stacked chips:
- **STT chip** — eyebrow "SPEECH → TEXT (STT)", provider (e.g. "Apple — on-device"), model
  (e.g. "Apple Speech"), right-side badge on-device(green ▪)/cloud(amber ◆).
- **LLM chip** — eyebrow "LANGUAGE MODEL (LLM)", provider (resolved intelligence provider:
  Apple Intelligence / OpenAI / the selected local GGUF model / "Not set"), model line, badge.
- Both reflect REAL state: STT = `settings.primaryProvider` + its model; LLM = the resolved
  `intelligenceProvider` (auto/appleIntelligence/openAI/localModel) + chat/local model name.
**CHOSEN STYLE = C · Minimal flat** (quiet, app-native, lowest visual risk, matches current Settings):
  row: icon tile 38×38 r10 `surfaceUp` + `line` border, accentLite glyph; body = eyebrow
  `mono 9 faint uppercase` + provider `ui 14.5 semibold text` + model `mono 10.5 muted`; trailing
  badge pill `mono 9`. Stacked in a `SettGroup`-style panel labelled "In use now".
(Styles A Signature / B Circuit-IC / D PCB were the flashier rejected options.)
RISK: `SettingsView`/`ModelsView` — keep any new section type-erased (`AnyView`) per the build-71
stack-overflow fix. This new panel lives in ModelsView (its own body), lower risk than SettingsView.

## 2. iPhone/iPad · Home · RecRow restyle  (from "RecRow Variants.html")
**CHOSEN VARIANT = B · text-first**: drop the leading source-icon TILE and the trailing copy TILE;
title first (2-line clamp, ui 14.5), then meta line with the source icon inline (small, faint) +
category dot/label + app · when · dur + engine badge (cloud amber / lock green); copy becomes a
quiet ghost glyph (no boxed tile). Lightest row, keeps EVERY datum + the copy action.
MUST PRESERVE: the swipe-to-delete gesture arbitration and copy-on-card behavior already in
`HomeView.RecRow` — only the row's internal layout changes, not its gestures/actions.

## 3. Electron desktop · implement the wz2 desktop design  ("na electronie duzo")
The Electron app (`desktop/`) should adopt the vendored desktop design language in
`.claude/design-ref/wz2/`: `wz-shell.jsx` (window shell + sidebar/tabs), `wz-tabs.jsx`
(settings tabs — General/Providers/Audio/Hotkeys/Updates/Recordings), `wz-recordings.jsx`
(recordings window), `wz-overlay.jsx` (dictation overlay pill), `wz-parts.jsx` (shared parts),
`wz-electron.jsx` (the Electron-specific composition), `wz-data.jsx` (tokens/sample data).
Delta-ADD: restyle the existing React renderer to match, keep all IPC/features
(hotkeys, overlay, dictation, command mode, output recording, recordings store, github sync,
settings). Colors ONLY via `tokens.css` variables (repo rule). NO iCloud — git sync stays the
cross-platform bridge. Gates: `npm run typecheck` + `npm run test:coverage` green.

## 4. Mac native · desktop-design polish
The native Mac Settings already ported wz-tabs (MacSettingsShell/MacSettingsTabs2, build 67).
Apply the same "In use now" chip idea to the Mac Providers/Intelligence tab, and align remaining
desktop-design details from wz-shell/wz-tabs. Delta-ADD, keep functionality.
