# Whisperio Android - internal track 1.0.0 (one-page checklist)

Scope: first upload to Play **Internal testing**. Context and the full Console walkthrough: `docs/android/RELEASE.md`
(facts, gate expectations, bump, later tracks). Console field values: `docs/android/PLAY-CONSOLE-PASTE.md`.
Version: `versionCode 10000` / `versionName 1.0.0` (`android/app/version.properties`, matches `release.json`).

## Pre-flight gates (all must PASS before the AAB goes to Daniel)

| # | Gate | PASS criteria |
|---|---|---|
| 1 | Signing env | 4 User env vars `WHISPERIO_KEYSTORE_FILE/_PASSWORD`, `WHISPERIO_KEY_ALIAS/_PASSWORD` all print SET (values never printed) |
| 2 | Test gate | `./gradlew test lint :app:verifyRoborazziDebug :app:assembleDebug` exit code 0 |
| 3 | Bundle built | `bundleRelease` exit 0, `app-release.aab` exists; R8 produced no "missing class" error |
| 4 | Signature | `jarsigner -verify` prints `jar verified.` and the cert SHA-256 equals the upload cert below |
| 5 | Install smoke | bundletool APKs install on the emulator; app launches, IME listed, tile/shortcut present, a recording-less flow (settings, history, erase all) works in **release** (R8) - no crash |
| 6 | Release-readiness | `check.mjs . --platform android` -> only the documented accepted results (RELEASE.md section 4); `play-listing`, `play-target-sdk`, `play-release-build`, `play-data-safety` PASS |
| 7 | Version | versionCode > last uploaded (first upload: 10000 is fine); versionName 1.0.0 |
| 8 | Notes | release notes <=500 chars per language (en-US 288, pl-PL 324) |

Upload cert SHA-256: `CF:F7:B7:15:FF:B9:EF:79:7D:EE:B4:FF:56:BA:6F:87:92:A0:33:6B:9A:87:61:82:11:9E:A8:9E:0D:AE:D0:3D`

## [REPO] (bee, on the PC)

Heavy job: one gradle at a time (CONTRACT 3). PowerShell from the repo root.

```powershell
# 1. env check (SET/MISSING only)
'WHISPERIO_KEYSTORE_FILE','WHISPERIO_KEYSTORE_PASSWORD','WHISPERIO_KEY_ALIAS','WHISPERIO_KEY_PASSWORD' |
  ForEach-Object { '{0}: {1}' -f $_, $(if ([Environment]::GetEnvironmentVariable($_, 'User')) {'SET'} else {'MISSING'}) }

# 2. test gate, then the bundle (JDK 21, capped gradle)
$env:JAVA_HOME = 'C:\Program Files\Android\openjdk\jdk-21.0.8'
cd android
./gradlew -Dorg.gradle.workers.max=2 -Dorg.gradle.jvmargs=-Xmx3g test lint :app:verifyRoborazziDebug :app:assembleDebug
./gradlew -Dorg.gradle.workers.max=2 -Dorg.gradle.jvmargs=-Xmx3g :app:bundleRelease
cd ..
```

New shells only see User env vars set before they started. Missing any of the four = **unsigned** AAB (build still succeeds): gate 4 catches it.

```powershell
# 3. verify signature (an AAB is a jar; apksigner only handles APKs, so use jarsigner + keytool)
$jdk = 'C:\Program Files\Android\openjdk\jdk-21.0.8\bin'
$aab = 'android\app\build\outputs\bundle\release\app-release.aab'
& "$jdk\jarsigner.exe" -verify -verbose:summary -certs $aab     # "jar verified."
& "$jdk\keytool.exe" -printcert -jarfile $aab                   # SHA256 must equal the upload cert above

# 4. smoke: bundle -> APK set for the connected emulator (debug-signed, default ks) -> install
java -jar bundletool.jar build-apks --bundle=$aab --output=$env:TEMP\w.apks --connected-device --overwrite
java -jar bundletool.jar install-apks --apks=$env:TEMP\w.apks
```

```bash
# 5. release gate (offline first, then online for legal-urls)
node ~/.claude/skills/release-readiness/tools/check.mjs . --platform android --offline
node ~/.claude/skills/release-readiness/tools/check.mjs . --platform android
```

6. Hand over: copy `app-release.aab` to `C:/Users/dkwar/bees/whisperio-play-assets/` as `whisperio-1.0.0-10000.aab`, next to
   `android/marketing/play/release-notes/1.0.0/{en-US,pl-PL}.txt`. Also keep `app/build/outputs/mapping/release/mapping.txt`
   (Play receives it inside the AAB; keep a copy for local deobfuscation). Report the gate table verbatim.

## [DANIEL] Play Console clicks only

Prereqs from RELEASE.md section 6 steps 1-3 (account, app created Free, Play App Signing default). Field values: `PLAY-CONSOLE-PASTE.md`.

1. Test and release > Testing > **Internal testing** > Create track (if not yet created).
2. **Testers** tab: create an e-mail list (yours + a few devices), save, copy the opt-in link.
3. **Create new release** > upload `whisperio-1.0.0-10000.aab` from `whisperio-play-assets`. Accept the Play App Signing prompt.
4. Release name: leave the default (`10000 (1.0.0)`). **Release notes**: paste the block below.
5. Next > resolve any blocking errors > **Save** > **Roll out to Internal testing**.
6. Open the opt-in link on the phone, install from Play, tell the bee the result; later read the Pre-launch report.

Release notes to paste (Play tag format; each part <=500 chars: en-US 288, pl-PL 324; whole block 647):

```
<en-US>
First release of Whisperio for Android.
- Dictation keyboard, Quick Settings tile and launcher shortcut
- Bring your own API key: OpenAI, Groq, Mistral, ElevenLabs, Deepgram, AssemblyAI or your own server
- Local history with copy, share and retry
- Free, no account, no ads, no analytics
</en-US>
<pl-PL>
Pierwsza wersja Whisperio na Androida.
- Klawiatura do dyktowania, kafelek w szybkich ustawieniach i skrót na ekranie głównym
- Własny klucz API: OpenAI, Groq, Mistral, ElevenLabs, Deepgram, AssemblyAI lub własny serwer
- Lokalna historia z kopiowaniem, udostępnianiem i ponawianiem
- Za darmo, bez konta, reklam i analityki
</pl-PL>
```

Closed testing (12 testers x 14 days, personal accounts) and production stay in RELEASE.md section 6, steps 15-16.
