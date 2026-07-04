# Whisperio — Apple sync (CloudKit) + native Mac app: manual handoff

This is the **human-only** checklist for finishing the Apple-ecosystem sync work (T1). Everything
in code is already done — the SwiftData + CloudKit store (`mobile/WhisperioKit/Sources/WhisperioKit/RecordingSyncStore.swift`),
the migration, and the native-Mac sources under `mobile/WhisperioApp/MacApp/` all exist. What's left
can only be done in the Apple Developer portal, the Xcode 26 UI, and the CloudKit console, because
they touch signing, capabilities, and server-side schema — none of which live in the repo.

Do these steps in order. Team is **953Q6T2WTB**.

## 0. Identifiers this all hangs on

These strings are hard-coded in the shipping code — the portal/Xcode entries **must** match
character-for-character or the app fails to build or silently doesn't sync.

| Thing | Value | Source of truth |
|---|---|---|
| iCloud container | `iCloud.ai.whisperio.mobile` | `RecordingSyncStore.swift:49` (`cloudKitContainerID`) |
| App group | `group.ai.whisperio.mobile` | `mobile/WhisperioApp/WhisperioApp.entitlements` |
| iOS app bundle id | `ai.whisperio.mobile` | existing WhisperioApp target |
| Mac app bundle id | `ai.whisperio.mac` | new target (below) |
| Migration flag | `migratedV2` (UserDefaults) | `RecordingSyncStore.swift:10` |

## 1. Apple Developer portal — create the iCloud container

1. Sign in to <https://developer.apple.com/account> with an account on team **953Q6T2WTB**.
2. **Certificates, Identifiers & Profiles → Identifiers → (+) → iCloud Containers**.
3. Description: `Whisperio Mobile`. Identifier: **`iCloud.ai.whisperio.mobile`** (exactly — the
   portal prefixes `iCloud.`, so type `ai.whisperio.mobile` into the field). This is the CloudKit
   container; creating it here is what enables CloudKit for it.
4. Confirm the container is assigned to team **953Q6T2WTB** (it is by default for that team's account).
5. Under **Identifiers → `ai.whisperio.mobile`** (the iOS app id), edit **iCloud** capability and
   tick the new `iCloud.ai.whisperio.mobile` container so the app id is associated with it.
6. Confirm the **App Group** `group.ai.whisperio.mobile` exists (it's already used by the keyboard
   extension); if not, create it under **Identifiers → App Groups** and associate it with both app ids.

## 2. Xcode 26 — capabilities on the WhisperioApp (iOS) target

Open `mobile/WhisperioApp/WhisperioApp.xcodeproj`.

1. Select the **WhisperioApp** target → **Signing & Capabilities**.
2. Set **Team** to 953Q6T2WTB; keep **Automatically manage signing** on.
3. **(+) Capability → iCloud**. Enable **CloudKit**. In the **Containers** list, tick
   `iCloud.ai.whisperio.mobile` (do **not** let Xcode auto-create `iCloud.$(BUNDLE_IDENTIFIER)` —
   untick that if it appears).
4. **(+) Capability → Background Modes**. Tick **Remote notifications** (CloudKit pushes silent
   notifications to drive incremental sync).
5. Confirm the **App Groups** capability still lists `group.ai.whisperio.mobile`.
6. **Verify the entitlements file matches** — Xcode edits `WhisperioApp.entitlements` for you, but
   it must end up equal to what the code step already committed:
   - `com.apple.developer.icloud-container-identifiers` → `iCloud.ai.whisperio.mobile`
   - `com.apple.developer.icloud-services` → `CloudKit`
   - `com.apple.security.application-groups` → `group.ai.whisperio.mobile`
   - Background Modes adds `remote-notification` to `UIBackgroundModes` in Info.plist.
   If Xcode wrote different values, fix them to match `mobile/WhisperioApp/WhisperioApp.entitlements`
   verbatim — the repo file is the source of truth.

## 3. CloudKit schema — initialize in DEBUG, then deploy to Production

SwiftData's CloudKit mirroring needs the record types (from `RecordingEntity`) to exist in the
CloudKit **Development** schema before anything syncs, and in **Production** before you ship. The
schema is created by running `initializeCloudKitSchema` **once** against Development.

1. In a **DEBUG** build only, temporarily add a one-shot schema-init call after the container is
   built. The store's container is private (`RecordingSyncStore.init`), so do it on the same
   `ModelContainer` — e.g. in a scratch DEBUG entry point:

   ```swift
   #if DEBUG
   // One-time, run on a real signed device/simulator with the iCloud container available.
   try store.container.initializeCloudKitSchema(options: [])
   #endif
   ```

   (`store.container` is the `ModelContainer` inside `RecordingSyncStore`; expose it or run the call
   from within WhisperioKit behind `#if DEBUG`. Remove this scaffolding after the run — it is not
   meant to ship.)
2. Run once on a device/simulator signed into an iCloud account on the dev team. It creates the
   `CD_RecordingEntity` record type + fields (`id`, `timestamp`, `category`, `render`,
   `renderPresetID`, `modifiedAt`, …) in the **Development** environment.
3. Open the **CloudKit Console** → <https://icloud.developer.apple.com/dashboard> → container
   `iCloud.ai.whisperio.mobile` → **Schema**. Confirm the record type and every field appear.
4. **Deploy to Production**: CloudKit Console → **Deploy Schema Changes** → review the diff →
   **Deploy**. Production is append-only for schema, so get it right in Development first.
5. Remove the DEBUG `initializeCloudKitSchema` scaffolding before cutting a release build.

> Ship gate: **never** ship a TestFlight/App Store build before the schema is deployed to
> Production — a prod build against an un-deployed schema fails to sync with opaque errors.

## 4. Create the native macOS app target — WhisperioMac

The sources exist but are **not** wired into any Xcode target (see the note atop
`mobile/WhisperioApp/MacApp/WhisperioMacApp.swift`). Everything macOS-specific is guarded by
`#if os(macOS)`, so the folder drops into a fresh target without edits.

1. In `WhisperioApp.xcodeproj`: **File → New → Target → macOS → App**.
   - Product Name: **WhisperioMac**
   - Bundle Identifier: **`ai.whisperio.mac`**
   - Interface: **SwiftUI**, Language: **Swift**
   - Minimum Deployment: **macOS 14**
   - Team: **953Q6T2WTB**
2. Delete the boilerplate `ContentView.swift` / `App.swift` Xcode generated for the new target.
3. Add the existing sources to the WhisperioMac target (drag into the target, or **Add Files** with
   *only* WhisperioMac ticked in **Target Membership**):
   - `mobile/WhisperioApp/MacApp/WhisperioMacApp.swift` (the `@main` entry point)
   - `mobile/WhisperioApp/MacApp/ContentView.swift`
   - `mobile/WhisperioApp/MacApp/WhisperioMac.entitlements`
4. **Link WhisperioKit**: target **General → Frameworks, Libraries, and Embedded Content → (+) →
   WhisperioKit** (the local Swift package). `ContentView.swift` and `WhisperioMacApp.swift`
   `import WhisperioKit`.
5. **Signing & Capabilities** for WhisperioMac — set **Code Signing Entitlements** build setting to
   `MacApp/WhisperioMac.entitlements`, then confirm each capability (they're already in that file):
   - **App Sandbox** (`com.apple.security.app-sandbox`)
   - **Microphone** / audio input (`com.apple.security.device.audio-input`) — add an
     `NSMicrophoneUsageDescription` string to the target's Info.plist too.
   - **iCloud → CloudKit** with container `iCloud.ai.whisperio.mobile` (same container as iOS — this
     is what makes the Mac join the shared journal).
   - **App Groups** → `group.ai.whisperio.mobile`.
6. In the portal, create/confirm an App ID for **`ai.whisperio.mac`** and associate it with the same
   iCloud container and App Group as in step 1.
7. Build & run WhisperioMac. On an unsigned/no-iCloud dev build it falls back to an in-memory store
   (`ContentView.makeStore()`), so the window still renders; a signed build with the container joins
   CloudKit.

## 5. Two-device QA checklist

Do this on **real hardware** signed into the **same Apple ID** (CloudKit private DB is per-Apple-ID;
the simulator's iCloud is unreliable for push).

- [ ] Sign iPhone **and** iPad into the same Apple ID; sign the Mac into that same Apple ID.
- [ ] Confirm iCloud Drive / iCloud is on for the account on all three.
- [ ] **Record on iPhone** → wait for transcription to complete.
- [ ] **Verify it appears on iPad** (WhisperioApp history) within a minute or two (CloudKit push +
      SwiftData mirror is not instant).
- [ ] **Verify it appears on Mac** (WhisperioMac history list) — same journal, same store.
- [ ] **Migration ran once**: on a device that had a legacy `Documents/recordings.json`, confirm the
      old history imported into the synced list, that a `recordings.json.migrated` marker was left
      behind, and that the `migratedV2` UserDefaults flag is set. Relaunch and confirm the migration
      does **not** re-run or duplicate rows (it's idempotent on id and gated on the flag —
      `RecordingSyncStore.swift:160`).
- [ ] **LWW category edit**: assign a recording to category A on iPhone; after it syncs, reassign the
      same recording to category B on iPad. Both edits bump `modifiedAt`
      (`RecordingSyncStore.setCategory`, `RecordingSyncStore.swift:85`), and reads resolve the row
      with the newest `modifiedAt` (`firstEntity`, `RecordingSyncStore.swift:120`; dedup at read via
      `RecordingSync.dedupByID`). Confirm the **later** edit (category B) wins on all three devices,
      not a duplicate or the older value.

## 6. Coexistence decision (context for reviewers)

Deliberate, not an oversight:

- The **native macOS app (WhisperioMac)** is the Apple-ecosystem product. It joins CloudKit and
  shares one journal with iPhone/iPad because they're all one Apple ID / one private CloudKit DB.
- The **Electron desktop app stays the Windows app** and does **not** join CloudKit. Cross-ecosystem
  sync (Windows ⇄ Apple) is handled by the GitHub-based sync path (**T4**), not CloudKit — CloudKit
  is Apple-only and can't reach Windows.

So: Apple devices sync via CloudKit (this doc); Windows participates via GitHub sync (T4). The two
paths are independent by design.
