#!/usr/bin/env bash
# Signing preflight: for every provisioning-profile NAME in ExportOptions.plist, take the NEWEST
# installed profile with that name (by CreationDate) and require that one of its
# DeveloperCertificates matches a codesigning identity in the current keychain search list.
# Catches duplicate profile sets whose certificate lives in a keychain that isn't searched
# (build 76, 2026-10-16/17).
#
#   preflight-signing.sh [ExportOptions.plist]
# Env: WZ_PROFILE_DIRS (colon-separated; default the two Xcode profile dirs).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
opts="${1:-$here/ExportOptions.plist}"
[ -f "$opts" ] || { echo "✘ ExportOptions.plist missing: $opts" >&2; exit 1; }

dirs="${WZ_PROFILE_DIRS:-$HOME/Library/MobileDevice/Provisioning Profiles:$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles}"

# Profile names (the <string> values inside the provisioningProfiles dict).
names="$(plutil -extract provisioningProfiles xml1 -o - "$opts" | sed -n 's|.*<string>\(.*\)</string>.*|\1|p')"
[ -n "$names" ] || { echo "✘ no provisioningProfiles in $opts" >&2; exit 1; }

identities="$(security find-identity -v -p codesigning 2>/dev/null || true)"
idshas="$(printf '%s\n' "$identities" | grep -oE '[0-9A-Fa-f]{40}' | tr 'a-f' 'A-F' | sort -u || true)"

# Emit "<CreationDate>\t<path>" for every installed profile named $1.
find_profiles() {
  local want="$1" d f n c
  local IFS=:
  for d in $dirs; do
    [ -d "$d" ] || continue
    for f in "$d"/*.mobileprovision "$d"/*.provisionprofile; do
      [ -f "$f" ] || continue
      n="$(security cms -D -i "$f" 2>/dev/null | plutil -extract Name raw -o - - 2>/dev/null || true)"
      [ "$n" = "$want" ] || continue
      c="$(security cms -D -i "$f" 2>/dev/null | plutil -extract CreationDate raw -o - - 2>/dev/null || true)"
      printf '%s\t%s\n' "$c" "$f"
    done
  done
}

fail=0
while IFS= read -r name; do
  [ -n "$name" ] || continue
  newest="$(find_profiles "$name" | sort | tail -1 | cut -f2)"
  if [ -z "$newest" ]; then
    echo "✘ no installed provisioning profile named \"$name\"" >&2; fail=1; continue
  fi
  plist="$(security cms -D -i "$newest")"
  fps=""; i=0
  while der="$(printf '%s' "$plist" | plutil -extract "DeveloperCertificates.$i" raw -o - - 2>/dev/null)"; do
    fps="$fps$(printf '%s' "$der" | base64 -d | openssl sha1 | grep -oE '[0-9a-f]{40}' | tr 'a-f' 'A-F')"$'\n'
    i=$((i + 1))
  done
  fps="$(printf '%s' "$fps" | sed '/^$/d')"
  if [ -n "$fps" ] && [ -n "$idshas" ] && printf '%s\n' "$fps" | grep -qxFf <(printf '%s\n' "$idshas"); then
    echo "  ✓ \"$name\" → $(basename "$newest") (certificate present)"
  else
    {
      echo "✘ newest profile \"$name\" ($(basename "$newest")) has no matching signing identity in the keychain search list."
      echo "  Profile certificate SHA-1(s):"; printf '%s\n' "$fps" | sed 's/^/    /'
      echo "  Local codesigning identities:"; printf '%s\n' "$identities" | sed 's/^/    /'
      echo "  Likely a keychain is missing from the search list (e.g. ~/Library/Keychains/wz-build.keychain-db;"
      echo "  unlock with WZ_BUILD_KEYCHAIN_PASSWORD — see memory note mac-testflight-pipeline)."
    } >&2
    fail=1
  fi
done <<< "$names"
exit "$fail"
