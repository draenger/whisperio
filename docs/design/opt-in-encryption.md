# Opt-in encryption of user data ("Encrypt history and recordings")

Status: DESIGN DRAFT for Daniel's decision (2026-10-30). No implementation until accepted. Nothing here is released or merged.
Scope: Android (1.0.0), desktop (Electron), iOS/iPadOS/watchOS and the Mac app. Evidence is `path:line`-level from `main` @ a94ac46; verify again before implementing.

## 0. Summary and recommendation

- A single user setting, **"Encrypt history and recordings"**, **default OFF**, offered once as a card after onboarding and in Settings > Privacy.
- One crypto contract on every platform: AES-256-GCM, a random 256-bit data key (DEK) per install, the DEK wrapped by the platform keystore (Android Keystore, Apple Keychain, Electron `safeStorage` = DPAPI / Keychain / libsecret). Same envelope everywhere (section 3.1) so test vectors are shared.
- Optional biometric lock is a **phase 2**, with a write-without-auth design (section 3.4).
- Erase all data becomes a **crypto-shred** (destroy the wrapped DEK first, then delete files).
- Most of the existing declarations stay true. The list of what must change is in section 5; the honest one to check early is the iOS export-compliance answer.
- Effort: roughly 20-28 dev-days total for phase 1 on all platforms (section 6). Android first, because it has the smallest surface (no sync, backups already excluded).

### Why default OFF (the question asked)

1. **Data loss risk is asymmetric.** Today a lost Keystore key costs the user a pasted API key (already handled: `KeystoreSecretStore` wipes and asks again, `lost` flow). With history encryption ON, the same rare event (OEM Keystore corruption after an update, restore to another device, factory reset with a kept SD card, Keychain `ThisDeviceOnly` on a restored iPhone) destroys the user's transcripts and clips. Default ON would turn a rare bug into silent data loss for everyone; OFF limits it to people who asked for protection and were told the trade-off.
2. **The threat model is narrow on mobile.** The app sandbox, file-based encryption of the device (Android FBE, iOS Data Protection) and backup exclusion (Android: `allowBackup=false` + data-extraction rules exclude everything; iOS keeps kept clips at `.complete`) already cover a lost, locked phone. App-level encryption adds protection against: (a) an unlocked device handed over (needs the biometric option), (b) backups and file copies taken with the app's own permissions (desktop, rooted device, iOS device backups), (c) a future bug that exposes files. It is real but not what most users need today.
3. **Performance and features have a cost:** search, recap, export and audio playback all read decrypted data; audio needs seekable decrypt (section 3.3).
4. **Desktop is different but not enough to split the default:** a Windows or Linux disk is readable by other local users, backups and malware running as the same user (DPAPI does NOT stop the last one). Same default OFF everywhere keeps one story. Revisit (ON for fresh installs on desktop) only after the migration is proven in the field.

A cheap middle path worth taking regardless: on desktop, refuse the **plaintext fallback for provider API keys** when `safeStorage` is available (today they can stay in `settings.json`, see 1.2). That is a bug-class fix, not part of the toggle.

## 1. Inventory: what is stored, where, and how it is protected today

### 1.1 Android (`ai.whisperio.mobile`, `android/`)

| Data | Where | Today |
|---|---|---|
| Provider API keys | Preferences DataStore `secrets` (`di/AppGraph.kt:36,71`) | **Protected**: AES-256-GCM, non-exportable Android Keystore key, base64(iv+ct) (`security/KeystoreSecretStore.kt:45-95`); decrypt failure wipes the entry and asks again |
| Dictation history: transcript, error, provider, model, language, source, category, created_at, duration, audio_path | Room DB `whisperio.db`, table `recording` (`history/Recording.kt:18-32`, `di/AppGraph.kt:89`) | **Plaintext** SQLite in private app storage |
| Audio clips (kept by default, `keepAudio=true`) | `filesDir/recordings/*` AAC/MP4 16 kHz mono (`di/AppGraph.kt:66`, `audio/AudioRecorder.kt:30`) | **Plaintext** files in private storage |
| Settings (provider choice, custom vocabulary, custom categories, consent flag, retention days) | Preferences DataStore `settings` (`di/AppGraph.kt:35`) | Plaintext in private storage (vocabulary and categories are user text) |
| Per-app language map (package names) | DataStore `app_languages` | Plaintext |
| Recap share card | `cacheDir/share/recap.png`, numbers only (`ui/recap/RecapShare.kt:64`) | Plaintext, deleted by Erase all |
| Export (TXT/MD/...) | User-picked SAF location (`ui/history/ExportLauncher.kt:75-99`) | Plaintext by design (the user's own file) |
| Widget / QS tile / keyboard | Same process and stores; widgets only start dictation (no history read found) | n/a |
| Backups | `allowBackup=false`, `data_extraction_rules.xml` excludes cloud backup and device transfer for all domains | Nothing leaves the device |
| Erase all | `AppGraph.eraseAllData()` (`di/AppGraph.kt:143-155`): history, secrets, settings, language map, share dir | Files deleted; flash remnants possible |

Layer already present at the OS level: file-based encryption keyed to the device lock screen. Not present: any app-level protection of the transcript, the audio or the settings text.

### 1.2 Desktop (Electron, `desktop/src/main`)

| Data | Where | Today |
|---|---|---|
| Provider API keys | `provider-keys.enc.json` via `safeStorage` (`secure/keyStore.ts`) | **Protected** when `safeStorage.isEncryptionAvailable()`; **otherwise a documented plaintext fallback in `settings.json`** (keyStore.ts header, `secure/keyAccessor.ts`). On Linux without a keyring, Electron may even report available with a weak `basic_text` backend: must be checked (`getSelectedStorageBackend()`) |
| GitHub token | `github-token.enc` wrapped by `safeStorage`, DEK in `secret-vault.key` (`secretVault.ts:35-36`) | **Protected**, fail-closed |
| GitHub sync payload | secrets sealed AES-256-GCM before commit (`secretCrypto.ts`, `githubSync.ts`) | Protected (secrets only) |
| Settings, vocabulary, prompts, tone table, app names | `settings.json` (`settingsManager.ts:316`) | **Plaintext** |
| Recording index: transcripts, cleanup result, context snapshot, speaker segments | `recordings/index.json` (`recordingStore.ts:112-154`) | **Plaintext** |
| Audio | `recordings/recording-<ts>.webm` (`recordingStore.ts:214-218`), size-capped cache | **Plaintext** |
| Usage counters | `usage.json` | Plaintext (no content) |
| Models | `models/`, `whisper-server/` | Public data, not in scope |
| Search | read-time over `recordingStore` data, no index file (`searchService.ts`) | works on plaintext |

### 1.3 iOS / iPadOS / watchOS / Mac app (`mobile/`)

| Data | Where | Today |
|---|---|---|
| Provider API keys | Keychain, `WhenUnlockedThisDeviceOnly` (`WhisperioKit/Keychain.swift:42`) | **Protected**, not synced, not in backups |
| History | `recordings.json` in Documents (JSON backend) **or** SwiftData store with CloudKit private DB (`Engine/RecordingsStore.swift:112,209`); digests/journal likewise (`DigestStore.swift`) | JSON: file protection `completeUntilFirstUserAuthentication` (`FileProtection.swift`); SwiftData: managed by SwiftData; CloudKit: encrypted by Apple, Apple holds the keys unless the user enabled Advanced Data Protection |
| Audio | Documents, kept clips `.complete` while protected data is available (`Engine/AudioStore.swift:10-21`) | **Protected** by Data Protection (tied to the passcode); never uploaded to iCloud |
| Settings, presets, digest prompts | UserDefaults / App Group suite (`SettingsStore`, `PresetStore`, `DigestPromptStore`, `DictateIntent.swift:16-22`) | Plaintext in the sandbox |
| GitHub sync | transcripts, journal, summaries uploaded as Markdown to the user's repo; token in Keychain (privacy.html section 3) | Plaintext on GitHub **by design** |
| Backups | iCloud / iTunes device backups include Documents (JSON history, audio) | Included, protected by Apple's backup encryption only |
| Extensions | keyboard, widget, watch app share the App Group | Need a shared keychain access group for any new key |

Net: iOS is already the strongest platform for audio; the plaintext gaps are the transcripts (JSON/SwiftData) and UserDefaults text. Android and desktop have the largest gap.

## 2. User-facing proposal

- Settings > Privacy > switch **"Encrypt history and recordings"** (PL: "Szyfruj historię i nagrania"). Subtitle: what it protects, and "If you lose access to this device's secure storage, encrypted history cannot be recovered."
- Turning ON: confirm dialog, progress ("Encrypting 142 items"), resumable, can be cancelled (partially migrated state is valid, section 4).
- Turning OFF: same in reverse, with a dialog that data will be readable again by anyone with file access.
- New items are written encrypted as soon as the switch is ON (no plaintext window).
- Optional phase 2: **"Require biometrics to open history"** (Android `BiometricPrompt`, iOS `LocalAuthentication`, desktop: Windows Hello via native module is out of scope; use the OS login as is).
- Erase all data = crypto-shred (section 4.3).
- Not affected: provider API key storage (already protected), data the user explicitly exports or shares.

## 3. Design

### 3.1 Envelope and keys (shared contract, `:core` for Android, `WhisperioKit` for Apple, `secretCrypto.ts` for desktop)

- Cipher: AES-256-GCM, 96-bit random nonce, 128-bit tag. Do not invent a format: reuse the existing desktop envelope idea (`secretCrypto.ts`: version, nonce, ciphertext, tag) and add `kid` (key id) for rotation.
- Fields: `v(1) | kid(4) | nonce(12) | ct | tag(16)`; AAD = `"whisperio/1|" + recordId + "|" + fieldName` so ciphertext cannot be moved between rows.
- Keys: one DEK per install (random 256-bit). DEK is stored only wrapped: Android Keystore AES key (alias `whisperio.data.kek`, non-exportable, StrongBox when available) wraps it; Apple Keychain `AfterFirstUnlock...ThisDeviceOnly` (see risk R2); desktop `safeStorage.encryptString` (new file `data-vault.key`, deliberately NOT the GitHub vault DEK so sync can be turned off without touching history).
- Fail closed: if the platform keystore is unavailable, the switch cannot be turned ON (desktop Linux without keyring or with the `basic_text` backend).
- Test vectors in the repo, identical for Kotlin, Swift, TypeScript, so a later cross-platform export stays possible.

### 3.2 Structured data (transcripts, settings text)

- **Android**: field-level encryption in the repository layer (the `transcript` and `error` columns, optionally vocabulary/categories later). Do NOT switch to SQLCipher for phase 1: new native dependency (+ several MB per ABI), an out-of-tree Room integration and `PrivacyGateTest` allowlist work; field-level keeps Room plain, keeps the 1.1 Kotlin-side search working (search decrypts in memory after load, no SQL `LIKE`/FTS involved), and keeps metadata (date, duration, provider, category) queryable. Cost: metadata stays plaintext; stated openly in the setting's help text. Room schema 2->3 adds `enc_version INTEGER NOT NULL DEFAULT 0` (migration test required, schemas are shipped as debug assets).
- **Desktop**: encrypt each recording's text fields inside `index.json` (or move the whole index to one sealed blob: simpler, loads are small). Recommendation: seal the whole index; `searchService` already reads it fully at query time. Settings text (vocabulary, prompts, tone table) goes in a second sealed blob only if we agree it is sensitive; phase 1 can skip it.
- **iOS**: JSON backend: seal the file. SwiftData/CloudKit backend: see 3.5.

### 3.3 Audio

- Android: chunked AEAD (4 KiB-64 KiB segments, per-segment nonce derived from a file nonce + counter, final-segment flag) so that `MediaPlayer` can seek. Use `MediaDataSource` (API 23+) backed by a seekable decrypting reader, no plaintext temp file. Prefer Google Tink `AesGcmHkdfStreaming` (seekable) over a hand-rolled format if the dependency is acceptable; otherwise implement the same scheme in `:core` with tests. Recorder writes to a temp encrypted sink on stop (recording itself is a plaintext `MediaRecorder` file until stopped: encrypt-on-finalize, then delete the plaintext, within the same dictation task).
- Desktop: same scheme; the renderer plays through a `blob:`/custom protocol that decrypts in main. Never write decrypted audio to disk.
- iOS: audio already has Data Protection. Phase 1 recommendation: leave audio on file protection (`.complete`) and encrypt only the transcript store; app-level audio encryption on iOS is phase 2 (low marginal value, high cost with `AVAudioPlayer` and the watch/keyboard extensions).

### 3.4 Biometrics (phase 2)

- Naive: auth-bound Keystore key (`setUserAuthenticationRequired(true)`) means the keyboard, tile, widget and shortcut cannot **save** a new dictation without a prompt. That breaks the product.
- Proposed: **write without auth, read with auth.** Per-record content key encrypted to an asymmetric public key (Android EC/ECIES or RSA-OAEP, iOS `SecKeyCreateEncryptedData`) whose private key is auth-bound. Writers (any entry point) use the public key silently; opening History needs one `BiometricPrompt`; the unlocked DEK/private key lives in memory for a short window (60 s, configurable). Costs roughly +3 dev-days per mobile platform plus a re-wrap path on biometric enrollment changes (`setInvalidatedByBiometricEnrollment` decision: recommend `false` + device credential fallback to avoid data loss).

### 3.5 iOS with iCloud sync (the hard case)

- SwiftData + CloudKit cannot per-field encrypt. App-level encrypting the transcript attribute would make every device need the same key, which means an iCloud-synced (`kSecAttrSynchronizable`) key. That reverses the privacy statement "API keys are not synced" in spirit (it would be a new key, but the policy must say so) and risks lock-out on losing all Apple devices.
- Recommendation: phase 1 offers the switch for **on-device-only storage mode** (JSON backend); when iCloud sync is on, the switch is disabled with an explanation ("iCloud data is already encrypted by Apple; for end-to-end protection turn on Advanced Data Protection"). Revisit if Daniel wants E2E for synced data (then CloudKit `encryptedValues` with raw CKRecord, i.e. leaving SwiftData's CloudKit integration: large change).

## 4. Migration, lifecycle, side effects

### 4.1 Enable/disable

- Idempotent per item: write ciphertext to `*.tmp`, fsync, atomic rename, then flip `enc_version` and delete the plaintext, in that order. A crash at any point leaves each item readable (either version) and the job resumes. Same in reverse.
- Background (Android `WorkManager` expedited or the existing `appScope`; desktop main process task; iOS `BGProcessingTask` for large sets), foreground progress UI, runs only while the keystore is available.
- Mixed state is valid: the reader dispatches on `enc_version`, so turning the switch ON or OFF never blocks the UI or dictation.
- Flash and SSD remnants: deleting plaintext does not guarantee physical erasure. Say so in the help text; the guarantee is only for data written encrypted from the start.

### 4.2 Search, recap, widget, export, backup

| Area | Effect |
|---|---|
| History search (Kotlin-side, v1.1) | Works unchanged conceptually: decrypt transcripts into the in-memory list used by search; first open pays a one-time decrypt of N rows (measure at 5-10k rows; AES-GCM on short text is sub-ms each, so the budget is dominated by list load). No FTS means no plaintext index to worry about; adding FTS later would leak and must stay off when encrypted |
| Recap (week card, share card) | Computed from decrypted words/counts; share card PNG contains numbers only; delete after share as today |
| Widget / tile / keyboard | Same process and key; fine without biometrics; with phase-2 biometrics they use the write-only path |
| Export (SAF TXT/MD, share sheet) | Produces plaintext by explicit user action; show one line in the export dialog when encryption is ON. Optional later: encrypted export (passphrase) |
| Android backup | No change: backup and device transfer are already fully excluded |
| iOS backups / iCloud | Decide key class (R2): `AfterFirstUnlockThisDeviceOnly` => backups of ciphertext are useless on a new phone (data lost, matches Android's behaviour); non-`ThisDeviceOnly` keys would travel in encrypted backups only |
| Desktop sync (GitHub) | Secret sealing unchanged. iOS Markdown sync to GitHub stays plaintext by design: turning encryption ON must show a warning if GitHub sync is also ON, and offer to turn sync off |
| Auto-delete / retention | Unchanged, operates on metadata |

### 4.3 Erase all data = crypto-shred

Order: (1) delete the wrapped DEK file/entry and the Keystore/Keychain KEK, (2) wipe DB rows and files, (3) clear settings. After step 1 everything encrypted is unreadable even if step 2 is interrupted or flash retains blocks. `AppGraph.eraseAllData()` already runs in a never-cancelled scope; add step 1 first. Plaintext data (switch OFF) keeps today's behaviour.

## 5. Impact on declarations (list only, no wording changes proposed here)

**Google Play Data safety** (`docs/android/play-data-safety.md`, Console form):
- Console answers: **none must change.** Encryption at rest is not a Console question; "data encrypted in transit", collected/shared types, deletion answer all stay.
- Internal doc: the "Ephemeral = No" rationale lists "audio file and transcript are stored by default" (section 2) - add that they can be encrypted; keep the answer No. API key row ("stored encrypted") unchanged.
- Re-check at submission: the new Keystore alias does not add a permission; `PrivacyGateTest` still passes (Tink is not on the ban list, but confirm).

**Apple (`PrivacyInfo.xcprivacy`, App Store Connect):**
- `NSPrivacyCollectedDataTypes` and tracking: no change. Required-reason APIs: none new expected (file timestamps already declared).
- **Export compliance** (checked 2026-10-30): `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO` is set in all 6 build configurations of `WhisperioApp.xcodeproj` (iOS app, extensions, watch, `WhisperioMac`), no hand-written key in the plists. Today the app has no own cryptography (no CryptoKit/CommonCrypto/AES in `mobile/`; the only hash is a Foundation SHA-1 helper, not encryption): only OS-provided HTTPS, Keychain and Data Protection, so `NO` is consistent with Apple's exemption for encryption that is part of the OS. Adding CryptoKit AES-GCM for the user's own data changes the answer to Apple's "standard encryption algorithms in addition to the OS" question: expect `YES` + an exemption self-classification (ancillary use, mass-market note) and a BIS annual self-classification report if Daniel distributes from the US; confirm with the current Apple/BIS text before iOS work starts. Not a blocker for Android-first.
- Keychain access group (App Group) entitlement changes if the keyboard/widget/watch need the DEK: update `WhisperioApp*.entitlements`.

**`docs/privacy.html`** (sections to touch when this ships):
- Section 3 "stored locally" bullets (settings, API keys, history): mention the optional encryption; the desktop key-store line "otherwise in the app's local config directory" (plaintext fallback) must match the final behaviour of the fallback fix.
- Section 5 (iCloud sync): state that encrypted mode is on-device-only (or the E2E decision), and the GitHub Markdown sync warning.
- Android history/storage paragraph (about "stored only on your device in the app's private storage") and the "Erase all data" description: add crypto-shred and the "cannot be recovered if the key is lost" statement; unchanged backup paragraph.
- New short section or paragraph: what the setting protects and does not (metadata, exports, provider-side copies).
- `docs/android/play-data-safety.md`, `docs/android/review-notes.md`, and store listings if they mention storage; app strings (EN/PL) for the new setting.

## 6. Effort (phase 1, Sonnet-lane estimates incl. tests; one reviewer pass per PR)

| Part | Days |
|---|---|
| Shared envelope spec + test vectors (3 languages) | 2 |
| Android: key mgmt, Room 2->3 migration, field encryption, audio streaming (Tink/own), migration job, settings UI EN/PL, erase = shred, Roborazzi baselines, migration + crypto tests | 7-9 |
| Desktop: data vault, sealed index, audio decrypt path, migration, settings UI, Linux keyring checks, plaintext-key-fallback fix, vitest + e2e | 5-6 |
| iOS/macOS (device-only mode): sealed JSON store, Keychain access group, extension reads, settings UI, migration, disable-when-iCloud logic, tests (needs a Mac worker) | 6-8 |
| Docs and declarations (privacy.html EN/PL, Data safety doc, export-compliance check) | 1-2 |
| **Total** | **~21-27** |
| Phase 2 biometrics | +3 per mobile platform |

Parallelism: Android and desktop are independent after the spec. iOS needs the Mac worker and, for iCloud users, a separate decision.

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Key lost (Keystore corruption, factory reset, restore on a new device, desktop profile move or OS reinstall): history is unrecoverable | Default OFF; clear warning at enable; fail-safe read path (a row that cannot be decrypted shows "unreadable", never crashes); optional recovery key (user-held, Argon2id-derived wrapping) as phase 2; keep metadata plaintext so the list still renders |
| R2 | iOS key class: `ThisDeviceOnly` loses data on a device migration; non-`ThisDeviceOnly` makes keys leave the device inside encrypted backups | Pick `AfterFirstUnlockThisDeviceOnly` for consistency with Android; state it in the setting's text |
| R3 | Performance: audio seek decrypt, search over thousands of rows, first-open decrypt | Segment size tuning, in-memory list cache, measure at 10k rows before shipping |
| R4 | Half-migrated state after a crash or a kill | Per-item atomic swap and dispatch by `enc_version`; resumable job; migration tests with injected failures |
| R5 | Plaintext leaks that bypass the toggle: Room WAL/journal remnants, recorder temp files, clipboard from tile/shortcut, the recap PNG, exports, logs | Inventory in the PR checklist; "no transcript in logs" test already exists in spirit, extend it; document the clipboard behaviour (already in privacy.html) |
| R6 | Desktop Linux weak backend / no keyring | Refuse to enable; message tells the user why |
| R7 | False sense of security: same-user malware or a rooted device with the app running can still read decrypted data | Say in the help text what it protects against (stolen disk, file copy, backups), and not what it does not |
| R8 | Store policy and export rules (Apple export compliance, French encryption declaration if applicable) | Check in the first week, before iOS work starts |
| R9 | New dependency (Tink) vs. the "no third-party SDK" privacy stance and `PrivacyGateTest` | Tink is a local crypto library with no network code; if not acceptable, implement the segment scheme in `:core` (about 200 lines + vectors) |

## 8. Decisions (taken 2026-10-30 on Daniel's instruction: recommended option wherever safer at equal cost)

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Default | **OFF**, offered as a card after onboarding and in Settings > Privacy | Data-loss risk is asymmetric (R1); mobile threat model already covered by FBE/Data Protection; one story on all platforms |
| 2 | Phase 1 scope | Transcripts + audio on **Android and desktop**; iOS = device-only mode, no iCloud E2E | Smallest surface first; iCloud E2E needs key sync and recovery design |
| 3 | DB encryption | **Field-level** (not SQLCipher) | Keeps metadata plaintext so lists render and an undecryptable row degrades to "unreadable"; no native DB dependency |
| 4 | Audio scheme | **Tink streaming AEAD on Android**; Node crypto segmented AES-256-GCM on desktop (no cross-platform file exchange, so formats need not match) | Audited library over our own 200 lines; Tink has no network code (R9), `PrivacyGateTest` re-checked |
| 5 | Biometric lock | **Phase 2** | Needs write-without-auth design (3.4); keeps phase 1 testable |
| 6 | Recovery key | **Yes, phase 2, user-held only** (Argon2id-derived wrap, we never hold a copy) | Mitigates R1 without changing the "we cannot recover anything" promise |
| 7 | Desktop plaintext key fallback | **Fixed now**, independent of this feature (PR #19) | Bug-class fix |

Still owned by Daniel (not decided here): everything in Play Console (RECORD_AUDIO declaration, Data safety submission), legal texts (privacy policy, terms), desktop release 1.5.2.
