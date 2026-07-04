# Whisperio → Native macOS SwiftUI: Phased Implementation Plan

Grounding facts confirmed: `MacApp/` scaffold exists (`WhisperioMacApp.swift`, `ContentView.swift`, `WhisperioMac.entitlements`) but is **not wired into any Xcode target**; `ContentView` already drives the live `RecordingSyncStore` split view. Only 4 iOS schemes exist. The Electron desktop already ships tray/overlay/hotkey/autopaste as a working behavior spec at `desktop/src/main/dictation/`.

---

## 1. Reuse map

| Existing view/module | Path | Verdict |
|---|---|---|
| `WhisperioKit` (all of it) | `mobile/WhisperioKit/Sources/WhisperioKit/*` | **Reuse as-is** — `Package.swift` already declares `.macOS(.v14)`; pure Foundation/SwiftData/Security/os |
| `RecordingSyncStore` / `RecordingEntity` | `WhisperioKit/RecordingSyncStore.swift` | **Reuse as-is** — `@available(macOS 14)`, CloudKit degrades gracefully |
| `DictationStateMachine` | `WhisperioKit/DictationStateMachine.swift` | **Reuse as-is** — pure state model, drives the overlay pill |
| Providers (OpenAI/ElevenLabs/Chat/Multipart/TextCleaner) | `WhisperioKit/Engine*`, providers | **Reuse as-is** — pure URLSession |
| Stores (Preset/Settings/Digest/Recordings) | `WhisperioKit/*Store.swift` | **Reuse as-is** — `RecordingsStore` already `#available` branches |
| `Theme.swift` | `.../WhisperioApp/Theme.swift` | **Reuse as-is** — `\.wz` env, `WZFont`, `Color.hex`. Only font *registration* is iOS-worded (comment); teal reskin = one token swap |
| `Components.swift` | `.../Components.swift` | **Reuse as-is** — all pure SwiftUI + SF Symbols. Add `.onHover` later (cosmetic) |
| `StyleKit.swift` | `.../StyleKit.swift` | **Reuse as-is** — `FlowLayout` is cross-platform `Layout` (macOS 13+) |
| `MacApp/ContentView.swift` | `MacApp/ContentView.swift` | **Reuse as-is** — already the live `NavigationSplitView` over `RecordingSyncStore` |
| `iPadView.swift` | `.../iPadView.swift` | **Adapt** — platform-clean; design-language donor for ContentView rows/detail (`sidebarRow`, `MiniWave`, `SourceBadge`). Drop hardcoded `width:340`, sample data |
| `HomeView.swift` | `.../HomeView.swift` | **Adapt** — swap `UIPasteboard`→`NSPasteboard`, drop haptics; `micDock` → toolbar control |
| `DetailView.swift` | `.../DetailView.swift` | **Adapt** — `NSPasteboard`; gate `.presentationDetents` (`:95,:102`); `ShareLink` OK |
| `RecordingView.swift` | `.../RecordingView.swift` | **Adapt** — waveform/status *fragment* → overlay pill; needs macOS audio backend; `NSPasteboard`; mic-permission copy rewrite |
| `SettingsView.swift` | `.../SettingsView.swift` | **Adapt (heavy)** — `SettGroup`/`SettRow` reusable; strip `SiriTipView`/`ShortcutsLink`/`fullScreenCover`/`presentationDetents`/`textInputAutocapitalization`/`keyboardType` |
| `Shared.swift` `ScreenScaffold` | `.../Shared.swift:11` | **Adapt** — `.padding(.top,54)` (notch clearance) → 0 on macOS |
| `AppShell.swift` | `.../AppShell.swift` | **Mac-only-new** — bespoke `WZScreen` router → `NavigationSplitView` + `WindowGroup` windowing; `MacApp/WhisperioMacApp.swift` replaces it |
| `Engine/AudioRecorder`, `LiveDictation` | `WhisperioKit/Engine/*` | **Adapt** — gate `AVAudioSession`; swap permission to `AVCaptureDevice` |
| `PhoneConnectivity.swift` | `WhisperioKit/Engine/PhoneConnectivity.swift` | **Exclude** — WatchConnectivity, iOS-only |
| `DynamicIslandScene`, `KeyboardSetupView`, `TriggerGuides`, `WatchView` | `.../` | **Exclude** — iOS hardware/OS features, no macOS analog |
| MenuBarExtra, overlay `NSPanel`, global hotkey, auto-paste, Updates pane | — | **Mac-only-new** (§4) |

---

## 2. Portability blockers & gating

**A. `#if canImport(UIKit)` blocks that silently vanish on native macOS (no build break, functional gap):**
- `HomeView.swift:201–203,215–218`, `DetailView.swift:216–219,244–246`, `RecordingView.swift:205–207,223–225` — `UIPasteboard.general.string` + `UINotificationFeedbackGenerator`.
- **Gate:** add `#if os(macOS)` branch → `NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string)`; drop the feedback generator entirely (no macOS haptics).

**B. Hard compile breaks (macOS-unavailable modifiers — MUST gate or the build fails):**
- `SettingsView.swift:77 SiriTipView`, `:78 ShortcutsLink` → wrap whole Quick-dictation section (`:72–83`) in `#if os(iOS)`.
- `SettingsView.swift:143,299,312 .textInputAutocapitalization(.never)`, `:313 .keyboardType(.URL)` → `#if os(iOS)` on those modifiers (keep `.autocorrectionDisabled()`, which is macOS-fine).
- `SettingsView.swift:223 .fullScreenCover`, `:221 .presentationDetents` → replace with a plain `.sheet` (no detents) on macOS.
- `DetailView.swift:95,102 .presentationDetents` → `#if os(iOS)` (keep the `.sheet`).
- Siblings routed to by the shell: `DigestDayView.swift:58`, `SetupView.swift:82` + `:50`, `TriggerGuides.swift:212` — same `.presentationDetents`/autocapitalization gating (only if included in the target).

**C. AVAudioSession — does not exist on macOS at all (capture blocker):**
- `AudioRecorder.swift:30–31,45,77,93` and `LiveDictation.swift:85–87,307` — `AVAudioSession.sharedInstance()/setCategory/setActive`.
- **Gate:** wrap every `AVAudioSession` line in `#if os(iOS)`. On macOS the mic works without a session (`AVAudioEngine`/`AVAudioRecorder`/`SFSpeechRecognizer` all exist on macOS 10.15+).
- Permission: `AudioRecorder.swift:20–22` `AVAudioApplication.requestRecordPermission` (iOS 17+) → `#if os(macOS)` use `AVCaptureDevice.requestAccess(for: .audio)`.

**D. WatchConnectivity — absent on macOS:** `PhoneConnectivity.swift:2,9–64` → `#if os(iOS)` the whole file, or exclude from the mac target (don't attach it).

**E. `UIApplication` settings-open:** `KeyboardSetupView.swift:132–133`, `TriggerGuides.swift:373–374` → excluded from mac target anyway; if referenced, `NSWorkspace.shared.open`.

**F. `ScreenScaffold` notch padding** (`Shared.swift:11 .padding(.top,54)`) → `#if os(macOS)` set to 0.

**G. Layout idioms:** `HomeView` `micDock` (`:135–150`), fixed `.padding(.bottom,40/140)` — thumb-reach; move to `.toolbar`. `iPadView` `width:340`/`maxWidth:640` — make resizable via `NavigationSplitView`.

**H. App Group / SharedStore:** `SharedStore.swift:14 group.ai.whisperio.mobile` is the iOS keyboard-extension bridge — irrelevant on Mac; exclude SharedStore-driven UI, don't port it.

**Strategy note:** Phase 1 uses **only** `MacApp/` (already `#if os(macOS)`-clean) + `WhisperioKit`. The iOS `Sources/WhisperioApp/` view files are NOT attached to the mac target in Phase 1 — the gating work in A/B above is deferred to Phase 2, when those views are actually shared into the mac target. This keeps the MVP compiling with zero edits to the iOS view files.

---

## 3. Xcode target setup (hand-authored pbxproj)

`project.pbxproj` is `objectVersion=77` (Xcode 16) using `PBXFileSystemSynchronizedRootGroup` — attach folders, not files. Model the mac target on the **Watch target** (standalone, `SDKROOT` override), NOT the app-extensions. Use a fresh **`1C…`** GID prefix.

**Objects to add:**
1. `PBXFileReference` `1C…03` → `WhisperioMac.app` (`explicitFileType=wrapper.application`, `sourceTree=BUILT_PRODUCTS_DIR`) — distinct name to avoid `WhisperioApp.app` collision.
2. `PBXFileSystemSynchronizedRootGroup` `1C…09` → `path = MacApp`. Add to `mainGroup 1A…0007` children; add product ref to Products group `1A…0008`.
3. Three empty build phases: `PBXSourcesBuildPhase`, `PBXFrameworksBuildPhase`, `PBXResourcesBuildPhase`.
4. `PBXBuildFile` → `WhisperioKit in Frameworks`.
5. `XCSwiftPackageProductDependency` `1C…11 = { productName = WhisperioKit; }` — **reuse the existing** `XCLocalSwiftPackageReference "../WhisperioKit"` (`1A…0010`); do NOT add a second package ref.
6. `PBXNativeTarget` — `productType = com.apple.product-type.application`, `fileSystemSynchronizedGroups = (1C…09)`, `packageProductDependencies = (1C…11)`, `dependencies = ()`, `productReference = 1C…03`.
7. `XCConfigurationList` + 2 `XCBuildConfiguration` (Debug/Release).
8. Register target GID in `PBXProject targets` (`1A…0001`) + `TargetAttributes`.

**Attach only `MacApp/` to the mac target. Do NOT attach `Sources/WhisperioApp` (iOS-coupled, second `@main`).**

**Build settings (both configs):**
```
SDKROOT = macosx
SUPPORTED_PLATFORMS = macosx            # keeps it out of the iOS `generic/platform=iOS` archive
MACOSX_DEPLOYMENT_TARGET = 14.0
PRODUCT_NAME = WhisperioMac
PRODUCT_BUNDLE_IDENTIFIER = ai.whisperio.mac
DEVELOPMENT_TEAM = 953Q6T2WTB
SWIFT_VERSION = 5.0
MARKETING_VERSION = 1.3.0
CURRENT_PROJECT_VERSION = 23
CODE_SIGN_STYLE = Automatic
CODE_SIGN_ENTITLEMENTS = MacApp/WhisperioMac.entitlements
ENABLE_HARDENED_RUNTIME = YES
GENERATE_INFOPLIST_FILE = YES           # do NOT set INFOPLIST_FILE = AppInfo.plist (iOS-only)
INFOPLIST_KEY_CFBundleDisplayName = Whisperio
INFOPLIST_KEY_LSApplicationCategoryType = public.app-category.productivity
INFOPLIST_KEY_NSMicrophoneUsageDescription = "Whisperio records your voice to transcribe it into text."
INFOPLIST_KEY_NSSpeechRecognitionUsageDescription = "Whisperio uses on-device speech recognition to turn your dictation into text."
LD_RUNPATH_SEARCH_PATHS = ("$(inherited)", "@executable_path/../Frameworks")   # NOT iOS's /Frameworks
COMBINE_HIDPI_IMAGES = YES
ENABLE_PREVIEWS = YES
```
**Omit** `IPHONEOS_DEPLOYMENT_TARGET`, `TARGETED_DEVICE_FAMILY`, all `INFOPLIST_KEY_UI*` scene/orientation keys.

**Scheme:** add shared `WhisperioMac.xcscheme` under `xcshareddata/xcschemes/` for headless `xcodebuild -scheme WhisperioMac -destination 'generic/platform=macOS'`.

**Entitlements** (`MacApp/WhisperioMac.entitlements` already correct): `app-sandbox`, `device.audio-input`, `application-groups [group.ai.whisperio.mobile]`, `icloud-container-identifiers [iCloud.ai.whisperio.mobile]`, `icloud-services [CloudKit]`. **Add when dictation/network lands:** `com.apple.security.network.client = true` (else URLSession silently fails under sandbox); `keychain-access-groups` if secrets are shared; `aps-environment` only if CloudKit push subscriptions are used.

**Portal/release:** register `ai.whisperio.mac` with iCloud container + App Group; create a macOS provisioning profile; `Scripts/ExportOptions.plist` only maps the 4 iOS bundle ids — mac needs its own export step (the iOS `WhisperioApp` archive won't build it, thanks to `SUPPORTED_PLATFORMS`).

---

## 4. New macOS-only work

1. **MenuBarExtra + activation policy** — SwiftUI `MenuBarExtra` scene in `WhisperioMacApp.swift` alongside `WindowGroup`: engine status, "Start dictation," open-window, quit. Optional `NSApplication` accessory policy for menubar-only mode. Behavior spec: `desktop/src/main/tray.ts`.
2. **Floating dictation overlay pill** — borderless non-activating `NSPanel` subclass (`.nonactivatingPanel`, `.floating` level, click-through, one per `NSScreen`) hosting a SwiftUI pill. Drives shared `DictationStateMachine`; visuals adapted from `RecordingView`'s `Waveform`/`EngineChip`/"Working…" fragment. Spec: `desktop/src/main/dictation/overlayWindow.ts`.
3. **Global hotkey capture** — `RegisterEventHotKey` (Carbon) or `CGEventTap` for `Ctrl+Shift+Space`; Hotkeys settings pane with recorder control. Spec: `desktop/src/main/dictation/hotkeyManager.ts`.
4. **Auto-paste to frontmost app** — capture/restore target window, synthesize ⌘V via `CGEvent`; requires Accessibility permission prompt. Spec: `desktop/src/main/dictation/autoPaste.ts`.
5. **Window chrome** — `NavigationSplitView` (resizable/collapsible sidebar) replacing the iOS `WZScreen` router; `.defaultSize`/`.windowResizability` on `WindowGroup`; `.toolbar` hosting the mic/dictation control.
6. **Tabbed 760×780 Settings window** — sidebar tabs General/Providers/Audio/Hotkeys/Updates/Recordings; Hotkeys + Updates panes are net-new (Sparkle-style updater); General/Providers/Audio adapt `SettGroup`/`SettRow` + `SettingsStore` bindings.

---

## 5. Phased plan

### Phase 1 — MVP: window + reused history + on-device dictation (highest value, lowest risk)
Goal: shippable native window that renders the shared journal and does on-device (Apple Speech) dictation. Uses only `MacApp/` + `WhisperioKit`; no iOS view files attached, so no gating needed yet.
- **Edit** `project.pbxproj` — add all `1C…` objects per §3.
- **Create** `xcshareddata/xcschemes/WhisperioMac.xcscheme`.
- **Verify** `MacApp/WhisperioMac.entitlements` — add `network.client` if enabling cloud transcription now.
- **Edit** `MacApp/WhisperioMacApp.swift` — add `MenuBarExtra` scene; window sizing.
- **Edit** `MacApp/ContentView.swift` — restyle rows/detail with `iPadView` design language + `\.wz` theme (currently plain `List`); wire `EngineBar` as status header.
- **Create** `MacApp/MacAudioRecorder.swift` (or gate `WhisperioKit/Engine/AudioRecorder.swift` + `LiveDictation.swift` per §2-C and add them to the target) — macOS `AVAudioEngine` + `SFSpeechRecognizer`, `AVCaptureDevice` permission, no `AVAudioSession`.
- **Create** `MacApp/DictationOverlayPanel.swift` — the `NSPanel` pill hosting shared `DictationStateMachine`.
- **Create** `MacApp/HotkeyManager.swift` — `RegisterEventHotKey` → start/stop dictation.
- Verify: `xcodebuild -scheme WhisperioMac -destination 'generic/platform=macOS'`; run, confirm history renders (in-memory fallback OK) and Apple-Speech dictation writes a recording.

### Phase 2 — Full parity settings, cloud engines, auto-paste, shared views
Goal: providers config, cloud transcription/rewrite, auto-paste, and reuse of iOS view fragments.
- **Add** `network.client` entitlement (if not in P1); enable OpenAI/ElevenLabs providers (already portable).
- **Create** the tabbed 760×780 Settings window (`MacApp/SettingsWindow.swift`) — adapt `SettGroup`/`SettRow` + `keyField`/`plainField` + `CloudConsentSheet` from `SettingsView.swift`; new Hotkeys + Audio panes.
- **Gate** the shared iOS views per §2-A/B and **attach** `Components.swift`, `Shared.swift`, `Theme.swift`, and the needed fragments of `DetailView`/`RecordingView`/`SettingsView` to the mac target (or extract fragments into `MacApp/`). Add `NSPasteboard` branches; gate `ScreenScaffold` padding.
- **Create** `MacApp/AutoPaste.swift` — `CGEvent` ⌘V + Accessibility permission (spec: `autoPaste.ts`).
- **Teal reskin:** add a `WZTheme` instance in `Theme.swift` swapping `accent`/`accentLite`/`gradient` → `#1cc8b4`; reskins globally via `\.wz`.
- Verify: full dictation→transcribe→cleanup→auto-paste flow; provider keys via Keychain.

### Phase 3 — Distribution polish
Goal: TestFlight/App-Store-ready.
- Register `ai.whisperio.mac` in portal; add mac provisioning profile; new mac export step (or extend `Scripts/ExportOptions.plist` + `release-testflight.sh`).
- Provision iCloud container for `ai.whisperio.mac` → CloudKit sync goes live (until then in-memory/local fallback per `makeStore()`).
- Updates pane (Sparkle) + notarization (`ENABLE_HARDENED_RUNTIME` already set).
- Mac asset catalog + `AppIcon`; `.onHover` affordances on custom buttons; de-slop `SettRow` density.

---

## 6. Open questions / risks

1. **Strategic — SwiftUI-native vs. ship Electron.** The Electron desktop (`desktop/`, v1.3.0) already ships tray/overlay/hotkey/auto-paste working. Items §4.2–4.4 are the genuinely hard net-new AppKit engineering; they already exist in TS. Decide *before writing Swift* whether native SwiftUI justifies re-implementing them.
2. **CloudKit provisioning.** Recent commits (`6ecde6b`, `c520e7d`) disabled CloudKit on iOS until the container is provisioned. Expect the same on Mac: `try RecordingSyncStore()` throws on unprovisioned dev builds → in-memory fallback → **history won't sync** until `ai.whisperio.mac` is entitled for `iCloud.ai.whisperio.mobile`. Cross-device journal is gated on portal work, not code.
3. **Legacy import gap.** `migrateLegacyJSONIfNeeded()` (`RecordingSyncStore.swift:176–200`) reads the sandbox container's `Documents/recordings.json` — a different container than iOS, so no legacy import on Mac. Acceptable; note it.
4. **Audio backend rewrite is the real capture risk.** `AVAudioSession` gating is mechanical, but macOS mic permission (`AVCaptureDevice`) + `AVAudioEngine` tap lifecycle differ enough to need real device testing. On-device `SFSpeechRecognizer` availability/locale download on macOS is a runtime unknown.
5. **Auto-paste needs Accessibility permission** (TCC prompt) — a first-run UX + a sandbox tension: `CGEvent` posting into other apps may conflict with App Sandbox / Mac App Store review. May force a Developer-ID-notarized (non-MAS) distribution for the paste feature.
6. **Bundle id `ai.whisperio.mac` vs iOS `ai.whisperio.mobile`** — different ids sharing one App Group + iCloud container works only on the same team (`953Q6T2WTB`), confirmed. But keychain-shared provider secrets need `keychain-access-groups` wired or the Mac re-prompts for keys.
7. **`SUPPORTED_PLATFORMS = macosx`** is load-bearing: without it the iOS release script's `-destination 'generic/platform=iOS'` archive would drag the mac target in and fail. Must be set from the first pbxproj edit.

**Key files to create:** `MacApp/{DictationOverlayPanel,HotkeyManager,MacAudioRecorder,AutoPaste,SettingsWindow}.swift`, `xcshareddata/xcschemes/WhisperioMac.xcscheme`.
**Key files to edit:** `WhisperioApp.xcodeproj/project.pbxproj`, `MacApp/{WhisperioMacApp,ContentView}.swift`, `MacApp/WhisperioMac.entitlements`, `WhisperioKit/Engine/{AudioRecorder,LiveDictation}.swift` (gate `AVAudioSession`), `Theme.swift` (teal token), and (Phase 2) the shared iOS views for `#if os` gating.