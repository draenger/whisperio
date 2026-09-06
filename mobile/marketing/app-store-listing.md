# Whisperio — App Store release (iOS 1.4.1 / build 74)

Mirror of the Zryw process (`~/Projects/husar/marketing/`): listing texts live in
`listing/<locale>.json`, screenshots in `screenshots/<device>/<lang>/`, and everything is
pushed to App Store Connect with the scripts in `pipeline/` (same ASC API key as the TestFlight
pipeline; `cryptography` is the only Python dependency, requests go through `curl`).

App id `6781780531` · bundle `ai.whisperio.mobile` · free · no IAP · no account.

## Pipeline

| Script | What it does |
|---|---|
| `pipeline/asc_listing.py --dry-run / --apply` | name, subtitle, privacy URL, description, keywords, promo, what's new, URLs |
| `pipeline/asc_review.py --dry-run / --apply` | App Review contact + notes from `app-store-review-notes.md` (iOS + macOS versions) |
| `pipeline/asc_screenshots.py --dry-run / --upload [--only TYPE]` | uploads missing screenshots (idempotent by file name) |
| `pipeline/capture-watch.sh` | builds the watch app for the simulator, captures idle/recording/done via the DEBUG harness, stamps 9:41 |

## Done via the API (2026-09-06)

- [x] Version string `1.0` → `1.4.1` on both the iOS and macOS records (matches build 74's `CFBundleShortVersionString`).
- [x] Build 74 attached to both versions; `usesNonExemptEncryption = false` (no export-compliance prompt).
- [x] Listing (en-US): name, subtitle, description, keywords, promo text, support/marketing/privacy URLs — all present, saved to `listing/en-US.json`.
- [x] Price schedule: **Free** (tier 0, base territory USA).
- [x] Availability: all 175 territories, auto-available in new ones.
- [x] Content rights: does not use third-party content.
- [x] Age rating questionnaire: all "none/no" → **4+**.
- [x] App Review information: contact + notes (no demo account, no API key needed — default engine is Apple on-device speech).
- [x] Screenshots: iPhone 6.9" ×5, iPad 13" ×5 (from July), **Apple Watch Series 10 ×3 (new)** — required because the bundle ships a watchOS app.
- [x] Privacy policy URL returns 200.
- [x] EULA: Apple standard.

## Left for the ASC web UI (no public API)

1. **App Privacy** (nutrition labels): App Store Connect → App → App Privacy → "Data Not Collected".
   Whisperio runs no server; audio goes only to a provider the user configured, keys stay in the Keychain,
   iCloud sync uses the user's private CloudKit database. Nothing is collected by the developer or an SDK.
2. **EU Digital Services Act — trader status**: Business → Agreements / App → Distribution. A free,
   non-commercial hobby app by an individual → declare **non-trader**. Without this the app is not
   shown in EU storefronts.
3. Then on the version page: **Add for Review → Submit**. Release type is currently
   *automatic after approval*; switch to *manual* on the version page if you want to control the day.

## Free app — what does NOT apply

No Paid Applications Agreement, no banking/tax forms, no IAP review. Only the free Apple Developer
Program License Agreement (already accepted — builds upload fine).

## Screenshot pipeline (done 2026-09-06)

iPhone 6.9" ×6 and iPad 13" ×4 are now composed marketing shots (headline + subcopy + floating device,
9:41 clock, deterministic demo library), produced by `pipeline/capture-ios.sh` → `pipeline/compose_ios.py`
→ `pipeline/asc_screenshots.py --upload --replace`. Story order: Home (hero) · Keyboard/any app ·
Engines & keys · Journal · Recap · Private by design. Copy lives in `compose_ios.py` → `COPY`.

Still optional: Polish localization (Zryw ships en-US + pl), app preview video, 6.5" set (Apple
downscales 6.9" for older phones).

## macOS (Mac App Store) — separate submission, not ready

Version 1.4.1 exists with build 74 attached, description and review notes are in place, but there are
**no Mac screenshots** (needs 1280×800 / 1440×900 / 2560×1600 / 2880×1800). Capture the native
`WhisperioMac.app` from the archive at `/Volumes/DevDisk/whisperio-build/whisperio-mac.xcarchive`
and upload with `asc_screenshots.py --platform MAC_OS` after adding an `APP_DESKTOP` entry to `SETS`.
Ship iOS first.
