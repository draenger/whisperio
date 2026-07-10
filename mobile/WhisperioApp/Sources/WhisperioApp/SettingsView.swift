import SwiftUI
import AppIntents
import CloudKit
import WhisperioKit
#if canImport(UIKit)
import UIKit
#endif

// Settings — real, backed by SettingsStore: pick the transcription engine, enter
// cloud keys, toggle AI cleanup. Appearance + models below.
struct SettingsView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var recordings: RecordingsStore
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
    var toast: (String) -> Void = { _ in }

    @State private var consentProvider: ProviderID?   // non-nil → consent sheet is up
    @State private var showTriggerGuides = false      // presents the trigger onboarding hub
    @State private var showRestoreConfirm = false     // confirm before restoring seed templates
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

    private var autoStopSecondsBinding: Binding<Double> {
        Binding(get: { settings.settings.audioAutoStopTimeoutSeconds },
                set: { settings.settings.audioAutoStopTimeoutSeconds = max(0, $0) })
    }

    private enum SettingsCategory: String, CaseIterable, Identifiable {
        case models, transcription, integrations, content, sync, developer, system

        var id: String { rawValue }
        var title: String {
            switch self {
            case .models: return "Models"
            case .transcription: return "Transcription"
            case .integrations: return "Integrations"
            case .content: return "Content"
            case .sync: return "Sync"
            case .developer: return "Developer"
            case .system: return "System"
            }
        }
        var icon: String {
            switch self {
            case .models: return "cpu"
            case .transcription: return "mic"
            case .integrations: return "zap"
            case .content: return "spark"
            case .sync: return "cloud"
            case .developer: return "hammer"
            case .system: return "gearshape"
            }
        }
        var subtitle: String {
            switch self {
            case .models: return "Choose the primary engine and API keys"
            case .transcription: return "Mic behavior, cleanup, fallback, and timing"
            case .integrations: return "Keyboard, Siri, Back Tap, GitHub, and onboarding"
            case .content: return "Language, vocabulary, rewrite prompts, journaling"
            case .sync: return "Where data lives and how it reaches iCloud"
            case .developer: return "Diagnostics, GitHub sync, and advanced controls"
            case .system: return "Appearance and installed models"
            }
        }
    }

    private func setLanguage(_ code: String) {
        var s = settings.settings
        s.language = code
        settings.settings = s
    }

    private func setStorageMode(_ mode: StorageMode) {
        var s = settings.settings
        s.storageMode = mode
        settings.settings = s
    }

    private func moveLibraryToCloud() {
        do {
            try recordings.migrateCurrentLibraryToCloud()
            setStorageMode(.iCloud)
            toast("Library moved to iCloud sync")
        } catch {
            toast("Couldn't move library to iCloud")
        }
    }

    private func pullCloudNow() {
        recordings.requestCloudRefresh()
        cloudDetailStatusText = "Cloud refresh requested."
        toast("Requested a cloud pull")
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

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: selectedCategory?.title ?? "Settings",
                        onBack: selectedCategory == nil ? onBack : { selectedCategory = nil })
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 22) {
                        if let selectedCategory {
                            categoryView(selectedCategory)
                        } else {
                            hubView
                        }
                    }
                    .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 28)
                    .animation(.easeInOut(duration: 0.2), value: selectedCategory)
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
    }

    // Wrap a ProviderID so it can drive `.sheet(item:)`.
    private struct ConsentTarget: Identifiable { let id: ProviderID }

    private var modelCategory: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Model settings").padding(.leading, 4)
            SettGroup(title: "Transcription engine") {
                VStack(alignment: .leading, spacing: 9) {
                    HStack {
                        Spacer()
                        PrivacyBadge(mode: settings.settings.isCloud(engine) ? .cloud : .device, small: true)
                    }
                    .padding(.bottom, 1)
                    VStack(spacing: 10) {
                        engineRow(.onDevice, "Apple — on-device", "Free · private · offline", "cpu")
                        engineRow(.openAI, "OpenAI", "Cloud · Whisper API", "globe")
                        engineRow(.elevenLabs, "ElevenLabs", "Cloud · Scribe", "globe")
                    }
                    if engine == .openAI {
                        keyField("OpenAI API key", binding(\.openAIKey))
                        plainField("Base URL (optional, self-hosted)", "https://api.openai.com/v1", binding(\.openAIBaseURL))
                        plainField("Model (optional)", "whisper-1", binding(\.whisperModel))
                    }
                    if engine == .elevenLabs { keyField("ElevenLabs API key", binding(\.elevenLabsKey)) }
                }
            }
        }
    }

    private var transcriptionCategory: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Transcription").padding(.leading, 4)
            SettGroup(title: "Mic behavior") {
                SettRow(icon: "mic", label: "Live transcription",
                        sub: "See text as you speak · on-device, free") {
                    WToggle(on: boolBinding(\.liveTranscriptionEnabled))
                }
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
                .padding(.vertical, 12)
                VStack(alignment: .leading, spacing: 9) {
                    HStack(alignment: .top, spacing: 13) {
                        WIcon("timer", size: 17, weight: .regular).foregroundStyle(t.accentLite)
                            .frame(width: 34, height: 34)
                            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Auto-stop after silence").font(WZFont.ui(14.5, .medium)).foregroundStyle(t.text)
                            Text("Whisperio will release the mic after this many seconds without speech. Set to 0 to turn it off.")
                                .font(WZFont.ui(12)).foregroundStyle(t.muted).lineSpacing(3)
                        }
                    }
                    HStack(spacing: 12) {
                        Stepper(value: autoStopSecondsBinding, in: 0...120, step: 5) {
                            Text(autoStopSecondsBinding.wrappedValue == 0
                                 ? "Off"
                                 : "\(Int(autoStopSecondsBinding.wrappedValue)) seconds")
                                .font(WZFont.ui(13.5, .semibold))
                                .foregroundStyle(t.text)
                        }
                        Spacer(minLength: 0)
                    }
                    Text(autoStopSecondsBinding.wrappedValue == 0
                         ? "No automatic stop. Only manual stop or interruption will release the mic."
                         : "When the app is quiet for \(Int(autoStopSecondsBinding.wrappedValue)) seconds, Whisperio stops listening.")
                        .font(WZFont.mono(11)).foregroundStyle(t.faint)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 12)
                SettRow(icon: "globe", label: "Apple online speech",
                        sub: "Use Apple’s servers when on-device isn’t available · audio leaves the device") {
                    WToggle(on: boolBinding(\.appleAllowOnline))
                }
                SettRow(icon: "spark", label: "Cleanup",
                        sub: "Tidy punctuation, casing & spacing") {
                    WToggle(on: boolBinding(\.cleanupEnabled))
                }
                SettRow(icon: "cloud", label: "Fallback engines",
                        sub: "If the chosen engine fails, try the others", last: true) {
                    WToggle(on: boolBinding(\.fallbackEnabled))
                }
            }
        }
    }

    private var integrationsCategory: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Integrations").padding(.leading, 4)
            #if os(iOS)
            SettGroup(title: "Quick dictation") {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Say “Dictate with Whisperio” to Siri — or add the shortcut, then assign it to Back Tap (Settings → Accessibility → Touch → Back Tap → Run Shortcut).")
                        .font(WZFont.ui(13)).foregroundStyle(t.muted).lineSpacing(3)
                    SiriTipView(intent: DictateIntent()).tint(t.accent)
                    ShortcutsLink().tint(t.accent)
                }
            }
            #endif
            SettGroup(title: "Dictate from anywhere") {
                SettRow(icon: "zap", label: "Set up dictation triggers",
                        sub: "Action Button, Back Tap, keyboard, widgets & more — step by step",
                        onTap: { showTriggerGuides = true })
                SettRow(icon: "keyboard", label: "Whisperio keyboard",
                        sub: "Dictate from any app — install & setup",
                        onTap: openKeyboardSetup)
            }
            SettGroup(title: "Setup") {
                SettRow(icon: "spark", label: "Replay onboarding",
                        sub: "Go through the intro flow again", last: true,
                        onTap: openOnboarding)
            }
        }
    }

    private var contentCategory: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Content").padding(.leading, 4)
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel(text: "Language & vocabulary").padding(.leading, 4)
                VStack(spacing: 0) {
                    Menu {
                        ForEach(languages, id: \.code) { lang in
                            Button(lang.name) { setLanguage(lang.code) }
                        }
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
                            WIcon("chevR", size: 16, weight: .regular).foregroundStyle(t.faint)
                        }
                        .padding(.vertical, 13)
                    }
                    .overlay(alignment: .bottom) { Rectangle().fill(t.lineSoft).frame(height: 1) }

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
                SettRow(icon: "command", label: "Categorization prompts",
                        sub: "Edit how the AI sorts & summarizes your day", last: true,
                        onTap: openDigestPrompts)
            }
        }
    }

    private var syncCategory: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Sync settings").padding(.leading, 4)
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

        }
    }

    private var developerCategory: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Developer").padding(.leading, 4)
            SettGroup(title: "Sync") {
                SettRow(icon: "sync", label: "Sync to GitHub",
                        sub: "Mirror transcripts, renders & daily summaries to a Git repo",
                        last: true, onTap: openGitHubSync)
            }

            SettGroup(title: "Diagnostics") {
                VStack(alignment: .leading, spacing: 10) {
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
                                WIcon("refresh", size: 14).foregroundStyle(t.text)
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
                        }
                        HStack(spacing: 10) {
                            GhostButton(title: "Pull from cloud", icon: "cloud.download") {
                                pullCloudNow()
                            }
                            .fixedSize()
                            Text(cloudDetailStatusText)
                                .font(WZFont.ui(11.5))
                                .foregroundStyle(t.faint)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
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
                .padding(.vertical, 12)
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
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "System").padding(.leading, 4)
            SettGroup(title: "On-device models") {
                SettRow(icon: "download", label: "Manage models",
                        sub: "Apple Speech + Whisper", last: true, onTap: openModels)
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
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Settings").padding(.leading, 4)
            VStack(spacing: 0) {
                ForEach(SettingsCategory.allCases) { category in
                    Button {
                        selectedCategory = category
                    } label: {
                        HStack(spacing: 13) {
                            WIcon(category.icon, size: 17, weight: .regular).foregroundStyle(t.accentLite)
                                .frame(width: 34, height: 34)
                                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            VStack(alignment: .leading, spacing: 1) {
                                Text(category.title).font(WZFont.ui(14.5, .medium)).foregroundStyle(t.text)
                                Text(category.subtitle).font(WZFont.ui(12)).foregroundStyle(t.muted)
                            }
                            Spacer(minLength: 0)
                            WIcon("chevR", size: 16, weight: .regular).foregroundStyle(t.faint)
                        }
                        .padding(.vertical, 13)
                    }
                    .buttonStyle(.plain)
                    .overlay(alignment: .bottom) {
                        if category != SettingsCategory.allCases.last {
                            Rectangle().fill(t.lineSoft).frame(height: 1)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
        }
    }

    @ViewBuilder
    private func categoryView(_ category: SettingsCategory) -> some View {
        switch category {
        case .models:
            modelCategory
        case .transcription:
            transcriptionCategory
        case .integrations:
            integrationsCategory
        case .content:
            contentCategory
        case .sync:
            syncCategory
        case .developer:
            developerCategory
        case .system:
            systemCategory
        }
    }

    /// Cloud providers require explicit, persisted consent before they can be selected.
    private func selectEngine(_ id: ProviderID) {
        if settings.settings.isCloud(id) && !settings.settings.cloudConsentGranted {
            consentProvider = id   // ask first; only switch on accept
        } else {
            applyEngine(id)
        }
    }

    private func applyEngine(_ id: ProviderID) {
        var s = settings.settings
        s.providerChain = [id]
        settings.settings = s
    }

    private func grantCloud(_ id: ProviderID) {
        var s = settings.settings
        s.cloudConsentGranted = true
        s.providerChain = [id]
        settings.settings = s
        consentProvider = nil
    }

    private func engineRow(_ id: ProviderID, _ title: String, _ sub: String, _ icon: String) -> some View {
        let on = engine == id
        let cloud = settings.settings.isCloud(id)
        let needsConsent = cloud && !settings.settings.cloudConsentGranted
        return Button {
            selectEngine(id)
        } label: {
            HStack(spacing: 13) {
                WIcon(icon, size: 17).foregroundStyle(on ? t.accent : t.muted)
                    .frame(width: 38, height: 38)
                    .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(WZFont.ui(14.5, .semibold)).foregroundStyle(t.text)
                    Text(sub).font(WZFont.mono(11)).foregroundStyle(t.faint)
                }
                Spacer(minLength: 0)
                if needsConsent {
                    WIcon("lock", size: 13).foregroundStyle(t.amber)
                }
                WIcon(on ? "check" : "", size: 18).foregroundStyle(t.accent)
            }
            .padding(13)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(t.surface, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous)
                .stroke(on ? t.accent : t.line, lineWidth: on ? 2 : 1))
        }
        .buttonStyle(.plain)
    }

    private func keyField(_ label: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionLabel(text: label).padding(.leading, 4)
            SecureField("paste key…", text: text)
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

struct SettGroup<Content: View>: View {
    @Environment(\.wz) private var t
    let title: String
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: title).padding(.leading, 4)
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
    @ViewBuilder var right: Right

    var body: some View {
        let row = HStack(spacing: 13) {
            WIcon(icon, size: 17, weight: .regular).foregroundStyle(t.accentLite)
                .frame(width: 34, height: 34)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(WZFont.ui(14.5, .medium)).foregroundStyle(t.text)
                if let sub { Text(sub).font(WZFont.ui(12)).foregroundStyle(t.muted) }
            }
            Spacer(minLength: 0)
            right
            if onTap != nil, Right.self == EmptyView.self {
                WIcon("chevR", size: 17, weight: .regular).foregroundStyle(t.faint)
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
    init(icon: String, label: String, sub: String? = nil, last: Bool = false, onTap: (() -> Void)? = nil) {
        self.init(icon: icon, label: label, sub: sub, last: last, onTap: onTap) { EmptyView() }
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

    private var name: String { provider == .openAI ? "OpenAI" : "ElevenLabs" }

    var body: some View {
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

            Spacer(minLength: 0)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
