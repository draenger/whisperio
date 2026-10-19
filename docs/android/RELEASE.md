# Whisperio for Android - release runbook (1.0.0, `ai.whisperio.mobile`)

Companion to `docs/release-runbook.md` (desktop / iOS / macOS) and `docs/android/CONTRACT.md` (section 10).
Legend: **[REPO]** = done by an agent/CI in this repo, **[DANIEL]** = only the owner can do it (Play Console account,
keys, forms). Nothing here is run automatically; every gradle run is a heavy job (one at a time, see CONTRACT 3).

Whisperio is **free**: no billing, no ads, no account. Public production launch happens **only after the iOS launch**
(one launch at a time); until then the Android app lives on internal / closed testing.

## 1. Facts

| Item | Value |
|---|---|
| applicationId | `ai.whisperio.mobile` (permanent once uploaded) |
| Version source | `android/app/version.properties` (`versionCode=10000`, `versionName=1.0.0`) |
| Artifact | AAB: `android/app/build/outputs/bundle/release/app-release.aab` |
| JDK | 21 at `C:/Program Files/Android/openjdk/jdk-21.0.8` |
| Upload keystore | `%USERPROFILE%\.android-keys\whisperio-upload.jks`, alias `whisperio-upload` |
| Upload cert SHA-256 | `CF:F7:B7:15:FF:B9:EF:79:7D:EE:B4:FF:56:BA:6F:87:92:A0:33:6B:9A:87:61:82:11:9E:A8:9E:0D:AE:D0:3D` |
| Signing inputs (User env vars, never in repo) | `WHISPERIO_KEYSTORE_FILE`, `WHISPERIO_KEYSTORE_PASSWORD`, `WHISPERIO_KEY_ALIAS`, `WHISPERIO_KEY_PASSWORD` |
| Manifest for the gate | `release.json` (`platforms.android`) |
| Console texts | `android/marketing/play/listing.{en,pl}.md`, `docs/android/play-data-safety.md`, `docs/android/review-notes.md` |

Signing is read in `android/app/build.gradle.kts:11-28` (gitignored `android/keystore.properties` first, then the env vars).
If any of the four values is missing the release build is produced **unsigned** instead of failing - always run the
signature check in `docs/android/INTERNAL-TRACK.md` so an unsigned AAB is never uploaded.

## 2-3. Build and verify the AAB [REPO]

Moved to `docs/android/INTERNAL-TRACK.md` (exact build command with JAVA_HOME and gradle caps, signature check against the
upload cert above, bundletool smoke, hand-over folder). Keep one copy only. Unsigned builds are not an error in gradle: the
signature check there is mandatory.

## 4. Release-readiness gate [REPO]

```bash
node ~/.claude/skills/release-readiness/tools/check.mjs . --platform android --offline   # first pass, no network
node ~/.claude/skills/release-readiness/tools/check.mjs . --platform android --last-build <last uploaded versionCode>
```

Report the table verbatim. Known, accepted/explained results for Whisperio (see `release.json` `notes`):

| Check | Expected | Why |
|---|---|---|
| `play-cleartext` | FAIL by design | `network_security_config.xml` has `cleartextTrafficPermitted="true"` in base-config; accepted exception, rationale in CONTRACT 4.3 and `release.json` notes (two-client guard in `HttpClients.kt`). The gate has no allow-list for it yet. |
| `account-deletion`, `account-deletion-web` | FAIL / not applicable | Whisperio has no account; the gate cannot express "not applicable" yet. |
| `legal-urls` | must PASS online | privacy/terms/support pages must return 200 (and the privacy page must contain the Android section, see below). |

Everything else must be PASS; investigate every other FAIL.

## 5. Bump the build [REPO]

Play rejects a `versionCode` that is <= any previously uploaded one.

```bash
node ~/.claude/skills/release-readiness/tools/bump-build.mjs . --platform android            # dry-run, prints the diff
node ~/.claude/skills/release-readiness/tools/bump-build.mjs . --platform android --write    # versionCode + 1
```

`versionName` (1.0.0) is edited by hand in `android/app/version.properties` for a new marketing version
(scheme `major*10000 + minor*100 + patch`, so 1.0.1 -> 10001 or higher). First upload of 1.0.0 may stay at `10000`.
Never reuse a versionCode even if the upload was rejected after processing.

## 6. [DANIEL] Play Console steps

Do these in order. Console menu names change; follow the intent.

1. **[DANIEL] Developer account.** Google Play Console account ($25 one-time) with identity verification (takes days).
   Note whether it is a **personal** or **organization** account (decides step 15). Confirm the support e-mail.
2. **[DANIEL] Create the app.** Name `Whisperio`, default language English (United States) or Polish (pick one; the other
   is added as a translation in step 5), type **App** (not Game), **Free** - this is permanent, a free app can never become
   paid. Accept the declarations (Developer Program Policies, US export laws).
3. **[DANIEL] Play App Signing.** Test and release > App integrity: keep the default "Use Google-generated app signing
   key"; the key in `whisperio-upload.jks` is the **upload key** only. On the first AAB upload Play registers its
   certificate. Keep a backup of the keystore and password outside the repo (the upload key can be reset via Play
   support, the signing key cannot be lost).
4. **[REPO]** Prepare the signed AAB and the gate result per `docs/android/INTERNAL-TRACK.md`; hand over `app-release.aab`.
5. **[DANIEL] Main store listing.** Grow > Store presence > Main store listing: copy **App name**, **Short description**,
   **Full description** from `android/marketing/play/listing.en.md` (default language) and add a Polish translation from
   `android/marketing/play/listing.pl.md`. Category Productivity, contact e-mail `daniel@danielkasprzyk.com`, website
   `https://whisperio.danielkasprzyk.com/`. Upload the 512x512 icon, the 1024x500 feature graphic and phone
   screenshots (min. 2); [REPO] produces them with `/app-screenshots` once the UI is final.
6. **[DANIEL] App content > Privacy policy:** `https://whisperio.danielkasprzyk.com/privacy.html`. Land the Android
   section of `docs/privacy.html` first (CONTRACT 8.2) - Play compares policy and Data safety form.
7. **[DANIEL] App content > Ads:** **No**, the app contains no ads.
8. **[DANIEL] App content > App access:** "All or some functionality is restricted". Paste the instructions block from
   `docs/android/review-notes.md` section 3 and replace the placeholder with the **reviewer API key** (a low-limit
   Groq free key or a budget-capped OpenAI key, created by Daniel; never committed).
9. **[DANIEL] App content > Content rating:** run the IARC questionnaire (category: utility/productivity; no violence,
   sexual content, gambling, user-to-user communication; no location sharing; no digital purchases). Expected result:
   Everyone / PEGI 3 equivalent.
10. **[DANIEL] App content > Target audience and content:** target age **13+** (13-15, 16-17, 18+); do **not** select
    children under 13 or "mainly for children"; not in the Families programme.
11. **[DANIEL] App content > Data safety:** answer exactly per `docs/android/play-data-safety.md` (Voice or sound
    recordings: collected, not shared, not ephemeral, required, App functionality; Other user-generated content / custom
    vocabulary: collected, not shared, not ephemeral, optional, App functionality; encrypted in transit: yes; no
    account, so no deletion URL). Check that the preview does NOT read "No data collected".
12. **[DANIEL] App content > Government apps = No; Financial features = none / not a financial app; Health = not a
    health app; News app = No; COVID-19 = not applicable.** Also: no advertising ID use (declare "No" to the
    advertising-ID question; the manifest has no `AD_ID`).
13. **[DANIEL] Testing > Internal testing:** follow `docs/android/INTERNAL-TRACK.md` (track, testers, upload, release notes, roll out), then
    install through the opt-in link and run the manual smoke from `docs/android/CONTRACT.md` section 9 (enable keyboard,
    dictate with a real key, tile flow, erase all) on a real device from Play.
14. **[DANIEL] Pre-launch report:** read the report Play generates for the internal build (crashes, accessibility,
    permission warnings) and hand findings to [REPO].
15. **[DANIEL] Closed testing (personal accounts created after 2023-11-13 only):** production access requires a closed
    test with **at least 12 testers opted in continuously for 14 days** (Console > Dashboard > "Set up your app" shows
    the requirement). Start this ahead of the planned launch: recruit 12+ testers, create a closed track, upload the
    same/newer AAB, add the testers (Google Group or e-mail list), keep it running 14 days, then apply for production
    access. Organization accounts are exempt; check the account type from step 1.
16. **[DANIEL] Production:** create the production release **only after the iOS launch** (one launch at a time).
    Use staged rollout (e.g. 20% -> 100%), release notes from the listing files, submit for review (can take several
    days for a new app). Bump the versionCode first if the AAB changed (section 5).

## 7. After release [REPO]

- Record the uploaded versionCode so the next gate run uses `--last-build`.
- Rotate/delete the reviewer API key once Play review is done.
- Each summer after Google announces the new target API level: bump `requiredTargetSdk` in `release.json` and
  `targetSdk` in `android/app/build.gradle.kts`, re-run the gate.
