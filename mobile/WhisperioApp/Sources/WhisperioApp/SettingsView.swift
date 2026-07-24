import SwiftUI
import AppIntents
import CloudKit
import WhisperioKit
#if canImport(UIKit)
import UIKit
#endif
#if os(macOS)
import AppKit
#endif

// Settings — real, backed by SettingsStore: pick the transcription engine, enter
// cloud keys, toggle AI cleanup. Appearance + models below.
struct SettingsView: View {
    @Environment(\.wz) private var t
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var recordings: RecordingsStore
    @EnvironmentObject private var digests: DigestStore
    @EnvironmentObject private var presets: PresetStore
    var onBack: () -> Void
    @Binding var dark: Bool
    var openModels: () -> Void
    var openKeyboardSetup: () -> Void = {}
    var openOnboarding: () -> Void = {}
    // Open the rewrite-preset editor — nil means "new template".
    var openPresetEditor: (RewritePreset?) -> Void = { _ in }
    var openGitHubSync: () -> Void = {}
    var openDigestPrompts: () -> Void = {}
    var openStorage: () -> Void = {}
    var toast: (String) -> Void = { _ in }
    // Consumed on appear — the category page (SettingsCategory raw value) this instance opens
    // on. Set by AppShell on the way back from deep pages that live outside SettingsView (the
    // models list), so back lands on the parent category (Models) instead of the hub.
    @Binding var initialCategoryID: String?

    // Two-step "Add provider + model" picker state on the Model order card.
    private enum ChainAddStep: Equatable {
        case provider               // step 1 — picking the provider
        case model(ProviderID)      // step 2 — picking that provider's model
    }

    @State private var consentProvider: ProviderID?   // non-nil → consent sheet is up
    @State private var showTriggerGuides = false      // presents the trigger onboarding hub
    @State private var showAddToSiriSheet = false     // "Add to Siri" sheet (System > Quick dictation)
    @State private var shortcutsOpenFailed = false    // shortcuts:// couldn't open — fall back to ShortcutsLink
    @State private var chainAdd: ChainAddStep? = nil  // "Add provider + model" flow state
    @State private var openConnection: ProviderID?    // expanded connection accordion (none = all collapsed)
    @State private var showRestoreConfirm = false     // confirm before restoring seed templates
    @State private var langOpen = false               // inline language chip grid expanded?
    @State private var selectedCategory: SettingsCategory? = nil
    @State private var cloudAccountStatusText = "Checking iCloud status…"
    @State private var cloudStatus: CKAccountStatus = .couldNotDetermine
    @State private var cloudAccountRecordIDText = "Checking account ID…"
    @State private var cloudDetailStatusText = "Awaiting sync details…"

    private var engine: ProviderID { settings.settings.providerChain.first ?? .onDevice }

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
    }

    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
    }

    private var deviceName: String {
#if canImport(UIKit)
        UIDevice.current.name
#else
        "Device"
#endif
    }

    private var deviceOS: String {
#if canImport(UIKit)
        UIDevice.current.systemVersion
#else
        "—"
#endif
    }

    private var deviceModel: String {
#if canImport(UIKit)
        UIDevice.current.model
#else
        "—"
#endif
    }

    private var deviceSummary: String {
        "\(deviceName) · \(deviceModel) · iOS \(deviceOS)"
    }

    private let languages: [(name: String, code: String)] = [
        ("Auto-detect", "auto"), ("English", "en"), ("Polski", "pl"), ("Deutsch", "de"),
        ("Español", "es"), ("Français", "fr"), ("Italiano", "it"), ("Português", "pt"),
        ("Nederlands", "nl"), ("Русский", "ru"), ("Українська", "uk")
    ]

    private var currentLanguageName: String {
        languages.first { $0.code == settings.settings.language }?.name ?? settings.settings.language
    }

    private var hasOpenAIKey: Bool {
        !settings.settings.openAIKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var interruptionBehaviorBinding: Binding<String> {
        Binding(get: { settings.settings.audioInterruptionBehavior.rawValue },
                set: { raw in
                    var s = settings.settings
                    s.audioInterruptionBehavior = AudioInterruptionBehavior(rawValue: raw) ?? .stop
                    settings.settings = s
                })
    }

    private var digestSourceModeBinding: Binding<String> {
        Binding(get: { settings.settings.digestSourceMode.rawValue },
                set: { raw in
                    var s = settings.settings
                    s.digestSourceMode = DigestSourceMode(rawValue: raw) ?? .all
                    settings.settings = s
                })
    }

    // Mirrors mob-settings.jsx:424's per-mode footnote. The `.appOnly` wording is adjusted from
    // the design's literal copy ("mic, Action Button, Watch") to match what the filter actually
    // does (`DigestGrouping.isAppSource`: source ∈ {"app","mic"} or nil — Watch notes are real,
    // distinguishable data and are excluded same as Keyboard) rather than promise a behavior the
    // app doesn't deliver.
    private var digestSourceModeFootnote: String {
        switch settings.settings.digestSourceMode {
        case .all:
            return "Everything — in-app, keyboard, Action Button and Watch — lands in the daily digest."
        case .appOnly:
            return "Only dictations made straight in Whisperio are summarized. Keyboard and Watch notes stay in the library, filterable in the Journal."
        case .manual:
            return "Nothing is auto-included — each day you tick which notes the summary should cover."
        }
    }

    private var autoStopSecondsBinding: Binding<Double> {
        Binding(get: { settings.settings.audioAutoStopTimeoutSeconds },
                set: { settings.settings.audioAutoStopTimeoutSeconds = max(0, $0) })
    }

    private enum SettingsCategory: String, CaseIterable, Identifiable {
        case models, transcription, content, sync, storage, developer, system

        var id: String { rawValue }
        var title: String {
            switch self {
            case .models: return "Models"
            case .transcription: return "Transcription"
            case .content: return "Content"
            case .sync: return "Data synchronisation"
            case .storage: return "Storage & data"
            case .developer: return "Developer"
            case .system: return "System"
            }
        }
        var icon: String {
            switch self {
            case .models: return "cpu"
            case .transcription: return "mic"
            case .content: return "spark"
            case .sync: return "cloud"
            case .storage: return "folder"
            case .developer: return "hammer"
            case .system: return "gearshape"
            }
        }
        var subtitle: String {
            switch self {
            case .models: return "Choose the primary engine and API keys"
            case .transcription: return "Mic behavior, cleanup, fallback, and timing"
            case .content: return "Language, vocabulary, rewrite prompts, journaling"
            case .sync: return "iCloud sync behavior and GitHub mirror"
            case .storage: return "What’s on this iPhone, per-type policy, cleanup"
            case .developer: return "Diagnostics and advanced controls"
            case .system: return "Integrations, appearance and app info"
            }
        }
    }

    private func setLanguage(_ code: String) {
        var s = settings.settings
        s.language = code
        settings.settings = s
    }

    #if os(iOS)
    // "Shortcuts" ghost button — opens the real Shortcuts app via its URL scheme. On the rare
    // device where that fails (e.g. a restricted profile), fall back to the system ShortcutsLink
    // control instead of silently doing nothing.
    private func openShortcutsApp() {
        guard let url = URL(string: "shortcuts://") else { shortcutsOpenFailed = true; return }
        openURL(url) { accepted in
            if !accepted { shortcutsOpenFailed = true }
        }
    }
    #endif

    private func setStorageMode(_ mode: StorageMode) {
        var s = settings.settings
        s.storageMode = mode
        settings.settings = s
    }

    private func setSyncMode(_ mode: SyncMode) {
        var s = settings.settings
        s.syncMode = mode
        settings.settings = s
    }

    private func setSyncIntervalMinutes(_ minutes: Int) {
        var s = settings.settings
        s.syncIntervalMinutes = minutes
        settings.settings = s
    }

    // Entry point for both the "Move library to iCloud" row and the mismatch-banner's "Resume
    // iCloud sync" action. Mirrors `RecordingsStore.attemptICloudResumeIfNeeded`'s account guard —
    // without it, a signed-out user tapping this gets a silent no-op from SwiftData's CloudKit
    // plumbing but we'd still flip `storageMode` to `.iCloud` and claim success, burying the one
    // banner that would have told them to sign in.
    //
    // Each store is migrated independently and only if it isn't already cloud-backed. Both
    // `RecordingsStore` and `DigestStore` open their own `ModelConfiguration` pinned to their own
    // on-disk file (`RecordingSync.storeURL()` / the digest equivalent), so calling
    // `migrateCurrentLibraryToCloud()` on a store that's already cloud-backed doesn't just no-op —
    // it stands up a *second* live CloudKit container on top of the same store file the first one
    // is still using, which is exactly the state this banner exists to recover from, not cause.
    private func moveLibraryToCloud() {
        guard FileManager.default.ubiquityIdentityToken != nil else {
            toast("Sign in to iCloud in Settings to sync your library")
            return
        }

        let recordingsNeedsMigration = !recordings.isCloudBacked
        let digestsNeedsMigration = !digests.isCloudBacked

        if recordingsNeedsMigration {
            do {
                try recordings.migrateCurrentLibraryToCloud()
            } catch {
                toast("Couldn't move library to iCloud")
                return
            }
        }

        setStorageMode(.iCloud)
        // Explicit user return to cloud — clear the crash-loop breaker's early-death streak so
        // the next launch honors this choice instead of pinning local again (see LaunchSentinel).
        LaunchSentinel.noteManualCloudResume()

        if digestsNeedsMigration {
            do {
                try digests.migrateCurrentLibraryToCloud()
            } catch {
                toast("Recordings moved to iCloud, but the journal is still local — retry from the sync banner")
                return
            }
        }

        switch (recordingsNeedsMigration, digestsNeedsMigration) {
        case (true, true):
            toast("Library moved to iCloud sync")
        case (true, false):
            toast("Recordings moved to iCloud sync")
        case (false, true):
            toast("Journal moved to iCloud sync")
        case (false, false):
            toast("Already syncing with iCloud")
        }
    }

    // Re-reads the local library snapshot and refreshes the CloudKit account/status diagnostics.
    // This does NOT force a network pull — SwiftData exposes no public API for that, and
    // `RecordingsStore.requestCloudRefresh()` only re-reads what's already been imported locally.
    // Real cross-device delivery is push-driven (silent remote-notification push).
    private func pullCloudNow() {
        recordings.requestCloudRefresh()
        if recordings.isSyncing {
            cloudDetailStatusText = "A CloudKit import/export is currently in flight."
        } else if let lastImportAt = recordings.lastImportAt {
            cloudDetailStatusText = "Re-read local library. Last CloudKit import: \(dateString(lastImportAt))."
        } else {
            cloudDetailStatusText = "Re-read local library. No CloudKit import has landed yet on this device."
        }
        toast("Re-read the local library")
        Task { await refreshCloudAccountStatus() }
    }

    // A selectable Storage row — tapping picks where transcripts are persisted. Shows a teal
    // checkmark on the currently-selected mode. Change takes effect on next launch (the store's
    // ModelContainer config is fixed at init), surfaced by the footnote under the group.
    private func storageRow(_ mode: StorageMode, _ label: String, _ sub: String,
                            _ icon: String, last: Bool = false) -> some View {
        let on = settings.settings.storageMode == mode
        return SettRow(icon: icon, label: label, sub: sub, last: last,
                       onTap: { setStorageMode(mode) }) {
            if on { WIcon("check", size: 18).foregroundStyle(t.accent) }
        }
    }

    // A selectable Sync mode row — mirrors storageRow's shape. Unlike storageMode, picking a new
    // mode here is read live by RecordingSyncStore/DigestSyncStore and WZPhoneView's scenePhase/
    // timer wiring on the very next event — no restart needed, so there's no "takes effect after
    // restart" footnote for this group (see the honesty footer instead).
    private func syncModeRow(_ mode: SyncMode, _ label: String, _ sub: String,
                             _ icon: String, last: Bool = false) -> some View {
        let on = settings.settings.syncMode == mode
        return SettRow(icon: icon, label: label, sub: sub, last: last,
                       onTap: { setSyncMode(mode) }) {
            if on { WIcon("check", size: 18).foregroundStyle(t.accent) }
        }
    }

    private let syncIntervalChoices = [5, 15, 30, 60]

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: selectedCategory?.title ?? "Settings",
                        onBack: selectedCategory == nil ? onBack : { selectedCategory = nil })
                ScrollViewReader { proxy in
                    ScrollView(showsIndicators: false) {
                        VStack(alignment: .leading, spacing: 22) {
                            // Top anchor for the page-swap scroll reset below.
                            Color.clear.frame(height: 1).id("wz.settings.top")
                            // Type-erase both branches. The `if/else` otherwise bakes BOTH the
                            // hub's and the (7-way) category switch's full generic types into
                            // this body's concrete type; that type grew deep enough by build 68
                            // (accordion + ScrollViewReader + intelligence section) that the
                            // Swift runtime's mangled-name type instantiation recurses past the
                            // 1MB main-thread stack ON DEVICE and SIGSEGVs on the stack guard —
                            // invisible on the simulator, whose main thread gets an 8MB stack.
                            if let selectedCategory {
                                categoryView(selectedCategory)
                            } else {
                                AnyView(hubView)
                            }
                        }
                        .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 28)
                        .animation(.easeInOut(duration: 0.2), value: selectedCategory)
                    }
                    // Reset to the top on hub <-> category swaps WITHOUT re-identifying the
                    // ScrollView: destroying the platform scroll view mid-animation (the
                    // previous .id() approach) is the kind of same-transaction teardown
                    // SwiftUI can trap on for some OS builds, and it was the only
                    // Settings-entry-path structural change in build 68. scrollTo on a
                    // stable anchor resets the offset with the hierarchy intact.
                    .onChange(of: selectedCategory) { _, _ in
                        proxy.scrollTo("wz.settings.top", anchor: .top)
                    }
                }
            }
        }
        .sheet(item: Binding(get: { consentProvider.map { ConsentTarget(id: $0) } },
                             set: { consentProvider = $0?.id })) { target in
            CloudConsentSheet(provider: target.id,
                              onAccept: { grantCloud(target.id) },
                              onCancel: { consentProvider = nil })
                .environment(\.wz, t)
                #if os(iOS)
                .presentationDetents([.medium, .large])
                #endif
        }
        #if os(iOS)
        .sheet(isPresented: $showAddToSiriSheet) {
            AddToSiriSheet()
                .environment(\.wz, t)
                .preferredColorScheme(t.dark ? .dark : .light)
                .presentationDetents([.medium])
        }
        #endif
        #if os(iOS)
        .fullScreenCover(isPresented: $showTriggerGuides) {
            TriggerGuidesView(onBack: { showTriggerGuides = false })
                .environment(\.wz, t)
                .preferredColorScheme(t.dark ? .dark : .light)
        }
        #else
        .sheet(isPresented: $showTriggerGuides) {
            TriggerGuidesView(onBack: { showTriggerGuides = false })
                .environment(\.wz, t)
                .preferredColorScheme(t.dark ? .dark : .light)
        }
        #endif
        .alert("Restore default templates?", isPresented: $showRestoreConfirm) {
            Button("Restore", role: .destructive) {
                presets.restoreDefaults()
                toast("Templates restored")
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This brings back the built-in templates and undoes your edits to them. Your own templates are kept.")
        }
        .task(id: selectedCategory?.id) {
            guard selectedCategory == .developer else { return }
            await refreshCloudAccountStatus()
        }
        .onAppear {
            // Land on the category a deep page navigated back from (see initialCategoryID).
            if let id = initialCategoryID {
                selectedCategory = SettingsCategory(rawValue: id)
                initialCategoryID = nil
            }
        }
    }

    // Wrap a ProviderID so it can drive `.sheet(item:)`.
    private struct ConsentTarget: Identifiable { let id: ProviderID }

    private var modelCategory: some View {
        VStack(alignment: .leading, spacing: 16) {
            // The heaviest sub-sections (reorderable order list, the 8 expandable connector
            // accordions, the intelligence picker) are each type-erased so `modelCategory`'s
            // own instantiated type stays shallow — same 1MB-device-stack reason as the body
            // branch above, since navigating INTO Models re-instantiates this view's type.
            AnyView(modelOrderSection)
            SettGroup(title: "On-device models") {
                SettRow(icon: "download", label: "Manage on-device models",
                        sub: "Download, update or remove Apple Speech + Whisper", last: true,
                        onTap: openModels)
            }
            HStack {
                SectionLabel(text: "Remote connectors")
                Spacer(minLength: 0)
                if engine == .selfHosted {
                    // Own-server pill instead of the usual on-device/cloud badge — the primary
                    // engine is neither: it's a third machine the user runs themselves.
                    HStack(spacing: 5) {
                        WIcon("server", size: 11)
                        Text("your server")
                    }
                    .font(WZFont.mono(10.5, .semibold))
                    .foregroundStyle(t.green)
                    .padding(.horizontal, 9).padding(.vertical, 3)
                    .background(t.green.opacity(0.1), in: Capsule())
                    .overlay(Capsule().stroke(t.green.opacity(0.25), lineWidth: 1))
                } else {
                    // The badge reflects slot 0 of the model order — the engine that transcribes.
                    PrivacyBadge(mode: settings.settings.isCloud(engine) ? .cloud : .device, small: true)
                }
            }
            .padding(.leading, 4)
            AnyView(VStack(spacing: 10) {
                connectorSection(.openAI, "OpenAI", "Cloud · Whisper API", "globe")
                connectorSection(.elevenLabs, "ElevenLabs", "Cloud · Scribe", "globe")
                connectorSection(.replicate, "Replicate", "Cloud · open-source models", "globe")
                connectorSection(.groq, "Groq", "Cloud · fastest Whisper inference", "bolt")
                connectorSection(.deepgram, "Deepgram", "Cloud · Nova, streaming & diarization", "globe")
                connectorSection(.assemblyAI, "AssemblyAI", "Cloud · Universal, speaker labels", "globe")
                connectorSection(.mistral, "Mistral", "Cloud · Voxtral, open weights", "globe")
                connectorSection(.selfHosted, "Self-hosted", "Your server · whisper.cpp / faster-whisper", "server")
            })
            Text("Tap a provider to configure its connection and model. Which one is actually used — and in what order — is set above.")
                .font(WZFont.mono(11)).foregroundStyle(t.faint).lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.leading, 4)
            AnyView(intelligenceSection)
        }
    }

    // A connector row plus its expanded configuration directly beneath it — a real accordion.
    // The config must sit right under its row (not after the whole 8-row list) so tapping a
    // row visibly opens where the finger is instead of landing off-viewport.
    @ViewBuilder
    private func connectorSection(_ id: ProviderID, _ title: String, _ sub: String, _ icon: String) -> some View {
        connectionRow(id, title, sub, icon)
        if openConnection == id {
            providerConfig(id)
                // Explicit per-provider identity: switching the open provider is then an
                // update of one stable subtree, not a cross-position remove+insert of
                // SecureField editing sessions (a SwiftUI focus-teardown trap candidate).
                .id("wz.providerConfig.\(id.rawValue)")
                .transition(.opacity.combined(with: .move(edge: .top)))
        }
    }

    // Expanded per-provider configuration: model chips, key/URL fields, then the
    // manage-account/usage (or self-hosted dashboard) buttons.
    @ViewBuilder
    private func providerConfig(_ id: ProviderID) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            // Self-hosted is deliberately absent from engineModelChoices (free-text model
            // instead of a chip catalog) — this `if let` doubles as that guard.
            if let choices = Self.engineModelChoices[id] {
                modelPicker(id, choices)
            }
            switch id {
            case .openAI:
                keyField("OpenAI API key", binding(\.openAIKey))
                plainField("Base URL (optional, self-hosted)", "https://api.openai.com/v1", binding(\.openAIBaseURL))
                plainField("Model (optional)", "whisper-1", binding(\.whisperModel))
                Text("Same setting as the chips above — tap a chip or type any newer model id here. Empty means whisper-1.")
                    .font(WZFont.mono(11)).foregroundStyle(t.faint).lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, 4)
            case .elevenLabs: keyField("ElevenLabs API key", binding(\.elevenLabsKey))
            case .replicate: keyField("Replicate API token", binding(\.replicateKey), placeholder: "r8_…")
            case .groq: keyField("Groq API key", binding(\.groqKey), placeholder: "gsk_…")
            case .deepgram: keyField("Deepgram API key", binding(\.deepgramKey))
            case .assemblyAI: keyField("AssemblyAI API key", binding(\.assemblyAIKey))
            case .mistral: keyField("Mistral API key", binding(\.mistralKey))
            case .selfHosted:
                plainField("Server URL", "http://192.168.1.20:8080/v1", binding(\.selfHostedURL))
                keyField("Bearer token (optional)", binding(\.selfHostedKey), placeholder: "leave blank if none")
                plainField("Model", "whisper-large-v3", binding(\.selfHostedModel))
                // Green "your own server" banner — verbatim design copy, mob-settings.jsx:339-346.
                HStack(alignment: .top, spacing: 10) {
                    WIcon("lock", size: 15).foregroundStyle(t.green).padding(.top, 1)
                    Text("Audio goes only to your own server — no third-party cloud. OpenAI-compatible endpoints (whisper.cpp, faster-whisper, Speaches) work out of the box.")
                        .font(WZFont.ui(12.5)).foregroundStyle(t.muted).lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 14).padding(.vertical, 12)
                .background(t.green.opacity(t.dark ? 0.08 : 0.07), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(t.green.opacity(0.25), lineWidth: 1))
            default:
                EmptyView()   // .onDevice / .localWhisper never appear in the connector list
            }
            if id == .selfHosted {
                // No vendor console for a server the user runs themselves — open the
                // actual configured URL (real, honest) instead of a dead "manage account"
                // link to a console that doesn't exist for arbitrary self-hosted servers.
                let urlText = settings.settings.selfHostedURL.trimmingCharacters(in: .whitespaces)
                if !urlText.isEmpty, let serverURL = URL(string: urlText) {
                    GhostButton(title: "Open server dashboard", icon: "arrowUR") {
                        openURL(serverURL)
                    }
                }
            } else {
                HStack(spacing: 9) {
                    GhostButton(title: "Manage account · \(engineDisplayName(id))", icon: "arrowUR") {
                        openManageAccount(id)
                    }
                    GhostButton(title: "Usage console", icon: "globe") {
                        openUsageConsole(id)
                    }
                    .fixedSize()
                }
            }
        }
    }

    // Per-engine model choices (persisted id → display name) for the cloud engines that carry
    // a selected-model setting. Mirrors ENGINE_MODELS in mob-settings.jsx.
    private static let engineModelChoices: [ProviderID: [(id: String, name: String)]] = [
        // Real, currently-documented model ids (verified July 2026) — mirrors ENGINE_MODELS in
        // mob-settings.jsx. The free-text "Model (optional)" field below stays as an advanced
        // override for anything newer than this list.
        .openAI: [("whisper-1", "whisper-1"),
                  ("gpt-4o-transcribe", "gpt-4o-transcribe"),
                  ("gpt-4o-mini-transcribe", "gpt-4o-mini")],
        // ElevenLabs Scribe v2 (batch) shipped January 2026; v1 remains real and supported.
        .elevenLabs: [("scribe_v2", "Scribe v2"), ("scribe_v1", "Scribe v1")],
        // whisper-diarization deliberately absent: thomasmol's schema takes file_url/file_string
        // (not "audio") and returns segments with no top-level text — ReplicateProvider can't
        // drive it, so offering the chip would be a dead control.
        .replicate: [("incredibly-fast-whisper", "incredibly-fast-whisper"),
                     ("whisper-large-v3", "whisper large-v3")],
        .groq: [("whisper-large-v3-turbo", "whisper-v3 turbo"),
                ("whisper-large-v3", "whisper large-v3"),
                ("distil-whisper", "distil-whisper")],
        .deepgram: [("nova-3", "Nova-3"), ("nova-2", "Nova-2"), ("whisper-cloud", "Whisper cloud")],
        .assemblyAI: [("universal-2", "Universal-2"), ("universal-1", "Universal-1")],
        .mistral: [("voxtral-small", "Voxtral Small"), ("voxtral-mini", "Voxtral Mini")],
        // Local Whisper is a legitimate "Add provider + model" slot (a downloaded-or-not
        // variant can be queued as a fallback — ProviderChain skips it honestly via
        // isConfigured until the model is actually on disk). Ids are WhisperKit's own
        // variant names so a picked chip maps straight onto `LocalWhisperModel`.
        .localWhisper: [("openai_whisper-tiny", "Whisper tiny"),
                        ("openai_whisper-base", "Whisper base"),
                        ("openai_whisper-small", "Whisper small")],
        // Self-hosted has no fixed catalog (any OpenAI-compatible server can name its model
        // anything) — deliberately absent here so it falls through to the free-text Model field
        // instead of a chip picker, matching mob-settings.jsx's `engine !== 'self'` chip guard.
    ]

    private func engineModelBinding(_ id: ProviderID) -> Binding<String> {
        switch id {
        case .openAI: return binding(\.whisperModel)
        case .elevenLabs: return binding(\.elevenLabsModel)
        case .replicate: return binding(\.replicateModel)
        case .groq: return binding(\.groqModel)
        case .deepgram: return binding(\.deepgramModel)
        case .assemblyAI: return binding(\.assemblyAIModel)
        case .mistral: return binding(\.mistralModel)
        case .localWhisper: return binding(\.localWhisperModel)
        default: return binding(\.whisperModel)   // unreached — only chip engines call this
        }
    }

    /// Display-level selection for a provider's model chips: the stored value when set,
    /// otherwise the provider's documented default — its catalog's first chip (whisper-1,
    /// scribe_v2, …). Engines whose setting defaults to "" (whisperModel, elevenLabsModel,
    /// replicateModel) thus open with the real default highlighted instead of nothing, and
    /// storage stays untouched until the user actually taps a chip. Trimmed so the OpenAI
    /// free-text Model field tracks its chip even with stray whitespace.
    private func effectiveModelID(for id: ProviderID) -> String {
        let stored = engineModelBinding(id).wrappedValue.trimmingCharacters(in: .whitespaces)
        return stored.isEmpty ? (Self.engineModelChoices[id]?.first?.id ?? "") : stored
    }

    // Model chips under an expanded connector — capsule per choice, accent tint on the
    // effective selection (tapping writes storage; the default highlight alone never does).
    private func modelPicker(_ id: ProviderID, _ choices: [(id: String, name: String)]) -> some View {
        let selection = engineModelBinding(id)
        let effective = effectiveModelID(for: id)
        return VStack(alignment: .leading, spacing: 7) {
            SectionLabel(text: "Model").padding(.leading, 4)
            FlowLayout(spacing: 7) {
                ForEach(choices, id: \.id) { choice in
                    let on = effective == choice.id
                    Button { selection.wrappedValue = choice.id } label: {
                        Text(choice.name)
                            .font(WZFont.mono(11.5, .semibold))
                            .foregroundStyle(on ? t.accentLite : t.muted)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(on ? t.accent.opacity(0.16) : t.surfaceUp, in: Capsule())
                            .overlay(Capsule().stroke(on ? t.hair : t.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.top, 2)
    }

    // MARK: - Intelligence (text-LLM backend)

    /// What `.auto` resolves to right now — the same availability checks
    /// `SettingsStore.makeChatClient()` runs, surfaced so the Auto chip says honestly which
    /// backend would serve instead of a vague "automatic".
    private var autoIntelligenceResolution: String {
        let s = settings.settings
        let openAIReady = s.cloudConsentGranted && !s.openAIKey.trimmingCharacters(in: .whitespaces).isEmpty
        if openAIReady { return "OpenAI" }
        return AppleIntelligenceService.isAvailableNow ? "Apple Intelligence" : "not configured"
    }

    /// The backend that would actually serve — the explicit pick, or `.auto`'s resolution.
    /// Drives whether the OpenAI chat-model chips are shown. A pinned-but-unavailable Apple
    /// Intelligence pick stays `.appleIntelligence` here even though `makeChatClient()` falls
    /// back to the unconfigured OpenAI path — showing OpenAI's model chips for it would be
    /// dishonest; the unavailable state is surfaced on the chip itself instead.
    private var effectiveIntelligenceProvider: IntelligenceProvider {
        let s = settings.settings
        switch s.intelligenceProvider {
        case .openAI, .appleIntelligence:
            return s.intelligenceProvider
        case .auto:
            let openAIReady = s.cloudConsentGranted && !s.openAIKey.trimmingCharacters(in: .whitespaces).isEmpty
            return !openAIReady && AppleIntelligenceService.isAvailableNow ? .appleIntelligence : .openAI
        }
    }

    // Chat-model choices for the OpenAI intelligence backend — real, currently-documented
    // chat model ids (verified July 2026). STT models live in engineModelChoices above; this
    // one value is shared by rewrites, command mode and journal summaries (see chatModel).
    private static let chatModelChoices: [(id: String, name: String)] = [
        ("gpt-4o-mini", "4o mini · fast"),
        ("gpt-4o", "4o"),
        ("gpt-4.1-mini", "4.1 mini"),
    ]

    /// Display-level selection for the chat-model chips — the effectiveModelID idiom: the
    /// stored value when it names a chip, otherwise the gpt-4o-mini default highlighted
    /// (storage stays untouched until the user actually taps a chip).
    private var effectiveChatModelID: String {
        let stored = settings.settings.chatModel.trimmingCharacters(in: .whitespaces)
        return Self.chatModelChoices.contains(where: { $0.id == stored }) ? stored : "gpt-4o-mini"
    }

    private var intelligenceSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            SettGroup(title: "Intelligence") {
                VStack(alignment: .leading, spacing: 16) {
                    intelligenceProviderPicker
                    if effectiveIntelligenceProvider == .openAI {
                        chatModelPicker
                    }
                }
                .padding(.vertical, 14)
            }
            Text("Speech-to-text uses the model order above. Intelligence powers rewrites, command mode and journal summaries.")
                .font(WZFont.mono(11)).foregroundStyle(t.faint).lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.leading, 4)
        }
    }

    private func intelligenceProviderName(_ p: IntelligenceProvider) -> String {
        switch p {
        case .auto: return "Auto"
        case .appleIntelligence: return "Apple Intelligence"
        case .openAI: return "OpenAI"
        }
    }

    /// Honest per-chip status line: Auto names what it currently resolves to; Apple
    /// Intelligence reports real FoundationModels availability (still selectable when
    /// unavailable — the pick persists and lights up on a capable device).
    private func intelligenceProviderSub(_ p: IntelligenceProvider) -> String {
        switch p {
        case .auto: return "currently \(autoIntelligenceResolution)"
        case .appleIntelligence:
            return AppleIntelligenceService.isAvailableNow ? "on-device" : "unavailable on this device"
        case .openAI: return "cloud · API key"
        }
    }

    private func setIntelligenceProvider(_ p: IntelligenceProvider) {
        var s = settings.settings
        s.intelligenceProvider = p
        settings.settings = s
    }

    // Provider chips — modelPicker's capsule language with a second, smaller status line
    // per chip (the honesty carrier: what Auto resolves to / whether on-device is available).
    private var intelligenceProviderPicker: some View {
        let selected = settings.settings.intelligenceProvider
        return VStack(alignment: .leading, spacing: 7) {
            SectionLabel(text: "Provider").padding(.leading, 4)
            FlowLayout(spacing: 7) {
                ForEach(IntelligenceProvider.allCases, id: \.self) { choice in
                    let on = selected == choice
                    Button { setIntelligenceProvider(choice) } label: {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(intelligenceProviderName(choice))
                                .font(WZFont.mono(11.5, .semibold))
                                .foregroundStyle(on ? t.accentLite : t.muted)
                            Text(intelligenceProviderSub(choice))
                                .font(WZFont.mono(9.5))
                                .foregroundStyle(on ? t.accentLite.opacity(0.75) : t.faint)
                        }
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(on ? t.accent.opacity(0.16) : t.surfaceUp, in: Capsule())
                        .overlay(Capsule().stroke(on ? t.hair : t.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.top, 2)
    }

    // Chat-model chips — same capsule language as modelPicker, bound to the shared chatModel.
    private var chatModelPicker: some View {
        let selection = binding(\.chatModel)
        let effective = effectiveChatModelID
        return VStack(alignment: .leading, spacing: 7) {
            SectionLabel(text: "Chat model").padding(.leading, 4)
            FlowLayout(spacing: 7) {
                ForEach(Self.chatModelChoices, id: \.id) { choice in
                    let on = effective == choice.id
                    Button { selection.wrappedValue = choice.id } label: {
                        Text(choice.name)
                            .font(WZFont.mono(11.5, .semibold))
                            .foregroundStyle(on ? t.accentLite : t.muted)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(on ? t.accent.opacity(0.16) : t.surfaceUp, in: Capsule())
                            .overlay(Capsule().stroke(on ? t.hair : t.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.top, 2)
    }

    // MARK: - Model order (Models page)

    /// Display name for an engine in the model-order card. Mirrors ENGINE_NAME in
    /// mob-settings.jsx (only the ProviderIDs this app actually has).
    private func engineDisplayName(_ id: ProviderID) -> String {
        id.displayName
    }

    private static let chainOrdinals = ["Primary", "Secondary", "Third", "Fourth", "Fifth", "Sixth"]

    private var modelOrder: [ProviderSlot] { settings.settings.modelOrder }

    private func setModelOrder(_ order: [ProviderSlot]) {
        var s = settings.settings
        s.modelOrder = order
        settings.settings = s
    }

    private func moveSlot(at index: Int, by delta: Int) {
        var order = modelOrder
        let j = index + delta
        guard order.indices.contains(index), order.indices.contains(j) else { return }
        order.swapAt(index, j)
        setModelOrder(order)
    }

    private func removeSlot(at index: Int) {
        var order = modelOrder
        guard order.count > 1, order.indices.contains(index) else { return }
        order.remove(at: index)
        setModelOrder(order)
    }

    /// Whether an equivalent (provider, model) slot is already in the order — compared on
    /// *resolved* models, so a modelless slot blocks re-adding the engine's selected model.
    private func slotExists(_ id: ProviderID, _ model: String) -> Bool {
        let s = settings.settings
        let resolved = s.resolvedModel(for: ProviderSlot(provider: id, model: model))
        return s.modelOrder.contains { $0.provider == id && s.resolvedModel(for: $0) == resolved }
    }

    private func appendSlot(_ id: ProviderID, _ model: String) {
        guard !slotExists(id, model) else { return }
        setModelOrder(modelOrder + [ProviderSlot(provider: id, model: model)])
    }

    /// Display label for the model a slot runs with. Resolves the slot against the
    /// per-engine selection, prefers the chip display name, and names the built-in default
    /// for engines without a model setting.
    private func slotModelLabel(_ slot: ProviderSlot) -> String {
        let resolved = settings.settings.resolvedModel(for: slot)
        if resolved.isEmpty {
            switch slot.provider {
            case .onDevice: return "Apple Speech"
            case .openAI: return "whisper-1"
            case .elevenLabs: return "Scribe"
            default: return "default"
            }
        }
        if let name = Self.engineModelChoices[slot.provider]?.first(where: { $0.id == resolved })?.name {
            return name
        }
        return resolved
    }

    /// Step-2 choices for "Add provider + model". Engines without a model list offer their
    /// current selected/default model as the one chip (the slot then keeps following the
    /// engine's setting) — mirrors the JSX self-hosted branch.
    private func addModelChoices(_ id: ProviderID) -> [(id: String, name: String)] {
        Self.engineModelChoices[id] ?? [(id: "", name: slotModelLabel(ProviderSlot(provider: id)))]
    }

    private var modelOrderSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "Model order").padding(.leading, 4)
            VStack(spacing: 0) {
                let order = modelOrder
                ForEach(Array(order.enumerated()), id: \.offset) { index, slot in
                    modelOrderRow(slot, index: index, count: order.count)
                }

                chainAddContent

                Button {
                    withAnimation(.easeInOut(duration: 0.15)) {
                        chainAdd = chainAdd == nil ? .provider : nil
                    }
                } label: {
                    HStack(spacing: 10) {
                        WIcon("plus", size: 15).foregroundStyle(t.accentLite)
                        Text(chainAdd == nil ? "Add provider + model" : "Cancel")
                            .font(WZFont.ui(13.5, .semibold)).foregroundStyle(t.accentLite)
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 11)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16).padding(.vertical, 4)
            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
            Text("Provider + model per slot — the same provider can appear more than once with different models. Whisperio uses #1 and walks down on failure (with “Fallback engines” on).")
                .font(WZFont.mono(11)).foregroundStyle(t.faint).lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.leading, 4)
        }
    }

    // One ordered slot row — index chip, "Provider · model" + ordinal sublabel,
    // up/down/remove controls. Slot 0 is the primary (accent chip, semibold).
    private func modelOrderRow(_ slot: ProviderSlot, index: Int, count: Int) -> some View {
        let primary = index == 0
        return HStack(spacing: 13) {
            Text("\(index + 1)")
                .font(WZFont.mono(11, .bold))
                .foregroundStyle(primary ? t.accentLite : t.muted)
                .frame(width: 24, height: 24)
                .background(primary ? t.accent.opacity(0.16) : t.surfaceUp,
                            in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(engineDisplayName(slot.provider))
                        .font(WZFont.ui(14, primary ? .semibold : .regular)).foregroundStyle(t.text)
                    Text("· \(slotModelLabel(slot))")
                        .font(WZFont.mono(12)).foregroundStyle(t.accentLite)
                        .lineLimit(1)
                }
                Text((index < Self.chainOrdinals.count ? Self.chainOrdinals[index] : "Then").uppercased())
                    .font(WZFont.mono(9, .bold)).kerning(0.7).foregroundStyle(t.faint)
            }
            Spacer(minLength: 0)
            chainArrowButton(up: true, disabled: index == 0) { moveSlot(at: index, by: -1) }
            chainArrowButton(up: false, disabled: index == count - 1) { moveSlot(at: index, by: 1) }
            Button {
                removeSlot(at: index)
            } label: {
                WIcon("x", size: 12).foregroundStyle(t.muted)
                    .frame(width: 26, height: 26)
                    .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(t.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(count == 1)
            .opacity(count == 1 ? 0.4 : 1)
        }
        .padding(.vertical, 9)
        .overlay(alignment: .bottom) { Rectangle().fill(t.lineSoft).frame(height: 1) }
    }

    private func chainArrowButton(up: Bool, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            WIcon("chevD", size: 13)
                .rotationEffect(.degrees(up ? 180 : 0))
                .foregroundStyle(disabled ? t.faint : t.text)
                .frame(width: 26, height: 26)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(t.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }

    // Expanded "Add provider + model" content — step 1 offers every provider as wrap-chips,
    // step 2 that provider's models (combos already in the order are disabled).
    @ViewBuilder private var chainAddContent: some View {
        switch chainAdd {
        case .provider:
            VStack(alignment: .leading, spacing: 7) {
                Text("1 · Provider".uppercased())
                    .font(WZFont.mono(10)).kerning(1).foregroundStyle(t.faint)
                FlowLayout(spacing: 7) {
                    ForEach(ProviderID.allCases, id: \.self) { id in
                        Button {
                            withAnimation(.easeInOut(duration: 0.15)) { chainAdd = .model(id) }
                        } label: {
                            Text(engineDisplayName(id))
                                .font(WZFont.ui(12, .semibold)).foregroundStyle(t.muted)
                                .padding(.horizontal, 12).padding(.vertical, 6)
                                .background(t.surfaceUp, in: Capsule())
                                .overlay(Capsule().stroke(t.line, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .bottom) { Rectangle().fill(t.lineSoft).frame(height: 1) }
        case .model(let provider):
            VStack(alignment: .leading, spacing: 7) {
                Text("2 · Model — \(engineDisplayName(provider))".uppercased())
                    .font(WZFont.mono(10)).kerning(1).foregroundStyle(t.faint)
                FlowLayout(spacing: 7) {
                    ForEach(addModelChoices(provider), id: \.id) { choice in
                        let taken = slotExists(provider, choice.id)
                        Button {
                            appendSlot(provider, choice.id)
                            withAnimation(.easeInOut(duration: 0.15)) { chainAdd = nil }
                        } label: {
                            Text(taken ? "\(choice.name) ✓" : choice.name)
                                .font(WZFont.mono(11.5, .semibold)).foregroundStyle(t.muted)
                                .padding(.horizontal, 12).padding(.vertical, 6)
                                .background(t.surfaceUp, in: Capsule())
                                .overlay(Capsule().stroke(t.line, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .disabled(taken)
                        .opacity(taken ? 0.4 : 1)
                    }
                }
            }
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .bottom) { Rectangle().fill(t.lineSoft).frame(height: 1) }
        case nil:
            EmptyView()
        }
    }

    private var transcriptionCategory: some View {
        VStack(alignment: .leading, spacing: 16) {
            SettGroup(title: "Live") {
                SettRow(icon: "mic", label: "Live transcription",
                        sub: "See text as you speak · on-device, free", last: true) {
                    WToggle(on: boolBinding(\.liveTranscriptionEnabled))
                }
            }
            SettGroup(title: "Interruptions & silence") {
                VStack(alignment: .leading, spacing: 9) {
                    HStack(alignment: .top, spacing: 13) {
                        WIcon("clock", size: 17, weight: .regular).foregroundStyle(t.accentLite)
                            .frame(width: 34, height: 34)
                            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("When interrupted").font(WZFont.ui(14.5, .medium)).foregroundStyle(t.text)
                            Text("Calls, Siri, alarms, FaceTime, and other audio interruptions always release the mic. Whisperio can either stop or try to resume after the interruption ends.")
                                .font(WZFont.ui(12)).foregroundStyle(t.muted).lineSpacing(3)
                        }
                    }
                    Segmented(value: interruptionBehaviorBinding, options: [
                        (id: AudioInterruptionBehavior.stop.rawValue, label: "Stop"),
                        (id: AudioInterruptionBehavior.resume.rawValue, label: "Resume")
                    ])
                    Text(settings.settings.audioInterruptionBehavior == .resume
                         ? "Whisperio will end the current session, then try to start a fresh one when the interruption ends."
                         : "Whisperio will end the session and stay idle until you start again.")
                        .font(WZFont.mono(11)).foregroundStyle(t.faint)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 13)
                .overlay(alignment: .bottom) { Rectangle().fill(t.lineSoft).frame(height: 1) }
                VStack(alignment: .leading, spacing: 9) {
                    HStack(alignment: .top, spacing: 13) {
                        Image(systemName: "timer")
                            .font(.system(size: 17, weight: .regular)).foregroundStyle(t.accentLite)
                            .frame(width: 34, height: 34)
                            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Auto-stop after silence").font(WZFont.ui(14.5, .medium)).foregroundStyle(t.text)
                            Text("Whisperio will release the mic after this many seconds without speech. Set to 0 to turn it off.")
                                .font(WZFont.ui(12)).foregroundStyle(t.muted).lineSpacing(3)
                        }
                    }
                    HStack(spacing: 12) {
                        Text(autoStopSecondsBinding.wrappedValue == 0
                             ? "Off"
                             : "\(Int(autoStopSecondsBinding.wrappedValue)) seconds")
                            .font(WZFont.ui(13.5, .semibold))
                            .foregroundStyle(t.text)
                            .frame(minWidth: 84, alignment: .leading)
                        HStack(spacing: 0) {
                            Button {
                                autoStopSecondsBinding.wrappedValue = max(0, autoStopSecondsBinding.wrappedValue - 5)
                            } label: {
                                Text("−")
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundStyle(autoStopSecondsBinding.wrappedValue == 0 ? t.faint : t.text)
                                    .frame(width: 34, height: 30)
                            }
                            .disabled(autoStopSecondsBinding.wrappedValue == 0)
                            Button {
                                autoStopSecondsBinding.wrappedValue = min(120, autoStopSecondsBinding.wrappedValue + 5)
                            } label: {
                                Text("+")
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundStyle(autoStopSecondsBinding.wrappedValue == 120 ? t.faint : t.text)
                                    .frame(width: 34, height: 30)
                            }
                            .disabled(autoStopSecondsBinding.wrappedValue == 120)
                        }
                        .background(t.surfaceUp)
                        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(t.line, lineWidth: 1))
                        Spacer(minLength: 0)
                    }
                    Text(autoStopSecondsBinding.wrappedValue == 0
                         ? "No automatic stop. Only manual stop or interruption will release the mic."
                         : "When the app is quiet for \(Int(autoStopSecondsBinding.wrappedValue)) seconds, Whisperio stops listening.")
                        .font(WZFont.mono(11)).foregroundStyle(t.faint)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 13)
            }
            SettGroup(title: "Engine behavior") {
                SettRow(icon: "spark", label: "Cleanup",
                        sub: "Tidy punctuation, casing & spacing") {
                    WToggle(on: boolBinding(\.cleanupEnabled))
                }
                SettRow(icon: "cloud", label: "Fallback engines",
                        sub: "If the chosen engine fails, try the others", last: true) {
                    WToggle(on: boolBinding(\.fallbackEnabled))
                }
            }
            SettGroup(title: "History") {
                SettRow(icon: "folder", label: "Save recordings",
                        sub: "Keep a local history of past dictations", last: true) {
                    WToggle(on: boolBinding(\.saveRecordings))
                }
            }
        }
    }

    private var contentCategory: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel(text: "Language & vocabulary").padding(.leading, 4)
                VStack(spacing: 0) {
                    Button {
                        withAnimation(.easeInOut(duration: 0.15)) { langOpen.toggle() }
                    } label: {
                        HStack(spacing: 13) {
                            WIcon("globe", size: 17, weight: .regular).foregroundStyle(t.accentLite)
                                .frame(width: 34, height: 34)
                                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            VStack(alignment: .leading, spacing: 1) {
                                Text("Language").font(WZFont.ui(14.5, .medium)).foregroundStyle(t.text)
                                Text("Spoken language for transcription").font(WZFont.ui(12)).foregroundStyle(t.muted)
                            }
                            Spacer(minLength: 0)
                            Text(currentLanguageName).font(WZFont.ui(13)).foregroundStyle(t.accentLite)
                            WIcon(langOpen ? "chevD" : "chevR", size: 16, weight: .regular).foregroundStyle(t.faint)
                        }
                        .padding(.vertical, 13)
                    }
                    .buttonStyle(.plain)
                    .overlay(alignment: .bottom) { Rectangle().fill(t.lineSoft).frame(height: 1) }

                    if langOpen {
                        FlowLayout(spacing: 7) {
                            ForEach(languages, id: \.code) { lang in
                                let on = settings.settings.language == lang.code
                                Button {
                                    setLanguage(lang.code)
                                    withAnimation(.easeInOut(duration: 0.15)) { langOpen = false }
                                } label: {
                                    Text(lang.name)
                                        .font(WZFont.ui(12.5, .semibold))
                                        .foregroundStyle(on ? t.accentLite : t.muted)
                                        .padding(.horizontal, 11).padding(.vertical, 6)
                                        .background(on ? t.accent.opacity(0.16) : t.surfaceUp, in: Capsule())
                                        .overlay(Capsule().stroke(on ? t.hair : t.line, lineWidth: 1))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.vertical, 12)
                        .overlay(alignment: .bottom) { Rectangle().fill(t.lineSoft).frame(height: 1) }
                    }

                    VStack(alignment: .leading, spacing: 7) {
                        Text("Custom words").font(WZFont.ui(13, .semibold)).foregroundStyle(t.muted)
                        TextField("git, GitHub, Next.js, kubectl…",
                                  text: binding(\.customVocabulary), axis: .vertical)
                            .lineLimit(2...4)
                            .font(WZFont.ui(13.5))
                            #if os(iOS)
                            .textInputAutocapitalization(.never)
                            #endif
                            .padding(.horizontal, 11).padding(.vertical, 9)
                            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(t.line, lineWidth: 1))
                        Text("Comma-separated — helps spell names, brands & jargon.")
                            .font(WZFont.mono(11)).foregroundStyle(t.faint)
                    }
                    .padding(.vertical, 13)
                }
                .padding(.horizontal, 16)
                .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
            }

            VStack(alignment: .leading, spacing: 8) {
                SectionLabel(text: "Rewrite prompts").padding(.leading, 4)
                Text(hasOpenAIKey
                     ? "Edit the rewrite templates Whisperio uses on transcripts."
                     : "Add an OpenAI API key first to edit rewrite prompts.")
                    .font(WZFont.mono(11)).foregroundStyle(t.faint)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(spacing: 0) {
                    ForEach(presets.presets) { p in
                        SettRow(icon: p.icon, label: p.name,
                                sub: p.isMeta ? "Builds new templates from your voice" : nil,
                                onTap: { openPresetEditor(p) })
                    }
                    SettRow(icon: "plus", label: "New template",
                            sub: "Add your own rewrite instruction", last: true,
                            onTap: { openPresetEditor(nil) })
                }
                .padding(.horizontal, 16)
                .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
                .opacity(hasOpenAIKey ? 1 : 0.5)
                .allowsHitTesting(hasOpenAIKey)
                GhostButton(title: "Restore default templates", icon: "sync") {
                    showRestoreConfirm = true
                }
                // No .fixedSize(): the design's parent here is a COLUMN flex container,
                // where align-items:stretch makes the ghost button span the full card
                // width (unlike the row-flex hug cases the earlier dimensional pass fixed).
                .padding(.top, 2)
                .opacity(hasOpenAIKey ? 1 : 0.5)
                .allowsHitTesting(hasOpenAIKey)
            }

            SettGroup(title: "Journaling") {
                SettRow(icon: "book", label: "Auto-journaling",
                        sub: settings.settings.cloudConsentGranted
                            ? "Group & summarize each day’s notes with AI · uses the cloud text model"
                            : "Groups & summarizes each day’s notes · turn on cloud transcription first") {
                    WToggle(on: boolBinding(\.autoDailyDigest))
                }
                VStack(alignment: .leading, spacing: 9) {
                    HStack(alignment: .top, spacing: 13) {
                        WIcon("keyboard", size: 17, weight: .regular).foregroundStyle(t.accentLite)
                            .frame(width: 34, height: 34)
                            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("What goes into the digest").font(WZFont.ui(14.5, .medium)).foregroundStyle(t.text)
                            Text("Keyboard dictations are usually chat replies — you may not want them summarized next to your real notes. Every source keeps its own tag, so this only affects the Journal.")
                                .font(WZFont.ui(12)).foregroundStyle(t.muted).lineSpacing(3)
                        }
                    }
                    Segmented(value: digestSourceModeBinding, options: [
                        (id: DigestSourceMode.all.rawValue, label: "All sources"),
                        (id: DigestSourceMode.appOnly.rawValue, label: "In-app only"),
                        (id: DigestSourceMode.manual.rawValue, label: "Pick per day")
                    ])
                    Text(digestSourceModeFootnote)
                        .font(WZFont.mono(11)).foregroundStyle(t.faint).lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 13)
                .overlay(alignment: .bottom) { Rectangle().fill(t.lineSoft).frame(height: 1) }
                SettRow(icon: "command", label: "Categorization prompts",
                        sub: "Edit how the AI sorts & summarizes your day", last: true,
                        onTap: openDigestPrompts)
            }
        }
    }

    // Persistent (non-dismissable) — shown whenever the user's choice is iCloud sync but EITHER
    // the library or the journal fell back to local-only (no iCloud account at launch, or a
    // CloudKit container init failed) and is pinned there for the process's lifetime. Without
    // this, two devices in this state each silently accumulate their own recordings/digests that
    // the other never sees.
    private var iCloudSyncMismatch: Bool {
        settings.settings.storageMode == .iCloud && (!recordings.isCloudBacked || !digests.isCloudBacked)
    }

    private var iCloudMismatchBanner: some View {
        Button(action: moveLibraryToCloud) {
            StateBanner(tone: .warn, icon: "cloud",
                        title: "iCloud sync is paused on this device",
                        sub: "Storage is set to Auto sync, but this device is local-only right now — recordings and journal entries made here won't reach your other devices until sync resumes.",
                        action: "Resume iCloud sync")
        }
        .buttonStyle(.plain)
    }

    private var syncCategory: some View {
        VStack(alignment: .leading, spacing: 16) {
            if iCloudSyncMismatch {
                iCloudMismatchBanner
            }
            VStack(alignment: .leading, spacing: 6) {
                SettGroup(title: "Storage") {
                    storageRow(.iCloud, "Auto sync",
                               "Keep the library in iCloud and sync it across your Apple devices",
                               "cloud")
                    storageRow(.onDevice, "On this device",
                               "Keep the library local until you move it manually",
                               "lock")
                    if settings.settings.storageMode == .onDevice {
                        SettRow(icon: "cloud", label: "Move library to iCloud",
                                sub: "Copies the current library into iCloud and switches this device to auto sync.",
                                last: true, onTap: moveLibraryToCloud)
                    }
                }
                Text("Takes effect after you restart Whisperio.")
                    .font(WZFont.mono(11)).foregroundStyle(t.faint)
                    .padding(.leading, 4)
            }

            VStack(alignment: .leading, spacing: 6) {
                SettGroup(title: "Sync behavior") {
                    syncModeRow(.automatic, "Automatic",
                                "Refresh live the moment iCloud delivers a change — today's default",
                                "bolt")
                    syncModeRow(.onOpen, "On open",
                                "Sync once each time you open Whisperio, then stay quiet",
                                "download")
                    syncModeRow(.interval, "Every few minutes",
                                "Sync on a timer while Whisperio is open",
                                "clock",
                                last: settings.settings.syncMode != .interval)
                    if settings.settings.syncMode == .interval {
                        intervalMinutesPicker
                    }
                    syncModeRow(.manual, "Manual only",
                                "Never sync automatically — tap the Sync button on Home when you want it",
                                "sync", last: true)
                }
                Text("iOS may still receive iCloud changes in the background; this controls when Whisperio actively refreshes and shows them.")
                    .font(WZFont.mono(11)).foregroundStyle(t.faint)
                    .padding(.leading, 4)
            }

            SettGroup(title: "GitHub mirror") {
                SettRow(icon: "sync", label: "Sync to GitHub",
                        sub: "Mirror transcripts, journals, renders & daily summaries to a Git repo",
                        last: true, onTap: openGitHubSync)
            }
        }
    }

    // Minute chips shown only while syncMode == .interval — mirrors the language-picker chip
    // style used elsewhere in Settings (Capsule, stroke, selected = accent fill).
    private var intervalMinutesPicker: some View {
        HStack(spacing: 8) {
            ForEach(syncIntervalChoices, id: \.self) { minutes in
                let on = settings.settings.syncIntervalMinutes == minutes
                Button { setSyncIntervalMinutes(minutes) } label: {
                    Text("\(minutes)m")
                        .font(WZFont.ui(12.5, .semibold))
                        .foregroundStyle(on ? Color.white : t.text)
                        .padding(.horizontal, 13).padding(.vertical, 7)
                        .background(on ? t.accent : t.surfaceUp, in: Capsule())
                        .overlay(Capsule().stroke(on ? Color.clear : t.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 2).padding(.bottom, 13)
        .overlay(alignment: .bottom) { Rectangle().fill(t.lineSoft).frame(height: 1) }
    }

    private var developerCategory: some View {
        VStack(alignment: .leading, spacing: 16) {
            SettGroup(title: "Diagnostics") {
                // Uniform 12pt column gap (design gap:12) — the header row is a peer of the
                // rows/refresh/events blocks, not a tighter-spaced sibling.
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .center) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("CloudKit status").font(WZFont.ui(13, .semibold)).foregroundStyle(t.text)
                            Text(cloudAccountStatusText)
                                .font(WZFont.ui(12))
                                .foregroundStyle(t.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 0)
                        Button {
                            Task { await refreshCloudAccountStatus() }
                        } label: {
                            HStack(spacing: 6) {
                                WIcon("sync", size: 14).foregroundStyle(t.text)
                                Text("Refresh")
                                    .font(WZFont.ui(12, .semibold))
                                    .foregroundStyle(t.text)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(t.surfaceUp, in: Capsule())
                            .overlay(Capsule().stroke(t.line, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        VStack(spacing: 10) {
                            diagnosticRow(label: "Device", value: deviceSummary)
                            diagnosticRow(label: "App version", value: "\(appVersion) (\(buildNumber))")
                            diagnosticRow(label: "Cloud container", value: RecordingSyncStore.cloudKitContainerID)
                            diagnosticRow(label: "Account status", value: accountStatusLabel)
                            diagnosticRow(label: "Account ID", value: cloudAccountRecordIDText)
                            diagnosticRow(label: "Storage mode",
                                          value: settings.settings.storageMode == .iCloud ? "Auto sync" : "On this device")
                            diagnosticRow(label: "Library backend",
                                          value: recordings.isCloudBacked ? "CloudKit" : "Local")
                            diagnosticRow(label: "Sync activity",
                                          value: recordings.isSyncing ? "Import/export in flight" : "Idle")
                            diagnosticRow(label: "Last import",
                                          value: dateString(recordings.lastImportAt))
                            diagnosticRow(label: "Last export",
                                          value: dateString(recordings.lastExportAt))
                            diagnosticRow(label: "Last local error",
                                          value: recordings.lastErrorMessage ?? "None")
                            diagnosticRow(label: "Journal backend",
                                          value: digests.isCloudBacked ? "CloudKit" : "Local")
                            diagnosticRow(label: "Journal sync activity",
                                          value: digests.isSyncing ? "Import/export in flight" : "Idle")
                            diagnosticRow(label: "Journal last import",
                                          value: dateString(digests.lastImportAt))
                            diagnosticRow(label: "Journal last error",
                                          value: digests.lastErrorMessage ?? "None")
                        }
                        if recordings.isCloudBacked {
                            HStack(spacing: 10) {
                                GhostButton(title: "Refresh local view", icon: "sync") {
                                    pullCloudNow()
                                }
                                .fixedSize()
                                .opacity(recordings.isSyncing ? 0.5 : 1)
                                .allowsHitTesting(!recordings.isSyncing)
                                Text(cloudDetailStatusText)
                                    .font(WZFont.ui(11.5))
                                    .foregroundStyle(t.faint)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 0)
                            }
                        } else {
                            Text("Library backend is local — there is no CloudKit connection to refresh from.")
                                .font(WZFont.ui(11.5))
                                .foregroundStyle(t.faint)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if !recordings.pendingSyncQueue.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Pending sync queue")
                                    .font(WZFont.ui(12.5, .semibold))
                                    .foregroundStyle(t.text)
                                VStack(spacing: 8) {
                                    ForEach(recordings.pendingSyncQueue) { item in
                                        syncQueueRow(item)
                                    }
                                }
                            }
                        }
                        if !recordings.recentSyncEvents.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Recent cloud events")
                                    .font(WZFont.ui(12.5, .semibold))
                                    .foregroundStyle(t.text)
                                VStack(spacing: 8) {
                                    ForEach(recordings.recentSyncEvents.prefix(6)) { event in
                                        syncEventRow(event)
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(.vertical, 13)
            }
        }
    }

    private var accountStatusLabel: String {
        switch cloudStatus {
        case .available: return "Available"
        case .noAccount: return "No account"
        case .restricted: return "Restricted"
            case .couldNotDetermine: return "Unknown"
            case .temporarilyUnavailable: return "Temporarily unavailable"
            @unknown default: return "Unknown"
        }
    }

    private func dateString(_ date: Date?) -> String {
        guard let date else { return "None" }
        let f = DateFormatter()
        f.dateStyle = .short
        f.timeStyle = .medium
        return f.string(from: date)
    }

    private func diagnosticRow(label: String, value: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(label)
                .font(WZFont.ui(12.5, .semibold))
                .foregroundStyle(t.muted)
                .frame(width: 116, alignment: .leading)
            Text(value)
                .font(WZFont.ui(12.5))
                .foregroundStyle(t.text)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 4)
    }

    private func syncQueueRow(_ item: RecordingsStore.SyncQueueItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(item.kind.rawValue)
                    .font(WZFont.ui(11.5, .semibold))
                    .foregroundStyle(t.accent)
                Text(item.title)
                    .font(WZFont.ui(12.5, .semibold))
                    .foregroundStyle(t.text)
                Spacer(minLength: 0)
                Text(dateString(item.timestamp))
                    .font(WZFont.mono(10.5))
                    .foregroundStyle(t.faint)
            }
            Text(item.detail)
                .font(WZFont.ui(11.5))
                .foregroundStyle(t.muted)
                .fixedSize(horizontal: false, vertical: true)
            if let recordID = item.recordID {
                Text(recordID.uuidString)
                    .font(WZFont.mono(10.5))
                    .foregroundStyle(t.faint)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .padding(10)
        .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.lineSoft, lineWidth: 1))
    }

    private func syncEventRow(_ event: RecordingSyncStore.EventLogEntry) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(event.kind.capitalized)
                    .font(WZFont.ui(11.5, .semibold))
                    .foregroundStyle(event.state == "failed" ? t.red : t.green)
                Text(event.state.capitalized)
                    .font(WZFont.ui(12.5, .semibold))
                    .foregroundStyle(t.text)
                Spacer(minLength: 0)
                Text(dateString(event.timestamp))
                    .font(WZFont.mono(10.5))
                    .foregroundStyle(t.faint)
            }
            Text(event.detail)
                .font(WZFont.ui(11.5))
                .foregroundStyle(t.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.lineSoft, lineWidth: 1))
    }

    @MainActor
    private func refreshCloudAccountStatus() async {
        // CKContainer(identifier:) raises an uncatchable NSException (instant process
        // death) when the installed binary's entitlements don't match the container —
        // probe the cheap signal first so a broken registration degrades to a label
        // instead of killing the app from a diagnostics page.
        guard FileManager.default.ubiquityIdentityToken != nil else {
            cloudStatus = .noAccount
            cloudAccountRecordIDText = "No iCloud account (or iCloud Drive off)"
            return
        }
        let container = CKContainer(identifier: RecordingSyncStore.cloudKitContainerID)
        do {
            let status = try await container.accountStatus()
            cloudStatus = status
            do {
                let recordID = try await fetchUserRecordID(container)
                cloudAccountRecordIDText = recordID.recordName
            } catch {
                cloudAccountRecordIDText = "Unable to fetch user record ID"
            }
            switch status {
            case .available:
                cloudAccountStatusText = "Available. CloudKit can sync against \(RecordingSyncStore.cloudKitContainerID)."
                cloudDetailStatusText = "CloudKit account is available."
            case .noAccount:
                cloudAccountStatusText = "No iCloud account is signed in on this device."
                cloudDetailStatusText = "No iCloud account on this device."
            case .restricted:
                cloudAccountStatusText = "iCloud is restricted on this device."
                cloudDetailStatusText = "CloudKit is restricted."
            case .couldNotDetermine:
                cloudAccountStatusText = "CloudKit could not determine account status yet."
                cloudDetailStatusText = "CloudKit could not determine account status."
            case .temporarilyUnavailable:
                cloudAccountStatusText = "CloudKit is temporarily unavailable."
                cloudDetailStatusText = "CloudKit is temporarily unavailable."
            @unknown default:
                cloudAccountStatusText = "CloudKit returned an unknown account status."
                cloudDetailStatusText = "CloudKit returned an unknown status."
            }
        } catch {
            cloudStatus = .couldNotDetermine
            cloudAccountStatusText = "CloudKit account check failed: \(error.localizedDescription)"
            cloudDetailStatusText = "Account lookup failed: \(error.localizedDescription)"
        }
    }

    private func fetchUserRecordID(_ container: CKContainer) async throws -> CKRecord.ID {
        try await withCheckedThrowingContinuation { continuation in
            container.fetchUserRecordID { recordID, error in
                if let recordID {
                    continuation.resume(returning: recordID)
                } else {
                    continuation.resume(throwing: error ?? NSError(
                        domain: "Whisperio.Settings",
                        code: -1,
                        userInfo: [NSLocalizedDescriptionKey: "Unable to fetch user record ID."]
                    ))
                }
            }
        }
    }

    private var systemCategory: some View {
        VStack(alignment: .leading, spacing: 16) {
            #if os(iOS)
            SettGroup(title: "Quick dictation") {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Say “Dictate with Whisperio” to Siri — or add the shortcut, then assign it to Back Tap (Settings → Accessibility → Touch → Back Tap → Run Shortcut).")
                        .font(WZFont.ui(13)).foregroundStyle(t.muted).lineSpacing(3)
                    HStack(spacing: 9) {
                        GhostButton(title: "Add to Siri", icon: "spark") { showAddToSiriSheet = true }
                        if shortcutsOpenFailed {
                            // shortcuts:// failed to open (rare — e.g. a restricted profile) —
                            // fall back to the system's own ShortcutsLink control.
                            ShortcutsLink().tint(t.accent).frame(maxWidth: .infinity)
                        } else {
                            GhostButton(title: "Shortcuts", icon: "arrowUR") { openShortcutsApp() }
                        }
                    }
                }
                .padding(.vertical, 13)
            }
            #endif
            SettGroup(title: "Dictate from anywhere") {
                // The custom keyboard is an iOS extension — there is nothing to install on
                // macOS, so its row only exists where the setup flow does (and the triggers
                // row takes the last-row divider treatment there instead).
                #if os(iOS)
                SettRow(icon: "zap", label: "Set up dictation triggers",
                        sub: "Action Button, Back Tap, keyboard, widgets & more — step by step",
                        onTap: { showTriggerGuides = true })
                SettRow(icon: "keyboard", label: "Whisperio keyboard",
                        sub: "Dictate from any app — install & setup", last: true,
                        onTap: openKeyboardSetup)
                #else
                SettRow(icon: "zap", label: "Global hotkeys",
                        sub: "Dictate anywhere with a system-wide shortcut",
                        last: true,
                        onTap: { NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil) })
                #endif
            }

            SettGroup(title: "Appearance") {
                SettRow(icon: dark ? "moon" : "sun", label: "Dark mode",
                        sub: "Match Whisperio’s look", last: true) {
                    WToggle(on: $dark)
                }
            }

            Text("Whisperio \(appVersion) · on-device")
                .font(WZFont.mono(11)).foregroundStyle(t.faint)
                .frame(maxWidth: .infinity, alignment: .center)
        }
    }

    private var hubView: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(spacing: 0) {
                SettRow(icon: "spark", label: "Replay onboarding",
                        sub: "Go through the intro flow again", last: true,
                        onTap: openOnboarding)
            }
            .padding(.horizontal, 16)
            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))

            hubGroup("AI", [.models, .transcription, .content])
            hubGroup("Data", [.sync, .storage])
            hubGroup("System", [.system, .developer])
        }
    }

    // One titled hub group (AI · Data · System) of category rows — built on the shared SettRow
    // primitive (17pt chevron, matching every other row in Settings) instead of a hand-rolled
    // duplicate of it.
    private func hubGroup(_ title: String, _ categories: [SettingsCategory]) -> some View {
        SettGroup(title: title) {
            ForEach(categories) { category in
                SettRow(icon: category.icon, label: category.title, sub: category.subtitle,
                        last: category == categories.last,
                        onTap: {
                            if category == .storage { openStorage() } else { selectedCategory = category }
                        })
            }
        }
    }

    @ViewBuilder
    // Returns AnyView so each category's (individually deep) generic type is erased at this
    // boundary instead of unioning all seven into one giant `_ConditionalContent` tree baked
    // into `body` — see the note at the call site. Settings is a cold path, so the AnyView
    // cost is irrelevant next to not crashing on device.
    private func categoryView(_ category: SettingsCategory) -> AnyView {
        // Explicit returns (not a @ViewBuilder switch) so each arm's deep type is erased into
        // AnyView here rather than unioned into one `_ConditionalContent` tree.
        switch category {
        case .models:       return AnyView(modelCategory)
        case .transcription: return AnyView(transcriptionCategory)
        case .content:      return AnyView(contentCategory)
        case .sync:         return AnyView(syncCategory)
        case .storage:      return AnyView(EmptyView())   // hub row opens StorageView directly
        case .developer:    return AnyView(developerCategory)
        case .system:       return AnyView(systemCategory)
        }
    }

    /// Tap a connection row: the open one collapses, another expands. Cloud providers still
    /// require explicit, persisted consent before their configuration opens.
    private func toggleConnection(_ id: ProviderID) {
        if openConnection == id {
            withAnimation(.easeInOut(duration: 0.2)) { openConnection = nil }
        } else if settings.settings.isCloud(id) && id != .selfHosted && !settings.settings.cloudConsentGranted {
            // Self-hosted is technically "cloud" (audio leaves the device), but it's the user's
            // own server, not a third party — the consent sheet doesn't apply. The green banner
            // in its expanded panel carries the honesty instead.
            consentProvider = id   // ask first; only expand on accept
        } else {
            withAnimation(.easeInOut(duration: 0.2)) { openConnection = id }
        }
    }

    /// Consent accepted — persist it and open the provider's configuration. Which engine
    /// actually transcribes is picked in the Model order card, not here.
    private func grantCloud(_ id: ProviderID) {
        var s = settings.settings
        s.cloudConsentGranted = true
        settings.settings = s
        consentProvider = nil
        withAnimation(.easeInOut(duration: 0.2)) { openConnection = id }
    }

    /// Per-row connection status line — exact strings from connStatus in mob-settings.jsx.
    private func connectionStatus(_ id: ProviderID) -> (text: String, ready: Bool) {
        let key: String
        switch id {
        case .onDevice: return ("Built-in · ready", true)
        // Never reaches the "Remote connectors" row loop (on-device, no key) — this arm only
        // keeps the switch exhaustive. Real state, not a placeholder: downloaded iff the
        // configured variant's model folder is actually on disk.
        case .localWhisper:
            return settings.isEngineReady(.localWhisper) ? ("Downloaded", true) : ("Not downloaded", false)
        case .selfHosted:
            let url = settings.settings.selfHostedURL.trimmingCharacters(in: .whitespaces)
            return url.isEmpty ? ("Add your server URL", false) : ("Connected · \(url)", true)
        case .openAI: key = settings.settings.openAIKey
        case .elevenLabs: key = settings.settings.elevenLabsKey
        case .replicate: key = settings.settings.replicateKey
        case .groq: key = settings.settings.groqKey
        case .deepgram: key = settings.settings.deepgramKey
        case .assemblyAI: key = settings.settings.assemblyAIKey
        case .mistral: key = settings.settings.mistralKey
        }
        return key.trimmingCharacters(in: .whitespaces).isEmpty
            ? ("Add API key to connect", false)
            : ("Connected", true)
    }

    /// Real, static provider-console deep links (not per-user data) for the "Manage account" /
    /// "Usage console" row — a July-2026 best effort; spot-check if a provider's dashboard changes.
    private static let engineConsoleURLs: [ProviderID: (manage: URL, usage: URL)] = [
        .openAI: (URL(string: "https://platform.openai.com/api-keys")!,
                  URL(string: "https://platform.openai.com/usage")!),
        .elevenLabs: (URL(string: "https://elevenlabs.io/app/settings/api-keys")!,
                     URL(string: "https://elevenlabs.io/app/usage")!),
        .replicate: (URL(string: "https://replicate.com/account/api-tokens")!,
                    URL(string: "https://replicate.com/account/billing")!),
        // .selfHosted intentionally has no entry — there's no vendor console for an arbitrary
        // user-run server. The "Manage account"/"Usage console" pair is swapped for a single
        // "Open server dashboard" button that opens the configured server URL directly instead.
        .groq: (URL(string: "https://console.groq.com/keys")!,
               URL(string: "https://console.groq.com/dashboard/usage")!),
        .deepgram: (URL(string: "https://console.deepgram.com/")!,
                   URL(string: "https://console.deepgram.com/")!),
        .assemblyAI: (URL(string: "https://www.assemblyai.com/app/account")!,
                     URL(string: "https://www.assemblyai.com/app/usage")!),
        .mistral: (URL(string: "https://console.mistral.ai/api-keys")!,
                  URL(string: "https://console.mistral.ai/usage")!),
    ]

    private func openManageAccount(_ id: ProviderID) {
        guard let urls = Self.engineConsoleURLs[id] else { return }
        openURL(urls.manage)
    }

    private func openUsageConsole(_ id: ProviderID) {
        guard let urls = Self.engineConsoleURLs[id] else { return }
        openURL(urls.usage)
    }

    // An expandable connection accordion row: tap toggles its configuration open, the
    // chevron rotates, and the status line reports the connection state.
    private func connectionRow(_ id: ProviderID, _ title: String, _ sub: String, _ icon: String) -> some View {
        let on = openConnection == id
        let cloud = settings.settings.isCloud(id)
        let needsConsent = cloud && !settings.settings.cloudConsentGranted
        let status = connectionStatus(id)
        return Button {
            toggleConnection(id)
        } label: {
            HStack(spacing: 13) {
                WIcon(icon, size: 17).foregroundStyle(on ? t.accent : t.muted)
                    .frame(width: 38, height: 38)
                    .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                VStack(alignment: .leading, spacing: 0) {
                    Text(title).font(WZFont.ui(14.5, .semibold)).foregroundStyle(t.text)
                    Text(sub).font(WZFont.mono(11)).foregroundStyle(t.faint)
                        .padding(.top, 1)
                    Text(status.text)
                        .font(WZFont.mono(10, .semibold))
                        .foregroundStyle(status.ready ? t.green : t.amber)
                        .padding(.top, 2)
                }
                Spacer(minLength: 0)
                if needsConsent {
                    WIcon("lock", size: 13).foregroundStyle(t.amber)
                }
                WIcon("chevD", size: 15).foregroundStyle(t.faint)
                    .rotationEffect(.degrees(on ? 180 : 0))
            }
            .padding(13)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(on ? t.surfaceUp : t.surface, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous)
                .stroke(t.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func keyField(_ label: String, _ text: Binding<String>,
                          placeholder: String = "paste key…") -> some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionLabel(text: label).padding(.leading, 4)
            SecureField(placeholder, text: text)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .autocorrectionDisabled()
                .font(WZFont.mono(13))
                .padding(.horizontal, 13).padding(.vertical, 12)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
        }
        .padding(.top, 2)
    }

    private func plainField(_ label: String, _ placeholder: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionLabel(text: label).padding(.leading, 4)
            TextField(placeholder, text: text)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
                #endif
                .autocorrectionDisabled()
                .font(WZFont.mono(13))
                .padding(.horizontal, 13).padding(.vertical, 12)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
        }
        .padding(.top, 2)
    }

    private func binding(_ keyPath: WritableKeyPath<WhisperioSettings, String>) -> Binding<String> {
        Binding(get: { settings.settings[keyPath: keyPath] },
                set: { var s = settings.settings; s[keyPath: keyPath] = $0; settings.settings = s })
    }
    private func boolBinding(_ keyPath: WritableKeyPath<WhisperioSettings, Bool>) -> Binding<Bool> {
        Binding(get: { settings.settings[keyPath: keyPath] },
                set: { var s = settings.settings; s[keyPath: keyPath] = $0; settings.settings = s })
    }
}

// Icon-key → SF Symbol with a raw-name fallback, so keys missing from WZIcon.map
// ("hammer", "gearshape", "timer") render their SF Symbol instead of a questionmark.
func settSymbol(_ k: String) -> String { WZIcon.map[k] ?? k }

struct SettGroup<Content: View>: View {
    @Environment(\.wz) private var t
    // Optional — mirrors mob-settings.jsx's `{title && <SectionLabel .../>}`. A group with no
    // title (e.g. the on-device models list) renders with no label above it at all, rather than
    // being forced to invent one (see ModelsView's models group).
    var title: String? = nil
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title {
                SectionLabel(text: title).padding(.leading, 4)
            }
            VStack(spacing: 0) { content }
                .padding(.horizontal, 16)
                .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
        }
    }
}

struct SettRow<Right: View>: View {
    @Environment(\.wz) private var t
    let icon: String
    let label: String
    var sub: String? = nil
    var last = false
    var onTap: (() -> Void)? = nil
    var iconSize: CGFloat = 17
    var chevronSize: CGFloat = 17
    @ViewBuilder var right: Right

    var body: some View {
        let row = HStack(spacing: 13) {
            Image(systemName: settSymbol(icon))
                .font(.system(size: iconSize, weight: .regular)).foregroundStyle(t.accentLite)
                .frame(width: 34, height: 34)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(WZFont.ui(14.5, .medium)).foregroundStyle(t.text)
                if let sub { Text(sub).font(WZFont.ui(12)).foregroundStyle(t.muted) }
            }
            Spacer(minLength: 0)
            right
            if onTap != nil, Right.self == EmptyView.self {
                WIcon("chevR", size: chevronSize, weight: .regular).foregroundStyle(t.faint)
            }
        }
        .padding(.vertical, 13)
        .overlay(alignment: .bottom) {
            if !last { Rectangle().fill(t.lineSoft).frame(height: 1) }
        }

        if let onTap {
            Button(action: onTap) { row }.buttonStyle(.plain)
        } else {
            row
        }
    }
}

extension SettRow where Right == EmptyView {
    init(icon: String, label: String, sub: String? = nil, last: Bool = false, onTap: (() -> Void)? = nil,
         iconSize: CGFloat = 17, chevronSize: CGFloat = 17) {
        self.init(icon: icon, label: label, sub: sub, last: last, onTap: onTap, iconSize: iconSize, chevronSize: chevronSize) { EmptyView() }
    }
}

// MARK: - Cloud consent sheet
// Plain-words, explicit opt-in before any audio leaves the device. Accepting persists
// `cloudConsentGranted`; on-device (Apple Speech) never reaches this.
struct CloudConsentSheet: View {
    @Environment(\.wz) private var t
    let provider: ProviderID
    var onAccept: () -> Void
    var onCancel: () -> Void

    private var name: String {
        switch provider {
        case .onDevice: return "Apple"   // never reaches the consent sheet
        case .localWhisper: return "Whisper"   // never reaches the consent sheet (on-device, same as .onDevice)
        case .openAI: return "OpenAI"
        case .elevenLabs: return "ElevenLabs"
        case .replicate: return "Replicate"
        case .selfHosted: return "Self-hosted"   // never reaches the consent sheet (your own server)
        case .groq: return "Groq"
        case .deepgram: return "Deepgram"
        case .assemblyAI: return "AssemblyAI"
        case .mistral: return "Mistral"
        }
    }

    var body: some View {
        // Scrolls because the .medium detent can be shorter than this content — the
        // accept/cancel buttons must always be reachable, not clipped off the bottom.
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    PrivacyBadge(mode: .cloud)
                    Spacer()
                    Button(action: onCancel) {
                        WIcon("x", size: 16).foregroundStyle(t.muted)
                            .frame(width: 34, height: 34)
                            .background(t.surfaceUp, in: Circle())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.bottom, 18)

                WIcon("cloud", size: 26).foregroundStyle(.white)
                    .frame(width: 56, height: 56)
                    .background(t.amber.opacity(0.9), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .padding(.bottom, 16)

                Text("Turn on cloud transcription?")
                    .font(WZFont.display(21)).foregroundStyle(t.text).padding(.bottom, 10)

                Text("To use \(name), your audio will leave this device and be sent to \(name)’s servers to be transcribed. That’s the only way a cloud engine can work.")
                    .font(WZFont.ui(14.5)).foregroundStyle(t.muted).lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true).padding(.bottom, 16)

                VStack(alignment: .leading, spacing: 11) {
                    bullet("lock", "Prefer privacy? Apple’s on-device engine is free, works in airplane mode, and never uploads anything.")
                    bullet("shield", "You can switch back to on-device any time. Your saved transcripts stay on this device.")
                }
                .padding(.bottom, 22)

                GradButton(title: "I understand — enable \(name)", icon: "cloud", action: onAccept)
                    .padding(.bottom, 10)
                GhostButton(title: "Keep audio on-device", action: onCancel)
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .background(t.bg.ignoresSafeArea())
    }

    private func bullet(_ icon: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            WIcon(icon, size: 15, weight: .regular).foregroundStyle(t.accentLite).padding(.top, 1)
            Text(text).font(WZFont.ui(13)).foregroundStyle(t.muted).lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

#if os(iOS)
// "Add to Siri" — a small sheet housing the real, system-provided SiriTipView so the phrase
// gets recorded against the App Shortcut Whisperio already auto-registers (DictateIntent).
// Nothing here is simulated: this is the system's own Siri-phrase recorder, just reframed as
// a two-up ghost button alongside "Shortcuts" instead of a bare vertical stack.
struct AddToSiriSheet: View {
    @Environment(\.wz) private var t
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Add to Siri")
                .font(WZFont.display(21)).foregroundStyle(t.text)
            Text("Record the phrase you want to say to Siri to start a Whisperio dictation.")
                .font(WZFont.ui(13.5)).foregroundStyle(t.muted).lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
            SiriTipView(intent: DictateIntent()).tint(t.accent)
            Spacer(minLength: 0)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(t.bg.ignoresSafeArea())
    }
}
#endif
