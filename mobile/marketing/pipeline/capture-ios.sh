#!/bin/bash
# Capture raw iPhone (6.9" = iPhone 17 Pro Max, 1320x2868) and iPad (13" = iPad Pro 13, 2064x2752)
# screens for the App Store set, driven by the DEBUG DesignHarness (WHISPERIO_DESIGN_SCREEN).
#
#   capture-ios.sh [--no-build] [phone|pad|all]     (default: build + all)
# Raw PNGs land in $RAW (simctl cannot write onto /Volumes/DevDisk); compose_ios.py turns them
# into the framed marketing set under ../screenshots/{iphone,ipad}/en/.
set -o pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DD=/Volumes/DevDisk/whisperio-build/DD-shots
APP="$DD/Build/Products/Debug-iphonesimulator/WhisperioApp.app"
PHONE="WZ iPhone 17 Pro Max"      # create once: xcrun simctl create "WZ iPhone 17 Pro Max" "iPhone 17 Pro Max"
PAD="WZ iPad Pro 13"        # create once: xcrun simctl create "WZ iPad Pro 13" "iPad Pro 13-inch (M4)"
RAW="${TMPDIR:-/tmp}/whisperio-ios-raw"; mkdir -p "$RAW"
BUNDLE=ai.whisperio.mobile

BUILD=1; WHICH=all
for a in "$@"; do case "$a" in --no-build) BUILD=0;; phone|pad|all) WHICH=$a;; esac; done
if [ "$BUILD" = 1 ]; then
  xcodebuild -project "$ROOT/mobile/WhisperioApp/WhisperioApp.xcodeproj" -scheme WhisperioApp \
    -destination 'generic/platform=iOS Simulator' -derivedDataPath "$DD" CODE_SIGNING_ALLOWED=NO build \
    | grep -E "error:|BUILD (SUCCEEDED|FAILED)" || exit 1
fi

shot() { # $1 device, $2 screen, $3 outfile
  SIMCTL_CHILD_WHISPERIO_DESIGN_SCREEN="$2" xcrun simctl launch --terminate-running-process "$1" "$BUNDLE" -AppleLanguages "(en)" -AppleLocale en_US >/dev/null || echo "LAUNCH-FAIL $2"
  sleep 5
  xcrun simctl io "$1" screenshot "$RAW/$3" >/dev/null 2>&1 || echo "SHOT-FAIL $3"
}
prep() { # $1 device
  xcrun simctl boot "$1" 2>/dev/null; sleep 8
  # System locale → en_US so the iPad status bar shows an English date (the app's own language is
  # forced per launch below; the status bar follows the device). Needs a reboot to take effect.
  xcrun simctl spawn "$1" defaults write "Apple Global Domain" AppleLanguages -array en
  xcrun simctl spawn "$1" defaults write "Apple Global Domain" AppleLocale -string en_US
  xcrun simctl shutdown "$1"; sleep 3; xcrun simctl boot "$1"; sleep 10
  xcrun simctl install "$1" "$APP"
  xcrun simctl status_bar "$1" override --time "9:41" --batteryState discharging --batteryLevel 100 --cellularBars 4 --wifiBars 3 --dataNetwork wifi 2>/dev/null
  # Pre-seed defaults BEFORE the first launch: a fresh sim has no settings blob, so the stores
  # would default to the iCloud backend and the (entitlement-less) simulator build traps inside
  # CloudKit before any harness code runs. Same three keys DesignHarness.prepareDefaultsIfActive sets.
  xcrun simctl spawn "$1" defaults write "$BUNDLE" whisperio.settings.v1 -data "$(printf '{"storageMode":"onDevice"}' | xxd -p | tr -d '\n')"
  xcrun simctl spawn "$1" defaults write "$BUNDLE" whisperio.setupDone.v1 -bool true
  xcrun simctl spawn "$1" defaults write "$BUNDLE" wz.cloudkit.schema.seeded -bool true
  # warm launch: first run seeds the demo library
  SIMCTL_CHILD_WHISPERIO_DESIGN_SCREEN=home xcrun simctl launch --terminate-running-process "$1" "$BUNDLE" -AppleLanguages "(en)" -AppleLocale en_US >/dev/null; sleep 8
}

if [ "$WHICH" != pad ]; then
  prep "$PHONE"
  for s in home detail models journal keyboard onboarding recap; do shot "$PHONE" "$s" "iphone-$s.png"; done
  xcrun simctl shutdown "$PHONE" 2>/dev/null
fi
if [ "$WHICH" != phone ]; then
  prep "$PAD"
  for s in ipad-library ipad-journal onboarding; do shot "$PAD" "$s" "$s.png"; done
  xcrun simctl shutdown "$PAD" 2>/dev/null
fi

echo "== raw =="; ls -la "$RAW" | awk 'NR>1{print $5, $9}'
