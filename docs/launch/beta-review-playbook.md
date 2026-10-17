# TestFlight Beta App Review: what can go wrong and what we answer

Status when written (2026-10-17): Whisperio 1.0.0, build 77 (iOS + macOS), external TestFlight group "Beta", state `WAITING_FOR_BETA_REVIEW`. (`docs/release-runbook.md` mentions build 76 as an earlier external beta already in review; check ASC for which build is actually attached.)

Quotes below are verbatim from the official corpus:
`/Volumes/DevDisk/Projects/apex-knowledge/legal/corpus/platform/apple/app-review-guidelines.txt` (ASC-side wording: `.../app-privacy-details.txt`).
Review notes source of truth: `mobile/marketing/app-store-review-notes.md`.

## (a) How Beta App Review differs from App Review

- Same rulebook, lighter pass. Guideline 2.2 (corpus, "Beta Testing"): "Any app submitted for beta distribution via TestFlight should be intended for public distribution and should comply with the App Review Guidelines." and "Significant updates to your beta build should be submitted to TestFlight App Review before being distributed to your testers."
- Only the first build of a version, and significant changes, go to Beta App Review; internal testers need none.
- What Apple looks at for an external build (our reading, not an Apple quote): the build installs and does not crash, the "App Review Information" / review notes let the reviewer exercise it, the beta description / "what to test" is present, and the privacy policy URL works.
- The anchor rule is 2.1(a): "Submissions to App Review, including apps you make available for pre-order, should be final versions with all necessary metadata and fully functional URLs included; placeholder text, empty websites, and other temporary content should be scrubbed before submission. Make sure your app has been tested on-device for bugs and stability before you submit it, and include demo account info (and turn on your back-end service!) if your app includes a login. ... We will reject incomplete app bundles and binaries that crash or exhibit obvious technical problems."
- Whisperio has no login (no demo account needed) and no back-end of ours.

## (b) Likely rejection reasons and our reply

### 1. 2.1 Missing information / could not test
Reply (paste into the reply field):
> Whisperio needs no account and no API key. The default engine is Apple's on-device speech recognition, so dictation works on first launch with no network. Steps: (1) launch; (2) on Home tap the big microphone, speak, tap again; the transcript appears in the list and is copied to the clipboard. Optional features (cloud providers with the user's own key, keyboard, Apple Watch, iCloud sync) are not needed to evaluate the app. Full steps are in the App Review Information notes.

Fix if the reviewer really could not test: check that the language they used has on-device recognition (the app says so instead of sending audio anywhere); add that to the notes.

### 2. 5.1.1(i)/(ii) Privacy
- 5.1.1(i): "All apps must include a link to their privacy policy in the App Store Connect metadata field and within the app in an easily accessible manner." Already done: policy URL https://whisperio.danielkasprzyk.com/privacy.html in ASC metadata and in the app. Re-verify the URL returns 200 before replying.
- 5.1.1(ii): "Ensure your purpose strings clearly and completely describe your use of the data." Current strings in `mobile/WhisperioApp/WhisperioApp.xcodeproj/project.pbxproj`:
  - `NSMicrophoneUsageDescription` (app): "Whisperio records your voice to transcribe it into text. Audio is sent to a cloud provider only if you choose one in Settings."
  - `NSSpeechRecognitionUsageDescription` (app): "Whisperio uses speech recognition to turn your dictation into text. Recognition runs on your device unless you allow online recognition in Settings."
  - `NSMicrophoneUsageDescription` (Watch): "Whisperio records your voice on Apple Watch to transcribe it."
- 5.1.2(i) (third-party AI): "You must clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so." Our facts: cloud use sits behind an in-app consent sheet; keys are the user's; no Whisperio server. Name the consent sheet in the reply.
- If the question is about the App Privacy label, see `app-privacy-details.txt` and the legal notes in `docs/notes/2026-10-16-legal.md`; do not change the label in a reply without the owner.

### 3. 4.4.1 Keyboard extension
Rule (corpus): "Keyboard extensions have some additional rules. They must: Provide keyboard input functionality (e.g. typed characters); ... Provide a method for progressing to the next keyboard; Remain functional without full network access and without requiring full access; ... Collect user activity only to enhance the functionality of the user's keyboard extension on the iOS device. They must not: Launch other apps besides Settings; or Repurpose keyboard buttons for other behaviors".
Our facts (from the review notes): the keyboard types normally without Full Access; Full Access (`RequestsOpenAccess`) is needed only for the mic key to hand the recording to the main app over the shared App Group and, if the user chose a cloud provider, to reach it; the keyboard asks in place and works as a plain keyboard without it.
Honest risk: the mic key opens Whisperio itself (our own app) to record. The rule says "Launch other apps besides Settings"; our position is that this is the containing app, not another app, and that iOS keyboard extensions cannot record in-process. Say exactly that, do not overclaim. If Apple objects, the fix is a UX change (owner decision), not a wording change.
Reply draft:
> The keyboard provides typed input, has a next-keyboard key, and is fully functional without Full Access and without network. Full Access is requested only for the optional mic key. The mic key opens Whisperio, the keyboard's own containing app, because a keyboard extension cannot capture audio itself; it launches no other app. The keyboard makes no network requests (no URLSession in Keyboard/); it stores nothing off the device — only the on-device App Group hand-off to the Whisperio app (last inserted transcript, text selected for rewrite) via SharedStore.

(Verify the last sentence against the source before sending.)

### 4. 2.5.4 Background modes
Rule: "Multitasking apps may only use background services for their intended purposes: VoIP, audio playback, location, task completion, local notifications, etc." Declared in `mobile/WhisperioApp/AppInfo.plist`: `audio` and `remote-notification`.
Justification (from the review notes): `audio` lets a dictation in progress finish when the screen locks / on the watch. `remote-notification` carries CloudKit silent pushes for the optional iCloud history sync; there are no user-facing push notifications.
Fallback if Apple disputes `audio`: it is recording-in-progress continuation, not playback; if that is rejected, the choice is to drop the mode and accept that locking the screen stops dictation (owner decision).

### 5. iCloud sync does not work in the beta
Known: the CloudKit Production schema still lacks the `source` field until the owner deploys it, so sync may fail for TestFlight testers. The what-to-test text already says so.
Honest answer if asked:
> iCloud sync is an optional feature that uses only the user's private CloudKit database. The Production schema deployment is still pending, so sync may not complete in this beta build. All core functionality (on-device dictation, history, keyboard, Watch) works without it. It will be enabled once the schema is deployed.

Do not claim it works. `Scripts/preflight-cloudkit.sh` reports the promotion state; `--allow-pending-schema` on release exists for this case.

### 6. "AI" content / AI Act notice
We label AI output in the app. Optional AI cleanup sends transcript text to the user's own LLM provider with the user's key, after the same consent. The label is `AINoticeLabel` ("Generated by AI — check before you rely on it.") under the daily summary card (`DigestDayView.swift`) and under the AI rewrite card (`DetailView.swift`); the Mac app reuses those views. (confirm on a device first, do not guess).

### 7. Crash on launch / "binary crashes"
- Collect: ASC -> TestFlight -> Crashes (per build, with symbolicated stack traces), and the tester feedback screenshots. On a device: Settings -> Privacy & Security -> Analytics & Improvements -> Analytics Data (`Whisperio-*.ips`).
- `xcrun simctl` does not apply (TestFlight builds run on devices).
- Build logs: `/Volumes/DevDisk/whisperio-build/` (archive/export/upload logs, if DevDisk was mounted during the release; otherwise under `$HOME`, see `Scripts/release-testflight.sh`).
- Reply only with a fixed build; do not argue "cannot reproduce" without a device log.

## (c) Where to reply, and who does what

- App Review (store submission): ASC -> app -> the version -> App Review / Resolution Center messages. Reply there; attach screenshots if useful.
- Beta App Review (TestFlight): Apple emails the account holder (owner). Reply to that email or via ASC -> TestFlight -> the build / Test Information. A rejected build is fixed by a new build or by changing Test Information, then resubmitted from the TestFlight page.
- Who: Daniel (owner) clicks, logs in, sends. bee drafts the reply text from this file, checks claims against the repo, and opens fix branches. Anything touching privacy label, background modes or the keyboard UX is an owner decision.

## (d) Re-submit checklist after a fix

1. Reproduce / confirm the rejection reason in writing (email or Resolution Center text) in an issue.
2. Fix on a branch; for metadata-only fixes (notes, what-to-test) no new build is needed.
3. Bump the build (`CURRENT_PROJECT_VERSION`; ASC may auto-manage it via `manageAppVersionAndBuildNumber`).
4. Archive and upload with `mobile/WhisperioApp/Scripts/release-testflight.sh`. It runs the preflights before archiving: `preflight-cloudkit.sh` (schema promotion) and `preflight-signing.sh` (profile vs certificate), plus the `swift test` gate unless `--no-verify`. Do not skip the gate to save time.
5. Wait for the build to become `VALID` in TestFlight (see `docs/release-runbook.md`).
6. Attach the build to the "Beta" external group, re-check "what to test" and review notes, submit for Beta App Review.
7. Reply to Apple's message with what changed.

No build is run as part of writing this document.
