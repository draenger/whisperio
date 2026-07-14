#!/usr/bin/env bash
# Mobile reachability sweep — Gate 3 (AUTOBUILD-SPEC.md): "Any orphan is a FAILURE."
#
# Scans mobile/WhisperioApp/Sources/**/*.swift for every `struct X: View`
# declaration (top-level screens/widgets — includes generic-constrained ones
# like `struct SettGroup<Content: View>: View`) and checks each has a real
# call-site (`Name(` or the SwiftUI trailing-closure form `Name {`) somewhere
# in that same tree, outside its own declaration line. A View with no call-site
# is dead code / a wiring bug — exactly the class of finding the 2026-07-14
# wiring pass (docs/PARITY.md) closed 46 of by hand. This script automates
# that sweep so it can't silently regress.
#
# Deliberately dependency-free: no new Swift package, no SwiftSyntax — a
# regex-based scan via the python3 that ships with macOS, same spirit as
# desktop/tests/reachability.spec.ts's regex-based JS/TS analyzer.
#
# Scope: mobile/WhisperioApp/Sources/WhisperioApp/** only, matching the task
# that commissioned this script. The Keyboard/, Widget/, MacApp/, and
# "WhisperioWatch Watch App/" targets are separate SwiftUI app shells that do
# NOT import this module's views (verified: no `import WhisperioApp` in any
# of them) — so this scope is self-contained, not a gap.
#
# Usage:
#   ./check-reachability.sh            # human-readable report
#   ./check-reachability.sh --quiet    # only print output on failure
# Exit code: 0 if every non-allowlisted View has a call-site, 1 otherwise.
set -euo pipefail

trap 'echo "✘ check-reachability aborted (line $LINENO)" >&2' ERR

QUIET=0
case "${1:-}" in
  ""|--quiet) [[ "${1:-}" == "--quiet" ]] && QUIET=1 ;;
  *) echo "✘ unknown argument: $1 (expected --quiet or none)" >&2; exit 2 ;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"           # …/whisperio
SRC="$REPO/mobile/WhisperioApp/Sources/WhisperioApp"
ALLOWLIST="$HERE/reachability-allowlist.txt"

command -v python3 >/dev/null || { echo "✘ python3 not on PATH (ships with macOS — check your shell setup)" >&2; exit 1; }
[[ -d "$SRC" ]] || { echo "✘ source dir not found: $SRC" >&2; exit 1; }
[[ -f "$ALLOWLIST" ]] || { echo "✘ allowlist file not found: $ALLOWLIST" >&2; exit 1; }

# Not `set -e`-guarded: a nonzero exit here means "orphans found", the
# script's actual job, not a crash — the ERR trap above is for genuine
# tooling failures (missing python3, bad args), so run this one explicitly.
trap - ERR
set +e
python3 "$HERE/reachability_check.py" "$SRC" "$ALLOWLIST" "$QUIET"
exit $?
