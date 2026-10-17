# Whisperio for Android — v1.0.0 contract

Status: DRAFT for review (2026-10-17). No code lands before this contract is reviewed.
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
| versionName / versionCode | `1.0.0` / `10000` | Zryw scheme `major*10000 + minor*100 + patch`, held in tracked `android/app/version.properties`. (Brief said versionCode 1; 10000 is strictly larger, keeps the scheme monotonic for 1.0.1 = 10001. Either works — choose before first upload, it can never go down.) |
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
- Release: R8 minify + shrinkResources, `allowBackup="false"`, `dataExtractionRules` excluding everything, `usesCleartextTraffic` only via network-security-config for private ranges (§4.3).
- Gradle memory: follow `~/.gradle/gradle.properties` caps (Xmx3g, kotlin daemon 1g, workers 4). Any gradle run = heavy task → `heavy-queue.txt` line, never parallel with other heavy jobs.

## 4. Transcription (parity with iOS `Engine/*Provider.swift`)

### 4.1 Providers in v1

| id | Request | Auth | Default model | Vocabulary sent as |
|---|---|---|---|---|
| `openai` | `POST {base}/audio/transcriptions` multipart (`model`, `language`?, `prompt`?, `file`). Default base `https://api.openai.com/v1`, overridable (BaseUrlPolicy). | `Authorization: Bearer` | `whisper-1` (chips `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`) | `prompt` |
| `groq` | `POST https://api.groq.com/openai/v1/audio/transcriptions`, same fields | Bearer | `whisper-large-v3-turbo` (chips + `whisper-large-v3`, `distil-whisper`→`distil-whisper-large-v3-en`) | `prompt` |
| `mistral` | `POST https://api.mistral.ai/v1/audio/transcriptions` (`model`, `language`?, `file`) | Bearer | `voxtral-small-latest` (`voxtral-mini-latest`) | — |
| `elevenlabs` | `POST https://api.elevenlabs.io/v1/speech-to-text` (`model_id`, `language_code`?, `keyterms`? JSON array, `file`) | `xi-api-key` | `scribe_v1`; `scribe_v2` when keyterms present | `keyterms` (each ≤50 chars, ≤5 words, no `<>{}[]\`) |
| `deepgram` | `POST https://api.deepgram.com/v1/listen?model=…&smart_format=true[&language=…]`, raw body | `Authorization: Token` | `nova-3` (`nova-2`, `whisper-cloud`→`whisper-large`) | — |
| `assemblyai` | `POST /v2/upload` raw → `POST /v2/transcript` JSON `{audio_url, speech_model, language_code \| language_detection:true}` → poll `GET /v2/transcript/{id}` every 2 s, max 150 polls | raw `authorization` | `universal` (`best`) | — |
| `selfhosted` | `POST {url}/audio/transcriptions` (`/v1` appended if missing), OpenAI fields minus `prompt` | optional Bearer | `whisper-1` | — |

Responses parsed exactly as iOS: `{text}`; Deepgram `results.channels[0].alternatives[0].transcript`; AssemblyAI `text` when `status == completed`, error on `status == error`.

### 4.2 Errors, fallback, validation
- Non-2xx → `ProviderError.Http(provider, status, detail)`; detail from `error.message` | `error` | `message` | `detail` | first line, truncated to 200 chars, **any API key redacted** (port of `K/ProviderError.swift`).
- `ProviderChain`: ordered list of configured providers; fallback off by default (`fallbackEnabled=false`); on all-fail return first error; if none configured, try first so the user sees a real error.
- Key validation (port of `K/ProviderKeyValidator.swift`): GET with 15 s timeout — 2xx valid, 401/403 invalid key, else unexpected(code), transport error = network. Same endpoints as iOS (`/v1/models`, `/v1/user`, `/v1/projects`, `/v2/transcript?limit=1`, …). A key is saved only after it validates.
- Language: ISO code, field omitted for `auto`; AssemblyAI uses `language_detection:true` for auto.
- No per-request retries (iOS has none). User can retry from history (audio is kept, §7).

### 4.3 BaseUrlPolicy (port of `K/BaseURLPolicy.swift`)
https always. http only for localhost, 127/8, 10/8, 172.16/12, 192.168/16, 100.64/10, `*.local`, `*.lan`, `*.internal`, `*.home.arpa`, dotless hosts, `::1`, `fc/fd/fe80`. Android additionally needs a network-security-config permitting cleartext for those; since NSC cannot express CIDR, cleartext is permitted app-wide **only** for requests that pass `BaseUrlPolicy` (OkHttp interceptor rejects anything else before it leaves the device). Unit-tested with the iOS test vectors.

### 4.4 Size limits (Android adds what iOS lacks)
Recording at AAC-LC 16 kHz mono 32 kbps ≈ 14 MB/hour. Before upload the client checks the file against the provider limit (OpenAI/Groq/Mistral 25 MB, others 100 MB+) and fails with a clear message instead of an opaque HTTP 413. Hard recording cap: 60 min, with a visible warning at 55 min.

## 5. Keyboard (IME)

- `WhisperioImeService : InputMethodService`, Compose UI in the input view.
- **Records directly inside the IME** (Android allows it; the iOS bounce-to-app flow is an iOS sandbox constraint, not a feature). The IME runs in the app process, so the app's `RECORD_AUDIO` grant covers it.
- Panel: big mic button (tap to start, tap to stop; state: idle / recording with level meter + timer / transcribing / error), backspace, space, enter (respects `EditorInfo.imeOptions` action), "switch keyboard" (`switchToPreviousInputMethod`, fallback `InputMethodManager.showInputMethodPicker`), provider chip (which provider audio goes to).
- Result: `currentInputConnection.commitText(transcript, 1)`, with a leading space if the char before the cursor is not whitespace. Entry saved to history with `source = keyboard`.
- No permission / no key → panel shows a single "Open Whisperio to finish setup" button (the IME cannot show the runtime permission dialog).
- Declares a `voice` subtype (`android:imeSubtypeMode="voice"`) so other keyboards' mic buttons can hand off to Whisperio.
- Privacy: never reads or stores typed text; `EditorInfo` password / `TYPE_TEXT_FLAG_NO_PERSONALIZED_LEARNING` / `IME_FLAG_NO_PERSONALIZED_LEARNING` fields → transcript is committed but **not** saved to history.
- Focus lost / IME hidden while recording → stop and discard (no background recording).

## 6. Recording, tile, shortcut

- `MediaRecorder`: MPEG-4/AAC, 16 kHz, mono, 32 kbps, file in `filesDir/recordings/<uuid>.m4a`. Level meter from `getMaxAmplitude()` every 50 ms.
- Optional auto-stop on silence (`autoStopSeconds`, default 0 = off, 0–120 in 5 s steps; activity threshold as iOS).
- Audio focus: request transient-exclusive; on loss → stop (iOS default `stop`).
- **Quick Settings tile** (`TileService`): tap → opens translucent `DictateActivity` (Android 14+: `startActivityAndCollapse(PendingIntent)`), which records, transcribes, copies to clipboard (marked `ClipDescription.EXTRA_IS_SENSITIVE` on 33+ is **not** set — transcripts are not secrets, but nothing is logged), saves to history with `source = tile`.
- **Launcher shortcut** (static `shortcuts.xml`): "Dictate" → same `DictateActivity`, `source = shortcut`.
- No foreground service in v1 → no `FOREGROUND_SERVICE_MICROPHONE` declaration. Leaving the activity stops the recording.

## 7. Main app

### 7.1 Onboarding (compressed from iOS's 9 steps)
1. Welcome. 2. Privacy: "Audio goes only to the provider you pick, with your key. No Whisperio server, no account, no analytics." + explicit consent to send audio to the chosen provider (stored as `cloudConsentGranted`; nothing is ever uploaded before it). 3. Pick provider + paste key (validated). 4. Languages (chips pl, en, de, es, fr, it, pt, uk + auto). 5. Microphone permission. 6. Enable the keyboard (deep link to `Settings.ACTION_INPUT_METHOD_SETTINGS`) + add QS tile (`StatusBarManager.requestAddTileService` on 33+), skippable. 7. First dictation / done.

### 7.2 Keys
- Stored encrypted: AES-256-GCM key in **Android Keystore** (non-exportable, `setUserAuthenticationRequired(false)`), ciphertext in a private `DataStore` file. (`EncryptedSharedPreferences` is deprecated in security-crypto 1.1.0; a small own wrapper is easier to test.) Equivalent of iOS `WhenUnlockedThisDeviceOnly`: not backed up (`allowBackup=false` + data-extraction rules exclude all), not transferable to another device.
- Keystore failure on read (key invalidated) → wipe the ciphertext, mark the provider as "key missing", ask the user to paste again. Never crash, never log the key.
- Keys never appear in logs, crash output, history, or error messages (redaction unit-tested).

### 7.3 History (Room, local only)
`Recording(id, createdAt, durationMs, status[recording|transcribing|done|failed], provider, model, language, transcript?, error?, audioPath?, source[app|keyboard|tile|shortcut])`.
List + detail (copy, share, retry transcription, delete). Settings: keep audio (default on), auto-delete after 1/7/30 days (default off), delete all audio, **erase all data** (history + audio + keys + settings).

### 7.4 Settings
Provider order + model per provider, fallback toggle, keys (add/replace/remove, re-validate), custom-provider base URL (OpenAI) / self-hosted URL, language (Auto, English, Polski, Deutsch, Español, Français, Italiano, Português, Nederlands, Русский, Українська), vocabulary (comma-separated), deterministic cleanup toggle (port of `TextCleaner.tidy`), auto-stop, storage/retention, About (version, privacy policy, terms, support, licences).

## 8. Privacy & Play declarations

- **Network destinations, complete list:** the transcription/validation endpoints in §4 for the providers the user configured, plus the user's own base URL. No Whisperio server, no analytics, no crash reporter, no Firebase, no Google Play Services dependency, no ads SDK. Enforced by a JVM test that greps dependencies + sources for known SDKs (port of desktop `privacy-grep-gate.test.ts`).
- **Permissions:** `RECORD_AUDIO`, `INTERNET`. Nothing else (no `FOREGROUND_SERVICE_*`, no `POST_NOTIFICATIONS`, no storage permissions).

### 8.1 Data safety — verified, and it is NOT "no data collected"
Google's definition (Play Console Help 10787469, fetched 2026-10-17): *"'Collect' means transmitting data from your app off a user's device."* The only exemptions are on-device-only processing, end-to-end encryption, and the narrow "user uploads to their own external drive/cloud storage and the app never accesses it". Apple's definition is different (data is only "collected" if the developer or partners can access it beyond servicing the request), which is why iOS can say "Data Not Collected".

Whisperio Android transmits the voice recording off the device (to the user's provider), so the honest Play answer is:

| Data type | Collected | Shared | Ephemeral | Required | Purpose |
|---|---|---|---|---|---|
| Audio → Voice or sound recordings | **Yes** | **No** — transfer to a third party based on a specific user-initiated action is not "sharing" (same help page) | No (we cannot vouch for the provider's retention) | Yes (core function) | App functionality |

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
- Public production launch only after the iOS launch (one launch at a time).

## 11. Open decisions for Daniel
1. versionCode `10000` (scheme) vs `1` (brief).
2. Play Data safety: declare Audio collected/not shared (recommended, §8.1) vs argue the BYO-key exemption (not supported by Google's text).
3. On-device transcription for 1.1: Android `SpeechRecognizer` (may hit Google) vs bundled whisper.cpp (~75–150 MB models).
