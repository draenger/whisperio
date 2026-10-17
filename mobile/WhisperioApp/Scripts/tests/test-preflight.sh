#!/usr/bin/env bash
# Bash tests for preflight-cloudkit.sh and preflight-signing.sh. No Xcode/Swift needed.
set -uo pipefail
S="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
pass=0; fail=0
check() { # name expected_rc actual_rc [output grep pattern]
  if [ "$2" = "$3" ] && { [ -z "${5:-}" ] || grep -qE "$5" <<<"$4"; }; then pass=$((pass+1)); echo "ok   $1"
  else fail=$((fail+1)); echo "FAIL $1 (rc=$3 want $2)"; echo "$4" | sed 's/^/     /'; fi
}

# ---- cloudkit ----
R="$T/repo"; mkdir -p "$R/Sources"; git -C "$R" init -q -b main
git -C "$R" config user.email t@t; git -C "$R" config user.name t
echo a > "$R/Sources/Other.swift"; git -C "$R" add -A; git -C "$R" commit -qm base
git -C "$R" branch base
mklog() { # $1 status for Recording, $2 for Digest
  printf '| Date | Record type(s) | Status | Notes |\n|---|---|---|---|\n| 2026-07 | `CD_DigestEntity` (x) | %s | n |\n| 2026-10 | `CD_RecordingEntity` +1 field (`source`) | %s | n |\n' "$2" "$1" > "$T/log.md"
}
run_ck() { WZ_REPO_ROOT="$R" WZ_PROMOTION_LOG="$T/log.md" WZ_RELEASE_BASE_REF=base "$S/preflight-cloudkit.sh" "$@" 2>&1; }

mklog PENDING PROMOTED
echo b > "$R/Sources/Other.swift"; git -C "$R" commit -qam other
out="$(run_ck)"; check "pending + non-touching diff, no flag -> 1 + warning" 1 $? "$out" 'WARNING.*PENDING|CD_RecordingEntity'
out="$(run_ck --allow-pending-schema)"; check "pending + non-touching diff, flag -> 0" 0 $? "$out" 'allow-pending-schema'
out="$(run_ck --bogus)"; check "unknown flag -> 2" 2 $? "$out"

echo c > "$R/Sources/RecordingEntity.swift"; git -C "$R" add -A; git -C "$R" commit -qm touch
out="$(run_ck --allow-pending-schema)"; check "pending Recording + touching diff -> 1 even with flag" 1 $? "$out" 'REFUSING TO SHIP.*CD_RecordingEntity'
mklog PROMOTED PENDING   # Digest pending but only Recording touched
out="$(run_ck --allow-pending-schema)"; check "pending Digest, Recording touched -> 0 with flag" 0 $? "$out"
echo d > "$R/Sources/DigestSyncStore.swift"; git -C "$R" add -A; git -C "$R" commit -qm touch2
out="$(run_ck --allow-pending-schema)"; check "pending Digest + Digest sync touched -> 1" 1 $? "$out" 'CD_DigestEntity'
mklog PROMOTED PROMOTED
out="$(run_ck)"; check "all PROMOTED -> 0" 0 $? "$out" 'no PENDING'

# ---- signing (fake security shim) ----
if command -v plutil >/dev/null && command -v openssl >/dev/null; then
  mkdir -p "$T/bin" "$T/prof"
  printf 'cert-A' > "$T/a.der"; printf 'cert-B' > "$T/b.der"
  shaA="$(openssl sha1 < "$T/a.der" | grep -oE '[0-9a-f]{40}' | tr a-f A-F)"
  mkprof() { # file name date certfile
    printf '<?xml version="1.0"?><plist version="1.0"><dict><key>Name</key><string>%s</string><key>CreationDate</key><string>%s</string><key>DeveloperCertificates</key><array><data>%s</data></array></dict></plist>' \
      "$2" "$3" "$(base64 < "$4" | tr -d '\n')" > "$T/prof/$1.mobileprovision"; }
  cat > "$T/bin/security" <<SH
#!/bin/bash
case "\$1" in
  cms) cat "\$4" ;;
  find-identity) echo "  1) $shaA \"iPhone Distribution: Test\""; echo "     1 valid identities found" ;;
esac
SH
  chmod +x "$T/bin/security"
  cat > "$T/opts.plist" <<'P'
<?xml version="1.0"?><plist version="1.0"><dict><key>provisioningProfiles</key><dict><key>x.app</key><string>WZ Test</string></dict></dict></plist>
P
  run_sg() { PATH="$T/bin:$PATH" WZ_PROFILE_DIRS="$T/prof" "$S/preflight-signing.sh" "$T/opts.plist" 2>&1; }
  mkprof old "WZ Test" 2026-07-20T00:00:00Z "$T/a.der"; mkprof new "WZ Test" 2026-07-23T00:00:00Z "$T/b.der"
  out="$(run_sg)"; check "newest profile cert missing locally -> 1, lists fingerprints" 1 $? "$out" 'no matching signing identity'
  mkprof new "WZ Test" 2026-07-23T00:00:00Z "$T/a.der"
  out="$(run_sg)"; check "newest profile cert present -> 0" 0 $? "$out" 'certificate present'
  mkprof new "Other" 2026-07-23T00:00:00Z "$T/a.der"; rm "$T/prof/old.mobileprovision"
  out="$(run_sg)"; check "no profile with that name -> 1" 1 $? "$out" 'no installed provisioning profile'
else
  echo "skip signing tests (plutil/openssl missing)"
fi

echo "bash tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
