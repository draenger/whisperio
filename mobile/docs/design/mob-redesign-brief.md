# Whisperio mobile — Rezme redesign (vendored brief from the Claude Design project, wz2/mob-*.jsx)

Design source: `wz2/mob-core.jsx` + `wz2/mob-screens.jsx` (+ mob-settings/single/recap/
onboarding/triggers = 1:1 ports of the shipped app, restyled by the THEME — apply the theme
and primitives below and they follow). The `redesign` branch of the design is the TARGET.

## Theme (buildMobTheme 'redesign') — replaces the violet aurora palette
DARK: bg #070d15 · bg2 #05090f · surface #101b2a · surfaceUp #0c1826 · elevated #16243a ·
line #202b3b · lineSoft rgba(255,255,255,.05) · hair rgba(28,200,180,.30) ·
text #ecf2f9 · muted #b4c1d0 · faint #7e91a4 ·
accent #1cc8b4 · accentLite #5ee0d0 · accentRgb 28,200,180 ·
gradient linear-gradient(100deg,#15bca8,#3da2f7) · green #22c55e · red #ef4444 · amber #f59e0b
LIGHT: bg #f6f8fa · bg2 #eef2f6 · surface #ffffff · surfaceUp #ffffff(input) · elevated #eef2f6 ·
line #e3e9ef · text #0c1822 · muted #3f4f5e · faint #74859a · accent #0f8478 · accentLite #1cc8b4 ·
gradient linear-gradient(100deg,#0f9b8b,#1d7fd6) · green #16a34a · red #dc2626 · amber #d97706
Fonts: FD=Space Grotesk→(SF Pro Rounded/display w app), FUI=IBM Plex→(SF Pro Text), FM=JetBrains Mono→(SF Mono).
The app already has WZTheme + fonts — REMAP VALUES, keep the API.

## Primitives (mob-core) — map onto Components.swift/StyleKit.swift
- PrivacyBadge: pill, mono 11.5 semibold, green lock "On-device" / amber cloud "Cloud", tinted bg (12%/9%) + border (28%/25%)
- EngineChip: pill mono 11, accent-tinted when on
- SourceBadge: pill mono 10.5 (Keyboard/Action Button/Back-Tap/Watch/In-app) with icon
- GradButton: gradient bg, white text, radius 14, shadow accent 50%; GhostBtn: surfaceUp + line border, radius 14
- MToggle 46×28 accent; Segmented: container surfaceUp radius 12, selected = accent bg white text
- SectionLabel: mono 11 semibold uppercase letterspacing .12em faint
- SquareIconButton 38×38 radius 12 surfaceUp+line
- Waveform: 3px bars radius 3 accent; CategoryTag/FilterChip: hue-tinted pills (Work #4a8cf7, Code #a78bfa, Ideas #fbbf24, To-do #34d399, Messages #f472b6)

## Screens (mob-screens) — key REDESIGN deltas vs shipped app
- HOME: WHeader (title 24 FD + Square icon buttons: journal/book, settings/cog) · search field (surfaceUp pill radius 13) ·
  category filter chips row (horizontal scroll OK here) · **"Today's digest" card** (gradient 40×40 icon tile + mono eyebrow
  TODAY'S DIGEST + one-line preview + chevron → opens Journal) · grouped list cards (surface, radius 18, rows: 38×38 icon tile,
  2-line title 14.5, CategoryTag, mono meta line app·when·dur + engine lock/cloud icon, trailing copy button 36×36 radius 11) ·
  **full-width gradient "Dictate" pill (height 56, radius 16, micFill icon) at bottom with fade-out gradient** — REPLACES the round FAB
- RECORDING: top row = EngineChip("Apple Speech · on-device") + mono clock · SectionLabel "Listening…" ·
  live transcript FD 23 med lineHeight 1.45 · Waveform 34 bars height 70 accent · controls: X ghost circle 56 + RED stop circle 84
  (red border ring 16%) · processing = spinner + "Working…"
- DETAIL: badges row (SourceBadge + PrivacyBadge + CategoryTag) · mono meta · transcript card (surface radius 18 padding 18,
  text 17/1.55) · Rewrite result card with "Action items" + cloud badge · bottom: Copy/Share/Rewrite GhostBtns equal flex
- JOURNAL: day cards (surface radius 18: SectionLabel day + n notes mono + category tags + "Open daily summary →" accent mono link)
- DIGEST DAY: summary card (SectionLabel "Daily summary" + cloud badge; empty → copy + GradButton "Generate summary" spark;
  ready → text 15.5/1.6 + "Generated just now" + Regenerate GhostBtn) · category groups with RecRow lists
- iPad SPLIT: optional engines bar (Engines: On-device → OpenAI → ElevenLabs + device badge) · Library|Journal segmented ·
  sidebar 320 (logo header + search + All/Keyboard/Watch mono tabs + rows w/ selection accent tint) ·
  detail: header badges + Copy ghost + **Insert gradient btn** · "CLEANED UP ON-DEVICE" mono eyebrow · title FD 28 ·
  audio card (gradient 46 circle bolt + MiniWave + dur)
- WATCH: black bg · header ghost logo + "Whisperio" 13 FD + green 9:41 mono · "LATEST TRANSCRIPTS" eyebrow ·
  rows #15131c radius 13, 11.5 text 2-line clamp, green "✓ when · synced" mono 9

## Rules
- Keep ALL existing behavior/logic (incl. sync-controls big manual Sync button — restyle it into the theme).
- Violet stays ONLY if a violet accent option exists in settings; default = teal. Keyboard/watch/widgets follow theme.
- No regressions: Kit tests green, app+keyboard+watch+widget build.
