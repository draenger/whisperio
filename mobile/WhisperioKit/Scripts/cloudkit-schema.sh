#!/usr/bin/env bash
# CloudKit schema helper for iCloud.ai.whisperio.mobile (runbook: ../CLOUDKIT_SCHEMA_RUNBOOK.md).
#
#   cloudkit-schema.sh plan                 export Development + Production, show what differs from the repo schema
#   cloudkit-schema.sh import-dev [--yes]   add the repo's missing fields to DEVELOPMENT (validate -> confirm -> import -> re-export)
#   cloudkit-schema.sh verify-prod          after the Console "Deploy Schema Changes to Production": PASS/FAIL
#
# Safety rules (fields deployed to Production can never be deleted, so nothing unvetted may get there):
#   - The file sent to import-schema is the LIVE Development export plus only the missing field lines
#     (or missing record types) from the repo schema. Indexes, grants and fields already live are never changed.
#   - A field whose type differs between the repo and Development stops everything (exit 1).
#   - Every field to be added is listed and needs confirmation (or --yes).
#   - Production is never written by this script (Apple rejects import-schema on Production anyway);
#     promotion is the single Console click described in the runbook.
#   - After a successful import the repo schema file is refreshed from the new Development export.
#
# Needs: Xcode command line tools (xcrun cktool) and a CloudKit management token saved once with
#   xcrun cktool save-token --type management
# Env overrides: CK_TEAM_ID, CK_CONTAINER_ID, CK_REPO_SCHEMA, CK_OUT_DIR.
set -euo pipefail

TEAM_ID="${CK_TEAM_ID:-953Q6T2WTB}"
CONTAINER_ID="${CK_CONTAINER_ID:-iCloud.ai.whisperio.mobile}"
here="$(cd "$(dirname "$0")" && pwd)"
REPO_SCHEMA="${CK_REPO_SCHEMA:-$here/../cloudkit/whisperio.ckdb}"
OUT="${CK_OUT_DIR:-${TMPDIR:-/tmp}/whisperio-cloudkit-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT"

die() { echo "✘ $*" >&2; exit 1; }
ck() { xcrun cktool "$@" --team-id "$TEAM_ID" --container-id "$CONTAINER_ID"; }

# "RecordType<TAB>Field<TAB>TYPE" for every non-system field of a .ckdb file.
fields() {
  awk '
    /^[ \t]*RECORD TYPE / { rt = $3; gsub(/[("]/, "", rt); next }
    rt != "" && /^[ \t]*\);/ { rt = ""; next }
    rt != "" {
      line = $0; sub(/^[ \t]+/, "", line)
      if (line == "" || line ~ /^GRANT/) next
      n = split(line, a, /[ \t]+/)
      name = a[1]; gsub(/"/, "", name)
      type = a[2]; sub(/,$/, "", type)
      if (name ~ /^___/ || type == "") next
      print rt "\t" name "\t" type
    }' "$1" | sort
}

need_token() {
  command -v xcrun >/dev/null 2>&1 || die "xcrun not found: run this on the Mac with Xcode installed."
  xcrun cktool get-teams >/dev/null 2>&1 || die "no CloudKit management token. Run once: xcrun cktool save-token --type management (token from CloudKit Console > Settings > Tokens)."
}

export_env() { # $1 = development|production, $2 = output file
  ck export-schema --environment "$1" --output-file "$2" >/dev/null || die "export-schema ($1) failed"
  [ -s "$2" ] || die "export-schema ($1) wrote an empty file"
}

# Fields the repo declares but $1 (an export) lacks; type conflicts go to $OUT/conflicts.tsv.
compare() { # $1 = export file, $2 = name for messages
  fields "$REPO_SCHEMA" > "$OUT/repo.tsv"
  fields "$1" > "$OUT/$2.tsv"
  : > "$OUT/$2-missing.tsv"; : > "$OUT/$2-conflicts.tsv"
  while IFS=$'\t' read -r rt name type; do
    live="$(awk -F'\t' -v r="$rt" -v n="$name" '$1 == r && $2 == n { print $3 }' "$OUT/$2.tsv")"
    if [ -z "$live" ]; then printf '%s\t%s\t%s\n' "$rt" "$name" "$type" >> "$OUT/$2-missing.tsv"
    elif [ "$live" != "$type" ]; then printf '%s\t%s\trepo=%s %s=%s\n' "$rt" "$name" "$type" "$2" "$live" >> "$OUT/$2-conflicts.tsv"
    fi
  done < "$OUT/repo.tsv"
}

show() { # $1 = name
  if [ -s "$OUT/$1-conflicts.tsv" ]; then echo "  TYPE CONFLICTS (stop):"; sed 's/^/    /' "$OUT/$1-conflicts.tsv"; fi
  if [ -s "$OUT/$1-missing.tsv" ]; then echo "  missing in $1:"; awk -F'\t' '{ print "    + " $1 "." $2 " " $3 }' "$OUT/$1-missing.tsv"
  else echo "  $1 has every field of the repo schema"; fi
}

# Live export + missing field lines (inserted before the record type's GRANT lines, or closing
# paren) + missing record types copied whole from the repo schema.
build_import() { # $1 = dev export, $2 = missing tsv, $3 = output
  awk -v missing="$2" -v repo="$REPO_SCHEMA" '
    BEGIN {
      while ((getline l < missing) > 0) { split(l, m, "\t"); add[m[1]] = add[m[1]] "        " m[2] " " m[3] ",\n"; want[m[1]] = 1 }
    }
    /^[ \t]*RECORD TYPE / { rt = $3; gsub(/[("]/, "", rt); seen[rt] = 1; done = 0 }
    rt != "" && !done && rt in add && /^[ \t]*GRANT/ { printf "%s", add[rt]; done = 1 }
    rt != "" && !done && rt in add && /^[ \t]*\);/ {
      # no GRANT lines: the previous field needs a comma, the new last field must not have one
      sub(/[ \t]*$/, "", prev); if (prev !~ /,$/ && prev !~ /\($/) prev = prev ","
      print prev; s = add[rt]; sub(/,\n$/, "\n", s); printf "%s", s; prev = $0; done = 1; rt = ""; next
    }
    /^[ \t]*\);/ { rt = "" }
    { if (NR > 1) print prev; prev = $0 }
    END {
      print prev
      while ((getline l < repo) > 0) {
        if (l ~ /^[ \t]*RECORD TYPE /) { t = l; sub(/^[ \t]*RECORD TYPE /, "", t); sub(/[ \t(].*/, "", t); copy = (want[t] && !(t in seen)) }
        if (copy) { print l; if (l ~ /^[ \t]*\);/) copy = 0 }
      }
    }' "$1" > "$3"
}

cmd="${1:-}"; shift || true
yes=0; for a in "$@"; do [ "$a" = "--yes" ] && yes=1; done
case "$cmd" in
  plan)
    need_token
    export_env development "$OUT/dev.ckdb"; export_env production "$OUT/prod.ckdb"
    compare "$OUT/dev.ckdb" development; compare "$OUT/prod.ckdb" production
    echo "Development:"; show development; echo "Production:"; show production
    echo "Exports: $OUT"
    ;;
  import-dev)
    need_token
    export_env development "$OUT/dev.ckdb"
    compare "$OUT/dev.ckdb" development
    echo "Development:"; show development
    [ -s "$OUT/development-conflicts.tsv" ] && die "type conflict between the repo schema and Development: nothing imported. Fix the repo file (or the app) first."
    if [ ! -s "$OUT/development-missing.tsv" ]; then echo "✔ nothing to import"; cp "$OUT/dev.ckdb" "$REPO_SCHEMA"; exit 0; fi
    build_import "$OUT/dev.ckdb" "$OUT/development-missing.tsv" "$OUT/import.ckdb"
    ck validate-schema --environment development --file "$OUT/import.ckdb" >/dev/null || die "validate-schema rejected $OUT/import.ckdb: nothing imported."
    echo "Import file (live Development + the fields above): $OUT/import.ckdb"
    if [ "$yes" != 1 ]; then
      read -r -p "Add these fields to DEVELOPMENT? Production is untouched. [y/N] " ok
      [ "$ok" = "y" ] || [ "$ok" = "Y" ] || die "cancelled: nothing imported."
    fi
    ck import-schema --environment development --file "$OUT/import.ckdb" >/dev/null || die "import-schema failed"
    export_env development "$OUT/dev-after.ckdb"
    compare "$OUT/dev-after.ckdb" development
    [ -s "$OUT/development-missing.tsv" ] || [ -s "$OUT/development-conflicts.tsv" ] && die "after import Development still differs; see $OUT"
    cp "$OUT/dev-after.ckdb" "$REPO_SCHEMA"
    echo "✔ Development has every field. Repo schema refreshed from the export: $REPO_SCHEMA (commit it)."
    echo "Next: the Console click (runbook step 3), then: $0 verify-prod"
    ;;
  verify-prod)
    need_token
    export_env production "$OUT/prod.ckdb"
    compare "$OUT/prod.ckdb" production
    echo "Production:"; show production
    if [ -s "$OUT/production-missing.tsv" ] || [ -s "$OUT/production-conflicts.tsv" ]; then
      echo "✘ FAIL: Production is missing fields (or has other types). Do not ship; see the runbook."; exit 1
    fi
    echo "✔ PASS: Production has every field of the repo schema. Flip the PENDING row in CLOUDKIT_SCHEMA_PROMOTION.md to PROMOTED."
    ;;
  *) sed -n '2,6p' "$0"; exit 2 ;;
esac
