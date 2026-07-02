# Whisperio — Mobile Implementation Plan

*Apple (iOS / iPadOS / watchOS) + Android / Wear OS*
*Companion to the feasibility report. Written June 2026. Targets the shipping OS generation: iOS/watchOS **26**, Android **13–16** (API 33–36).*

> Doc is in English on purpose — it's full of API names and is meant to live next to code / a public source-available repo. Say the word and I'll flip it to PL.

---

## 0. The one decision that matters most: stack + sequencing

**Build native, one platform at a time, iOS first.** Not React Native, not Flutter.

Every high-value surface in this product — the voice keyboard, on-device speech, the Watch/Wear capture — is deep-OS integration that only exists in native APIs. A cross-platform layer would help only the in-app screens (~30% of the work) and actively fight you on the other 70% (keyboard extensions, `SpeechAnalyzer`, `WatchConnectivity`, `InputMethodService`, Wear Data Layer). Your .NET/React/TS muscle memory does **not** transfer here — this is a Swift project and, later, a Kotlin project. Accept that up front.

If you later insist on code sharing, the only sane option is **Kotlin Multiplatform for the domain layer only** (provider chain, models, settings, history-sync logic) with native UI/integration per platform. Don't start there. Extract shared logic *after* iOS proves the model.

**Sequencing (this is the anti-split-focus rule):** ship iOS fully — Phase 1 → 2 → 3 — *then* start Android. Do not run two native codebases in parallel as a solo dev. That's the exact trap you already know is your enemy. One platform, shipped, then the next.

---

## 1. Shared architecture (mirror your desktop, both platforms)

The desktop mental model survives intact at the domain level. Re-express it identically on each platform:

**State machine:** `idle → recording → transcribing → cleaning → output → idle` (same as desktop).

**Core abstractions (one per platform, identical shape):**

| Abstraction | Responsibility | Desktop equivalent |
|---|---|---|
| `TranscriptionProvider` | `transcribe(audio) -> Result<Transcript, Error>` | your STT provider interface |
| **Provider chain** | ordered list, try each, fall back on failure, surface error if all fail | your existing fallback chain |
| `CleanupProvider` | optional LLM pass: de-umm, punctuation, custom-vocab fixes, formatting | your AI post-processing |
| `Recording` | audio file + metadata (duration, provider, transcript, status) | your recording history model |
| `Settings` | provider order, keys, base URL, model, language, vocab, cleanup on/off | your JSON settings |

**Provider chain, concretely, per platform:**

| Tier | iOS | Android |
|---|---|---|
| 1. On-device (default) | `SpeechTranscriber` (iOS 26) → `DictationTranscriber` fallback | `SpeechRecognizer.createOnDeviceSpeechRecognizer()` (API 33+) |
| 2. On-device cleanup (enhance) | Foundation Models (Apple-Intelligence devices) | ML Kit GenAI / Gemini Nano (AICore devices) |
| 3. Cloud (BYO key, opt-in) | OpenAI `gpt-4o-transcribe` / ElevenLabs Scribe — same HTTP contract as desktop | identical |

Keep tiers 1–2 as the privacy/offline default and tier 3 as an explicit opt-in. That ordering *is* your brand.

**Old-device strategy (decision): the chain itself solves "old iPhones."** Devices without
on-device support — no Apple Intelligence hardware, or simply too old to run the on-device
tier — are **not dropped**. The provider chain degrades them straight to **tier 3 cloud
(OpenAI / ElevenLabs)**, exactly like the desktop fallback. So the on-device gate is a
*progressive enhancement*, never a hard requirement: new/AI-capable devices get free, private,
offline transcription; old devices stay fully functional via a BYO cloud key (or subscription).
This is why the deployment-target choice below is a reach trade-off, not a feature cliff.

---

## 2. Apple plan (iOS / iPadOS / watchOS)

### Stack & project shape
- **Swift 6 + SwiftUI**, Xcode 26. **Deployment target is a reach decision, not a hard gate** (see "Old-device strategy" in §1):
  - **Option A — min iOS 26 (simplest MVP):** lets you use `SpeechTranscriber` unconditionally and skip availability-guard branching. Drops pre-26 iPhones entirely. Fine if you want the leanest first ship.
  - **Option B — min iOS 17 (recommended once cloud tier exists):** older iPhones install the app and run **cloud STT (OpenAI/ElevenLabs)**; on-device `SpeechTranscriber` becomes a runtime-gated enhancement on iOS 26 + AI hardware. Wider reach, slightly more branching. This matches the desktop provider-chain philosophy.
  - Either way, **guard every on-device API behind an availability check** — you need that branching for non-AI iOS-26 devices regardless.
- **Universal app** (iPhone + iPad share one target; iPad gets layout adaptivity, not a separate product).
- **Targets:** (1) App, (2) `WhisperioKit` shared framework (domain, provider chain, persistence), (3) Watch app, (4) App Intents (in app or framework), (5) Keyboard extension — added in Phase 3.

### Capabilities / entitlements (set these once)
- **App Group** `group.ai.whisperio` — the shared container that lets app ↔ keyboard ↔ intents ↔ watch exchange recordings, transcripts, settings. This is load-bearing; design around it from day one.
- `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription`.
- **Background Modes → Audio**, declared *only* because capture must survive the keyboard bounce; tie it to active capture, don't fake keep-alive (review risk).
- `PrivacyInfo.xcprivacy` privacy manifest + accurate App Store privacy labels (esp. if cloud tier sends audio out).
- Keyboard `RequestsOpenAccess = YES` — Phase 3 only.

### Phase 1 — In-app core (iPhone + iPad) — *the only no-compromise surface, ship this first*
1. `AVAudioEngine` mic capture + live waveform.
2. `SpeechAnalyzer` + `SpeechTranscriber` streaming with partial results. **Preheat/allocate the locale model at app launch** — there were early-beta reports of ~14s cold starts; warming it avoids that. Wire `DictationTranscriber` as the fallback for unsupported languages/older devices ([WWDC25 session 277](https://developer.apple.com/videos/play/wwdc2025/277/)).
3. Foundation Models cleanup pass behind a **runtime availability check**; degrade silently to "no cleanup" or cloud when unavailable (any non-Pro iPhone 15 and older get nothing — gate it) ([device requirements](https://support.apple.com/en-us/121115)). Same gating applies to on-device STT: if `SpeechTranscriber` is unavailable (old device / old OS / unsupported locale), the provider chain falls through to **cloud STT** — the user still gets a transcript, just not offline.
4. Cloud BYO provider (OpenAI/ElevenLabs), reusing your desktop's multipart-upload contract.
5. Provider chain with fallback + clear all-failed error.
6. Transcript detail screen: edit / copy / share. History (SwiftData or files in the App Group). Settings.

### Phase 1.5 — Action Button / Shortcuts / Lock Screen — *highest wow-per-effort for "everywhere"*
- App Intent `DictateToClipboardIntent`: record in the app's audio session → transcribe → `UIPasteboard.general.string = result` → return the string as a Shortcuts result.
- Ship an importable Shortcut; document binding to the **Action Button** (iPhone 15 Pro+) and **Back Tap** (Settings → Accessibility → Touch → Back Tap → your Shortcut). Back Tap is a tutorial, not code.
- **Live Activity / Dynamic Island** for recording state with an end-session control (Wispr does exactly this).
- Reality check: post-**iOS 26.4**, mic activation from a Shortcut/keyboard may force a manual swipe-back to your app. You can't beat it; you can only make the swipe smooth.

### Phase 2 — Apple Watch — *your differentiator vs Wispr (they have no wrist story)*
- watchOS app: `AVAudioRecorder` → local file. Complication for one-tap capture.
- **Do not transcribe on the watch** — `SpeechTranscriber` is unavailable on watchOS ([WWDC25 277](https://developer.apple.com/videos/play/wwdc2025/277/)).
- `WCSession.transferFile` ships audio to the iPhone when reachable; queue locally and flush when nearby = your "sync when nearby" vision, natively.
- iPhone receives → transcribes → writes into shared history. Capture-now-transcribe-later, local-first.

### Phase 3 — Keyboard extension — *necessary for "everywhere", highest risk, do last*
- Minimal keyboard + mic key (no need to reimplement a full keyboard at MVP).
- Tap mic → open the main app (the Wispr "Start Flow" bounce) so the **app** can grab `AVAudioSession` (the extension legally cannot record).
- iOS 26.4: user manually swipes back; show a one-time explainer.
- App records (background audio) → writes transcript to App Group → keyboard reads it → `textDocumentProxy.insertText`. Clipboard fallback if insert fails or there's no field.
- `RequestsOpenAccess` + an explicit privacy policy: **no keystroke logging, audio only on explicit tap, on-device by default.** This is your #1 App Review hurdle — front-load the justification.

### Apple build order
`Phase 1 (universal app) → 1.5 (Action Button) → 2 (Watch) → 3 (keyboard)`. Ship after Phase 1.5; Watch and keyboard are fast-follows, not launch blockers.

---

## 3. Android plan (Android / Wear OS)

### The good news Android gives you that iOS never will
On Android, a custom keyboard (**`InputMethodService`**) **can record from the mic itself and insert inline** via `currentInputConnection.commitText(...)`. No app bounce, no swipe-back. The desktop "speak where your cursor is" magic *mostly survives* here. This flips the iOS priority order: on Android the keyboard is a Phase-2 feature, not a Phase-3 ordeal.

### Stack & project shape
- **Kotlin + Jetpack Compose**, **min SDK 33 (Android 13)** so `createOnDeviceSpeechRecognizer()` is available; cloud fallback covers anything below.
- **Modules:** (1) `:app` (Compose UI, capture, history, settings), (2) `:ime` (the voice keyboard `InputMethodService`), (3) `:wear` (Wear OS), (4) `:core` (domain / provider chain — this is the KMP-shareable layer if you ever go that route), (5) optional `:a11y` (AccessibilityService overlay) in Phase 3.

### Permissions
- `RECORD_AUDIO`.
- Foreground service with **`foregroundServiceType="microphone"`** — mandatory declaration since **Android 14 (API 34)** for background capture ([Picovoice guide](https://picovoice.ai/blog/android-speech-recognition/)).
- `POST_NOTIFICATIONS` (the foreground-service notification).
- `SYSTEM_ALERT_WINDOW` + AccessibilityService — **only** if you build the Phase-3 overlay (Option B below).

### On-device STT & cleanup
- **STT:** `SpeechRecognizer.createOnDeviceSpeechRecognizer()` (API 33+, offline, free, fails cleanly if no local engine) ([Android XR ASR docs](https://developer.android.com/develop/xr/jetpack-xr-sdk/asr)). Upgrade path: **ML Kit GenAI Speech Recognition** (Gemini Nano via AICore) — Basic mode on API 31+, Advanced/GenAI currently Pixel-10-ish, more devices in progress, still alpha as of 2026 ([ML Kit GenAI](https://developers.google.com/ml-kit/genai/speech-recognition/android)). Fully-offline-OSS option if you want desktop parity: **Vosk** ([alphacep/vosk-api](https://github.com/alphacep/vosk-api)) or whisper.cpp via JNI.
- **Cleanup:** ML Kit GenAI rewriting/proofreading (Gemini Nano, AICore devices — Pixel 8+/9/10, Galaxy S24+) behind an availability check; cloud LLM fallback otherwise.

### Phase 1 — In-app core
- Compose UI; `AudioRecord`/`MediaRecorder` capture in a `microphone` foreground service; on-device `SpeechRecognizer` streaming (`onPartialResults`); provider chain; cleanup pass; Room history; settings; clipboard output (`ClipboardManager`).

### Phase 1.5 — Quick capture (Android's "Action Button" equivalents)
- **App Shortcut** + **Quick Settings tile** + home-screen **widget**, each → foreground service records → transcribe → clipboard → user pastes. (Android has no single Action Button, so you cover the several entry points users actually have.)

### Phase 2 — Voice keyboard (IME) — *the everywhere win, and better than iOS here*
- `InputMethodService` with a mic key. Records directly, transcribes, `commitText(text, 1)` inserts inline at the cursor in any app. User selects Whisperio as a keyboard once. Clean, low review risk, genuinely delivers the desktop feel.

### Phase 2 — Wear OS — *Google literally documents your exact use-case*
- Wear app: `AudioRecord` capture → transfer to phone via the **Wearable Data Layer API**. Use `ChannelClient` for streamed audio or `DataClient` + `Asset` / a file for completed recordings; `MessageClient` for the RPC/capability handshake. Phone transcribes (offload, because the watch lacks the horsepower) and stores in history ([Wear voice-transcription pattern](https://developer.android.com/training/wearables/data/messages), [client types](https://developer.android.com/training/wearables/data/client-types)).
- Gotchas: Data Layer requires **same package name + same signing key** on both sides; it routes over Bluetooth and falls back to E2E-encrypted cloud; it does **not** work if a Wear OS watch is paired to an iPhone (irrelevant here, but know it).

### Phase 3 — AccessibilityService overlay (optional, Wispr's Android model)
- Floating bubble via `SYSTEM_ALERT_WINDOW`, text insertion via AccessibilityService `ACTION_SET_TEXT`/paste — works regardless of the selected keyboard. **Only build this if the IME isn't enough.** Accessibility-service apps get heavy Play Store scrutiny and can be pulled if the justification is weak. The IME (Phase 2) is the safer "everywhere" play.

### Android build order
`Phase 1 (app) → 1.5 (quick capture) → 2 (IME + Wear) → 3 (a11y overlay, maybe never)`.

---

## 4. iOS vs Android — where they diverge (so you don't assume parity)

| Capability | Apple | Android |
|---|---|---|
| Keyboard records audio itself | ❌ must bounce to app | ✅ IME records directly |
| Keyboard inserts inline | ✅ `insertText` | ✅ `commitText` |
| "Type anywhere" magic | janky (bounce + swipe-back) | mostly intact via IME |
| On-device STT | `SpeechTranscriber` (iOS 26) / `DictationTranscriber` | `createOnDeviceSpeechRecognizer` (API 33) / ML Kit GenAI |
| On-device cleanup LLM | Foundation Models (A17 Pro+, 8GB) | Gemini Nano via AICore (Pixel 8+/9/10, S24+) |
| Quick trigger | Action Button + Back Tap → Shortcut | App Shortcut + QS tile + widget |
| Overlay/bubble over other apps | ❌ impossible | ✅ `SYSTEM_ALERT_WINDOW` + a11y |
| Wrist capture → phone transcribe | `WCSession.transferFile` | Wear Data Layer (`ChannelClient`/`DataClient`) |
| Wrist on-device STT | ❌ not on watchOS | limited / offload to phone |
| Biggest review risk | keyboard Full Access | AccessibilityService overlay |

**Implication:** don't copy the iOS architecture onto Android. On Android the IME *is* the product; on iOS the in-app + Action Button flow is the product and the keyboard is a grudging add-on.

---

## 5. MVP definition (what "done enough to ship" means)

**iOS MVP = Phase 1 + Phase 1.5:**
- Open app → record → live on-device transcript → edit/copy/share → history.
- Action Button → dictate → clipboard.
- On-device default; Foundation Models cleanup where available; BYO cloud key opt-in.
- Onboarding that sells the one thing Wispr can't do: **works fully offline, audio never leaves the device.**

That's it. Watch and keyboard are v1.1 and v1.2. They are *not* in the first ship.

---

## 6. Risk register (build-time)

| Risk | Platform | Mitigation |
|---|---|---|
| `SpeechTranscriber` cold-start latency | iOS | Preheat/allocate locale model at launch |
| Foundation Models / Gemini Nano absent on most devices | both | Availability check + silent degrade; never a baseline |
| Background capture killed | both | iOS: `audio` mode tied to active capture; Android: `microphone` foreground service |
| Keyboard Full Access rejection | iOS | Minimize Full Access scope; explicit no-keystroke-logging policy |
| AccessibilityService takedown | Android | Prefer IME; only add a11y with strong justification |
| Cloud audio undisclosed | both | Privacy manifest + accurate labels + opt-in + optional zero-retention mode |
| Wear pairing/signing mismatch | Android | Same package + signing key on `:app` and `:wear` |

---

## 7. The execution rule (because you know your pattern)

Pick **iOS**. Build **Phase 1 only**. Get a working "record → on-device transcript → copy" loop on your own phone within the first sprint — even ugly, even no cleanup. Then Action Button. Ship to TestFlight before you write a single line of the keyboard or the Watch app. The keyboard is the part most likely to eat a month and stall the whole thing; it is explicitly *last*. Don't start there because it's the "cool" part. Cool doesn't ship; the boring in-app loop ships, and it's the only surface with zero platform-fighting.

*"Co wysyłam dziś?"* — Phase 1, iOS, the record loop. Nothing else.

---

*API/device gates current as of June 2026 (iOS/watchOS 26 shipping; Android 13–16). Sources linked inline. Where Apple/Google enforce rules at review (Full Access, AccessibilityService, background-audio, IAP boundaries) I've flagged the realistic risk rather than asserting a guaranteed outcome.*
