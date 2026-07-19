/* Whisperio Apple — trigger scenes (interactive): custom keyboard, Back-Tap/Action/Lock,
   Dynamic Island / Live Activity, widgets & Control Center. Ported from KeyboardScene.swift,
   TriggerScene.swift, DynamicIslandScene.swift, WhisperioWidget.swift. Each fills a phone screen.
   NOTE: vendored copy for implementation reference; see SYNC-NOTES.md for the authoritative
   keyboard/widget/watch specs. WidgetScene contains shipped families + CONCEPT widgets
   (Quick dictate gradient, This-week stats w/ 7-day bars, Recent notes medium, Today's digest medium,
   Lock Screen combo, StandBy, Control Center tile). */

/* KeyboardSceneClassic: Messages thread mock; keyboard tray dark #0b141f / light #d4d2e2;
   top bar: globe 30x30 r8 white.06 · WGhost 16 + "Whisperio" 13 semibold · spacer ·
   ✨ rewrite 30x30 (only when inserted; menu: Clean up/Bullet points/Email reply/Action items/Summary,
   w190 elevated r12) · on-device chip (lock 10 green .12 pill) · mic 38 gradient circle shadow accent .55.
   Rows: qwertyuiop / asdfghjkl (inset 16px) / shift(40) zxcvbnm backspace(40) / 123(64x42) space(flex,42h) return(78x42 accent solid white).
   Key: h40 r7 keyBg white .13 dark / #fff light; font FUI 17.
   Toast in thread: check + "Back in Messages · text inserted" / "Rewritten in app · replaced";
   rewriting spinner "Rewriting in Whisperio…".
   explain sheet: "Dictation opens Whisperio" + arrowUR icon 40x40 r12; copy: "iOS keyboards can't use the
   microphone on their own, so the mic key opens Whisperio to record — then drops you right back here with
   the text inserted. One tap each way." + green lock "Still transcribed on-device" + GradButton "Got it — start dictating".
   recording overlay: bg2; back "‹ Messages" accentLite 15 semibold + EngineChip "On-device" cpu;
   WGhost 20 + SectionLabel "Listening…"; live text FD 24 med lh 1.45 + accent caret;
   Waveform 32 bars h64; GradButton "Insert & return to Messages" (check). */

/* TriggerScene: lock screen gradient #1a1430→#0a0911; Action Button nub 5x38 left (lights accent while listening);
   lock icon 16 white .6; "Tuesday, 17 June" FUI 22 .85; clock 84 semibold; Whisperio pill (WGhost 22 +
   "Whisperio" FD14 + "Tap to capture" FM 10.5) white .10 r16; bottom Back-Tap ×2/×3 pills white .08.
   listening overlay: EngineChip "Via {Action Button|Back-Tap|Lock Screen}" + Waveform 30/64 + live FD21 +
   stop 64 red ring red .18 7px. done overlay: green copy circle 30 + "Copied to clipboard" FD17;
   text card white .08 r16; row [book "Save to Whisperio"][share "Share"]; note "Open any app and paste —
   iOS won't let an app paste for you" FM11 white .55; "Tap anywhere to dismiss". */

/* DynamicIslandScene: island expanded 348w r34 black: gradient circle 40 WGhost 22 · red dot 7 +
   "Recording" FD13.5 + "on-device" FM11 white .6 · Waveform 20 bars h18 · mono clock 14 · stop 40 red.
   collapsed: pill h37 black: green check circle 24 + "Saved · tap to record" FM12.
   home grid 4 cols app tiles 58 r15 + dock 86 r32 white .12 with gradient Whisperio tile 56 r14. */

/* WidgetScene sections:
   "Shipped · WhisperioWidget.swift": systemSmall 150x150 r22 surface (teal #1cc8b4 circle 64 mic 30 white +
   "Dictate" FUI14 semibold); accessoryCircular (mic in 34 circle stroke white .4); accessoryRectangular
   (mic 15 + "Dictate" FUI14); Control Center iOS18 (mic in 34 r10 accent .16).
   "Concepts · Home Screen": Small gradient "Quick dictate" (mic circle 46 white .22, FD17);
   Small stats "THIS WEEK" (spark 15 accentLite + FM10.5 label; big FD30 700 "1,240"; "words · 5-day streak"
   FUI12; 7 bars flex h(5,8,4,9,7,3,6)+8 r2 accent, peak solid); Medium "Recent" (book 14; 2 rows:
   26 src-icon chip r8 + title FUI12.5 1-line + when FM10); Medium "Today's digest" (spark + cloud
   PrivacyBadge small; text FUI13.5 lh1.5; "4 notes · 3 categories" FM10.5).
   "Concepts · Lock Screen": card gradient #2a2350→#0c1020 r22: mic circle 58 white .14 + "3 notes today /
   Tap to review" row 58 r16 white .10 (book 32 r9 gradient); bottom inline: mic 13 + "Whisperio · Dictate"
   FUI12.5 white .82 + MiniWave 16 h12 white .6.
   "Concepts · StandBy": black r22 card: clock FD44 + date FUI12 white .5 | gradient mic circle 56 +
   "Dictate" FM10 accentLite.
   "Control Center": row card surface r16: gradient mic circle 46 + "Whisperio Dictate" FUI14.5 semibold +
   "Control · one tap to record" FM11.
   Toast bottom pill: green dot 8 + msg FUI13.5 on #221d33. */

/* Full interactive JSX lives in the Claude Design project (wz2/mob-triggers.jsx); this vendored file
   summarizes layout constants for Swift implementation. Re-fetch via DesignSync for the live source. */
