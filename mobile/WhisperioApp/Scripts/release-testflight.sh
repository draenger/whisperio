#!/usr/bin/env bash
# Whisperio → TestFlight, entirely headless (archive → manual-signed export → upload).
# No Xcode GUI, no interactive login: signs with the ASC API key (App Manager) + the
# distribution cert already in the keychain, and uploads via xcodebuild's App Store Connect
# delivery. Build number is auto-managed by App Store Connect (manageAppVersionAndBuildNumber).
#
# Usage:
#   ./release-testflight.sh              # verify (swift test) → archive → export → upload
#   ./release-testflight.sh --no-verify  # skip the WhisperioKit test gate
set -euo pipefail

# Fail loud: point at the line that aborted instead of dying silently.
trap 'echo "✘ release aborted (line $LINENO)" >&2' ERR

# --- Argument validation (reject typos so we never build an unverified IPA by accident) ---
case "${1:-}" in
  ""|--no-verify) ;;
  *) echo "✘ unknown argument: $1 (expected --no-verify or none)" >&2; exit 2 ;;
esac

REPO="$(cd "$(dirname "$0")/../../.." && pwd)"          # …/whisperio
PROJ="$REPO/mobile/WhisperioApp/WhisperioApp.xcodeproj"
KIT="$REPO/mobile/WhisperioKit"
SCRIPTS="$REPO/mobile/WhisperioApp/Scripts"

# --- Signing material (this machine, account dkwarmaster3@gmail.com / Team 953Q6T2WTB) ---
KEY="$HOME/.appstoreconnect/private_keys/AuthKey_HUMHQQ6DB3.p8"   # App Manager key (can update profiles)
KID="HUMHQQ6DB3"
ISS="ee61e2e6-1f5f-44e8-a4aa-d80fabb8e83d"

# Build products live on DevDisk when it's mounted — the system disk runs chronically full
# (a full startup disk evicts the iOS platform and kills archives), the dev volume doesn't.
if [ -d "/Volumes/DevDisk" ]; then BUILD_ROOT="/Volumes/DevDisk/whisperio-build"; else BUILD_ROOT="$HOME"; fi
mkdir -p "$BUILD_ROOT"
ARCHIVE="$BUILD_ROOT/whisperio-release.xcarchive"
EXPORT_DIR="$BUILD_ROOT/whisperio-export"
DERIVED="$BUILD_ROOT/DerivedData-Release"
EXPORT_OPTS="$SCRIPTS/ExportOptions.plist"

auth=(-allowProvisioningUpdates -authenticationKeyPath "$KEY" -authenticationKeyID "$KID" -authenticationKeyIssuerID "$ISS")

echo "▸ Whisperio → TestFlight (headless)"

# --- Preflight: fail early with a clear message instead of a cryptic xcodebuild error ---
command -v xcodebuild >/dev/null || { echo "✘ xcodebuild not on PATH (install Xcode + command-line tools)"; exit 1; }
[ -f "$KEY" ]         || { echo "✘ ASC key missing: $KEY"; exit 1; }
[ -d "$PROJ" ]        || { echo "✘ Xcode project missing: $PROJ"; exit 1; }
[ -f "$EXPORT_OPTS" ] || { echo "✘ ExportOptions.plist missing: $EXPORT_OPTS"; exit 1; }

# 0. Verify the pure core (fast, catches regressions before a slow archive)
if [[ "${1:-}" != "--no-verify" ]]; then
  echo "▸ swift test (WhisperioKit)…"
  command -v swift >/dev/null || { echo "✘ swift not on PATH (needed for the test gate; use --no-verify to skip)"; exit 1; }
  [ -d "$KIT" ]               || { echo "✘ WhisperioKit package missing: $KIT"; exit 1; }
  if ( cd "$KIT" && swift test >/dev/null ); then
    echo "  ✓ tests green"
  else
    echo "✘ WhisperioKit tests failed — aborting release (re-run with --no-verify to override)"; exit 1
  fi
fi

# 1. Ensure the iOS device platform is present (macOS evicts it when the disk fills)
echo "▸ ensuring iOS platform…"
xcodebuild -downloadPlatform iOS >/dev/null 2>&1 || true

# 2. Archive (ASC-key auth lets automatic signing update profiles without a GUI login)
echo "▸ archiving…"
rm -rf "$ARCHIVE"
xcodebuild -project "$PROJ" -scheme WhisperioApp -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" -derivedDataPath "$DERIVED" archive "${auth[@]}"
[ -d "$ARCHIVE" ] || { echo "✘ archive not produced"; exit 1; }

# 3. Export with MANUAL signing (the pre-created 'WZ AppStore …' profiles) + upload.
#    Manual signing avoids the "Cloud signing permission error" that automatic export hits.
echo "▸ exporting + uploading…"
rm -rf "$EXPORT_DIR"
xcodebuild -exportArchive -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$EXPORT_OPTS" -exportPath "$EXPORT_DIR" "${auth[@]}"

echo "✓ UPLOAD SUCCEEDED — build is processing on App Store Connect (app id 6781780531)."
echo "  It appears in TestFlight as 'processing' then VALID within a few minutes."
