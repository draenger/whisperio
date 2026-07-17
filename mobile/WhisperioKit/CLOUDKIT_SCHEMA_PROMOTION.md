# CloudKit schema promotion checklist

`WhisperioKit` syncs two SwiftData `@Model`s into the private CloudKit database
`iCloud.ai.whisperio.mobile`: `RecordingEntity` (→ `CD_RecordingEntity`) and `DigestEntity` (→
`CD_DigestEntity`). Read this in full **before shipping any TestFlight/App Store build** whose
diff adds a new synced record type, or adds/renames/retypes a field on an existing one.

## Why this exists

SwiftData's `ModelConfiguration(cloudKitDatabase:)` creates CloudKit record schema *lazily*, on
first write — but only in the CloudKit **Development** environment. **Production never lazily
creates schema.** A signed, TestFlight/App Store build always talks to Production. So:

- A record type that only exists in Development syncs perfectly on every DEBUG build you've run
  locally, and then **silently fails to sync** on TestFlight/App Store — no crash, no error
  banner, `NSPersistentCloudKitContainer` just can't write records CloudKit doesn't recognize.
- This is exactly how `DigestEntity`/`CD_DigestEntity` shipped without sync for a while: the
  `@Model` existed, `RecordingEntity`'s schema had already been promoted, but nobody promoted
  `CD_DigestEntity` to Production before it started shipping.

`CloudKitSchema.swift`'s `WhisperioCloudKit.initializeSchemaForDevelopment()` (DEBUG-only) is the
one supported way to force CloudKit to materialize schema at all — but it only ever touches
Development. Getting a new/changed record type into Production is a **manual, one-time step per
schema change**, done through the CloudKit Console or `cktool`. There is no way to script or
automate this away; the checklist below is the guardrail.

## The checklist

1. **Run a DEBUG build, signed into a real iCloud account**, on a Mac or device (any WhisperioKit
   host app — `WhisperioApp`, the Mac app, etc.) so `WhisperioCloudKit.initializeSchemaForDevelopment()`
   actually executes at least once. This pushes the current hand-built schema
   (`CD_RecordingEntity` + `CD_DigestEntity`, see `CloudKitSchema.swift`) to CloudKit's
   **Development** environment. `CloudKitSchemaParityTests` (headless, no CloudKit account) keeps
   that hand-built schema honest against the `@Model` field lists — but it can't reach CloudKit
   itself, so this step is still required.
2. **Confirm in CloudKit Console** (icloud.developer.apple.com) → container
   `iCloud.ai.whisperio.mobile` → Schema → **Development** → Record Types: both `CD_RecordingEntity`
   and `CD_DigestEntity` are present, with every attribute added/changed in this release.
3. **Promote Development → Production.** Either:
   - CloudKit Console UI: **Deploy Schema Changes to Production**, or
   - CLI: `cktool export-schema` against Development, then `cktool import-schema` against
     Production for the same container.

   Promotion is additive/one-way for this project's needs — it only needs to happen again when a
   *new* record type or field appears, not on every release.
4. **Record the promotion below** (date, who, what changed, and flip `Status` to `PROMOTED`)
   **before** the TestFlight/App Store build that depends on it goes out. If a row's `Status` is
   `PENDING`, treat Production schema for that record type as unverified and do not ship — do
   steps 1–3 first. The release gate below enforces this mechanically for `CD_DigestEntity`.

## Promotion log

`Status` is machine-checked by the release gate below — keep it exactly `PROMOTED` or `PENDING`
(all caps, no other values) so the grep in that script keeps working.

| Date | Record type(s) / field(s) | Status | Notes |
|------|----------------------------|--------|-------|
| 2026-06 (approx) | `CD_RecordingEntity` (8 fields: id, filename, timestamp, duration, statusRaw, transcription, modifiedAt, entityName) | PROMOTED | Original lazy-created schema. **Stale for weeks**: the model grew `providerRaw`/`error`/`category`/`render`/`renderPresetID` but Production never learned them → every export batch failed → **nothing synced on TestFlight**. Root cause of the "recorded on iPhone, never appears on iPad" bug. |
| 2026-07-13 | `CD_RecordingEntity` +5 fields (`providerRaw`, `error`, `category`, `render`, `renderPresetID`) | PROMOTED | Imported to Development via `xcrun cktool import-schema` (management token, `--method file`), then Console → Deploy Schema Changes to Production. `cktool import-schema --environment production` is rejected by Apple ("endpoint not applicable") — the Console click is mandatory. |
| 2026-07-13 | `CD_DigestEntity` (dayKey, date, recordingIDsData, groupsData, summary, summaryGeneratedAt, modifiedAt, entityName) | PROMOTED | Same import + Console deploy as above. Verified by `cktool export-schema --environment production` showing both record types with full field lists. Schema source: `scratchpad` ckdb generated from `CloudKitSchema.swift` field lists. |
| 2026-07-16 | `CD_RecordingEntity` +2 fields (`segmentsData`, `speakerNamesData` — Conversation mode diarized segments + speaker names, both BYTES) | PROMOTED | Imported to Development via `xcrun cktool import-schema` (management token), Console → Deploy Schema Changes to Production clicked 2026-07-17. Verified by `cktool export-schema --environment production` showing both BYTES fields before the build-42 release. |

## Release gate — do not ship digest sync while `CD_DigestEntity` is `PENDING`

`DigestEntity`/`DigestSyncStore` (see `mobile/WhisperioKit/Sources/WhisperioKit/`) are fully wired
to sync through this same CloudKit container, so any TestFlight/App Store build cut while the row
above says `PENDING` ships digests that silently fail to sync on Production — the exact "digest
never appears on the other device" bug this checklist exists to prevent. Until the row is flipped
to `PROMOTED`, treat every release as blocked on digests specifically (recordings still sync fine,
since `CD_RecordingEntity` is already `PROMOTED`).

This is a preflight check that belongs in `~/.claude/skills/whisperio-release/SKILL.md` /
`mobile/WhisperioApp/Scripts/release-testflight.sh`, run before the archive step. It isn't wired in
yet — add it there, not here, next time that script is touched:

```bash
#!/usr/bin/env bash
# Preflight: refuse to ship if the diff touches digest sync and CD_DigestEntity is still PENDING.
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
promotion_doc="$repo_root/mobile/WhisperioKit/CLOUDKIT_SCHEMA_PROMOTION.md"
base_ref="${1:-origin/main}"

touches_digest_sync=$(git -C "$repo_root" diff --name-only "$base_ref"...HEAD -- \
  '*DigestEntity*.swift' '*DigestSyncStore*.swift' '*CloudKitSchema*.swift' | head -1)

if [[ -n "$touches_digest_sync" ]]; then
  if grep -qE '^\|.*`CD_DigestEntity`.*\|\s*PENDING\s*\|' "$promotion_doc"; then
    echo "REFUSING TO SHIP: diff touches digest sync and CD_DigestEntity is still PENDING" >&2
    echo "promotion to Production (see $promotion_doc)." >&2
    echo "Complete the promotion checklist there and flip the log row to PROMOTED first." >&2
    exit 1
  fi
fi
```

Even without that script wired in, **do not ship a build that syncs digests while the row above
reads `PENDING`** — this section exists so the gate can be dropped in mechanically the next time
someone is in `release-testflight.sh`, without re-deriving the grep from scratch.

## Cross-references

- `CloudKitSchema.swift` — the hand-built schema + `initializeSchemaForDevelopment()`; its doc
  comment carries the same four-step release note this file expands on.
- `CloudKitSchemaParityTests.swift` — headless test that fails CI the moment the hand-built schema
  (`CD_RecordingEntity`/`CD_DigestEntity` attribute names) drifts from the `@Model`s' stored
  properties. Catches "forgot to update the hand-built schema" — it cannot catch "forgot to
  promote to Production," which is what this checklist is for.
- `~/.claude/skills/whisperio-release/SKILL.md` (the `whisperio-release` skill used to ship this
  app to TestFlight) documents that **CloudKit containers/capabilities can't be provisioned
  headlessly** at all — the container and its entitlement have to exist via Xcode GUI or CloudKit
  Console first. This document is the next step after that one-time setup: once the container
  exists, every schema change on top of it still needs the promotion above before a TestFlight
  build depending on it ships. Run this checklist as part of that release flow, not instead of it.
