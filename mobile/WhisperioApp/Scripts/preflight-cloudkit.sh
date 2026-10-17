#!/usr/bin/env bash
# CloudKit schema-promotion preflight (see mobile/WhisperioKit/CLOUDKIT_SCHEMA_PROMOTION.md).
#
#   preflight-cloudkit.sh [--allow-pending-schema]
#
# 1. HARD GATE: if the diff <base>...HEAD touches the sync code of an entity
#    (Recording/Digest Entity, SyncStore; CloudKitSchema touches both) AND the promotion log has
#    a PENDING row for that CD_ record type -> exit 1 (the schema change in this diff would not
#    sync on Production).
# 2. WARNING: ANY PENDING row (independent of the diff) is printed loudly; exit 1 unless
#    --allow-pending-schema is given.
#
# Env overrides: WZ_REPO_ROOT, WZ_PROMOTION_LOG, WZ_RELEASE_BASE_REF.
set -euo pipefail

allow_pending=0
for a in "$@"; do
  case "$a" in
    --allow-pending-schema) allow_pending=1 ;;
    *) echo "preflight-cloudkit: unknown argument: $a" >&2; exit 2 ;;
  esac
done

repo="${WZ_REPO_ROOT:-$(git rev-parse --show-toplevel)}"
log="${WZ_PROMOTION_LOG:-$repo/mobile/WhisperioKit/CLOUDKIT_SCHEMA_PROMOTION.md}"
[ -f "$log" ] || { echo "✘ promotion log missing: $log" >&2; exit 1; }

# Base ref: env override → origin/main → last tag → HEAD~20 → empty tree.
base="${WZ_RELEASE_BASE_REF:-}"
if [ -z "$base" ]; then
  if git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
    base="origin/main"
  elif tag="$(git -C "$repo" describe --tags --abbrev=0 2>/dev/null)" && [ -n "$tag" ]; then
    base="$tag"
  elif git -C "$repo" rev-parse --verify -q 'HEAD~20' >/dev/null; then
    base="HEAD~20"
  else
    base="$(git -C "$repo" hash-object -t tree /dev/null)"
  fi
fi
echo "▸ CloudKit promotion preflight (diff base: $base)"

# PENDING rows: "<entity>\t<date>" per CD_ record type named in the row's type column.
# Table columns: | Date | Record type(s) / field(s) | Status | Notes |
pending="$(awk -F'|' '
  /^\|/ {
    st=$4; gsub(/^[ \t]+|[ \t]+$/, "", st)
    if (st == "PENDING") {
      date=$2; gsub(/^[ \t]+|[ \t]+$/, "", date)
      t=$3; n=0
      while (match(t, /CD_(Recording|Digest)Entity/)) {
        print substr(t, RSTART, RLENGTH) "\t" date "\t" $3
        t=substr(t, RSTART+RLENGTH); n++
      }
      if (n == 0) print "?\t" date "\t" $3
    }
  }' "$log")"

if [ -z "$pending" ]; then
  echo "  ✓ no PENDING rows in the promotion log"
  exit 0
fi

touched() { # $@ = pathspecs
  [ -n "$(git -C "$repo" diff --name-only "$base"...HEAD -- "$@" 2>/dev/null | head -1)" ] \
    || [ -n "$(git -C "$repo" diff --name-only "$base" HEAD -- "$@" 2>/dev/null | head -1)" ]
}

blocked=0
while IFS=$'\t' read -r entity date desc; do
  case "$entity" in
    CD_RecordingEntity) specs=('*RecordingEntity*.swift' '*RecordingSyncStore*.swift' '*CloudKitSchema*.swift') ;;
    CD_DigestEntity)    specs=('*DigestEntity*.swift' '*DigestSyncStore*.swift' '*CloudKitSchema*.swift') ;;
    *)                  specs=('*CloudKitSchema*.swift') ;;
  esac
  if touched "${specs[@]}"; then
    echo "✘ REFUSING TO SHIP: diff touches $entity sync code and the promotion log row ($date) is PENDING:" >&2
    echo "    $desc" >&2
    blocked=1
  fi
done <<< "$pending"

if [ "$blocked" -eq 1 ]; then
  echo "  Complete the promotion checklist in $log and flip the row to PROMOTED first." >&2
  exit 1
fi

echo "" >&2
echo "!!! WARNING: CloudKit schema promotion is PENDING (build still ships, the Production schema deploy is missing):" >&2
while IFS=$'\t' read -r entity date desc; do
  echo "!!!   $entity ($date):$desc" >&2
done <<< "$pending"
echo "!!! Until promoted, affected data silently fails to sync on TestFlight/App Store." >&2

if [ "$allow_pending" -eq 1 ]; then
  echo "  ⚠ continuing: --allow-pending-schema given" >&2
  exit 0
fi
echo "✘ re-run with --allow-pending-schema to ship anyway (or promote the schema and flip the row)." >&2
exit 1
