#!/usr/bin/env python3
"""Shared App Store Connect API helpers for the Whisperio marketing pipeline.

Auth: ES256 JWT minted with `cryptography` (no PyJWT needed); requests go
through `curl` because python.org builds ship without a CA bundle. Same ASC
API key as the TestFlight pipeline (mobile/WhisperioApp/Scripts/release-testflight.sh);
override via env ASC_KEY_ID / ASC_ISSUER / ASC_P8.
"""
import base64, json, os, subprocess, time

KEY_ID = os.environ.get("ASC_KEY_ID", "HUMHQQ6DB3")
ISSUER = os.environ.get("ASC_ISSUER", "ee61e2e6-1f5f-44e8-a4aa-d80fabb8e83d")
P8 = os.environ.get("ASC_P8", os.path.expanduser(f"~/.appstoreconnect/private_keys/AuthKey_{KEY_ID}.p8"))
API = "https://api.appstoreconnect.apple.com/v1"
BUNDLE_ID = "ai.whisperio.mobile"
APP_ID = "6781780531"

_TOKEN = None


def token():
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec, utils
    from cryptography.hazmat.primitives.serialization import load_pem_private_key

    def b64(b):
        return base64.urlsafe_b64encode(b).rstrip(b"=")

    key = load_pem_private_key(open(P8, "rb").read(), password=None)
    now = int(time.time())
    header = b64(json.dumps({"alg": "ES256", "kid": KEY_ID, "typ": "JWT"}).encode())
    payload = b64(json.dumps({"iss": ISSUER, "iat": now, "exp": now + 15 * 60, "aud": "appstoreconnect-v1"}).encode())
    signing = header + b"." + payload
    der = key.sign(signing, ec.ECDSA(hashes.SHA256()))
    r, s = utils.decode_dss_signature(der)
    return (signing + b"." + b64(r.to_bytes(32, "big") + s.to_bytes(32, "big"))).decode()


def call(method, url, body=None, raw_headers=None, data=None):
    """JSON request against ASC (or a raw upload when raw_headers/data are given)."""
    global _TOKEN
    if _TOKEN is None:
        _TOKEN = token()
    cmd = ["curl", "-s", "-g", "-X", method, "-w", "\n%{http_code}"]
    if raw_headers is not None:
        for k, v in raw_headers.items():
            cmd += ["-H", f"{k}: {v}"]
        cmd += ["--data-binary", "@-"]
        stdin = data
    else:
        cmd += ["-H", f"Authorization: Bearer {_TOKEN}", "-H", "Content-Type: application/json"]
        stdin = json.dumps(body).encode() if body is not None else None
        if stdin is not None:
            cmd += ["--data-binary", "@-"]
    cmd.append(url)
    out = subprocess.run(cmd, input=stdin, capture_output=True, check=True).stdout
    txt, _, code = out.rpartition(b"\n")
    code = int(code)
    if code >= 400:
        raise SystemExit(f"{method} {url} -> {code}\n{txt.decode(errors='replace')[:800]}")
    if raw_headers is not None or not txt.strip():
        return None
    return json.loads(txt)


def get_all(url):
    out = []
    while url:
        page = call("GET", url)
        out += page.get("data", [])
        url = page.get("links", {}).get("next")
    return out


EDITABLE = ("PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED",
            "WAITING_FOR_REVIEW", "READY_FOR_REVIEW")


def editable_version(platform="IOS"):
    for v in get_all(f"{API}/apps/{APP_ID}/appStoreVersions?filter[platform]={platform}&limit=20"):
        if v["attributes"]["appStoreState"] in EDITABLE:
            return v
    return None


def editable_app_info():
    infos = get_all(f"{API}/apps/{APP_ID}/appInfos")
    for i in infos:
        if i["attributes"].get("appStoreState") in EDITABLE:
            return i
    return infos[0] if infos else None
