# Whisperio Mobile

Native mobile apps for Whisperio. **iOS-first** (Swift / SwiftUI), Android to follow.
See `../docs/whisperio-mobile-implementation-plan.md` for the full plan and
`../docs/whisperio-mobile-research.md` for the feasibility constraints.

> **Authored on Windows, built on a Mac.** The Swift here is written without an Xcode
> compiler in the loop, so the first slice is deliberately **pure, UI-free domain code**
> that compiles and tests with the command-line Swift toolchain. Anything that needs
> iOS-26 frameworks (`AVAudioEngine`, `SpeechAnalyzer`/`SpeechTranscriber`, Foundation
> Models) is intentionally **not** here yet — it gets written on the Mac where the
> compiler can check it.

## Layout

```
mobile/
  WhisperioKit/          Swift package — platform-agnostic domain core (no UI, no AVFoundation)
    Sources/WhisperioKit/
      Models.swift           ProviderID, AudioClip, Transcript, Recording, errors
      Providers.swift        TranscriptionProvider / CleanupProvider protocols
      ProviderChain.swift    ordered try-with-fallback (port of desktop transcribeAudio)
      DictationStateMachine.swift  idle→recording→transcribing→cleaning→output→idle (pure reducer)
      Settings.swift         WhisperioSettings (mirrors desktop AppSettings; no baked secrets)
    Tests/WhisperioKitTests/   swift-testing unit tests for the chain, state machine, settings
  WhisperioApp/          (next) SwiftUI app target — created in Xcode on the Mac
```

## Build & test the core (on the Mac)

```bash
cd mobile/WhisperioKit
swift build
swift test
```

No Xcode project needed for the kit — it's a plain Swift package. (Requires a recent
Swift toolchain; the package targets iOS 17 / macOS 14 / watchOS 10.)

## Why this is the right first slice

The implementation plan's execution rule: **build the engine, not the UI, first.** This
core is independent of both the design (still in progress with the designer) and the
platform UI frameworks, so:

- it can be written and reviewed before the design lands,
- it's the part the desktop already proved (provider chain + fallback + state machine),
- it has zero platform-fighting and is fully unit-testable.

## Next steps (on the Mac, in order)

1. **Create the app target** in Xcode (`WhisperioApp`, SwiftUI, deployment target per the
   plan §2 — see the iOS-17-vs-26 reach decision), add the local `WhisperioKit` package.
2. **App Group** `group.ai.whisperio` entitlement (load-bearing for app ↔ keyboard ↔ watch).
3. **Phase 1 record loop** (skeleton UI is fine): `AVAudioEngine` capture → an
   `OnDeviceProvider: TranscriptionProvider` wrapping `SpeechAnalyzer`/`SpeechTranscriber`
   → `ProviderChain` → show transcript → copy. Preheat the locale model at launch.
4. **Cloud providers**: `OpenAIProvider` / `ElevenLabsProvider` conforming to
   `TranscriptionProvider`, reusing the desktop multipart-upload contract. Keys entered at
   runtime — **never committed** (this is a public repo).
5. **Cleanup**: a `CleanupProvider` backed by Foundation Models behind an availability check.
6. Then Phase 1.5 (Action Button / Shortcuts), Phase 2 (Watch), Phase 3 (keyboard).

UI from the designer gets dropped in over this loop — the domain core does not change.
