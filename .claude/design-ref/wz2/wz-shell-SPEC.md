# wz-shell.jsx — condensed implementation spec (desktop Electron settings window)

Full JSX lives in the Claude Design project (wz2/wz-shell.jsx); this spec captures every
app-relevant element of the REDESIGN branch. The ORIGINAL branch is the shipping app —
deltas below are what the desktop app should gain. Theme = buildRezmeTheme (wz-data.jsx):
dark bg #070d15, surface #101b2a, accent teal #1cc8b4 (alt sky #3da2f7), gradient teal→sky.

## Window
- 760×780 (matches settingsWindow.ts), radius 12 (mac) / 8 (win), theme.shadow.
- TitleBar 38px: traffic lights (mac) or min/max/close (win), ghost logo 18 (ListeningGhost sway,
  click-fun) + title "Whisperio Settings" / "Whisperio Recordings" (12px, textSecondary),
  theme toggle button 32×32 r6 (sun/moon 14, hover bgTertiary+accent color).
  Titlebar bg rgba(9,16,26,.86) dark, border-bottom theme.border, subtle accentGlow shadow.

## StatusHeader (REDESIGN-ONLY strip, toggleable)
Under the title bar: padding 11×20, bg bgSecondary, border-bottom.
Items separated by 1px×26 divider, each: mono 9.5 uppercase .12em label + value row:
- "Status": green StatusDot(glow) + "Ready" 13 semibold.
- "Dictate": Keycaps(dictationHotkey) e.g. Ctrl+Shift+Space.
- "Engine chain": labels joined by "→", first accentLight semibold, rest textSecondary.
- Right: when aiPostProcessing on — bolt 13 accentLight + "AI cleanup" 11.5 muted.

## Navigation
Tabs: General · Providers · Audio · Hotkeys · Updates · Recordings (icons IC.general/providers/
audio/hotkeys/updates/recordings from wz-data).
- Sidebar variant (default): width 198, bg bgSecondary, "SETTINGS" mono label; items r10 pad 9×12
  ui 13.5 semibold; active: accent .13 bg + accentLight + e1 shadow + 3px accent bar (left, r2, top/bottom 7).
  Bottom: version badge "● v1.4.0" (green dot 6, mono 10.5).
- Top-tabs variant (option): horizontal pill row, active = accent .13 bg + accentLight.

## Autosave (REDESIGN replaces Save button)
Save bar bottom (padding 12×24, border-top, bg): left-aligned
"✓ Changes save automatically" (12.5, check 14 accentLight) — on any change pulse to
green "Saved" for 1.4s (savedPulse). ORIGINAL keeps explicit "Save Settings" button.

## Tray / platform chrome (mock-only wallpaper chrome; real app equivalents)
- macOS MenuBar / Windows taskbar tray menu: ghost logo button → dropdown 218-220w r10-12:
  header (logo 20 + "Whisperio" FD13 + "Ctrl+Shift+Space to dictate" mono 10.5),
  items Settings / Recordings / divider / Quit Whisperio (danger red hover).
- These map to the app's existing tray menu — restyle only.

## Overlay
DictationOverlay (wz-overlay.jsx vendored verbatim) — bottom-center pill,
states armed/rec/cmd/proc/done/hidden; redesign: red live dot, ghost idle 30 in rec,
ghost note 30 in proc, teal→sky progress, green on-device badge, hint bubble above with
Ctrl+Shift+Space / Esc. MiniDisplay = mirrored overlay card for second display (concept).

## Tweaks defaults (design intent)
version Redesign, dark, accent #1cc8b4, primaryButton Solid, navigation Sidebar,
density Comfortable, statusHeader true.

## Keyframes
wzpulse (opacity/scale), wzwave (scaleY), wzspin, wzprog (progress slide -26px→64px).
