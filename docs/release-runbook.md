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
`.github/workflows/build.yml` (trigger: push to `release`) runs test → 3-OS build matrix → publishes a
GitHub Release tagged from `package.json`. macOS leg signs + notarizes (secrets `CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_API_KEY_*` in GitHub Secrets). Watch: `gh run watch` /
`gh release view vX.Y.Z`. Auto-update picks it up from `latest*.yml` in the release assets.

If the mac leg hangs on notarization it times out at 25 min and the release job doesn't publish —
re-run the failed job, don't re-push.

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
| CloudKit entitlement | **stripped** → app degrades to local store, no cross-device sync | kept |
| Needs | ASC key `HUMHQQ6DB3`, dist cert + `WZ AppStore …` profiles (manual export signing) | Apple ID session in Xcode |
| Use for | quick TF builds without sync | **anything shipped to real users / App Store** |

```bash
cd mobile/WhisperioApp && ./Scripts/release-testflight.sh        # headless; run in background, ~10 min
```
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
- Website: bump `softwareVersion` in `docs/index.html` JSON-LD; add App Store badge/link.
- Start the next version in ASC only when the next build is ready (an open version blocks metadata edits on the live one).

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
