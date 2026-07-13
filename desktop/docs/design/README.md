# Whisperio Desktop — design reference

Source of truth for the v1.4+ UI: the Claude Design project **"Whisperio"**
(`claude.ai/design/p/21e16e40-c28e-4854-ab8e-12f95ea75beb`), which composes the
Rezme Design System ("Technical Confidence") with a faithful recreation of the
shipping Electron app.

## Files here

- **`tokens.css`** — THE contract. All renderer colors/fonts/radius/motion come
  from these `--wsp-*` variables; components must not hardcode hex. Themes:
  `data-theme="dark"` (default) / `"light"` / `"violet-legacy"` (frozen pre-Rezme
  aurora palette); accent picker via `data-accent`. Derived 1:1 from
  `src/renderer/theme.ts` + the design project's `wz2/wz-data.jsx`.
- **`wz-parts.jsx`** — design-source UI primitives (Section, ToggleRow, Segmented,
  Keycaps, StatusDot, buttons) in the "redesign" style: bordered cards radius
  12–14, accent tick on section titles, quiet density. Match new settings UI
  (e.g. the Cleanup panel) to these shapes.
- **`wz-overlay.jsx`** — design-source dictation overlay, full state set
  (armed → recording → transcribing → pasted, + Command Mode). Semantics:
  recording = red dot on cool-dark pill, transcribing = teal→sky progress,
  quiet green "on-device" badge.

## Not vendored (fetch from the design project if needed)

`wz2/wz-shell.jsx` (app shell + StatusHeader + nav), `wz2/wz-tabs.jsx` (settings
tabs), `wz2/wz-data.jsx` (theme builders — already captured by tokens.css),
`_ds/.../colors_and_type.css` (Rezme token source), `wz2/wz-recordings.jsx`.

## Rules (UI / theming contract)

- Brand: teal-forward (`--wsp-accent` #1cc8b4 lead, `--wsp-accent-2` #3da2f7
  support). Violet is legacy-only (`data-theme="violet-legacy"`).
- Recording signal: red dot on a cool-dark pill — never violet, never orange.
- Transcribing: teal→sky accent progress, visually distinct from recording.
- Reuse the On-device / Cloud badge vocabulary everywhere.
- Restrained motion: 120–200ms fades only.
