# Whisperio Android — HANDOFF (2026-10-17, end of day)

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
