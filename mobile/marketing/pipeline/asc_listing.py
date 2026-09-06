#!/usr/bin/env python3
"""Push the App Store listing texts (mobile/marketing/listing/<locale>.json) to ASC.

    python3 asc_listing.py --dry-run            # current vs new per field, with lengths
    python3 asc_listing.py --apply              # PATCH app-info + version localizations
    python3 asc_listing.py --apply --platform MAC_OS

Fields:
  appInfoLocalizations         name (30) · subtitle (30) · privacyPolicyUrl
  appStoreVersionLocalizations description (4000) · keywords (100) ·
                               promotionalText (170) · whatsNew (4000) · supportUrl · marketingUrl
Length limits are validated locally before any request; over-limit aborts.
"""
import argparse, json, pathlib

import asc_common as asc

LISTING = pathlib.Path(__file__).resolve().parent.parent / "listing"
LIMITS = {"name": 30, "subtitle": 30, "promotionalText": 170, "keywords": 100, "description": 4000, "whatsNew": 4000}
INFO_FIELDS = ("name", "subtitle", "privacyPolicyUrl")
VERSION_FIELDS = ("description", "keywords", "promotionalText", "whatsNew", "supportUrl", "marketingUrl")


def load_texts():
    texts = {}
    for f in sorted(LISTING.glob("*.json")):
        if f.name.startswith("_"):
            continue
        texts[f.stem] = json.loads(f.read_text())
    bad = [(loc, k, len(v)) for loc, t in texts.items() for k, v in t.items() if k in LIMITS and len(v) > LIMITS[k]]
    if bad:
        raise SystemExit("over limit: " + ", ".join(f"{loc}.{k}={n}/{LIMITS[k]}" for loc, k, n in bad))
    return texts


def diff(label, locale, current, new, fields):
    changes = {}
    for k in fields:
        if k not in new:
            continue
        old = current.get(k) or ""
        if old != new[k]:
            changes[k] = new[k]
            lim = f"/{LIMITS[k]}" if k in LIMITS else ""
            print(f"  {label} {locale}.{k}: {len(old)} -> {len(new[k])}{lim} chars")
            if k != "description":
                print(f"      old: {old[:90]!r}\n      new: {new[k][:90]!r}")
    return changes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--platform", default="IOS", choices=["IOS", "MAC_OS"])
    args = ap.parse_args()
    if not (args.dry_run or args.apply):
        ap.error("pass --dry-run or --apply")
    texts = load_texts()

    info = asc.editable_app_info()
    version = asc.editable_version(args.platform)
    if not version:
        raise SystemExit(f"no editable {args.platform} appStoreVersion")
    print(f"version {version['attributes']['versionString']} · {version['attributes']['appStoreState']} ({version['id']})")

    backup = {"appInfo": {}, "version": {}}
    todo = []
    for loc in asc.get_all(f"{asc.API}/appInfos/{info['id']}/appInfoLocalizations"):
        locale = loc["attributes"]["locale"]
        backup["appInfo"][locale] = loc["attributes"]
        if locale in texts:
            ch = diff("appInfo", locale, loc["attributes"], texts[locale], INFO_FIELDS)
            if ch:
                todo.append(("appInfoLocalizations", loc["id"], ch))
    for loc in asc.get_all(f"{asc.API}/appStoreVersions/{version['id']}/appStoreVersionLocalizations"):
        locale = loc["attributes"]["locale"]
        backup["version"][locale] = loc["attributes"]
        if locale in texts:
            ch = diff("version", locale, loc["attributes"], texts[locale], VERSION_FIELDS)
            if ch:
                todo.append(("appStoreVersionLocalizations", loc["id"], ch))
    missing = set(texts) - set(backup["version"])
    if missing:
        print(f"  (locales in listing/ but not in ASC: {sorted(missing)} — add the localization in ASC first)")
    if not todo:
        print("nothing to change")
        return
    if args.dry_run:
        print(f"{len(todo)} PATCH(es) pending — run with --apply")
        return
    import datetime
    (LISTING / f"_asc-backup-{datetime.date.today()}.json").write_text(json.dumps(backup, indent=2, ensure_ascii=False))
    for typ, lid, ch in todo:
        asc.call("PATCH", f"{asc.API}/{typ}/{lid}", {"data": {"type": typ, "id": lid, "attributes": ch}})
        print(f"  patched {typ} {lid}: {sorted(ch)}")
    print("done")


if __name__ == "__main__":
    main()
