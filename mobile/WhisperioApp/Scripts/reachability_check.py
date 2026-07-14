#!/usr/bin/env python3
"""Regex-based static reachability check for SwiftUI View structs.

Invoked by check-reachability.sh; see that file's header comment for scope
and rationale. Kept as a separate .py (rather than inlined in the .sh via a
heredoc) so it's independently readable/testable.

Mechanism:
  1. "Defined": every `struct X ... : ... View ... {` declaration under
     SRC/**/*.swift, including generic-constrained ones
     (`struct SettGroup<Content: View>: View`).
  2. "Reachable": for a defined name X, a real call-site `X(` or the SwiftUI
     trailing-closure form `X {` exists anywhere in SRC/**/*.swift, on a line
     other than X's own declaration line. Lines inside a `#Preview { ... }`
     one-liner count as "preview-only", not "reachable" — a view exercised
     solely by an Xcode Preview never ships in the running app, which is
     exactly the gap Gate 3 cares about. Preview-only views must be
     allowlisted explicitly (see reachability-allowlist.txt), not silently
     passed.
  3. Orphan = defined, not reachable, not preview-only, not allowlisted.
"""
from __future__ import annotations

import pathlib
import re
import sys

STRUCT_RE = re.compile(
    r'^[ \t]*((?:private|fileprivate|internal|public)\s+)*'
    r'struct\s+([A-Za-z_][A-Za-z0-9_]*)\b[^\n{]*:[^\n{]*\bView\b',
    re.MULTILINE,
)


def find_defined(files: list[pathlib.Path], texts: dict[pathlib.Path, str]) -> dict[str, tuple[pathlib.Path, int, bool]]:
    defined: dict[str, tuple[pathlib.Path, int, bool]] = {}
    dupes: list[str] = []
    for f in files:
        text = texts[f]
        for m in STRUCT_RE.finditer(text):
            mods, name = m.group(1) or '', m.group(2)
            is_private = 'private' in mods or 'fileprivate' in mods
            lineno = text.count('\n', 0, m.start()) + 1
            if name in defined:
                dupes.append(f'{name} (in both {defined[name][0]} and {f})')
                continue
            defined[name] = (f, lineno, is_private)
    if dupes:
        print('warning: duplicate View struct names (kept first occurrence):', file=sys.stderr)
        for d in dupes:
            print(f'  - {d}', file=sys.stderr)
    return defined


def find_reachability(
    defined: dict[str, tuple[pathlib.Path, int, bool]], lines_map: dict[pathlib.Path, list[str]]
) -> tuple[set[str], set[str]]:
    reachable: set[str] = set()
    preview_only: set[str] = set()
    for name, (declfile, declline, _is_private) in defined.items():
        call_re = re.compile(r'(?<![A-Za-z0-9_])' + re.escape(name) + r'\s*[({]')
        real = False
        preview = False
        for f, lines in lines_map.items():
            for i, line in enumerate(lines, start=1):
                if f == declfile and i == declline:
                    continue
                if not call_re.search(line):
                    continue
                if line.lstrip().startswith('#Preview'):
                    preview = True
                else:
                    real = True
        if real:
            reachable.add(name)
        elif preview:
            preview_only.add(name)
    return reachable, preview_only


def load_allowlist(path: pathlib.Path) -> dict[str, str]:
    allow: dict[str, str] = {}
    for raw in path.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        if '\t' in line:
            name, reason = line.split('\t', 1)
        else:
            parts = line.split(None, 1)
            name, reason = parts[0], (parts[1] if len(parts) > 1 else '')
        allow[name.strip()] = reason.strip()
    return allow


def main() -> int:
    src = pathlib.Path(sys.argv[1])
    allowlist_path = pathlib.Path(sys.argv[2])
    quiet = sys.argv[3] == '1'

    files = sorted(src.rglob('*.swift'))
    texts = {f: f.read_text(encoding='utf-8') for f in files}
    lines_map = {f: t.splitlines() for f, t in texts.items()}

    defined = find_defined(files, texts)
    reachable, preview_only = find_reachability(defined, lines_map)
    allowlist = load_allowlist(allowlist_path)

    defined_names = set(defined)
    orphans = sorted(defined_names - reachable - preview_only - set(allowlist))
    stale_allowlist = sorted(set(allowlist) - defined_names)
    # Allowlisted names that are actually reachable now don't need the entry
    # anymore — flag so the allowlist doesn't quietly rot into dead weight.
    unnecessary_allowlist = sorted(set(allowlist) & reachable)

    def rel(f: pathlib.Path) -> str:
        return str(f.relative_to(src.parent.parent.parent.parent))

    ok = not orphans and not stale_allowlist

    if not quiet or not ok:
        print(f'defined: {len(defined)} · reachable: {len(reachable)} · '
              f'preview-only: {len(preview_only)} · allowlisted: {len(allowlist)}')
        print()
        if preview_only:
            listed = sorted(n for n in preview_only if n in allowlist)
            unlisted = sorted(n for n in preview_only if n not in allowlist)
            if unlisted:
                print('Preview-only, NOT allowlisted (will FAIL — add to reachability-allowlist.txt with a reason, or wire it up):')
                for n in unlisted:
                    f, ln, _ = defined[n]
                    print(f'  - {n}  ({rel(f)}:{ln})')
                print()
            if listed:
                print('Preview-only, allowlisted (informational, not a failure):')
                for n in listed:
                    f, ln, _ = defined[n]
                    print(f'  - {n}  ({rel(f)}:{ln}) — {allowlist[n]}')
                print()
        if orphans:
            print('Orphan components (defined, no call-site, not allowlisted):')
            for n in orphans:
                f, ln, is_private = defined[n]
                print(f'  - {n}  ({rel(f)}:{ln}){" [private]" if is_private else ""}')
            print()
        if stale_allowlist:
            print('Stale allowlist entries (no longer defined — remove them):')
            for n in stale_allowlist:
                print(f'  - {n}')
            print()
        if unnecessary_allowlist:
            print('Note: allowlist entries now reachable via a real call-site (safe to remove, not required):')
            for n in unnecessary_allowlist:
                print(f'  - {n}')
            print()

    # preview-only views not on the allowlist are also orphans for exit-code
    # purposes: not shipped-app-reachable, and not consciously accepted.
    unlisted_preview = [n for n in preview_only if n not in allowlist]
    ok = ok and not unlisted_preview

    if ok:
        if not quiet:
            print('✓ every View struct is reachable (or explicitly, justifiably allowlisted)')
        return 0

    print('✘ reachability sweep FAILED', file=sys.stderr)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
