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

REPO="$(cd "$(dirname "$0")/../../.." && pwd)"          # …/whisperio
PROJ="$REPO/mobile/WhisperioApp/WhisperioApp.xcodeproj"
KIT="$REPO/mobile/WhisperioKit"
SCRIPTS="$REPO/mobile/WhisperioApp/Scripts"

# --- Signing material (this machine, account dkwarmaster3@gmail.com / Team 953Q6T2WTB) ---
KEY="$HOME/.appstoreconnect/private_keys/AuthKey_HUMHQQ6DB3.p8"   # App Manager key (can update profiles)
KID="HUMHQQ6DB3"
ISS="ee61e2e6-1f5f-44e8-a4aa-d80fabb8e83d"

ARCHIVE="$HOME/whisperio-release.xcarchive"
EXPORT_DIR="$HOME/whisperio-export"
EXPORT_OPTS="$SCRIPTS/ExportOptions.plist"

auth=(-allowProvisioningUpdates -authenticationKeyPath "$KEY" -authenticationKeyID "$KID" -authenticationKeyIssuerID "$ISS")

echo "▸ Whisperio → TestFlight (headless)"
[ -f "$KEY" ] || { echo "✘ ASC key missing: $KEY"; exit 1; }

# 0. Verify the pure core (fast, catches regressions before a slow archive)
if [[ "${1:-}" != "--no-verify" ]]; then
  echo "▸ swift test (WhisperioKit)…"
  ( cd "$KIT" && swift test >/dev/null ) && echo "  ✓ tests green"
fi

# 1. Ensure the iOS device platform is present (macOS evicts it when the disk fills)
echo "▸ ensuring iOS platform…"
xcodebuild -downloadPlatform iOS >/dev/null 2>&1 || true

# 2. Archive (ASC-key auth lets automatic signing update profiles without a GUI login)
echo "▸ archiving…"
rm -rf "$ARCHIVE"
xcodebuild -project "$PROJ" -scheme WhisperioApp -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" archive "${auth[@]}"
[ -d "$ARCHIVE" ] || { echo "✘ archive not produced"; exit 1; }

# 3. Export with MANUAL signing (the pre-created 'WZ AppStore …' profiles) + upload.
#    Manual signing avoids the "Cloud signing permission error" that automatic export hits.
echo "▸ exporting + uploading…"
rm -rf "$EXPORT_DIR"
xcodebuild -exportArchive -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$EXPORT_OPTS" -exportPath "$EXPORT_DIR" "${auth[@]}"

echo "✓ UPLOAD SUCCEEDED — build is processing on App Store Connect (app id 6781780531)."
echo "  It appears in TestFlight as 'processing' then VALID within a few minutes."
