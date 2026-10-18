# Whisperio - Google Play listing (English)

Fields to paste into Play Console (Grow > Store presence > Main store listing, default language English).
Play limits: title <=30, short description <=80, full description <=4000 characters, release notes <=500.
Counts below are measured with `node` (code points); the `release-readiness` check `play-listing` re-measures them:
`node ~/.claude/skills/release-readiness/tools/check.mjs . --platform android`
Polish counterpart: `android/marketing/play/listing.pl.md` (keep both in parity).

Rules for this text (CONTRACT 8.1): it must NOT say "no data collected" - on Play the voice recording IS collected data
(it leaves the device for the provider the user picked). It may say: no account, no Whisperio server, no analytics, no ads.
It describes only what ships in 1.0.0 (see the evidence table below).

## App name (<=30)

```
Whisperio: Voice Dictation
```
Characters: 26/30

## Short description (<=80)

```
Dictate into any app with your own API key. No account, no ads, no analytics.
```
Characters: 77/80

## Full description (<=4000)

```
Whisperio turns your voice into text in any app. Tap the mic, speak, and the transcript lands in the field you are typing in. You bring your own API key from a speech-to-text provider you trust, so you pay the provider directly and Whisperio stays free.

HOW IT WORKS
Switch to the Whisperio dictation keyboard, tap the mic, speak, tap again. The text is inserted for you. Prefer not to switch keyboards? Add the Quick Settings tile or the launcher shortcut: record from anywhere, and the result is copied to the clipboard and saved to your history.

YOUR KEY, YOUR PROVIDER
Choose the service that suits you and paste your own API key:
- OpenAI (Whisper and GPT-4o transcription models)
- Groq
- Mistral (Voxtral)
- ElevenLabs (Scribe)
- Deepgram
- AssemblyAI
- Your own server that speaks the OpenAI transcription API (for example faster-whisper or whisper.cpp)
Set an order of providers and optionally fall back to the next one if the first fails. Your key is checked before it is saved and is stored encrypted on your device with the Android Keystore.

WHAT YOU GET
- Dictation keyboard with a big mic button, level meter, backspace, space and enter
- Quick Settings tile and a "Dictate" launcher shortcut
- Auto-detect or pick your language: English, Polish, German, Spanish, French, Italian, Portuguese, Dutch, Russian, Ukrainian
- Custom vocabulary for names and technical terms (sent to providers that support it)
- Optional text tidy-up: fixes spacing and repeated words without rewriting what you said
- Local history of your dictations: copy, share, retry a transcription, delete
- Optional auto-stop on silence and automatic history clean-up after 1, 7 or 30 days
- Dark and light theme, English and Polish interface

PRIVACY, PLAINLY
- Free. No purchases, no subscriptions, no ads.
- No account and no sign-in. There is no Whisperio server and no analytics or tracking.
- When you dictate, your recording (and your custom vocabulary, if you set one) is sent straight from your phone to the provider you chose, using your own key. Whisperio asks for your consent before the first upload, and that provider's terms and privacy policy apply to what it receives.
- History, recordings and keys stay on your device. They are excluded from Android backups and device transfer. One tap on "Erase all data" in Settings removes them.
- The keyboard does not store or send what you type. Dictation is switched off in password fields.
- Microphone access is used only while you are recording, on a screen you can see.

REQUIREMENTS
Android 8.0 or newer, internet access, and an API key from one of the providers above (most offer a free or pay-as-you-go tier). Whisperio does not include a transcription service of its own.

Privacy policy: https://whisperio.danielkasprzyk.com/privacy.html
Terms of use: https://whisperio.danielkasprzyk.com/terms.html
Support: https://whisperio.danielkasprzyk.com/support.html
```
Characters: 2913/4000

## Release notes 1.0.0 (<=500)

```
First release of Whisperio for Android.
- Dictation keyboard, Quick Settings tile and launcher shortcut
- Bring your own API key: OpenAI, Groq, Mistral, ElevenLabs, Deepgram, AssemblyAI or your own server
- Local history with copy, share and retry
- Free, no account, no ads, no analytics
```
Characters: 288/500

## Category and contact

- Category: Productivity (alternative: Tools). App type: App. Free.
- Contact e-mail: daniel@danielkasprzyk.com (as published on `docs/support.html`). Website: https://whisperio.danielkasprzyk.com/
- Privacy policy field: https://whisperio.danielkasprzyk.com/privacy.html

## Evidence (claim -> code), all under `android/` unless noted

| Claim | Evidence |
|---|---|
| Dictation keyboard, mic, backspace/space/enter | `app/src/main/AndroidManifest.xml:48-59` (`WhisperioImeService`), `ime/ImePanel.kt`, strings `ime_backspace/space/enter` |
| Quick Settings tile | `AndroidManifest.xml:61-70` (`WhisperioTileService`), `ui/nav/AppRoot.kt:178-186` (`requestAddTileService`) |
| Launcher shortcut "Dictate" | `res/xml/shortcuts.xml`, `AndroidManifest.xml:33-36` |
| Result copied to clipboard + history from tile/shortcut | string `dictate_copied`, `dictate/DictateActivity.kt` |
| Providers OpenAI/Groq/Mistral/ElevenLabs/Deepgram/AssemblyAI/self-hosted + models | `core/src/main/kotlin/ai/whisperio/core/ProviderCatalog.kt:18-53` |
| Order + optional fallback | strings `settings_providers_hint`, `settings_fallback` |
| Key validated before save, encrypted with Keystore | `settings/KeyEnrollment.kt`, `security/KeystoreSecretStore.kt:47-66` |
| Languages | `ui/common/Languages.kt` |
| Custom vocabulary | `core/.../ProviderHttp.kt:132`, `ElevenLabsProvider.kt:25-35`; string `settings_vocabulary` |
| Text tidy-up | `core/.../TextCleaner.kt`; string `settings_cleanup_hint` |
| Local history: copy, share, retry, delete | `history/HistoryStore.kt`, strings `action_copy/share/retry/delete` |
| Auto-stop on silence, auto-delete 1/7/30 days | strings `settings_autostop_value`, `settings_auto_delete`; `di/AppGraph.kt:81-87` |
| Consent before first upload | `ui/onboarding/OnboardingScreen.kt:80`, `dictation/DictationController.kt:172` |
| No account/server/analytics/ads | `app/build.gradle.kts:122-162`, `app/src/test/kotlin/ai/whisperio/android/PrivacyGateTest.kt:15-29` |
| Excluded from backups/transfer | `AndroidManifest.xml:14-16`, `res/xml/data_extraction_rules.xml` |
| Erase all data | `di/AppGraph.kt:90-96` |
| Keyboard: password fields off, no typed-text storage | `ime/ImeCommitPolicy.kt:19-37`, `ime/WhisperioImeService.kt:192` |
| Android 8.0+ | `app/build.gradle.kts` `minSdk = 26` |
| Dark/light, EN/PL UI | `res/values-night`, `res/values-pl/strings.xml` |

## Do NOT write in the listing

- "No data collected" / "we collect nothing" (false on Play - see CONTRACT 8.1).
- "Works offline" or "on-device transcription" (v1 is cloud, bring-your-own-key only).
- Wear OS, sync between devices, AI rewrite / summaries / conversation mode (not in 1.0.0).
- A full QWERTY keyboard (the keyboard is a dictation panel).
- "100% private" or "your audio never leaves your phone".
- Emoji or ALL-CAPS shouting in title/short/full description (Play metadata policy). Section labels in capitals are plain headings only; remove them if Play flags the text.
