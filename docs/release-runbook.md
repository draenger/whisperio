# Whisperio — release runbook

How a release leaves this repo and reaches users, per platform. Companion to [runbook.md](runbook.md)
(dev/build/config) — this file is only about shipping. Modelled on Zryw's `docs/runbook.md`.

Three independent release tracks. They share one version number in spirit, not in tooling:

| Track | Artifact | Version source | Channel |
|---|---|---|---|
| **Desktop** (Electron) | dmg / NSIS / AppImage+deb | `desktop/package.json` `version` | GitHub Releases + in-app auto-update |
| **iOS + watchOS** | `.ipa` (app, keyboard, widget, watch) | `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in `mobile/WhisperioApp/WhisperioApp.xcodeproj/project.pbxproj` (10 occurrences each — one per target/config) | TestFlight → App Store |
| **macOS native** | `WhisperioMac.app` (same bundle id as iOS) | same pbxproj | TestFlight → Mac App Store |

Identifiers: iOS/Mac bundle `ai.whisperio.mobile`, ASC app id `6781780531`, team `953Q6T2WTB`,
App Group `group.ai.whisperio.mobile`, CloudKit container `iCloud.ai.whisperio.mobile`.

---


> **Version decision 2026-10-17:** the first App Store release of the native apps is **1.0.0** (the app was never public; 1.4.x was the TestFlight/internal numbering). ASC version records were renamed 1.4.1 → 1.0.0 on both platforms; `MARKETING_VERSION = 1.0.0`, `CURRENT_PROJECT_VERSION = 77`. Build 76 (1.4.1) stays only as the external beta already in review. The desktop Electron app keeps its own GitHub-release numbering (v1.3.x), unrelated.

## 0. Before any release — gates

```bash
# desktop (release gate = typecheck + coverage thresholds, same as CI)
cd desktop && npm run typecheck && npm run test:coverage

# mobile domain core
cd mobile/WhisperioKit && swift build && swift test

# mobile app compiles for simulator (catches Swift errors the package tests don't see)
xcodebuild -project mobile/WhisperioApp/WhisperioApp.xcodeproj -scheme WhisperioApp \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath /Volumes/DevDisk/whisperio-build/DD-gate \
  CODE_SIGNING_ALLOWED=NO build | grep -E "error:|BUILD (SUCCEEDED|FAILED)"

# reachability guardians (0 orphans, both platforms)
cd desktop && npx vitest run tests/reachability.spec.ts
mobile/WhisperioApp/Scripts/check-reachability.sh
```

Disk: the system disk is full; every archive / DerivedData path goes under `/Volumes/DevDisk/whisperio-build`.
`git log --oneline main..origin/main` — pull Suzie SDLC commits and merge `fix/*` branches BEFORE cutting,
never after (see `docs/PARITY.md` for the human-gate rule: gates green ≠ human-smoked).

---

## 1. Desktop (Windows / macOS / Linux)

### 1.1 Bump + changelog
1. `desktop/package.json` → `version` (semver).
2. `desktop/CHANGELOG.md` → move *Unreleased* under the new version with the date.
3. Optional: `desktop/docs/release-notes-vX.Y.Z.md` (GitHub release body; the pipeline uses the tag + auto notes otherwise).
4. Commit to `main`, push.

### 1.2 Human smoke (the only manual gate)
Package locally and click through the real app — the click tests drive `_electron`, but nobody has
run the *packaged* build until you do:
```bash
cd desktop && npm run build:mac         # unsigned local dmg is fine for smoke
open dist/*.dmg
```
Smoke list: hotkey → record → paste into another app · Settings opens/persists · Recordings panel
(search, replay, Clean up) · local server start (Windows only) · quit from tray.

### 1.3 Ship
```bash
git push origin main:release
```
`.github/workflows/build.yml` (trigger: push to `release`) runs test -> 3-OS build matrix -> creates a
**DRAFT** GitHub Release tagged from `package.json`, containing the mac zips + Linux AppImage/deb/`latest-linux.yml`
but deliberately **not** the Windows `.exe` / `latest.yml` (CI cannot sign Windows builds; see 1.4). macOS leg signs +
notarizes (secrets `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY_*` in GitHub Secrets). Watch: `gh run watch`.
The release is **not live** until you finish 1.4 and publish the draft. Installed apps only see a release once it is
published.

If the mac leg hangs on notarization it times out at 25 min and the release job doesn't publish —
re-run the failed job, don't re-push.

### 1.4 Signed Windows release (local, Daniel's PC only) - required step of every desktop release
GitHub-hosted runners have no signing cert, so CI never publishes the Windows installer or `latest.yml` (the draft
from 1.3 has none). Installed apps verify every downloaded Windows update against the pinned release signer
(`desktop/src/main/updateSignature/updateVerifier.ts`: SHA-256 of the signer's **SubjectPublicKeyInfo**, plus the
cert thumbprint `2A917C6457B67B928C52413DB00FA34CAAF15206` as a secondary pin; subject `CN=Jarvis (Daniel Kasprzyk)`,
valid to 2031-08-06, in `Cert:\CurrentUser\My`; sha256 only) and **reject** unsigned or foreign-signed installers.
The app also re-verifies the downloaded file right before `quitAndInstall`.
```powershell
cd desktop
npm run typecheck; npm run test:coverage
npm run build:win:signed        # signs with the store cert (signtool via electron-builder), sha256
# verify with the app's OWN verifier (no Windows SDK, no trusted root needed):
npm run verify:signed -- dist\Whisperio-Setup-X.Y.Z.exe     # must print PASS + the pinned SPKI sha256; exit 0
# optional extra check (signtool /pa needs the self-signed root trusted on this machine, else it
# reports "not trusted" even for a good signature - the Node check above is the authoritative one):
signtool verify /pa /v dist\Whisperio-Setup-X.Y.Z.exe
```
Then add the signed files to the draft and publish it:
```powershell
gh release upload vX.Y.Z dist\Whisperio-Setup-X.Y.Z.exe dist\latest.yml     # latest.yml sha512 must match the signed file
gh release edit vX.Y.Z --draft=false
```
Never export the private key. Modelled on Suzie's `scripts/release-desktop.mjs`.

**Failure mode if an installed app rejects an update**: the app shows "Version X couldn't be verified - download it
from the Releases page", remembers X (`userData/rejected-update.json`) and stops re-downloading it. Fix = publish a
correctly signed X+1.

**Certificate renewal / key rotation.** Pins are a list (`PINNED_UPDATE_SIGNERS.spkiSha256`). Order matters:
1. Compute the new cert's SPKI hash (`openssl x509 -in new.cer -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256`,
   or sign once and read it from `npm run verify:signed`'s output with the new pin temporarily added).
2. Ship a release **signed with the OLD cert** whose `updateVerifier.ts` pin list contains BOTH old and new hashes.
3. Wait until users have updated, then sign releases with the new cert; the old pin can be dropped later.
Skipping step 2 strands every installed app (they would reject the new-cert update; users must reinstall manually).
There is **no revocation path** other than shipping a new pin list in a release signed by a still-pinned key; if the
private key is stolen, an attacker who can also control the update feed could push updates until users move off
affected builds, so protect the key and the GitHub release permissions.

**Accepted risks (documented, not fixed):**
- **Linux AppImage updates are unauthenticated** (TLS + sha512 from the same feed; no detached signatures). The app
  therefore never downloads or installs them: it shows "update available - download from Releases" with a link.
  Revisit when detached signatures (e.g. minisign/GPG over the AppImage, verified in-app) exist.
- macOS relies on Apple code signing + notarization (Squirrel.Mac checks the signature).

---

## 2. iOS + watchOS → TestFlight

### 2.1 Bump
`CURRENT_PROJECT_VERSION` must be **higher than the latest build in ASC** (both iOS and Mac share the
number). `MARKETING_VERSION` is the user-facing version (currently `1.4.1`). Bump all occurrences:
```bash
sed -i '' 's/CURRENT_PROJECT_VERSION = 74;/CURRENT_PROJECT_VERSION = 75;/g' mobile/WhisperioApp/WhisperioApp.xcodeproj/project.pbxproj
grep -c "CURRENT_PROJECT_VERSION = 75" mobile/WhisperioApp/WhisperioApp.xcodeproj/project.pbxproj   # expect 10
```

### 2.2 Archive + upload
Two paths — pick by whether the build must carry **CloudKit**:

| | Headless (`whisperio-release` skill / `Scripts/release-testflight.sh`) | Xcode GUI: Product → Archive → Distribute |
|---|---|---|
| CloudKit entitlement | **kept** since the `WZ AppStore mobile 92ab` profile carries `icloud-container-identifiers` (verified 2026-10-14 on build 75: the exported IPA has `icloud-services = CloudKit`, `aps-environment = production`, the App Group; earlier builds from the pre-iCloud profile were stripped) — check with `codesign -d --entitlements :- Payload/WhisperioApp.app` on an export-only run before uploading | kept |
| Needs | ASC key `HUMHQQ6DB3`, dist cert + `WZ AppStore …` profiles (manual export signing) | Apple ID session in Xcode |
| Use for | TF and App Store builds (what shipped 75) | fallback when the headless path can't sign |

```bash
cd mobile/WhisperioApp && ./Scripts/release-testflight.sh        # headless; run in background, ~10 min
```
macOS native (same build number): archive scheme `WhisperioMac` with the same ASC-key auth flags, then
`xcodebuild -exportArchive … -exportOptionsPlist Scripts/ExportOptions-Mac.plist` (manual signing with the
`3rd Party Mac Developer …` certs in `wz-build.keychain` — add it to the search list and unlock it first,
see memory `mac-testflight-pipeline`). On the shared Mac run both archives through
`/Volumes/DevDisk/Projects/.zryw-tools/withlock.sh` + `xcb` (one heavy job at a time); build 75 took
~9 min per platform. TestFlight "what to test" PL/EN goes on the build via `betaBuildLocalizations`
once `processingState` is `VALID`; the internal group `Dev` has access to all builds automatically.
**Preflights (headless script, before the archive):** `Scripts/preflight-cloudkit.sh` refuses to ship when the
diff vs `origin/main` (override: `WZ_RELEASE_BASE_REF`) touches Recording/Digest entity, sync-store or
`CloudKitSchema` code while that entity's row in `CLOUDKIT_SCHEMA_PROMOTION.md` is `PENDING`; any other `PENDING`
row only stops the run until you pass `--allow-pending-schema` (build ships, the schema deploy is what is missing — §2.3).
`Scripts/preflight-signing.sh` checks that the newest installed profile for each name in `ExportOptions.plist` has
its certificate in the keychain search list. Pitfall (build 76, 2026-10-16/17): two profile sets shared the same
names (2026-07-20 → cert in login keychain, 2026-07-23 → cert in `wz-build.keychain-db`); Xcode took the newest
profile but resolved the certificate by name from another keychain and the export failed. The script now adds
`wz-build.keychain-db` to the search list (unlocks it only if `WZ_BUILD_KEYCHAIN_PASSWORD` is set) and aborts early,
listing profile vs local fingerprints. Tests: `Scripts/tests/test-preflight.sh`.
Both paths auto-manage the build number against ASC on export (`manageAppVersionAndBuildNumber`).
`ITSAppUsesNonExemptEncryption = NO` is in the configs, so no export-compliance prompt.

### 2.3 CloudKit schema (once per schema change, BEFORE shipping a sync build)
SwiftData creates the schema only in *Development*. Run **WhisperioMac Debug** (or the iOS Debug app)
once on a device signed into iCloud — the `#if DEBUG` seed writes one record — then CloudKit Console →
**Deploy Schema Changes → Production**. Skipping this = "works in Xcode, nothing syncs on TestFlight".
The Console shows the developer Apple ID's private DB, usually not your test account's — verify sync
device↔device, not in the Console.

### 2.4 Poll processing
```bash
python3 - <<'PY'
import sys; sys.path.insert(0, "mobile/marketing/pipeline"); import asc_common as asc
for b in asc.call("GET", f"{asc.API}/builds?filter[app]={asc.APP_ID}&limit=4&sort=-uploadedDate&fields[builds]=version,processingState,uploadedDate")["data"]:
    print(b["attributes"])
PY
```
`VALID` = installable in TestFlight (Internal group needs no Beta Review). A build that "uploaded"
but never appears = duplicate build number → bump and re-export.

---

## 3. iOS → App Store (first release and every update)

Everything below is idempotent and lives in `mobile/marketing/` (full checklist:
[`mobile/marketing/app-store-listing.md`](../mobile/marketing/app-store-listing.md)).

### 3.1 Version record
ASC needs an editable `appStoreVersion` whose `versionString` equals the build's `MARKETING_VERSION`.
First release: it exists (1.4.1). Updates: create the new version in ASC (App → + Version) or via API,
then attach the build (Build section → pick the `VALID` build).

### 3.2 Listing texts
Edit `mobile/marketing/listing/en-US.json` (add `pl.json` for Polish once the localization exists in ASC), then
```bash
cd mobile/marketing/pipeline
python3 asc_listing.py --dry-run      # per-field diff + length check (30/30/170/100/4000)
python3 asc_listing.py --apply        # writes a _asc-backup-<date>.json first
```
For updates also fill `whatsNew` in the JSON (required from the 2nd version on).

### 3.3 Review notes
`mobile/marketing/app-store-review-notes.md` → `python3 asc_review.py --apply` (iOS + macOS versions).
No demo account, no API key needed: the default engine is Apple on-device speech. Keep the keyboard
Full-Access explanation and the background-mode justifications in there — reviewers ask.

### 3.4 Screenshots
Required sets for this bundle: iPhone 6.9" (1320×2868), iPad 13" (2064×2752), **Apple Watch**
(416×496 — mandatory because the bundle ships a watchOS app). Optional: 6.5", Mac.
```bash
cd mobile/marketing/pipeline
./capture-ios.sh                  # builds DEBUG app → sims "WZ iPhone 17 Pro Max" + "WZ iPad Pro 13" → raw PNGs in $TMPDIR/whisperio-ios-raw
python3 compose_ios.py            # headline/subcopy overlays → ../screenshots/{iphone,ipad}/en/NN-*.png
./capture-watch.sh                # watch app on "Apple Watch Series 10 (46mm)" → ../screenshots/watch/en/
python3 asc_screenshots.py --dry-run && python3 asc_screenshots.py --upload
```
How it works: the DEBUG-only `DesignHarness` (`Sources/WhisperioApp/DesignHarness.swift`) reads
`WHISPERIO_DESIGN_SCREEN` and renders that screen on a deterministic demo library seeded into the real
stores; `capture-ios.sh` pre-seeds three UserDefaults keys via `simctl spawn … defaults write` so the
stores pick the on-device backend (a simulator build has no CloudKit entitlement and traps otherwise).
Copy lives in `compose_ios.py` → `COPY`. `asc_screenshots.py` skips files already present by name — to
**replace** a set, delete it in ASC first (or pass `--replace`, which deletes and re-uploads).
The simulators cannot write onto `/Volumes/DevDisk`; raws go to `$TMPDIR`.

### 3.5 Pricing, availability, rights, age rating
Already set via API for 1.4.1 (free / 175 territories / no third-party content / 4+). They persist
across versions; only re-check if you add IAP or change territories.

### 3.6 ASC web UI only (no public API) — do these by hand
1. **App Privacy** → "Data Not Collected" (no server, keys in Keychain, iCloud = user's private DB).
2. **EU DSA trader status** → see 3.6.1 below. Without a declared status the app is hidden from EU storefronts.
3. Version page → **Add for Review → Submit**. Release type on the version is *automatic after
   approval*; set *manual* if you want to pick the day.

#### 3.6.1 Trader status (Digital Services Act) — account-wide, switchable any time
- The status lives on the **developer account** (App Store Connect → Business → the account holder's
  Digital Services Act section), not on the app. It applies to every app on team `953Q6T2WTB` at once —
  Whisperio **and Zryw**.
- **Non-trader** is legitimate only for non-commercial activity: free app, no ads, no IAP, no promotion of a
  business. Whisperio alone qualifies. **Zryw does not** (Zryw Pro subscription), so the moment Zryw ships
  the account must be a trader — and Whisperio inherits that automatically.
- **Switching non-trader → trader** is a settings change, not a resubmission: fill address + phone + email,
  confirm the phone and e-mail via the codes Apple sends, done; nothing in the app or the version record
  changes and no new review is triggered. The verified contact details are then shown **publicly** on
  every EU product page of every app on the account — as an individual that means your own name/address,
  so use a dedicated phone number and mailbox for it.
- Trader → non-trader is possible too, but only if nothing on the account monetises.
- Recommendation: since Zryw forces trader anyway, set trader once and be done for both apps. If you want
  to postpone handing over contact details until Zryw launches, declare non-trader for Whisperio now and
  flip later — both are safe for App Review.

### 3.7 After approval
- Tag the repo: `git tag ios-v1.4.1-b74 && git push --tags`.
- Website: flip the App Store flag (3.8). On later releases bump `softwareVersion` of the `MobileApplication` node in `docs/index.html` JSON-LD.
- Start the next version in ASC only when the next build is ready (an open version blocks metadata edits on the live one).

### 3.8 Website App Store flag
The iPhone section (`#ios` in `docs/index.html`) shows "Coming soon to the App Store" as a non-link label until the app is live, because `https://apps.apple.com/app/id6781780531` 404s before release. On release day, once that URL opens in a browser:
1. In `docs/index.html` set `data-appstore-live="true"` on `<html>` (the id stays in `data-appstore-id`). The inline script at the end of `<body>` turns the badge into a "Download on the App Store" link and adds `installUrl`/`downloadUrl` to the `MobileApplication` JSON-LD.
2. Add `<meta name="apple-itunes-app" content="app-id=6781780531">` to `<head>` (Safari's smart banner reads it at load, so it can't come from the script).
3. Make the link static too, so crawlers, link previews and no-JS visitors see it:
   - In the `#ios` badge markup, change the `<span ... data-appstore-badge aria-disabled="true">` to `<a ... data-appstore-badge href="https://apps.apple.com/app/id6781780531">` and the label to "Download on the App Store".
   - In the JSON-LD `MobileApplication` node, add `"installUrl"` and `"downloadUrl"` with the same URL.
   - The inline script then has nothing to do, which is fine.
4. Legal pages: in `docs/privacy.html` and `docs/terms.html` (line ~71) change "for iPhone, iPad and Apple Watch (to be distributed through the App Store, bundle ID …; <span data-appstore-status>coming soon</span>)" to "for iPhone, iPad and Apple Watch (App Store, bundle ID …)". Bump "Last updated" on both.
5. Search/share metadata in `docs/index.html` `<head>`: `<title>` → "Whisperio — Free Dictation for iPhone, Mac, Windows &amp; Linux"; in `description`, `og:description` and `twitter:description` replace "Free dictation for Mac, Windows and Linux with your own AI key or offline local models. iPhone, iPad and Apple Watch coming to the App Store." with "Free dictation for iPhone, iPad, Apple Watch, Mac, Windows and Linux. On-device speech, offline local models or your own AI key."
6. `node docs/launch/1.4.1/tools/check-site.mjs` must give `RESULT: PASS` (with the flag ON it requires the banner with the same id). Commit to `main`; GitHub Pages deploys it.
7. TestFlight public link (optional, independent of the flag above): once a public link is enabled for the "Beta" group in App Store Connect (TestFlight -> group -> Public Link), set `data-testflight-url="https://testflight.apple.com/join/XXXX"` on `<html>` in `docs/index.html`. The inline script at the end of `<body>` then shows a "Join the TestFlight beta" link in `#ios`. Empty (default) = nothing is rendered, no placeholder, no dead link; the script ignores any value that does not start with `https://testflight.apple.com/`. Unset the attribute (back to `""`) when the beta ends or the link is disabled. Run `node docs/launch/1.4.1/tools/check-site.mjs` (must stay `RESULT: PASS`) and commit to `main`.

---

## 4. macOS native → Mac App Store (not yet shipped)

Same ASC app, separate `appStoreVersion` (platform `MAC_OS`, 1.4.1, build 74 attached, description + review
notes in place). Missing: **Mac screenshots** (1280×800 / 1440×900 / 2560×1600 / 2880×1800 — one size is
enough). Capture the archived `WhisperioMac.app`
(`/Volumes/DevDisk/whisperio-build/whisperio-mac.xcarchive/Products/Applications`), add an `APP_DESKTOP`
entry to `SETS` in `asc_screenshots.py`, upload with `--platform MAC_OS`, then submit that version
separately. The Mac TestFlight pipeline (keychain `wz-build.keychain`, `ExportOptions-Mac.plist`, MAS
certs/profile) is documented in the `mac-testflight-pipeline` memory + `runbook.md`.

---

### 4.1 Mac App Store launch day — wording sweep
Until the macOS 1.4.1 version is live, every public text must speak of the Mac App Store app in the future tense (App Review 2.3: "make sure all your app metadata, including privacy information, your app description, screenshots, and previews accurately reflect the app's core experience"; 2.3.1(a): marketing "content or services that it does not actually offer" is grounds for removal). The desktop Electron app for macOS (dmg in the GitHub release) is a different, already available product and may be called "Mac" in the desktop context.
Trigger: the `MAC_OS` appStoreVersion in App Store Connect reaches `READY_FOR_SALE` and the product page shows the Mac platform (the `apps.apple.com/app/id6781780531` URL alone is not a signal — the Mac version shares the iOS app id, so it opens as soon as iOS is live). If iOS is not live yet, do §3.8 first or apply the line-71 changes of both sections together. Flip everything in ONE commit:
1. `docs/index.html`: add the Mac App Store badge/link next to the iOS one (same `data-appstore-*` mechanism as §3.8); title / `description` / `og:description` / `twitter:description` may then say "Mac" for the App Store app as well as the desktop app; JSON-LD `MobileApplication.operatingSystem` adds `macOS 14` (= `MACOSX_DEPLOYMENT_TARGET` in `project.pbxproj`, not the current OS version).
2. `docs/privacy.html`: meta description (line ~7) "iPhone, iPad and Apple Watch (coming to the App Store) and for desktop…" → "iPhone, iPad, Apple Watch and Mac (App Store) and for desktop…"; §1 (~71) availability sentence → add "and Mac", delete "A Mac App Store version is coming."; §3 API keys (~90) "(and in the Mac App Store app, once released)" → "On iPhone, iPad, Apple Watch and Mac"; §3 paths (~97) "macOS (Mac App Store app, once released)" → "macOS (Mac App Store app)"; §4.1 (~105) "the Mac App Store app, once released, will use the same default" → "default on iPhone, iPad, Apple Watch and Mac"; §4.2 (~121) "and in the Mac App Store app once released" → "iPhone, iPad, Apple Watch and Mac"; §5 (~131) "(and, once released, the Mac App Store app)" → "On iPhone, iPad and Mac". Bump "Last updated".
3. `docs/terms.html` §1 (~71): same availability sentence as privacy §1, delete "A Mac App Store version is coming.". Bump "Last updated".
4. `docs/support.html` (~78 and any FAQ answer that says "once released").
5. `mobile/marketing/listing/en-US.json` (and a PL listing if one exists by then): "Mac" in promotionalText / description ("iPhone, iPad, Mac, and Apple Watch", "syncs across iPhone, iPad, and Mac", "Native Mac app with global hotkeys") is allowed only once the Mac app is live; push with `asc_listing.py --apply`. Since 2026-10-16 the iOS listing carries no Mac claims, and `check-aso` (`ios-first`) fails on any Mac/macOS in `listing/*.json` until `MAC_APP_STORE_LIVE` in `docs/launch/1.4.1/tools/check-aso.mjs` is set to `true` in this same commit. `--platform MAC_OS` needs its own Mac listing text; do not push the iPhone/iPad text to the Mac version.
6. `docs/PARITY.md` and `mobile/marketing/app-store-listing.md` §"macOS": status lines.
7. In-app: the About links in `SettingsView` and `MacSettingsShell.swift` are platform-neutral — no change.
Verification: `grep -nE '\bMac\b|once released|coming soon|is coming' docs/*.html mobile/marketing/listing/*.json` — a person reads the list (desktop "Mac" mentions are legitimate) and confirms no future-tense leftovers; then `node docs/launch/1.4.1/tools/check-site.mjs` → `RESULT: PASS`.

## 5. Rollback / hotfix

- **Desktop**: GitHub Release → mark the bad release as pre-release or delete its `latest*.yml`; auto-update
  stops offering it. Ship the fix as a new patch version through `release`.
- **iOS/Mac**: App Store → Pricing & Availability → *Remove from sale* is the emergency brake; otherwise
  expedited review with a new build (Contact Us → request expedited).
- **TestFlight**: expire the bad build in ASC (Builds → build → Expire); testers fall back to the previous one.

## 6. Credentials map (never in the repo)

| What | Where |
|---|---|
| ASC API key `HUMHQQ6DB3` (.p8) | `~/.appstoreconnect/private_keys/` — issuer `ee61e2e6-…` |
| iOS dist cert / profiles | login keychain + `~/Library/MobileDevice/Provisioning Profiles` (`WZ AppStore …`) |
| Mac App Store certs/profile | `wz-build.keychain` (see memory `mac-testflight-pipeline`) |
| Desktop signing + notarization | GitHub Secrets on `draenger/whisperio` |
| Provider API keys | never — users bring their own; OS secure storage at runtime |
