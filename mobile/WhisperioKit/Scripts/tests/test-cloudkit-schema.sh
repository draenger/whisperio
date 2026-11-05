#!/usr/bin/env bash
# Tests for cloudkit-schema.sh with a fake `xcrun cktool` (no Mac, no CloudKit account needed).
# Run: bash mobile/WhisperioKit/Scripts/tests/test-cloudkit-schema.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
script="$here/../cloudkit-schema.sh"
repo_schema="$here/../../cloudkit/whisperio.ckdb"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
pass=0; fail=0
ok() { pass=$((pass + 1)); echo "  ok   $1"; }
bad() { fail=$((fail + 1)); echo "  FAIL $1"; }

# Fake xcrun: state lives in $FAKE/dev.ckdb and $FAKE/prod.ckdb; every call is logged.
mkdir -p "$work/bin"
cat > "$work/bin/xcrun" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE/calls.log"
[ "$1" = cktool ] || exit 9
shift; sub="$1"; shift
env=""; file=""; out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --environment) env="$2"; shift 2 ;;
    --file) file="$2"; shift 2 ;;
    --output-file) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
case "$sub" in
  get-teams) [ -f "$FAKE/no-token" ] && exit 1; echo "953Q6T2WTB" ;;
  export-schema) [ "$env" = development ] && cp "$FAKE/dev.ckdb" "$out" || cp "$FAKE/prod.ckdb" "$out" ;;
  validate-schema) grep -q "DEFINE SCHEMA" "$file" && ! grep -q "^,$" "$file" ;;
  import-schema) [ "$env" = development ] || { echo "endpoint not applicable" >&2; exit 1; }; cp "$file" "$FAKE/dev.ckdb"; cp "$file" "$FAKE/imported.ckdb" ;;
  *) exit 9 ;;
esac
EOF
chmod +x "$work/bin/xcrun"

# Live Development as it might really look: no CD_source yet, an extra live-only asset field,
# index flags on two fields. None of that may be changed by an import.
live_dev() {
  sed -e '/CD_source /d' \
      -e 's/^\(        CD_timestamp            TIMESTAMP\),/\1 QUERYABLE SORTABLE,/' \
      -e 's/^\(        CD_segmentsData         BYTES,\)/\1\n        CD_segmentsData_ckAsset ASSET,/' "$repo_schema"
}

setup() { # $1 = case name
  export FAKE="$work/$1"; mkdir -p "$FAKE"
  cp "$repo_schema" "$FAKE/repo.ckdb"
  export CK_REPO_SCHEMA="$FAKE/repo.ckdb" CK_OUT_DIR="$FAKE/out" PATH="$work/bin:$PATH"
  : > "$FAKE/calls.log"
}

echo "cloudkit-schema.sh"

# 1. import-dev adds exactly CD_source and keeps every live detail
setup import
live_dev > "$FAKE/dev.ckdb"; cp "$FAKE/dev.ckdb" "$FAKE/dev-before.ckdb"; live_dev > "$FAKE/prod.ckdb"
out="$(bash "$script" import-dev --yes 2>&1)"; rc=$?
[ $rc -eq 0 ] && ok "import-dev exits 0" || bad "import-dev exits 0 (rc=$rc): $out"
echo "$out" | grep -q "+ CD_RecordingEntity.CD_source STRING" && ok "plan lists + CD_RecordingEntity.CD_source STRING" || bad "lists CD_source: $out"
added="$(diff "$FAKE/dev-before.ckdb" "$FAKE/imported.ckdb" | grep '^>' )"
[ "$added" = ">         CD_source STRING," ] && ok "the import adds exactly one line: CD_source STRING" || bad "import diff is only CD_source: [$added]"
diff "$FAKE/dev-before.ckdb" "$FAKE/imported.ckdb" | grep -q '^<' && bad "import removed/changed a live line" || ok "no live line removed or changed"
grep -q "CD_segmentsData_ckAsset ASSET," "$FAKE/imported.ckdb" && grep -q "CD_timestamp            TIMESTAMP QUERYABLE SORTABLE," "$FAKE/imported.ckdb" \
  && ok "live-only field and index flags kept" || bad "live details kept"
cmp -s "$FAKE/repo.ckdb" "$FAKE/dev.ckdb" && ok "repo schema refreshed from the new Development export" || bad "repo schema refreshed"
grep -q "production" "$FAKE/calls.log" && grep "import-schema" "$FAKE/calls.log" | grep -q production && bad "never imports to production" || ok "never imports to production"

# 2. running it again: nothing to import, no import call
: > "$FAKE/calls.log"
out="$(bash "$script" import-dev --yes 2>&1)"; rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -q "nothing to import" && ! grep -q import-schema "$FAKE/calls.log" \
  && ok "second run: nothing to import, no import-schema call" || bad "second run idempotent: $out"

# 3. a type conflict stops before any import
setup conflict
live_dev | sed 's/CD_duration             DOUBLE/CD_duration             STRING/' > "$FAKE/dev.ckdb"; cp "$FAKE/dev.ckdb" "$FAKE/prod.ckdb"
out="$(bash "$script" import-dev --yes 2>&1)"; rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q "TYPE CONFLICTS" && ! grep -q import-schema "$FAKE/calls.log" \
  && ok "type conflict: exit 1, no import-schema call" || bad "type conflict stops: rc=$rc $out"

# 4. no confirmation, no import
setup decline
live_dev > "$FAKE/dev.ckdb"; cp "$FAKE/dev.ckdb" "$FAKE/prod.ckdb"
out="$(echo n | bash "$script" import-dev 2>&1)"; rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q "cancelled" && ! grep -q import-schema "$FAKE/calls.log" \
  && ok "answer n: cancelled, no import-schema call" || bad "decline: rc=$rc $out"

# 5. a record type with no GRANT lines gets valid commas
setup nogrant
live_dev | awk '/RECORD TYPE CD_RecordingEntity/ { r = 1 } r && /GRANT/ { next } r && /\);/ { r = 0 } { print }' \
  | awk '{ a[NR] = $0 } END { for (i = 1; i <= NR; i++) { if (i < NR && a[i + 1] ~ /^    \);/ && a[i] ~ /CD_transcription/) sub(/,$/, "", a[i]); print a[i] } }' > "$FAKE/dev.ckdb"
cp "$FAKE/dev.ckdb" "$FAKE/prod.ckdb"
bash "$script" import-dev --yes >/dev/null 2>&1; rc=$?
tail_rec="$(awk '/RECORD TYPE CD_RecordingEntity/ { r = 1 } r { print } r && /\);/ { r = 0 }' "$FAKE/imported.ckdb" 2>/dev/null | tail -3)"
[ $rc -eq 0 ] && echo "$tail_rec" | grep -q "CD_transcription        STRING,$" && echo "$tail_rec" | grep -q "CD_source STRING$" \
  && ok "no GRANT lines: previous field gets a comma, new last field has none" || bad "no-GRANT commas: rc=$rc [$tail_rec]"

# 6. a whole missing record type is copied from the repo schema
setup newtype
live_dev | awk '/RECORD TYPE CD_DigestEntity/ { s = 1 } s { if (/\);/) { s = 0 }; next } { print }' > "$FAKE/dev.ckdb"
cp "$FAKE/dev.ckdb" "$FAKE/prod.ckdb"
bash "$script" import-dev --yes >/dev/null 2>&1; rc=$?
[ $rc -eq 0 ] && grep -q "RECORD TYPE CD_DigestEntity" "$FAKE/imported.ckdb" && [ "$(grep -c 'RECORD TYPE CD_DigestEntity' "$FAKE/imported.ckdb")" = 1 ] \
  && ok "missing record type copied once from the repo schema" || bad "missing record type: rc=$rc"

# 7. verify-prod: FAIL while Production lacks CD_source, PASS once it has it
setup verify
live_dev > "$FAKE/dev.ckdb"; live_dev > "$FAKE/prod.ckdb"
out="$(bash "$script" verify-prod 2>&1)"; rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q "FAIL" && echo "$out" | grep -q "CD_source" && ok "verify-prod FAIL names CD_source" || bad "verify-prod fail: rc=$rc $out"
cp "$repo_schema" "$FAKE/prod.ckdb"
out="$(bash "$script" verify-prod 2>&1)"; rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -q "PASS" && ok "verify-prod PASS when Production has every field" || bad "verify-prod pass: rc=$rc $out"

# 8. no management token: clear message, no export
setup notoken
touch "$FAKE/no-token"; live_dev > "$FAKE/dev.ckdb"; cp "$FAKE/dev.ckdb" "$FAKE/prod.ckdb"
out="$(bash "$script" plan 2>&1)"; rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q "save-token --type management" && ! grep -q export-schema "$FAKE/calls.log" \
  && ok "no token: tells how to save it, no export" || bad "no token: rc=$rc $out"

echo "passed $pass, failed $fail"
[ $fail -eq 0 ]
