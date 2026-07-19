---
name: "source-command-pr"
description: "Verify-before-PR for whisperio. Electron desktop (typecheck:node + typecheck:web + tests + electron-vite build), plus secret scan focused on OpenAI/ElevenLabs API keys (which would be a leak — keys live in OS secure store at runtime, never in code), TODO audit, and electron-builder dry-run validation when packaging-relevant files change. Implements the loop-engineer \"don't get the agent self-verify\" rule."
---

# source-command-pr

Use this skill when the user asks to run the migrated source command `pr`.

## Command Template

# /pr — whisperio

Pre-flight before pushing. Run from a **fresh** Codex session.

## 1. Typecheck

```bash
npm run typecheck:node
npm run typecheck:web
```

Both must pass clean. Red on any error.

## 2. Tests

```bash
npm test -- --run
```

Vitest. Red on any failed test.

## 3. Lint (if configured)

```bash
ls eslint.config.* 2>/dev/null && npx eslint .
```

Yellow on warnings, red on errors. Skip with note if no eslint config.

## 4. Build (full electron-vite build)

```bash
npm run build
```

Heavy step (1–3 min). Catches packaging-config errors that typecheck misses.

## 5. Secret scan

Whisperio is a "bring-your-own-key" app — API keys MUST NOT be in the codebase. Grep diff for:
- OpenAI: `sk-[a-zA-Z0-9]{20,}`, `sk-proj-[A-Za-z0-9_-]{20,}`
- ElevenLabs: `xi-[A-Za-z0-9]{32,}`
- Generic API keys / tokens
- `.env` MUST NOT be in the diff (gitignored, but `git add -f .env` could leak)

Specifically: ensure no test fixture file contains a real key (use `sk-FAKE-…` patterns for tests).

## 6. electron-builder dry-run (when packaging files change)

If `git diff --name-only` includes `electron-builder.yml`, `package.json` (deps / electronBuilder section), or `src/main/`:

```bash
npx electron-builder --dir --publish never
```

This packages without publishing — surfaces signing / icon / asset / entitlements errors locally before pushing to CI.

## 7. Code-signing reminder (when macOS code touched)

If `git diff` includes `src/main/` on macOS-specific paths or `electron-builder.yml` macOS section:
- Surface yellow: "macOS builds are currently UNSIGNED. ci is non-blocking on signature check. Either keep unsigned (TestFlight handles signing for the mobile app, desktop ships as 'verify with xattr -cr') or wire up Developer ID."

## 8. TODO / FIXME audit

```bash
git diff --name-only origin/main...HEAD | xargs grep -n -E "TODO|FIXME|XXX" 2>/dev/null
```

## Output

```
PR pre-flight — whisperio on branch <name>
  ✓ Typecheck (node)     OK
  ✓ Typecheck (web)      OK
  ✓ Tests                32 passed, 0 failed
  ⚠ Lint                 2 warnings (no errors)
  ✓ Build                electron-vite build OK (1m 12s)
  ✓ Secrets              0 hits — keys belong in OS secure store
  ✓ electron-builder     dry-run OK (Windows NSIS target)
  ⚠ TODO                 1 in src/main/hotkey.ts:88

Verdict  PASS-with-notes (2 lint warnings, 1 TODO)
```
