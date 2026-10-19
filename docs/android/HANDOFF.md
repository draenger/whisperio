# Whisperio Android — HANDOFF (updated 2026-10-18)

## 2026-10-19 update
- **Heavy slot 19.10 done (lock released):**
  - Android gate green after the teal theme (24a7195, 9647739): `:core:test` 113, `:app:testDebugUnitTest` 227, `verifyRoborazziDebug` (110 baselines, eyeballed), `lintDebug`, `assembleDebug`. Fixed on the way: `--` in XML comments, QS tile NewApi guard inline, key actions FlowRow (font 2x), IME chip width + ellipsis, two never-run tests (Room executor wait, one DataStore file per enrollment).
  - Signed AAB `:app:bundleRelease` 1.0.0 / 10000, upload cert SHA-256 CF:F7:...:D0:3D, `jarsigner` verified. Copy: `C:/Users/dkwar/bees/whisperio-play-assets/whisperio-1.0.0-10000.aab` (sha256 2230d50b...db75c). Upload to internal track once Daniel created the app (Plaster task).
  - Emulator smoke API 36 only (no 34/35 images installed): onboarding 1-7 + try-it, IME dictation into Messages, mic off in password field, QS tile (setup-needed + dictation -> clipboard/history), Erase all -> onboarding; transcription via a local self-hosted mock (`ELEVENLABS_API_KEY` in env returns 401 - invalid). Emulator has `hw.keyboard=yes`: needs `settings put secure show_ime_with_hard_keyboard 1`. Still to do on a real phone: real key + real mic, TalkBack, API 34/35. Copy nit: self-hosted without key says "The key works and is saved".
  - Desktop 1.5.0: signed `Whisperio-Setup-1.5.0.exe` + `latest.yml` uploaded to the **draft** (verify PASS, remote == local). Fixes on main: `*.mjs eol=lf` (64b269f, vitest 928/928 on Windows), `signingHashAlgorithms` as a yml array (40ff672). **Not published** - publish = `gh release edit v1.5.0 --draft=false` after an OK (auto-updates every install).
- **Desktop 1.5.0:** `release` ff to main; CI fixed twice (main 16299d6 pin `windows-2022` — windows-latest is now windows-2025-vs2026 and node-gyp 9 can't find VS 2026; main d65b9f8 Python 3.11 on the win job — distutils). Run 39212496598 green, **draft v1.5.0** has the Linux assets. `release-desktop.mjs` dry run PASS from worktree `D:/Master/Repo/whisperio-release` (branch `main`). Next (heavy slot): `npm ci` + `npm run release:desktop -- --execute` (no `--publish` without an OK).
- **Audit Apple:** L6 (`NSAllowsLocalNetworking`, 8eb3437) and L2 (keyboard inserts only into the origin field; hashed origin + TTL; chip "Paste last dictation"; e15521a) pushed to `fix/audit-apple`. Not compiled (no Swift on Windows) — Mac test run (amc) before merge; check the keyboard height with the chip shown. H1 (CloudKit Production schema) = Mac/Console, not code.

## 2026-10-18 update
- **Play prep (18.10 pm):** `docs/android/PLAY-CONSOLE-PASTE.md` (PL paste sheet), Plaster task `wh-android-play-1017` v2; store assets via `android/marketing/play/screenshots` (app-screenshots kit from Roborazzi baselines, verify PASS; copies in `C:/Users/dkwar/bees/whisperio-play-assets`). Launcher icon = teal ghost traced from the iOS icon (commit 234654f) - NOT yet through gradle (lint/assemble).
- **Next heavy slot (queued in heavy-queue.txt):** gate (lint + assembleDebug + verifyRoborazzi) after the icon, emulator smoke API 34/35/36 (CONTRACT §9), capture keyboard + tile store shots with the kit `android` adapter, then signed `:app:bundleRelease` + signature verify + release-readiness, then merge `android/skeleton` -> main.
- **Audit 2026-10-18 (Fable):** desktop fixes merged (main d2e3f05); Apple fixes on `fix/audit-apple` (worktree `D:/Master/Repo/whisperio-audit-apple`) await Mac tests (amc) before merge.
- **Gradle gate GREEN** (first compile): `:core:test` 111/111, `:app:testDebugUnitTest` 158/158, `:app:verifyRoborazziDebug` (82 baselines in `app/src/test/snapshots/`, eyeballed), `:app:lintDebug`, `:app:assembleDebug`. `local.properties` (gitignored) needs `sdk.dir=C\:/Users/dkwar/AppData/Local/Android/Sdk`. Run with `-Dorg.gradle.workers.max=2 -Dorg.gradle.jvmargs=-Xmx3g`; kill only own daemon PIDs afterwards (no `--stop` while others build).
- **Opus code review (1 round): PASS with notes**, all findings fixed: IME commits only within the same input session + non-password + input view shown; Erase all aborts in-flight transcription (`abortAll`) in appScope; orphan-audio sweep; keepAudio respected on failure; maintenance sweep skips the live row; no redirects on the secure client; redacted network errors; cleartext only to private resolved addresses; Keystore wipes the key only on permanent errors; onDestroy cancels keyboard recording; backspace uses tracked selection (no getSelectedText); fallback disclosed in privacy §8.1 + consent string.
- **Merged `android/skeleton` → `main`** (see git log). Remaining next steps below: 3 (emulator smoke), 5 (signed AAB, screenshots, internal track), 6.


Brief: `C:/Users/dkwar/bees/whisperio-android.txt`. Contract: `docs/android/CONTRACT.md` (Opus-reviewed, merged to main 0eb641c).

## Done
- **0) Contract** — merged to `main` (0eb641c). Decisions (queenbee): applicationId `ai.whisperio.mobile`, versionCode 10000 (scheme major*10000+minor*100+patch), Data safety = Audio collected / not shared / not ephemeral; vocabulary = user-generated content, optional.
- **3) Legal** — `docs/privacy.html` Android sections 8–10 (GDPR roles, EUR-Lex-verified quotes, support-email controller, Art. 6(1)(f), 12-month retention, Art. 77 / Prezes UODO, Android vitals). Opus legal review applied; merged to `main` (a65ab29). Notes: `docs/android/privacy-android-notes.md`.
- **1–2) Code skeleton** — branch `android/skeleton` (pushed, NOT merged, NOT compiled):
  - `android/core` (pure Kotlin/JVM): 7 providers, ProviderChain + ChainFactory consent gate, BaseUrlPolicy, two OkHttp clients, redacted ProviderError, KeyValidator, TextCleaner, ProviderCatalog, tests (MockWebServer) + privacy gate test.
  - `android/app`: IME dictation panel, MediaRecorder, DictationController, QS tile + shortcut → DictateActivity, Keystore SecretStore, Room history, onboarding/home/history/settings/about, en+pl strings (154 keys each), unit + Robolectric + Roborazzi tests (no PNG baselines yet).
  - `di/CoreAdapters.kt` reconciled to the real :core API by hand (only file in :app touching :core).
- **4) Release prep** — `release.json` (android), `docs/android/play-data-safety.md`, `android/marketing/play/listing.{en,pl}.md`, `docs/android/review-notes.md`, `docs/android/RELEASE.md`. `release-readiness --platform android`: PASS 18 / WARN 4 / FAIL 0.
  - Personal skill `~/.claude/skills/release-readiness` patched: `accountDeletion.notApplicable`, `play.cleartextException` (+ tests, 54/54 green).
  - Upload keystore: `%USERPROFILE%/.android-keys/whisperio-upload.jks`, alias `whisperio-upload`, SHA-256 `CF:F7:B7:15:FF:B9:EF:79:7D:EE:B4:FF:56:BA:6F:87:92:A0:33:6B:9A:87:61:82:11:9E:A8:9E:0D:AE:D0:3D`. Passwords only in User env `WHISPERIO_KEYSTORE_FILE/_PASSWORD`, `WHISPERIO_KEY_ALIAS/_PASSWORD`. No age CLI → no encrypted copy in bees/secrets (backup task is on Daniel's panel).
  - Daniel's 14 Play Console steps + jks backup: on his panel (queenbee). New owner tasks go to Plaster Królowej db `tasks` (RULES-usage.txt).

## Next (in order)
1. **Gradle gate** (heavy-queue line `workerbee-whisperio-android`, wait for queenbee ping; take lock via heavy-queue.mjs). From `android/`, `JAVA_HOME="C:/Program Files/Android/openjdk/jdk-21.0.8"`:
   `./gradlew :core:test :app:testDebugUnitTest lint :app:assembleDebug` → fix compile errors (first compile — expect several rounds), then `:app:recordRoborazziDebug`, eyeball PNGs, commit baselines, then `:app:verifyRoborazziDebug`. Check exit codes, not log tails. Release lock after.
   Known risks from lanes: `(?U)` regexes in core, MockWebServer 4.12 API (`RecordedRequest.body`), IME ViewTree owners + savedstate imports, Roborazzi qualifier merge, `robolectric.properties` sdk=34, Room `schemas/` dir appears after first build (commit it).
   Small duplication to clean: :app also checks upload size (core already does for OpenAI/Groq/Mistral) — keep one (core).
2. Opus review of the code (one round: security/IME/keys/network focus).
3. Manual emulator smoke (CONTRACT §9): IME in a text field with a real key, password field disables mic, tile flow, erase all; API 34/35/36; TalkBack pass.
4. Merge `android/skeleton` → `main` locally (`git merge --no-ff`, push, verify `rev-parse HEAD == origin/main`) — gh pr create has no permission on this repo.
5. Signed AAB `:app:bundleRelease` (heavy), verify signature, rerun release-readiness, screenshots for listing (app-screenshots skill), internal track upload once Daniel created the app (Free).
6. At public launch (after iOS): privacy.html "being prepared for Google Play" → live wording; Terms §4 add Google Play.

## Worktrees
- `D:/Master/Repo/whisperio-android` — branch `android/skeleton` (this work). Never use the main checkout.
