#!/usr/bin/env python3
"""Create/update the App Review Information (contact + notes) on the editable
iOS and macOS versions from ../app-store-review-notes.md (the fenced block).

    python3 asc_review.py --dry-run
    python3 asc_review.py --apply
"""
import argparse, pathlib, re

import asc_common as asc

CONTACT = {"contactFirstName": "Daniel", "contactLastName": "Kasprzyk", "contactPhone": "+48533091947",
           "contactEmail": "daniel@danielkasprzyk.com", "demoAccountRequired": False}
NOTES_MD = pathlib.Path(__file__).resolve().parent.parent / "app-store-review-notes.md"


def notes():
    m = re.search(r"```\n(.*?)\n```", NOTES_MD.read_text(), re.S)
    if not m:
        raise SystemExit("no fenced notes block in app-store-review-notes.md")
    text = m.group(1).strip()
    if len(text) > 4000:
        raise SystemExit(f"notes too long: {len(text)}/4000")
    return text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    if not (args.dry_run or args.apply):
        ap.error("pass --dry-run or --apply")
    attrs = dict(CONTACT, notes=notes())
    for plat in ("IOS", "MAC_OS"):
        v = asc.editable_version(plat)
        if not v:
            print(f"{plat}: no editable version"); continue
        cur = asc.call("GET", f"{asc.API}/appStoreVersions/{v['id']}/appStoreReviewDetail").get("data")
        print(f"{plat} {v['attributes']['versionString']}: review detail {'exists' if cur else 'MISSING'}; notes {len(attrs['notes'])} chars")
        if args.dry_run:
            continue
        if cur:
            asc.call("PATCH", f"{asc.API}/appStoreReviewDetails/{cur['id']}", {"data": {"type": "appStoreReviewDetails", "id": cur["id"], "attributes": attrs}})
        else:
            asc.call("POST", f"{asc.API}/appStoreReviewDetails", {"data": {"type": "appStoreReviewDetails", "attributes": attrs,
                     "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": v["id"]}}}}})
        print(f"  {plat}: written")


if __name__ == "__main__":
    main()
