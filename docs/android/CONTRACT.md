# Whisperio for Android — v1.0.0 contract

Status: REVIEWED (2026-10-17) — Opus review APPROVE-WITH-FIXES, all BLOCKER/SHOULD-FIX/NIT items applied below. Decisions by queenbee 2026-10-17: versionCode 10000, applicationId `ai.whisperio.mobile`, Data safety per §8.1 (Ephemeral = No).
Source of truth for behaviour: iOS `mobile/WhisperioApp` + `mobile/WhisperioKit`, desktop `desktop/`.
Build patterns: Zryw Android (`D:/Master/Repo/zryw/src/android`, read-only reference).

Whisperio is **free**. No payments, IAP, Play Billing, ads or subscriptions — ever. Play listing = Free app, no merchant account.

---

## 1. Identity

| Item | Value | Why |
|---|---|---|
| applicationId | `ai.whisperio.mobile` | Same as iOS bundle id (`PRODUCT_BUNDLE_IDENTIFIER = ai.whisperio.mobile`). Permanent once uploaded to Play. |
| Kotlin namespace / package root | `ai.whisperio.android` | Matches the reverse-domain of the bundle id; the brief's `dev.whisperio` would not match iOS. |
| minSdk / targetSdk / compileSdk | 26 / 36 / 36 | minSdk from brief; Play requires target 36 for new apps since 2026-08-31 (same as Zryw `release.json`). |
| versionName / versionCode | `1.0.0` / `10000` | Zryw/portfolio scheme `major*10000 + minor*100 + patch`, held in tracked `android/app/version.properties` (decided 2026-10-17). |
| App name | Whisperio | |
| Repo location | `android/` at repo root, sibling of `desktop/` and `mobile/` | |

## 2. Scope

### In v1
1. **Dictation keyboard (IME)** — record → transcribe → commit text into the focused field.
2. **Main app** — onboarding, provider keys, local history, settings (language, provider/model, vocabulary, cleanup, retention).
3. **Quick Settings tile** + **launcher shortcut** "Dictate" — record from anywhere, result copied to clipboard and saved to history.
4. **Cloud transcription, bring-your-own-key** — providers in §4.
5. UI languages: English (default) + Polish.

### Out of v1 (explicitly)
- Wear OS, any cloud sync (iCloud has no Android equivalent; no own server), GitHub digest sync.
- On-device transcription (Android `SpeechRecognizer` / whisper.cpp) — candidate for 1.1. Android's platform recognizer may send audio to Google depending on device, which would break the "audio only to your chosen provider" promise; needs its own decision.
- LLM post-processing: rewrite presets, digest/journal, auto-categorize, conversation mode / diarization — 1.1+. v1 is text-in, text-out: transcript + optional deterministic cleanup.
- Full QWERTY keyboard. The v1 IME is a dictation panel (see §5), like a voice-input keyboard.
- Replicate and on-device engines from iOS. Replicate needs file upload + polling; low usage; 1.1.
- Foreground service / background recording (recording is always tied to a visible surface; see §6).

## 3. Architecture

```
android/
  settings.gradle.kts, build.gradle.kts, gradle.properties, gradle/libs.versions.toml, gradlew
  core/        pure Kotlin/JVM: providers, ProviderChain, BaseUrlPolicy, TextCleaner,
               ProviderError, KeyValidator, models. No Android deps → fast JUnit tests.
  app/         Android: Compose UI, IME service, recorder, tile, Room history, key store.
```

- Versions copied from Zryw's working catalog: Gradle 8.13, AGP 8.11.1, Kotlin 2.2.21 + KSP 2.2.21-2.0.5, Compose BOM, Room 2.8.5, OkHttp 4.12, kotlinx-serialization 1.7.3, coroutines 1.9.0, Roborazzi 1.76.0, Robolectric 4.17, MockK. JDK 21 for Robolectric.
- **No Hilt** — manual DI via an `AppGraph` object on `Application`. Two modules don't justify the KSP/Hilt build cost.
- HTTP: OkHttp + `MockWebServer` in tests. Timeouts: connect 15 s, read/write 120 s, call 600 s (iOS: request 120 s, resource 600 s).
- Release: R8 minify + shrinkResources, `allowBackup="false"` **and** `data_extraction_rules.xml` with both `<cloud-backup>` and `<device-transfer>` excluding all domains (on target 31+ `allowBackup=false` alone does not block device-to-device transfer). Cleartext: see §4.3.
- Target 35/36 behaviour: edge-to-edge enforced, predictive back on, orientation/resizability locks ignored on ≥600 dp. All screens incl. `DictateActivity` are inset-safe and resizable; Roborazzi includes a tablet size.
- Gradle memory: follow `~/.gradle/gradle.properties` caps (Xmx3g, kotlin daemon 1g, workers 4). Any gradle run = heavy task → `heavy-queue.txt` line, never parallel with other heavy jobs.

## 4. Transcription (parity with iOS `Engine/*Provider.swift`)

### 4.1 Providers in v1

| id | Request | Auth | Default model | Vocabulary sent as |
|---|---|---|---|---|
| `openai` | `POST {base}/audio/transcriptions` multipart (`model`, `language`?, `prompt`?, `file`). Default base `https://api.openai.com/v1`, overridable (BaseUrlPolicy). | `Authorization: Bearer` | `whisper-1` (chips `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`) | `prompt` |
| `groq` | `POST https://api.groq.com/openai/v1/audio/transcriptions`, same fields | Bearer | `whisper-large-v3-turbo` (chip `whisper-large-v3`; iOS's `distil-whisper-large-v3-en` dropped — retired by Groq, verify against `/v1/models` during implementation) | `prompt` |
| `mistral` | `POST https://api.mistral.ai/v1/audio/transcriptions` (`model`, `language`?, `file`) | Bearer | `voxtral-small-latest` (`voxtral-mini-latest`) | — |
| `elevenlabs` | `POST https://api.elevenlabs.io/v1/speech-to-text` (`model_id`, `language_code`?, `keyterms`? JSON array, `file`) | `xi-api-key` | `scribe_v1`; `scribe_v2` when keyterms present | `keyterms` (each ≤50 chars, ≤5 words, no `<>{}[]\`) |
| `deepgram` | `POST https://api.deepgram.com/v1/listen?model=…&smart_format=true[&language=…]`, raw body | `Authorization: Token` | `nova-3` (`nova-2`, `whisper-cloud`→`whisper-large`) | — |
| `assemblyai` | `POST /v2/upload` raw → `POST /v2/transcript` JSON `{audio_url, speech_model, language_code \| language_detection:true}` → poll `GET /v2/transcript/{id}` every 2 s, max 150 polls | raw `authorization` | `universal` (`best`) | — |
| `selfhosted` | `POST {url}/audio/transcriptions` (`/v1` appended if missing), OpenAI fields minus `prompt` | optional Bearer | `whisper-1` | — |

Responses parsed exactly as iOS: `{text}`; Deepgram `results.channels[0].alternatives[0].transcript`; AssemblyAI `text` when `status == completed`, error on `status == error`.

### 4.2 Errors, fallback, validation
- Non-2xx → `ProviderError.Http(provider, status, detail)`: **verbatim port** of `K/ProviderError.swift:110-144` — 8 KB prefix, strip script/style/tags, JSON `error.message | error | message | detail` else first non-empty line, redact `bearer|token|basic` values, `api-key|xi-api-key|authorization` values, `sk-|gsk_|xi-|r8_|aai` prefixed tokens and any 32+ char token; output `"HTTP <status>: <detail>"`, 200 chars total incl. ellipsis. Tests = `ProviderErrorTests.swift` vectors.
- `ProviderChain`: ordered list of configured providers; fallback off by default (`fallbackEnabled=false` → slot 0 only); on all-fail return first error; if none configured, try first so the user sees a real error.
- **Consent gate in `ChainFactory`** (iOS `SettingsStore.swift:104-119`): cloud providers are dropped when `!cloudConsentGranted`, including the single-provider retry path. Unit-tested.
- Key validation (port of `K/ProviderKeyValidator.swift`): GET with 15 s timeout — 2xx valid, 401/403 invalid key, else unexpected(code), transport error = network. Same endpoints as iOS (`/v1/models`, `/v1/user`, `/v1/projects`, `/v2/transcript?limit=1`, …). A key is saved only after it validates.
- Language: ISO code, field omitted for `auto`; AssemblyAI uses `language_detection:true` for auto.
- No per-request retries (iOS has none). User can retry from history (audio is kept, §7).

### 4.3 BaseUrlPolicy (port of `K/BaseURLPolicy.swift`)
Verbatim port of `validate(raw, assumeHTTPForBareHost)` + `isLocalHost` + `isOfficialHost` (`K/BaseURLPolicy.swift:32-89`): https always; http only for localhost, `0.0.0.0`, 127/8, 10/8, 172.16/12, 192.168/16, 100.64/10, `*.local`, `*.lan`, `*.internal`, `*.home.arpa`, dotless hosts, `::1`/`[::1]`, `fc/fd/fe80`; bare host read as `http://` for the self-hosted field. Tests = `BaseURLPolicyTests.swift` vectors.

Transport — **two OkHttp clients**, so plain http can never reach a public host (not even via redirect):
- `secureClient` (all official providers): `connectionSpecs(listOf(MODERN_TLS, COMPATIBLE_TLS))`, no `CLEARTEXT` → http impossible.
- `localClient`, built only for a URL that passed `BaseUrlPolicy`: `followRedirects(false)`, `followSslRedirects(false)`, plus a **network** interceptor re-running `BaseUrlPolicy` on every hop.
- Network-security-config sets `cleartextTrafficPermitted=true` in base-config only because NSC cannot express CIDR ranges; the two-client rule is the real guard. Recorded in `release.json` as an accepted cleartext exception with this rationale.
- Custom host warning (iOS parity, `MacSettingsTabs2.swift:540-542`): when the OpenAI base URL is not an official host, settings show "Custom host — your key and audio go to this server, not to OpenAI."

### 4.4 Size limits (Android adds what iOS lacks)
Recording at AAC-LC 16 kHz mono 32 kbps ≈ 14 MB/hour. Before upload the client checks the file against the provider limit (OpenAI/Groq/Mistral 25 MB, others 100 MB+) and fails with a clear message instead of an opaque HTTP 413. Hard recording cap: 60 min, with a visible warning at 55 min.
The 100 MiB on-device cap for ElevenLabs/Deepgram/AssemblyAI (`ProviderCatalog.kt`) is a deliberate safety cap below those providers' own limits (phone memory and upload time); at 32 kbps it is about 7 hours of audio, far above the 60-minute recording cap.

## 5. Keyboard (IME)

- `WhisperioImeService : InputMethodService`, Compose UI in the input view.
- **Records directly inside the IME** (Android allows it; the iOS bounce-to-app flow is an iOS sandbox constraint, not a feature). The IME runs in the app process, so the app's `RECORD_AUDIO` grant covers it.
- Panel: big mic button (tap to start, tap to stop; state: idle / recording with level meter + timer / transcribing / error), backspace, space, enter (respects `EditorInfo.imeOptions` action), "switch keyboard" (`switchToPreviousInputMethod`, fallback `InputMethodManager.showInputMethodPicker`), provider chip (which provider audio goes to).
- Result: `currentInputConnection.commitText(transcript, 1)`, with a leading space if the char before the cursor is not whitespace. Entry saved to history with `source = keyboard`.
- No permission / no key → panel shows a single "Open Whisperio to finish setup" button (the IME cannot show the runtime permission dialog).
- Declares a `voice` subtype (`android:imeSubtypeMode="voice"`) — **best-effort** (AOSP `getShortcutInputMethodsAndSubtypes`; Gboard does not hand off to third-party voice IMEs), not an acceptance criterion. After a commit in voice mode → `switchToPreviousInputMethod()` (API 28+; `InputMethodManager.switchToLastInputMethod` on 26–27).
- Privacy: never stores or transmits typed text. On device it reads only the field type (password detection), the single character before the cursor (leading-space rule) and the selection bounds from `onUpdateSelection` (backspace), never the selected text.
  - Password fields (`TYPE_TEXT_VARIATION_PASSWORD` / `VISIBLE_PASSWORD` / `WEB_PASSWORD` / `NUMBER_PASSWORD`) → **mic disabled**, panel shows "Dictation is off in password fields". A spoken password must never reach a third party.
  - `IME_FLAG_NO_PERSONALIZED_LEARNING` → dictation allowed, transcript committed but **not** saved to history.
- Focus lost / IME hidden while recording → stop and discard (no background recording).
- Transcription in flight when the field changes: the upload runs in an app-scoped coroutine (not the IME/Activity scope). `fieldId` is only the host View id and is shared by all fields of a Compose screen / WebView, so it is not trusted alone. The IME keeps a monotonic input-session counter (incremented in `onStartInput` when `restarting=false` and in `onFinishInput`) and captures it with the `EditorInfo` key (`fieldId` + `packageName`) when recording starts. It commits only if the counter is unchanged, the current field is not a password field (re-checked at commit) and the input view is still shown; otherwise the result is saved to history marked "not inserted" and is never committed.
- Accessibility: mic button has per-state content descriptions; recording / transcribing / error announced via a live region; touch targets ≥48 dp; TalkBack pass in manual smoke; Roborazzi also at font scale 2.0.

## 6. Recording, tile, shortcut

- `MediaRecorder`: `AudioSource.VOICE_RECOGNITION`, MPEG-4/AAC, 16 kHz, mono, 32 kbps, file in `filesDir/recordings/<uuid>.m4a`. Deliberate deviation from iOS (AAC 44.1 kHz, `AudioRecorder.swift:51`): speech models resample to 16 kHz anyway and the file stays well under the 25 MB limits. Level meter from `getMaxAmplitude()` every 50 ms, mapped to dBFS `20·log10(amp/32767)` so the iOS thresholds apply (`AudioRecorder.swift:86`).
- **Silent-mic guard:** Android delivers zeros instead of an error when the mic is blocked (privacy toggle, lost capability, ongoing call). If amplitude is 0 for the first 3 s or the whole clip → do not upload, show "Microphone is blocked or muted". Manual smoke on API 34, 35, 36.
- Optional auto-stop on silence (`autoStopSeconds`, default 0 = off, 0–120 in 5 s steps; activity threshold as iOS).
- Audio focus: request transient-exclusive; on loss → stop (iOS default `stop`).
- **Process death / rotation:** a `Recording` row is written when recording starts; on app start any row left in `recording` or `transcribing` becomes `failed("Interrupted")` and is retryable when audio exists. Configuration changes never restart an upload (state lives outside the Activity).
- **Quick Settings tile** (`TileService`): tap → `unlockAndRun {}` if locked, then opens translucent `DictateActivity` (`startActivityAndCollapse(PendingIntent)` on 34+, `Intent` overload below), which records, transcribes, copies the transcript to the clipboard as plain text (no own toast on 33+, the system shows one; `EXTRA_IS_SENSITIVE` set only when the "Treat transcripts as sensitive" setting is on, default off), saves to history with `source = tile`.
- **Launcher shortcut** (static `shortcuts.xml`): "Dictate" → same `DictateActivity`, `source = shortcut`.
- No foreground service in v1 → no `FOREGROUND_SERVICE_MICROPHONE` declaration. Leaving the activity stops the recording.

## 7. Main app

### 7.1 Onboarding (compressed from iOS's 9 steps)
1. Welcome. 2. Privacy: "Audio goes only to the provider you pick, with your key. No Whisperio server, no account, no analytics." + explicit consent to send audio to the chosen provider (stored as `cloudConsentGranted`; nothing is ever uploaded before it). 3. Pick provider + paste key (validated). 4. Languages (chips pl, en, de, es, fr, it, pt, uk + auto — same chips as iOS onboarding; nl and ru stay available in Settings, as on iOS). 5. Microphone permission. 6. Enable the keyboard (deep link to `Settings.ACTION_INPUT_METHOD_SETTINGS`) + add QS tile (`StatusBarManager.requestAddTileService` on 33+), skippable. 7. First dictation / done.

### 7.2 Keys
- Stored encrypted: AES-256-GCM key in **Android Keystore** (non-exportable, `setUserAuthenticationRequired(false)`), ciphertext in a private `DataStore` file. (`EncryptedSharedPreferences` is deprecated in security-crypto 1.1.0; a small own wrapper is easier to test.) Equivalent of iOS `WhenUnlockedThisDeviceOnly`: not backed up (`allowBackup=false` + data-extraction rules exclude all), not transferable to another device.
- Keystore failure on read (key invalidated) → wipe the ciphertext, mark the provider as "key missing", ask the user to paste again. Never crash, never log the key.
- Keys never appear in logs, crash output, history, or error messages (redaction unit-tested).

### 7.3 History (Room, local only)
`Recording(id, createdAt, durationMs, status[recording|transcribing|done|failed], provider, model, language, transcript?, error?, audioPath?, source[app|keyboard|tile|shortcut])`.
List + detail (copy, share, retry transcription, delete). Settings: keep audio (default on), auto-delete after 1/7/30 days (default off), delete all audio, **erase all data** (history + audio + keys + settings).

### 7.4 Settings
Provider order + model per provider, fallback toggle, keys (add/replace/remove, re-validate), custom-provider base URL (OpenAI, with the custom-host warning from §4.3) / self-hosted URL, language (Auto, English, Polski, Deutsch, Español, Français, Italiano, Português, Nederlands, Русский, Українська), vocabulary (comma-separated), deterministic cleanup toggle (port of `TextCleaner.tidy`), auto-stop, storage/retention, About (version, privacy policy, terms, support, licences).

## 8. Privacy & Play declarations

- **Network destinations, complete list:** the transcription/validation endpoints in §4 for the providers the user configured, plus the user's own base URL. No Whisperio server, no analytics, no crash reporter, no Firebase, no Google Play Services dependency, no ads SDK. Enforced by a JVM test that greps dependencies + sources for known SDKs (port of desktop `privacy-grep-gate.test.ts`).
- **Permissions:** `RECORD_AUDIO`, `INTERNET`. Nothing else (no `FOREGROUND_SERVICE_*`, no `POST_NOTIFICATIONS`, no storage permissions).

### 8.1 Data safety — verified, and it is NOT "no data collected"
Source: Play Console Help, "Provide information for Google Play's Data safety section", https://support.google.com/googleplay/android-developer/answer/10787469 (fetched 2026-10-17). Quotes:
- Collection: *"'Collect' means transmitting data from your app off a user's device."*
- Exemptions from collection: *"User data accessed by your app that is only processed locally on the user's device"*; data *"unreadable by you or anyone other than the sender and recipient"* (end-to-end encryption); and the narrow case where the user uploads *"directly to their own external drive or cloud storage account"* and the app never accesses the data.
- Ephemeral: *"Processing data 'ephemerally' means accessing and using it while the data is only stored in memory"* and retained no longer than needed to service the request in real time.
- Sharing: *"'Sharing' refers to transferring user data collected from your app to a third party."* Not sharing: *"Transferring user data to a third party based on a specific user-initiated action"*.

Apple's definition differs (data counts as "collected" only if the developer or partners can access it beyond servicing the request in real time), which is why iOS can say "Data Not Collected" and Play cannot.

Whisperio Android transmits the voice recording (and the custom vocabulary) off the device to the user's chosen provider, so the honest Play answer is:

| Data type | Collected | Shared | Ephemeral | Required | Purpose |
|---|---|---|---|---|---|
| Audio → Voice or sound recordings | **Yes** | **No** — sent to the provider the user picked, with the user's own key, on the user's tap (user-initiated action) | **No** — the recipient is the provider, not us; providers may retain API audio (e.g. OpenAI up to 30 days for abuse monitoring), so "only stored in memory" cannot be guaranteed | Yes (core function) | App functionality |
| App activity → Other user-generated content (custom vocabulary sent as `prompt`/`keyterms`) | **Yes** | **No** (same reason) | No | No (optional) | App functionality |

- RECORD_AUDIO needs no Permissions Declaration form, but requires a privacy policy URL in the Console and a link in the app. Target audience 13+ (outside the Families policy).

- Encrypted in transit: **Yes** (https; http only for user-configured private-network self-hosted URLs — disclose in the privacy policy).
- Data deletion: Whisperio holds nothing server-side; local data is removed by in-app "Erase all data" or uninstall, provider-side retention is governed by the user's own provider account. No account exists, so Play's account-deletion URL requirement does not apply. **Recheck the exact Console question set at submission** and record the answers in `docs/android/play-data-safety.md` with file:line evidence (Zryw pattern).
- Everything else: not collected. The listing copy must not claim "no data collected"; it may claim "no account, no Whisperio server, no analytics, no ads".

### 8.2 Privacy policy
`docs/privacy.html` gets an Android section: keys in Android Keystore, audio direct to chosen provider after consent, local Room history, no backup, keyboard does not read typed text, GDPR (RODO) legal basis with article + source + quote. Separate PR, Opus review (brief step 3).

## 9. Testing

- `core`: JUnit + MockWebServer for every provider (request shape: URL, headers, multipart fields, omitted fields for `auto`; response parsing; error redaction), ProviderChain, BaseUrlPolicy (iOS vectors), TextCleaner (iOS vectors), keyterm filter.
- `app`: Robolectric unit tests (key store with fake keystore, Room DAO, recorder state machine with fake recorder, IME commit logic incl. leading-space and no-history-for-sensitive-fields), Roborazzi snapshots (onboarding steps, settings, history list/detail, IME panel in each state, DictateActivity) — phone 411×914 dp, dark + light, en + pl; `verifyRoborazziDebug` is part of the gate.
- Gate (one heavy-queue slot): `./gradlew test lint :app:verifyRoborazziDebug :app:assembleDebug`. Check exit code, not log tail.
- Manual emulator smoke before release: enable IME, dictate into a text field with a real key (OpenAI), tile flow, erase all.

## 10. Release

- AAB `:app:bundleRelease`, signed with a **new upload keystore**. Passwords only in user env vars (`WHISPERIO_KEYSTORE_FILE`, `WHISPERIO_KEYSTORE_PASSWORD`, `WHISPERIO_KEY_ALIAS`, `WHISPERIO_KEY_PASSWORD`) / `bees/secrets` age file — never in repo, never echoed in logs. Unsigned build if absent (Zryw pattern). Play App Signing on.
- `release.json` `platforms.android` block so `/release-readiness --platform android` runs (Data safety file, listing links, targetSdk, permissions-used check).
- Play Console: app created as **Free**, internal track first, then closed. If the app does not exist in Play Console yet, Daniel creates it (Kokpit step); everything else is prepared in repo.
- Verify the developer account type: a personal account created after 2023-11-13 needs a closed test with ≥12 opted-in testers for 14 days before production access — plan it ahead of the post-iOS launch date.
- Public production launch only after the iOS launch (one launch at a time).

## 11. Decisions
- Decided 2026-10-17 (queenbee): versionCode 10000; applicationId `ai.whisperio.mobile`; Data safety per §8.1, Ephemeral = No.
- Open, for 1.1: on-device transcription — Android `SpeechRecognizer` (may hit Google) vs bundled whisper.cpp (~75–150 MB models).
