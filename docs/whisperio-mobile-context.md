# Whisperio — Full Context for Research (Apple Mobile Ecosystem)

> Paste this whole document into Claude Desktop as background, then add the research
> question at the bottom (or your own). It is written to be self-contained: everything
> Claude needs to know about what Whisperio *is*, what it *does today*, and what we
> *want to explore* on iPhone / iPad / Apple Watch.

---

## 1. One-liner

**Whisperio is a global voice-dictation tool: press a hotkey, speak, and your words are
transcribed and instantly pasted into whatever app you're using.** No browser tab, no
copy-paste, no "open the dictation app first." You talk, it types — system-wide.

It exists today as a desktop app (Windows, macOS, Linux). This document is the briefing
for exploring a **native Apple-ecosystem mobile version** (iPhone, iPad, Apple Watch).

---

## 2. Mission & philosophy

- **Dictation should be ambient and frictionless.** The win is removing every step
  between "I want to say this" and "it's now text in the thing I'm working in."
- **Bring-your-own-intelligence.** Whisperio is a thin, fast client over speech-to-text
  engines. Users pick the engine: a cloud API they already pay for, or a fully local/
  offline model. We are not locked to one vendor.
- **Privacy is a first-class option, not an afterthought.** Offline/local transcription
  means audio never leaves the device. This is a core differentiator, not a niche toggle.
- **Stay out of the way.** Lives in the tray/background, minimal overlay, no bloat.
  The interface is mostly *invisible* — the magic is that it works everywhere.
- **Open source, MIT.** Hackable, self-hostable, no walled garden.

The spiritual target for mobile: something that feels like **Obsidian for voice** — a
fast, local-first, low-friction capture tool you trust with your raw thoughts, that
stores them and lets you do something with them later.

---

## 3. The core interaction (the "magic")

On desktop the loop is:

1. Press a **global hotkey** (works from any application, even when Whisperio is in the
   background).
2. Speak. A minimal overlay shows recording status (on every monitor).
3. Press the hotkey again to stop.
4. Audio is transcribed (cloud or local), and the result is **auto-pasted into the
   currently focused text field** — via clipboard + simulated keystroke.

Variants that already exist:

- **Dictate & Send** — same flow, but presses Enter after pasting (great for chat apps).
- **Output recording** — records *system audio* instead of the mic (e.g. transcribe a
  meeting / a video).
- **Recording history** — optionally save audio, then browse, replay, and re-transcribe.

The state machine is literally: `idle → recording → transcribing → pasting → idle`.

---

## 4. Current product — full feature set (desktop, v1.2.0)

- **Global hotkey** dictation, system-wide.
- **Auto-paste** transcription into the focused field (clipboard + keystroke injection;
  Windows via native API/koffi, macOS via `osascript`, Linux via `xdotool`).
- **Dictate & Send** mode (auto-Enter).
- **Multi-monitor overlay** recording indicator.
- **Output/system-audio recording** and transcription.
- **STT provider chain with automatic fallback** — ordered list of providers; if the
  first fails, the next takes over.
- **Providers today:** OpenAI (`gpt-4o-transcribe`), ElevenLabs (Scribe v2), and any
  **self-hosted OpenAI-compatible STT server** (whisper.cpp, faster-whisper, LocalAI,
  Ollama) for fully offline transcription.
- **Local model management** — download/manage GGML Whisper models; can auto-start a
  bundled local whisper server (Windows) and point the app at `127.0.0.1`.
- **AI post-processing** — optional LLM pass that fixes technical terms / jargon using a
  user-supplied custom vocabulary.
- **Custom vocabulary & transcription prompt** — bias the recognizer toward your terms.
- **Language selection** (auto-detect or explicit; ~20 languages).
- **Recording history** — save, browse, replay, re-transcribe, delete.
- **Customizable hotkeys** — game-style key recorder for any combination.
- **System tray**, launch-at-startup, runs quietly in background.
- **Auto-update** from GitHub releases, with in-app status + "restart to install".
- **Dark & light themes**, switchable accent palettes.

---

## 5. Technical & architectural model

- **Stack:** Electron + React + TypeScript (electron-vite, Vitest). Native bits for
  keystroke injection per OS.
- **Process split:** main process (dictation state machine, hotkeys, transcription,
  settings, tray, auto-update) ↔ preload IPC bridge ↔ React renderer (settings UI,
  overlay, recordings).
- **Transcription flow:** build an ordered **provider chain**, filter to configured
  providers, try each in order, fall back on failure, surface a clear error if all fail.
- **Provider abstraction:** OpenAI-compatible HTTP (multipart audio upload) + ElevenLabs
  REST. Self-hosted = same OpenAI-compatible contract pointed at a local server.
- **Audio:** recorded to a temp/userData location; optionally persisted as files with
  metadata (duration, provider, transcript, status).
- **Settings:** JSON in userData. Key fields: provider chain, API keys, base URL, model,
  language, prompt, vocabulary, AI post-processing, hotkeys, save-recordings, theme.

---

## 6. STT providers & the offline story (important for mobile)

Whisperio's design assumes **the transcription engine is pluggable**. On desktop the
three tiers are:

1. **Cloud API** (OpenAI / ElevenLabs) — best quality, needs network + a user key.
2. **Self-hosted server** — OpenAI-compatible endpoint the user runs; private, offline-
   capable, but requires infrastructure.
3. **Local model** — Whisper GGML running on-device.

**Mobile reality check (to research, not assumed):** On iOS we likely *cannot* ship the
self-hosted-server model the same way, and bundling a large Whisper model is heavy. The
interesting question is whether **on-device Apple frameworks** can serve as the "local"
tier:

- Apple's on-device **Speech framework** (`SFSpeechRecognizer`, on-device mode).
- **Apple Intelligence** / on-device foundation models (where available, newer devices)
  for the *AI post-processing / cleanup* step.
- Whisper-on-device via Core ML (e.g. whisper.cpp Core ML / MLX builds) as an alternative.

So the mobile offline angle is probably: **cloud key (BYO) OR Apple on-device speech**,
with Apple Intelligence as the local cleanup pass. Self-hosting is likely dropped on
mobile. **This is exactly the kind of feasibility we want researched.**

---

## 7. Brand & design language

- **Mascot:** a friendly purple **ghost**.
- **Accent:** violet — `#8b5cf6` / `#a78bfa` (switchable palettes exist).
- **Type:** Space Grotesk (display) + IBM Plex Sans (UI) + JetBrains Mono (code/mono).
- **Mood:** dark "aurora," minimal, calm, gets-out-of-the-way. Light theme also exists.
- Mobile should feel native-Apple (SF-friendly layout, system gestures) while keeping the
  violet/ghost identity.

---

## 8. The mobile vision — what we want to explore (Apple ecosystem)

We want Whisperio to become a **native iPhone + iPad + Apple Watch** experience. The
desktop "global hotkey → speak → auto-paste anywhere" magic has no 1:1 on iOS, so we want
to find the closest native equivalents. Surfaces and interactions we're interested in:

**Target surfaces**
- **iPhone app** (primary).
- **iPad app** (split-view / larger canvas, note-taking).
- **Apple Watch app** — quick voice-memo capture on the wrist.
- **Custom keyboard extension** — a mic key available inside *any* app's text field; tap,
  dictate, text is inserted **inline** where the cursor is.
- **Action Button / Lock Screen / widget** trigger — hold, speak, transcript lands on the
  **clipboard** (and/or shared destination).
- **Haptic / Back-Tap trigger** — double- or triple-tap the back of the phone to start
  dictation, then auto-copy to clipboard and paste into the selected text input.

**Core interaction targets**
- *Custom keyboard:* tap mic in any app → dictate → inserts inline.
- *Action Button / Lock Screen:* hold → speak → transcript copied to clipboard.
- *In-app capture:* open app → record → get a clean transcript.
- *Haptic trigger:* dictate → copy to clipboard → auto-paste into the focused text input.

**The "voice memo / second brain" angle (Obsidian-like)**
- A dead-simple **voice note-taker**: just record a voice memo you can use later. It's
  stored locally and **flushed/synced to the iPhone when nearby** (esp. captured on the
  Watch). Think: capture raw thought now, transcribe/organize later. Local-first, your
  data, like Obsidian.

**Screens we expect**
- Onboarding
- Home / recordings list
- Live recording + waveform
- Transcript detail (edit, copy, share)
- Keyboard extension in action
- Settings (providers: cloud vs local / Apple Intelligence, hotword)
- Offline / local model (or Apple on-device) management

---

## 9. Hard constraints & known unknowns to research (iOS platform realities)

These are the questions that decide what's actually buildable. We want real answers, with
citations to Apple docs / developer guidance, not guesses:

1. **System-wide dictation is sandboxed.** iOS has no "global hotkey + paste into any
   app." What are the *legitimate* native equivalents and their limits?
   - **Custom keyboard extension:** can it record audio and run STT? Memory/CPU limits of
     keyboard extensions? "Allow Full Access" requirements and UX cost? Can it insert text
     inline reliably?
   - **Action Button / Shortcuts / App Intents:** can a Shortcut record audio, transcribe,
     and put text on the clipboard? Can it run from the Lock Screen / Action Button?
   - **Back-Tap:** is it only reachable via Accessibility → Shortcuts, and what can it
     actually trigger?
   - **Clipboard auto-paste:** can an app/extension paste into the *currently focused
     field* of another app, or is the realistic ceiling "put it on the clipboard, user
     pastes"? (iOS paste-notification / `UIPasteboard` constraints.)
2. **On-device speech options & quality:**
   - `SFSpeechRecognizer` on-device mode — accuracy, languages, time limits, offline
     guarantees, privacy posture.
   - Whisper on-device (Core ML / MLX / whisper.cpp) — model size, latency, battery, App
     Store size limits, background execution.
   - **Apple Intelligence / Foundation Models** availability matrix (which devices/OS),
     and whether it can do the *cleanup/post-processing* pass on-device.
3. **Apple Watch capture:** mic access, on-watch recording, on-device transcription vs
   relaying audio, and the **sync-when-nearby** model (WatchConnectivity / iCloud) for the
   voice-memo use case.
4. **Background & triggers:** what can run when the app isn't foreground (audio session
   rules, Action Button latency, Siri/Shortcuts entry points).
5. **BYO key vs subscription:** is "bring your own OpenAI/ElevenLabs key" allowed and sane
   on the App Store, or does Apple's IAP / review push us toward a subscription + our own
   backend? Privacy-manifest / data-disclosure implications of sending audio to a cloud
   API.
6. **App Store review risks:** keyboard-extension audio recording, "Full Access" data
   policies, clipboard usage prompts, background audio justifications.

---

## 10. Competitive reference

**Wispr Flow / "Whisper Flow"** already shipped a voice-dictation experience on iOS
(keyboard-based dictation, clean transcripts). It's proof the category is viable on
Apple platforms — we want to understand *how* they navigated the constraints above
(keyboard extension vs app, on-device vs cloud, paste vs insert) and what we can match
or do better (privacy / local-first / open).

---

## 11. What we want from the research

Produce a feasibility-and-strategy report covering:

- For **each surface** (iPhone app, iPad app, Watch app, custom keyboard, Action Button /
  Lock Screen, Back-Tap/haptic): what is *technically possible today* on current iOS/
  iPadOS/watchOS, what's *blocked or restricted*, and the *recommended* native pattern.
- The realistic **on-device transcription stack** (Apple Speech vs Whisper-on-device vs
  Apple Intelligence cleanup) with quality/latency/size/battery trade-offs.
- The **clipboard-vs-inline-insert** truth: how close can we get to the desktop "auto-
  paste anywhere" magic, legitimately?
- A recommended **MVP surface set** and phasing (what to ship first for maximum "wow"
  with least platform fighting).
- **App Store / privacy** risks and how to de-risk them.
- How **Wispr Flow** (and any close competitors) actually implemented this, as a reference.

Cite Apple developer documentation and credible sources. Flag anything that is
version- or device-gated (e.g. Apple Intelligence device requirements).

---

## 12. Ready-to-paste research prompt

> Paste sections 1–11 above as context, then this prompt. (Works in Claude Desktop with
> web search / research enabled.)

```
You are a senior iOS/Apple-platform engineer and product strategist. Using the Whisperio
context I pasted above, produce a rigorous FEASIBILITY + STRATEGY report on bringing
Whisperio to the Apple ecosystem (iPhone, iPad, Apple Watch). Whisperio's desktop magic is
"press a hotkey anywhere → speak → text is auto-pasted into the focused app," with a
bring-your-own-engine model (cloud API or fully local/offline) and a privacy-first stance.
I need to know what of that magic survives iOS's sandbox, and the best native substitutes.

Do real research with current sources. Cite Apple Developer documentation, WWDC sessions,
and credible engineering write-ups. Mark every claim that is version- or device-gated
(iOS/iPadOS/watchOS version, chip, Apple Intelligence eligibility) and give the cutoff.
Where Apple's rules are ambiguous or enforced only at App Review, say so explicitly and
describe the realistic risk.

Cover, per SURFACE, what is possible TODAY, what is BLOCKED/RESTRICTED, and the RECOMMENDED
native pattern:
1. iPhone app (in-app record → clean transcript).
2. iPad app (note-taking / split view).
3. Apple Watch app (on-wrist voice capture; on-device transcription vs relaying audio;
   "sync to iPhone when nearby" via WatchConnectivity/iCloud).
4. Custom keyboard extension — can it record mic audio and run STT? Memory/CPU/runtime
   limits of keyboard extensions, "Allow Full Access" requirements + UX cost, and whether
   it can insert text inline at the cursor in any app.
5. Action Button / Shortcuts / App Intents / Lock Screen — can a Shortcut or App Intent
   record audio, transcribe, and place text on the clipboard, launched from the Action
   Button or Lock Screen? Latency and background limits.
6. Back-Tap / haptic trigger (double/triple tap) — what can it actually launch (Accessibility
   → Shortcuts), and can that chain reach "dictate → clipboard → paste"?

Then answer these CROSS-CUTTING questions:
A. CLIPBOARD vs INLINE INSERT: how close can we legitimately get to "auto-paste into the
   currently focused field of another app"? Detail UIPasteboard behavior, the paste
   permission prompt, and where the realistic ceiling is (insert-inline only inside our own
   keyboard extension vs clipboard-only elsewhere).
B. ON-DEVICE TRANSCRIPTION STACK: compare (a) SFSpeechRecognizer on-device mode, (b)
   Whisper on-device via Core ML / MLX / whisper.cpp, (c) Apple Intelligence / Foundation
   Models for the post-processing "cleanup" pass. Give quality, latency, languages, model
   size, battery, App Store binary-size limits, background-execution rules, and the device/
   OS eligibility matrix for each.
C. ENGINE/BUSINESS MODEL: is "bring your own OpenAI/ElevenLabs API key" allowed and sane on
   the App Store, or does Apple's IAP / review push toward a subscription + our own backend?
   Privacy-manifest and data-disclosure (NSPrivacyAccessedAPI, "Allow Full Access" data
   policy) implications of sending audio to a third-party cloud API.
D. APP STORE REVIEW RISK: enumerate concrete rejection risks (keyboard extension recording
   audio, Full Access data use, clipboard prompts, background-audio justification, mic use
   in extensions) and how to de-risk each.
E. COMPETITOR TEARDOWN: how did Wispr Flow (and any close competitors) actually ship iOS
   voice dictation — keyboard extension vs standalone app, on-device vs cloud, insert vs
   clipboard, and their pricing model? What can we match or beat (privacy / local-first /
   open source)?

Finish with:
- A recommended MVP surface set + phasing: what to build first for maximum "wow" with the
  least platform fighting, and what to defer.
- A capability matrix table: rows = surfaces, columns = {record audio?, on-device STT?,
  insert inline?, clipboard?, background trigger?, Full Access needed?, review risk}.
- A short "what's impossible / not worth fighting Apple on" list, so we set expectations.

Be concrete and opinionated. Prefer tables. Flag uncertainty honestly rather than guessing.
```
