#!/bin/bash
# Capture the three Apple Watch App Store screenshots (Series 10 46mm = 416x496 px)
# from the watchOS simulator, then stamp the marketing 9:41 clock (watchOS has no
# status-bar override). States come from the DEBUG-only harness in
# WhisperioWatchApp.swift (WHISPERIO_WATCH_STAGE=recording|done) — no paired iPhone needed.
#
#   mobile/marketing/pipeline/capture-watch.sh            # build + capture + stamp
#   mobile/marketing/pipeline/capture-watch.sh --no-build
set -o pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WATCH="Apple Watch Series 10 (46mm)"
DD=/Volumes/DevDisk/whisperio-build/DD-watch-shots
APP="$DD/Build/Products/Debug-watchsimulator/WhisperioWatch Watch App.app"
RAW="${TMPDIR:-/tmp}/whisperio-watch-raw"; mkdir -p "$RAW"   # simctl can't write onto DevDisk
OUT="$ROOT/mobile/marketing/screenshots/watch/en"; mkdir -p "$OUT"

if [ "$1" != "--no-build" ]; then
  xcodebuild -project "$ROOT/mobile/WhisperioApp/WhisperioApp.xcodeproj" -scheme "WhisperioWatch Watch App" \
    -destination 'generic/platform=watchOS Simulator' -derivedDataPath "$DD" CODE_SIGNING_ALLOWED=NO build \
    | grep -E "error:|BUILD (SUCCEEDED|FAILED)" || exit 1
fi

xcrun simctl boot "$WATCH" 2>/dev/null; sleep 8
xcrun simctl install "$WATCH" "$APP"
# cold-start warmup: the first launch after boot shows a spinner far longer than any capture sleep
xcrun simctl launch --terminate-running-process "$WATCH" ai.whisperio.mobile.watchkitapp >/dev/null; sleep 12
shot() { # $1 stage ("" = idle), $2 outfile
  SIMCTL_CHILD_WHISPERIO_WATCH_STAGE="$1" xcrun simctl launch --terminate-running-process "$WATCH" ai.whisperio.mobile.watchkitapp >/dev/null
  sleep 6
  xcrun simctl io "$WATCH" screenshot "$RAW/$2" >/dev/null 2>&1 || echo "SHOT-FAIL $2"
}
shot ""        watch-01-idle.png
shot recording watch-02-recording.png
shot done      watch-03-done.png
xcrun simctl shutdown "$WATCH" 2>/dev/null

python3 - "$RAW" "$OUT" <<'PY'
import sys, pathlib
from PIL import Image, ImageDraw, ImageFont
src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
font = ImageFont.truetype("/System/Library/Fonts/SFCompact.ttf", 34)
try: font.set_variation_by_name("Semibold")
except Exception: pass
for p in sorted(src.glob("watch-0*.png")):
    im = Image.open(p).convert("RGB"); d = ImageDraw.Draw(im)
    d.rectangle([250, 20, 416, 80], fill=(0, 0, 0))            # paint out the real clock
    d.text((386 - d.textlength("9:41", font=font), 34), "9:41", font=font, fill=(255, 255, 255))
    im.save(out / p.name); print("wrote", out / p.name, im.size)
PY
echo "next: python3 $ROOT/mobile/marketing/pipeline/asc_screenshots.py --upload --only APP_WATCH_SERIES_10"
