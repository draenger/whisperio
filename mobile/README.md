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
  WhisperioApp/          SwiftUI iPhone app — implementation of the Claude Design "Apple Concept"
    Sources/WhisperioApp/
      Theme.swift            design tokens (wz() palette, dark+light) + fonts + Color(hex:)
      Components.swift       PrivacyBadge, EngineChip, SourceBadge, buttons, toggle, segmented, waveforms, icons→SF Symbols
      Shared.swift           ScreenScaffold, WHeader, section labels
      EnginePrivacy.swift    EngineChain (settled Direction B) + Cloud ConsentSheet + FlowLine
      OnboardingView.swift   5-slide privacy-first onboarding
      HomeView.swift         recordings "second brain" + mic dock + RecRow
      RecordingView.swift    live on-device transcript + waveform + "tidying up"
      DetailView.swift       transcript detail (raw/cleaned, scrubber, copy/share/insert)
      SettingsView.swift     engine chain + triggers + appearance + consent
      ModelsView.swift       on-device model management
      AppShell.swift         screen routing + toast + @main App + #Previews
      SampleData.swift       UI demo data (real data comes from WhisperioKit later)
```

## The iPhone app (implemented)

`WhisperioApp` is a faithful SwiftUI translation of the Claude Design **"Whisperio Apple
Concept"** handoff — the core iPhone surfaces: onboarding, recordings home, live recording,
transcript detail, settings (engine chain + Cloud consent), on-device models. Dark + light.

> **Authored on Windows — not yet compiled.** Verify on the Mac (`#Preview` in `AppShell.swift`
> renders each screen). If anything doesn't build, send me the errors. Known wiring to finish
> on the Mac (can't be done blind here):
> - **Add to an Xcode app target** (iOS 17+/26): create an iOS App, drop these sources in, add
>   the `WhisperioKit` package as a dependency.
> - **Fonts:** add Space Grotesk / IBM Plex Sans / JetBrains Mono to the target + `UIAppFonts`
>   (falls back to system until then).
> - **Ghost asset:** add `WhisperioGhost` (template PNG/SVG from `icons/`) to the asset catalog
>   (`WGhost` falls back to a tinted placeholder until then).
> - Icons use **SF Symbols** mapped from the design's Lucide set (native idiom).

### Deliberately deferred (concept-canvas scenes, later phases — not the first ship)
Keyboard bounce, Action Button / Lock Screen / Back-Tap trigger scenes, Dynamic Island /
Live Activity, iPad split view, Apple Watch, the 3 engine-selector directions, edge states,
and the component/style kit are in the design but **not implemented yet** — they map to
Phases 1.5–3 in `../docs/whisperio-mobile-implementation-plan.md`.

### Wire it to real logic
The screens currently use `SampleData`. Replace with `WhisperioKit` (`ProviderChain`,
`DictationStateMachine`, `WhisperioSettings`, `Recording`) once the `AVAudioEngine` /
`SpeechTranscriber` providers are written on the Mac. The UI was built so the domain core
drops in underneath without changing the views.

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
