#!/usr/bin/env python3
"""Upload App Store screenshots to App Store Connect (idempotent by fileName).

    python3 asc_screenshots.py --dry-run
    python3 asc_screenshots.py --upload
    python3 asc_screenshots.py --upload --only APP_WATCH_SERIES_10

Local layout: mobile/marketing/screenshots/<folder>/<lang>/<file>.png — see SETS.
The iPhone 6.9"/iPad 13" sets already live in ASC (uploaded 2026-07 from the
design-harness captures); this script fills whatever is missing.
"""
import argparse, hashlib, pathlib, time

import asc_common as asc

ROOT = pathlib.Path(__file__).resolve().parent.parent / "screenshots"
# ASC display type -> (local folder, file names). APP_IPHONE_67 accepts the
# 6.9" 1320x2868 capture; APP_IPAD_PRO_3GEN_129 accepts 2064x2752;
# APP_WATCH_SERIES_10 takes 416x496 (Series 10 46mm raw capture).
SETS = {
    "APP_IPHONE_67": ("iphone", ["iphone-01-onboarding-welcome.png", "iphone-02-home.png", "iphone-03-settings-providers.png", "iphone-04-journal.png", "iphone-05-capture-anywhere.png"]),
    "APP_IPAD_PRO_3GEN_129": ("ipad", ["ipad-01-onboarding-welcome.png", "ipad-02-library.png", "ipad-03-settings-providers.png", "ipad-04-journal.png", "ipad-05-capture-anywhere.png"]),
    "APP_WATCH_SERIES_10": ("watch", ["watch-01-idle.png", "watch-02-recording.png", "watch-03-done.png"]),
}
LANG_FOR_LOCALE = {"en": "en", "pl": "pl"}


def sets_for(loc_id):
    return asc.get_all(f"{asc.API}/appStoreVersionLocalizations/{loc_id}/appScreenshotSets")


def shots_in(set_id):
    return asc.get_all(f"{asc.API}/appScreenshotSets/{set_id}/appScreenshots")


def ensure_set(loc_id, display_type, existing):
    for s in existing:
        if s["attributes"]["screenshotDisplayType"] == display_type:
            return s["id"]
    created = asc.call("POST", f"{asc.API}/appScreenshotSets", {"data": {
        "type": "appScreenshotSets", "attributes": {"screenshotDisplayType": display_type},
        "relationships": {"appStoreVersionLocalization": {"data": {"type": "appStoreVersionLocalizations", "id": loc_id}}}}})
    return created["data"]["id"]


def upload_one(set_id, path):
    data = path.read_bytes()
    reserve = asc.call("POST", f"{asc.API}/appScreenshots", {"data": {
        "type": "appScreenshots", "attributes": {"fileName": path.name, "fileSize": len(data)},
        "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": set_id}}}}})
    sid = reserve["data"]["id"]
    for op in reserve["data"]["attributes"]["uploadOperations"]:
        chunk = data[op["offset"]:op["offset"] + op["length"]]
        asc.call(op["method"], op["url"], raw_headers={h["name"]: h["value"] for h in op["requestHeaders"]}, data=chunk)
    asc.call("PATCH", f"{asc.API}/appScreenshots/{sid}", {"data": {"type": "appScreenshots", "id": sid,
             "attributes": {"uploaded": True, "sourceFileChecksum": hashlib.md5(data).hexdigest()}}})
    return sid


def wait_complete(sid, timeout=180):
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = (asc.call("GET", f"{asc.API}/appScreenshots/{sid}")["data"]["attributes"].get("assetDeliveryState") or {})
        if st.get("state") == "COMPLETE":
            return "COMPLETE"
        if st.get("state") == "FAILED":
            return f"FAILED: {st.get('errors')}"
        time.sleep(3)
    return "TIMEOUT"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--upload", action="store_true")
    ap.add_argument("--only", help="restrict to one display type, e.g. APP_WATCH_SERIES_10")
    ap.add_argument("--platform", default="IOS", choices=["IOS", "MAC_OS"])
    args = ap.parse_args()
    if not (args.dry_run or args.upload):
        ap.error("pass --dry-run or --upload")
    version = asc.editable_version(args.platform)
    if not version:
        raise SystemExit("no editable appStoreVersion")
    print(f"version {version['attributes']['versionString']} · {version['attributes']['appStoreState']}")
    plan = []
    for loc in asc.get_all(f"{asc.API}/appStoreVersions/{version['id']}/appStoreVersionLocalizations"):
        locale = loc["attributes"]["locale"]
        lang = LANG_FOR_LOCALE.get(locale.split("-")[0])
        sets = sets_for(loc["id"])
        have = {s["attributes"]["screenshotDisplayType"]: len(shots_in(s["id"])) for s in sets}
        print(f"localization {locale}: existing {have or '{}'}")
        if not lang:
            continue
        for display_type, (folder, names) in SETS.items():
            if args.only and display_type != args.only:
                continue
            files = [ROOT / folder / lang / n for n in names]
            present = [f for f in files if f.exists()]
            if not present:
                print(f"  - {display_type}: no local files under {ROOT / folder / lang}, skipping")
                continue
            plan.append((loc, locale, display_type, sets, present))
    if args.dry_run:
        for _, locale, dt, _, files in plan:
            print(f"  {locale} {dt}: " + ", ".join(f.name for f in files))
        return
    for loc, locale, display_type, sets, files in plan:
        set_id = ensure_set(loc["id"], display_type, sets)
        existing = {s["attributes"]["fileName"] for s in shots_in(set_id)}
        for f in files:
            if f.name in existing:
                print(f"  = {locale} {display_type} {f.name} (already there)")
                continue
            print(f"  ^ {locale} {display_type} {f.name} -> {wait_complete(upload_one(set_id, f))}")
    print("done")


if __name__ == "__main__":
    main()
