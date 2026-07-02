# Feature — Mobile app (iPhone / iPad / Apple Watch, keyboard, widget, intents)

## What it does

A native Swift/SwiftUI dictation app distributed via TestFlight: tap the mic (or use the
Watch, a widget/Control Center button, the Action Button via App Intents, or the custom
keyboard) → speak → the transcript is auto-copied/insertable anywhere. Privacy-first: live
on-device transcription is the default path; cloud providers (OpenAI / ElevenLabs) are BYO-key
opt-ins with automatic fallback — the same provider-chain philosophy as desktop.

## User-facing flow

1. **In-app dictation** — tap record; a live on-device transcript streams while speaking; a
   cleanup pass tidies the text; the recording lands in history.
2. **Apple Watch** — tap to record on the wrist; audio syncs to the phone, which transcribes
   and replies with the text.
3. **Keyboard extension** — mic key bounces to the main app (`whisperio://dictate`), the app
   records, and the keyboard inserts the transcript into the focused field.
4. **Widget / Control Center + Shortcuts** — start/stop dictation from a control or the
   Action Button via App Intents.

## How it works (code path)

### Domain core — WhisperioKit (pure Swift package, no UI)

- `TranscriptionProvider` / `CleanupProvider` protocols
  (`mobile/WhisperioKit/Sources/WhisperioKit/Providers.swift:5`,
  `mobile/WhisperioKit/Sources/WhisperioKit/Providers.swift:15`).
- `ProviderChain` — ordered try-with-fallback, a port of desktop `transcribeAudio`
  (`mobile/WhisperioKit/Sources/WhisperioKit/ProviderChain.swift:9`).
- `DictationStateMachine` — pure reducer `idle → recording → transcribing → cleaning → output`
  (`mobile/WhisperioKit/Sources/WhisperioKit/DictationStateMachine.swift:5`).
- Models (`Recording`, `Transcript`, `AudioClip`, `ProviderID`) in
  `mobile/WhisperioKit/Sources/WhisperioKit/Models.swift:5`; settings model in
  `mobile/WhisperioKit/Sources/WhisperioKit/Settings.swift:5`.
- `SharedStore` — App Group plumbing (`group.ai.whisperio.mobile`,
  `mobile/WhisperioKit/Sources/WhisperioKit/SharedStore.swift:14`) incl. the keyboard bounce
  URL `whisperio://dictate` (`mobile/WhisperioKit/Sources/WhisperioKit/SharedStore.swift:17`).
- Targets iOS 17 / macOS 14 / watchOS 10 (`mobile/WhisperioKit/Package.swift:9`).

### App engine (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/`)

- `AudioRecorder` — `AVAudioRecorder` capture
  (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/AudioRecorder.swift:9`).
- `LiveDictation` — streaming on-device transcription with segment restarts
  (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/LiveDictation.swift:15`, start at
  `mobile/WhisperioApp/Sources/WhisperioApp/Engine/LiveDictation.swift:55`).
- `AppleSpeechProvider` — on-device tier via `SFSpeechRecognizer`
  (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/AppleSpeechProvider.swift:6`). *Note:
  the legacy implementation plan aimed at iOS 26's `SpeechAnalyzer`/`SpeechTranscriber`; the
  shipped code uses `SFSpeechRecognizer` — docs follow the code.*
- Cloud tier: `OpenAIProvider` (multipart upload, default base `https://api.openai.com/v1` —
  `mobile/WhisperioApp/Sources/WhisperioApp/Engine/OpenAIProvider.swift:5`) and
  `ElevenLabsProvider`
  (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/ElevenLabsProvider.swift:5`), same HTTP
  contracts as desktop.
- `TextCleaner` — regex de-umm/punctuation/capitalization pass
  (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/TextCleaner.swift:6`).
- `SettingsStore` — settings + keys as JSON in `UserDefaults`
  (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/SettingsStore.swift:8`).
- `RecordingsStore` — local history
  (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/RecordingsStore.swift:7`).

### Surfaces

- App entry: `@main struct WhisperioApp`
  (`mobile/WhisperioApp/Sources/WhisperioApp/AppShell.swift:142`); SwiftUI screens
  (onboarding, home, recording, detail, settings, models, iPad, watch mock, gallery) live in
  `mobile/WhisperioApp/Sources/WhisperioApp/`.
- **Watch**: records with `AVAudioRecorder`
  (`mobile/WhisperioApp/WhisperioWatch Watch App/WhisperioWatchApp.swift:90`) and ships the
  file via `WCSession.transferFile`
  (`mobile/WhisperioApp/WhisperioWatch Watch App/WhisperioWatchApp.swift:107`); the phone
  receives it, transcribes with the configured chain, saves to history and sends the text
  back (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/PhoneConnectivity.swift:57`,
  transcription at
  `mobile/WhisperioApp/Sources/WhisperioApp/Engine/PhoneConnectivity.swift:27`).
- **Keyboard extension**: inserts the shared transcript with
  `textDocumentProxy.insertText`
  (`mobile/WhisperioApp/Keyboard/KeyboardViewController.swift:75`) and opens the host app for
  recording via `whisperio://dictate`
  (`mobile/WhisperioApp/Keyboard/KeyboardViewController.swift:130`) — extensions legally
  cannot record audio themselves.
- **Widget / Control Center**: `DictateWidget` + `DictateControl`
  (`mobile/WhisperioApp/Widget/WhisperioWidget.swift:52`,
  `mobile/WhisperioApp/Widget/WhisperioWidget.swift:64`).
- **App Intents**: `DictateIntent` / `StopDictationIntent` for Shortcuts, Action Button and
  the control widget (`mobile/WhisperioApp/Sources/WhisperioApp/DictateIntent.swift:38`,
  `mobile/WhisperioApp/Sources/WhisperioApp/DictateIntent.swift:52`).

## Entry points (file:line)

- `mobile/WhisperioApp/Sources/WhisperioApp/AppShell.swift:142` — app `@main`.
- `mobile/WhisperioApp/WhisperioWatch Watch App/WhisperioWatchApp.swift:9` — watch `@main`.
- `mobile/WhisperioApp/Widget/WhisperioWidget.swift:76` — widget bundle `@main`.
- `mobile/WhisperioApp/Keyboard/KeyboardViewController.swift:1` — keyboard extension.
- `mobile/WhisperioKit/Sources/WhisperioKit/ProviderChain.swift:9` — domain chain.

## Data touched

- Recordings + transcripts: local app storage / App Group container
  (`mobile/WhisperioKit/Sources/WhisperioKit/SharedStore.swift:14`).
- Settings + API keys: `UserDefaults` JSON
  (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/SettingsStore.swift:6`).
- Audio leaves the device only to the user-configured cloud provider; no backend, no
  analytics (absorbed from the legacy `testflight-info.md` review notes).

## Edge cases

- **On-device recognizer unavailable / locale unsupported** → the chain falls through to the
  cloud tier (chain semantics in
  `mobile/WhisperioKit/Sources/WhisperioKit/ProviderChain.swift:9`; availability check in
  `mobile/WhisperioApp/Sources/WhisperioApp/Engine/AppleSpeechProvider.swift:25`).
- **Speech permission not granted** → provider fails with a clear error instead of hanging
  (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/AppleSpeechProvider.swift:40`).
- **Watch unreachable** → recordings queue locally and transfer when the phone is nearby
  (`WCSession.transferFile` semantics,
  `mobile/WhisperioApp/WhisperioWatch Watch App/WhisperioWatchApp.swift:107`).
- **Intent runs in a separate process** — state is exchanged via the shared container, not
  in-memory notifications (`mobile/WhisperioApp/Sources/WhisperioApp/DictateIntent.swift:7`).
- **Keyboard `openURL:` quirk** — the extension walks the responder chain with a
  runtime-selected selector because the single-arg `openURL:` was removed from UIKit
  (`mobile/WhisperioApp/Keyboard/KeyboardViewController.swift:143`).

## Related tests

- `mobile/WhisperioKit/Tests/WhisperioKitTests/ProviderChainTests.swift:1`
- `mobile/WhisperioKit/Tests/WhisperioKitTests/DictationStateMachineTests.swift:1`
- `mobile/WhisperioKit/Tests/WhisperioKitTests/SettingsTests.swift:1`
- Watch app test targets exist (`mobile/WhisperioApp/WhisperioWatch Watch AppTests/`,
  `mobile/WhisperioApp/WhisperioWatch Watch AppUITests/`) — run from Xcode.
