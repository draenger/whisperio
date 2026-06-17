# Whisperio on Apple Mobile — Feasibility Research

> Auto-generated from a deep, multi-source, adversarially-verified research pass
> (29 sources fetched → 127 claims → 25 verified, 24 confirmed / 1 refuted).
> Confidence and split-votes are noted per claim. Dated **June 2026**; several findings
> are time-sensitive (iOS 26.4 + late-2025/2026 App Store guideline updates).

## TL;DR

Whisperio's core desktop magic — **"hotkey anywhere → speak → text auto-pastes into the
focused app"** — does **not** survive iOS's sandbox intact:

- **No extension can record the microphone** — including custom keyboards. Dictation must
  happen in a real (containing) app.
- **The only way to insert text inline into another app** is a **custom keyboard** via
  `UITextDocumentProxy.insertText`. Ordinary apps cannot reach another app's text field.
- The shipped industry pattern (**Wispr Flow**) is a hybrid: a custom keyboard that
  **bounces out to its containing app** to record, transcribes (cloud), then inserts inline.
  **iOS 26.4 degraded even this** — Apple now forces a manual swipe-back.
- A **fully on-device, private pipeline is shippable today** via whisper.cpp / WhisperKit
  (iOS 17+, broad device support). Apple's own SpeechAnalyzer/Foundation Models is better
  integrated but **iOS 26+ and Apple-Intelligence hardware only**.

**Recommended MVP:** a **standalone app** (record → clean transcript → clipboard/share)
**+ a companion custom keyboard** for inline insertion, with **on-device Whisper** as the
default privacy engine. Whisperio's privacy-first / local-first / open-source angle is a
**genuine differentiator** vs Wispr Flow (cloud-only, fails offline).

---

## Per-surface findings

### 1. iPhone app (in-app record → clean transcript) — ✅ FULLY VIABLE
A normal app can record mic audio and transcribe on-device. Proven shipping example:
**Aiko** (whisper.cpp + Core ML, "nothing leaves your device"). Caveat: Aiko transcribes
**pre-recorded files**, not live dictation — the live record→insert loop still needs
building, but no platform blocker exists for in-app capture. *(high confidence)*

### 2. iPad app (note-taking / split view) — ✅ VIABLE (under-researched)
Same app capabilities as iPhone; no surviving claim flagged an iPad-specific blocker.
Split-view/note-taking patterns weren't deeply verified — treat as low-risk but confirm.

### 3. Apple Watch (on-wrist capture + sync) — ⚠️ UNVERIFIED
`AudioRecordingIntent` exists on **watchOS 11+**, but no surviving evidence confirmed
on-wrist dictation quality, on-watch transcription viability (RAM/CPU), or the
WatchConnectivity/iCloud "sync-when-nearby" flow. **Open question — needs a focused spike.**

### 4. Custom keyboard extension — ⛔ THE HARD WALL
- **Cannot record the microphone.** Apple's App Extension Programming Guide, verbatim:
  *"Custom keyboards… have no access to the device microphone, so dictation input is not
  possible."* Recording inside a keyboard fails with `AVAudioSession` error 561145187 even
  with Full Access + mic permission. *(high, 2-1)*
- **Can insert text inline** at the cursor via `UITextDocumentProxy.insertText` — the
  **only** cross-app inline-insert mechanism on iOS. Exceptions: secure/password fields and
  phone-pad fields (iOS swaps in the stock keyboard). *(high, 3-0)*
- **No network / no shared container by default** — both need **"Allow Full Access"**
  (`RequestsOpenAccess`). Cloud STT in a keyboard mandates Full Access (scary system
  warning = trust cost). *(high, 3-0)*
- **Guideline 4.4.1**: keyboards must *"remain functional without full network access and
  without requiring full access"* and must **not** *"launch other apps besides Settings."*
  So basic typing must work without Full Access; network STT can only be an add-on path.
  *(high, 2-1)*

### 5. Action Button / Shortcuts / App Intents / Lock Screen — ✅ VIABLE, with mandatory UI
- **`AudioRecordingIntent`** (iOS/iPadOS 18+, watchOS 11+) is the sanctioned path to
  start/stop recording from a Shortcut / Action Button; the system shows a recording
  indicator. *(high, 3-0)*
- **But:** you **must start and maintain a Live Activity** for the whole recording or it
  stops, and recording **cannot be cold-started from a fully backgrounded state** — it must
  originate while foregrounded. **No silent background recording.** *(high, 3-0)*

### 6. Back-Tap / haptic trigger — ✅ as a launcher only
Back Tap (Settings → Accessibility → Touch → Back Tap) can **run a Shortcut** on
double/triple tap. Device-gated: **iPhone 8+, iOS 14+, requires unlocked device, does NOT
work from the lock screen.** It can launch a dictate→clipboard Shortcut, but cannot reach
silent paste-into-foreground-app. *(high, 3-0)*

---

## Cross-cutting

**A. Clipboard vs inline insert.** Realistic ceiling:
- **Inline insert into an arbitrary app → only inside our own custom keyboard** (via
  `UITextDocumentProxy`), and only while that keyboard is active.
- **Everywhere else → clipboard only**, then the user pastes manually. (Exact current
  paste-permission-prompt behavior wasn't fully verified — open question.)
- The desktop dream of "silently paste into whatever's focused, no keyboard, no prompt" is
  **not achievable**.

**B. On-device transcription stack.**
| Engine | OS / device gate | Notes |
|---|---|---|
| **whisper.cpp / WhisperKit** | **iOS 17+ / macOS 14+** — broadest reach | Best default today for a privacy-first app. iOS limited to small/medium models (large won't fit memory). *(high, 3-0)* |
| **Apple SpeechAnalyzer / SpeechTranscriber** | **iOS 26+ only** | Best OS integration; fully-local pipeline w/ Foundation Models cleanup, but **Apple-Intelligence hardware only** (iPhone 15 Pro/A17 Pro+, M1+, 8GB+ RAM). *(high, 3-0)* |
| **`SFSpeechRecognizer` (on-device mode)** | older OS | Legacy fallback; not the str/quality leader. |
| **Apple Foundation Models** | iOS 26+, AI hardware | For the **post-processing cleanup** pass (fix terms/punctuation). |

> ⚠️ Refuted: the "Apple supports ~10 languages vs WhisperKit ~100 (10×)" claim was killed
> (1-2). Don't cite that ratio. (Source was Argmax, a WhisperKit vendor.)

**C. Business model.** **Bring-your-own-API-key is risky.** Guideline **3.1.1**: apps may
not use *"their own mechanisms to unlock content or functionality, such as license keys"* —
App Review has rejected BYO-key apps framed as unlocking features. Safer: **subscription +
IAP**, optionally honoring desktop subscriptions under **3.1.3(b)** (multiplatform) *provided
the sub is also purchasable via IAP in-app*. Hedge: a fully-free app that merely *requires* a
user key to operate (no IAP-gated features) is more defensible — **but unverified in
practice** (open question). *(high, 3-0)*

**D. App Store review risks & de-risking.**
- Sending audio to **OpenAI/ElevenLabs** triggers **5.1.2(i)**: must *"clearly disclose where
  personal data will be shared with third parties, including with third-party AI, and obtain
  explicit permission before doing so"* (the "third-party AI" wording was added Nov 2025).
  **On-device transcription avoids this entirely.** *(high, 3-0)*
- Keyboard must work without Full Access (4.4.1); Full Access prompt is a trust cost.
- No silent background mic; Live Activity is mandatory during Action-Button recording.

**E. Competitor teardown — Wispr Flow.** Custom keyboard ("Wispr Flow: AI Voice Keyboard")
→ invokes a separate Flow app to capture mic → **cloud** transcription → inserts polished
text inline. **No offline/on-device mode; fails when offline.** iOS 26.4 broke its seamless
return (manual swipe-back now). Other refs: Aqua Voice, superwhisper/Spokenly. *(high, 3-0)*

---

## Recommended MVP + phasing

**Phase 1 — Standalone iPhone app (lowest platform friction, real "wow").**
- Record → on-device Whisper (WhisperKit/whisper.cpp) → clean transcript.
- Output: copy to clipboard + share sheet; local history (the "voice memo / second brain").
- Optional cloud engine (BYO or sub) **with explicit 5.1.2(i) consent**; on-device default.

**Phase 2 — Companion custom keyboard** for inline insertion in other apps.
- Mic capture still routes through the containing app (the unavoidable bounce); keyboard
  inserts via `UITextDocumentProxy`. Set expectations re: iOS 26.4 swipe-back.

**Phase 3 — Action Button / Shortcuts / Back-Tap** entry points via `AudioRecordingIntent`
(+ mandatory Live Activity), landing transcript on the clipboard.

**Phase 4 — iPad polish + Apple Watch spike** (after the watch open questions are answered).

## Capability matrix

| Surface | Record audio? | On-device STT? | Insert inline? | Clipboard? | Background trigger? | Full Access needed? | Review risk |
|---|---|---|---|---|---|---|---|
| iPhone app | ✅ | ✅ | ❌ | ✅ | ⚠️ foreground-start only | — | Low |
| iPad app | ✅ | ✅ | ❌ | ✅ | ⚠️ | — | Low |
| Apple Watch | ⚠️ unverified | ⚠️ | ❌ | ⚠️ | ⚠️ | — | Unknown |
| Custom keyboard | ⛔ (no mic) | n/a in ext | ✅ (only here) | ✅ | ❌ | ✅ for network | Med–High |
| Action Button / Shortcut | ✅ via App Intent | ✅ | ❌ | ✅ | ⚠️ Live Activity req'd | — | Low–Med |
| Back-Tap | launches Shortcut only | — | ❌ | ✅ (via Shortcut) | ❌ (unlocked only, no lock screen) | — | Low |

## What's impossible / not worth fighting Apple on

- A **single background gesture that records and silently pastes into an arbitrary
  foreground app** with no app-switch and no paste prompt. **Dead end.**
- **Microphone recording inside any extension** (keyboard or otherwise).
- **Inline text insertion from a normal app** (non-keyboard) into another app.
- **Fully silent / cold background recording** from a locked or backgrounded state.
- A **frictionless keyboard→app→keyboard round-trip** — Apple is actively tightening it
  (iOS 26.4); don't over-invest.

## Open questions (need a focused spike)

1. **Apple Watch:** on-wrist capture quality, on-watch vs relayed transcription, and the
   WatchConnectivity/iCloud "sync-when-nearby" flow.
2. **UIPasteboard:** exact current cross-app paste-prompt behavior; can a Shortcut place
   text silently so the user does a single manual paste?
3. **Model sizing:** which quantized Whisper model fits app-size/cellular-download limits
   with acceptable live-dictation latency on a mid-range iPhone?
4. **BYO-key in practice:** does Review actually accept a free app that *requires* a user
   key (no IAP-gated features), or push everything to IAP regardless of framing?

## Key sources (primary)

- Apple — Custom Keyboard / App Extension Programming Guide
- Apple — `UITextDocumentProxy`, `AudioRecordingIntent` docs
- Apple — App Store Review Guidelines (3.1.1, 3.1.3(b), 4.4.1, 5.1.2(i))
- Apple — Run shortcuts by tapping the back of iPhone (Back Tap)
- Wispr Flow docs — keyboard setup + "Adapting to iOS 26.4"
- Argmax (WhisperKit) — Apple vs Argmax on-device comparison *(vendor — verify framing)*
- swift-scribe (FluidInference) — fully-local SpeechAnalyzer + Foundation Models POC
- Aiko (Sindre Sorhus) — offline on-device Whisper on iOS
