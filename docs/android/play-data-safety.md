# Google Play - Data safety form (Whisperio for Android, `ai.whisperio.mobile`)

> Verified against the code on branch `android/skeleton`, 2026-10-17. Evidence is `file:line`, relative to the repo root.
> Binding source: `docs/android/CONTRACT.md` section 8.1. The owner enters these answers in Play Console
> (Policy > App content > Data safety) - code cannot do that, and `release-readiness` only checks that this file exists
> and mentions every detected data category. Policy text (`docs/privacy.html`), in-app wording and this form must say
> the same thing, because Play compares them.
> **Re-read the exact Console question set at submission time** (Google changes the form) and amend this file if it differs.

## 0. Definitions (Play Console Help, "Provide information for Google Play's Data safety section", answer 10787469, fetched 2026-10-17)

- Collection: *"'Collect' means transmitting data from your app off a user's device."*
- Exemptions from collection: *"User data accessed by your app that is only processed locally on the user's device"*; data *"unreadable by you or anyone other than the sender and recipient"* (end-to-end encryption); and the narrow case where the user uploads *"directly to their own external drive or cloud storage account"* and the app never accesses the data.
- Ephemeral: *"Processing data 'ephemerally' means accessing and using it while the data is only stored in memory"* and retained no longer than needed to service the request in real time.
- Sharing: *"'Sharing' refers to transferring user data collected from your app to a third party."* Not sharing: *"Transferring user data to a third party based on a specific user-initiated action"*.

Consequence: the voice recording leaves the device (to the user's chosen provider), so by Play's definition it IS collected.
Apple's definition differs (collected only if the developer or partners can access it beyond servicing the request in
real time), which is why iOS can say "Data Not Collected" and Play cannot. **Never answer "No data collected" on Play and
never write it in the listing.**

## 1. Overview answers (Console section "Data collection and security")

| Console question | Answer | Evidence |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** | section 2 |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | all providers with an official endpoint use `HttpClients.secureClient` = TLS only, no CLEARTEXT spec (`android/core/src/main/kotlin/ai/whisperio/core/HttpClients.kt:19-31`); default bases are `https://` (`ProviderCatalog.kt:21,27,32,37,42,47`). The only plain-http path is a user-typed self-hosted or custom-OpenAI URL on a private network, via `localClient` (`HttpClients.kt:37-59`, `ProviderChain.kt:71`, `SelfHostedProvider.kt:15`), gated by `BaseUrlPolicy` - disclose in the privacy policy. |
| Do you provide a way for users to request that their data is deleted? | **Yes** (nothing is held by us; in-app erase + uninstall; provider-side deletion is the provider's - section 4) | `android/app/src/main/kotlin/ai/whisperio/android/di/AppGraph.kt:91-102`; `ui/settings/SettingsScreen.kt:192-195,236-247` |
| Account creation methods / Delete account URL | **Not applicable** - no account, no sign-in, no server | no auth code anywhere under `android/`; `PrivacyGateTest.kt:15-18` bans analytics/ads/billing SDKs |
| Independent security review / Families / Play Billing | No | - |

## 2. Data types

| Data type (Console) | Collected | Shared | Processed ephemerally | Required or optional | Purposes |
|---|---|---|---|---|---|
| Audio files > **Voice or sound recordings** | **Yes** | **No** | **No** | Required (core function: no recording, no transcript) | **App functionality** |
| App activity > **Other user-generated content** (custom vocabulary) | **Yes** | **No** | **No** | **Optional** (empty by default) | **App functionality** |

Why each answer:

- **Collected = Yes.** The recording is uploaded off-device to the provider the user configured:
  - request builders: `android/core/src/main/kotlin/ai/whisperio/core/ProviderHttp.kt:132` (OpenAI-compatible multipart incl. `prompt`), `ElevenLabsProvider.kt:25-35` (`keyterms`), plus `DeepgramProvider.kt`, `AssemblyAiProvider.kt`, `MistralProvider.kt`, `GroqProvider.kt`, `SelfHostedProvider.kt`.
  - nothing is uploaded before the user ticks the consent box in onboarding (`android/app/src/main/kotlin/ai/whisperio/android/ui/onboarding/OnboardingScreen.kt:80`: Next stays disabled until `consent`), and it is enforced again in code: `dictation/DictationController.kt:194` (`!s.cloudConsentGranted -> CONSENT_MISSING`) and `android/core/src/main/kotlin/ai/whisperio/core/ProviderChain.kt:50-59` (`ConsentRequired`); default is `false` (`settings/AppSettings.kt:16`).
- **Shared = No.** The only recipient is the provider chosen by the user, with the user's own API key, on the user's own tap (a "specific user-initiated action", section 0). Whisperio operates no server and ships no third-party SDK that receives data:
  - network destinations are exactly the endpoints in `ProviderCatalog.kt:18-53` plus the user's own URL. No analytics, crash reporter, Firebase, Play Services, ads or billing library: `android/app/build.gradle.kts:122-162` (the complete dependency list) and the enforcing JVM test `android/app/src/test/kotlin/ai/whisperio/android/PrivacyGateTest.kt:15-28` (bans firebase, crashlytics, play-services, gms.ads, admob, sentry, bugsnag, mixpanel, amplitude, appsflyer, posthog, datadog, billingclient ...).
  - Judgement call to confirm at submission: some reviewers treat the provider as an independent third party and the transfer as "sharing". Because the user picks the provider, supplies the key and triggers every upload, the "user-initiated action" exemption applies and the contract decision (2026-10-17) is **No**. If Play pushes back, change this file, the Console and the privacy policy together.
- **Ephemeral = No.** "Only stored in memory" cannot be guaranteed for the recipient: providers may retain API audio (e.g. OpenAI up to 30 days for abuse monitoring), and on the device the audio file and transcript are stored by default (`settings/AppSettings.kt:22` `keepAudio = true`; Room table `recording` with `audio_path`, `transcript`: `history/Recording.kt:18-32`; file in `filesDir/recordings` (`di/AppGraph.kt:42`)).
- **Required = Yes (audio) / No (vocabulary).** Vocabulary defaults to empty (`AppSettings.kt:18`) and is forwarded only when non-blank and only to OpenAI, Groq and ElevenLabs (`ProviderHttp.kt:132`, `ElevenLabsProvider.kt:25-35`; `usesVocabulary=false` for Mistral, Deepgram, AssemblyAI, self-hosted: `ProviderCatalog.kt:32,42,47,52`).
- **Purpose = App functionality only.** No advertising, analytics, personalisation, fraud prevention or account management exists in the code.

## 3. Everything else: not collected

| Category | Answer | Evidence |
|---|---|---|
| Location, contacts, calendar, photos/videos, files, health/fitness, financial info, personal info (name, email ...), web browsing, SMS/calls | Not collected | the manifest declares only `RECORD_AUDIO` (`android/app/src/main/AndroidManifest.xml:6`) and `INTERNET` (`:8`), asserted by `PrivacyGateTest.kt:31-38`. No `FOREGROUND_SERVICE_*`, no `POST_NOTIFICATIONS`, no storage permission. |
| Device or other IDs, advertising ID | Not collected | no SDK (`app/build.gradle.kts:122-162`); no `AD_ID` permission in the manifest |
| App info and performance (crash logs, diagnostics) | Not collected | no crash reporter (`PrivacyGateTest.kt:15-18`); provider errors are redacted before display (`core/.../ProviderError.kt`, CONTRACT 4.2) |
| App activity > App interactions, in-app search history | Not collected | no analytics anywhere |
| API keys | Not transmitted to us | stored on device only: AES-256-GCM key in the Android Keystore (`android/app/src/main/kotlin/ai/whisperio/android/security/KeystoreSecretStore.kt:45-77`, `AES/GCM/NoPadding` at `:84`), ciphertext in a private DataStore (`di/AppGraph.kt:33`). The key goes only to the provider it belongs to, as that provider's auth header; this is the provider authenticating its own customer, not data collected by us. |
| Typed text | Not collected, not stored | `ime/WhisperioImeService.kt:222` reads only `getTextBeforeCursor(1, 0)` (leading-space rule); `ime/ImeCommitPolicy.kt:29-45` turns the mic off in password fields and skips history when `IME_FLAG_NO_PERSONALIZED_LEARNING` is set |
| Backups | Nothing leaves the device via Auto Backup or device transfer | `AndroidManifest.xml:14` `allowBackup="false"`, `:15` `dataExtractionRules`, `:16` `fullBackupContent="false"`; `res/xml/data_extraction_rules.xml` excludes every domain for both `cloud-backup` and `device-transfer` (asserted by `PrivacyGateTest.kt:40-47`) |

## 4. Data deletion question

Whisperio holds **nothing server-side**: no account, no server, no analytics store. Therefore:

- Local data (history, audio, API keys, settings) is deleted by **Settings > Erase all data** (`AppGraph.kt:91-102`: cancels dictation, clears history, secrets and settings; UI `SettingsScreen.kt:192-195,236-247`), by per-item delete, "Delete all audio" and auto-delete in Settings, or by uninstalling the app.
- Data held by the user's transcription provider (audio, transcript, retention) is governed by that provider's terms and the user's account with them; the user deletes it there. The privacy policy says so (`docs/privacy.html` sections 8.4 and 9; the Android section 8 is in place).
- Play's account-deletion URL requirement does **not** apply (no account can be created). In the Console choose the path "my app does not allow users to create an account".

## 5. Console entry checklist (owner)

1. Data collection: "Yes, collects or shares". Tick **Audio files > Voice or sound recordings** and **App activity > Other user-generated content**.
2. For each: Collected = yes; Shared = no; ephemeral = no; Required (audio) / Optional (vocabulary); purpose = App functionality.
3. Encrypted in transit = yes.
4. Deletion: no account; local erase + uninstall as in section 4.
5. Privacy policy URL: `https://whisperio.danielkasprzyk.com/privacy.html`.
6. Check the preview Play generates: it must NOT read "No data collected".

## 6. Open items (cannot be settled from code)

- `docs/privacy.html` now has the Android section (section 8, plus the Play/App Store comparison in section 9; 8.1 states the fallback behaviour: off by default, next configured provider only). Play compares policy and form: **deploy the updated privacy.html to the public URL before submitting the form** and re-check the two still match.
- Whether Play classifies the provider transfer as "sharing" is a policy judgement (section 2). Recorded decision: No.
- The exact Console wording at submission time (note at the top).
