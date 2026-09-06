#if DEBUG
import SwiftUI
import WhisperioKit

// App Store screenshot harness — DEBUG builds only, never compiled into the App Store binary.
//
// Launch the simulator app with WHISPERIO_DESIGN_SCREEN=<screen> (via
// `SIMCTL_CHILD_WHISPERIO_DESIGN_SCREEN`, see mobile/marketing/pipeline/capture-ios.sh) and
// RootView renders that screen directly, on top of a deterministic demo library seeded into the
// REAL stores (RecordingsStore / DigestStore / SettingsStore) — so every row, chip and count on
// the screenshot is produced by the same code paths a user sees, just with known data.
//
// Screens: onboarding · home · detail · models · settings · journal · recap · keyboard ·
// triggers · ipad-library · ipad-journal · ipad-settings
enum DesignHarness {
    static var screen: String? { ProcessInfo.processInfo.environment["WHISPERIO_DESIGN_SCREEN"] }
    static var isActive: Bool { screen != nil }

    /// Must run before any store is created (WhisperioAppDelegate.didFinishLaunching calls it
    /// first thing). A fresh simulator has no settings blob, so RecordingsStore/DigestStore
    /// would default to the iCloud backend — and a simulator build carries no CloudKit
    /// entitlement, so NSPersistentCloudKitContainer traps at launch. Persist a minimal
    /// on-device settings blob (the decoder fills every other field with its default) so the
    /// stores pick the local JSON backend.
    static func prepareDefaultsIfActive() {
        guard isActive else { return }
        let d = UserDefaults.standard
        if d.data(forKey: "whisperio.settings.v1") == nil {
            d.set(Data(#"{"storageMode":"onDevice"}"#.utf8), forKey: "whisperio.settings.v1")
        }
        d.set(true, forKey: "whisperio.setupDone.v1")
        d.set(true, forKey: "wz.cloudkit.schema.seeded")   // skip the DEBUG CloudKit schema seed
    }

    /// Idempotent: settings are always normalised, recordings/digest only seeded when the
    /// library is empty (a relaunch for the next screen must not duplicate rows).
    @MainActor
    static func seed(settings: SettingsStore, recordings: RecordingsStore, digests: DigestStore) {
        settings.didCompleteSetup = true
        var s = settings.settings
        s.modelOrder = [
            ProviderSlot(provider: .onDevice, model: ""),
            ProviderSlot(provider: .openAI, model: "gpt-4o-transcribe"),
            ProviderSlot(provider: .elevenLabs, model: "scribe_v2")
        ]
        s.openAIKey = "sk-demo-key-for-screenshots"
        s.elevenLabsKey = "el-demo-key-for-screenshots"
        s.intelligenceProvider = .appleIntelligence
        s.storageMode = .onDevice
        s.cloudConsentGranted = true
        s.autoDailyDigest = true
        settings.settings = s

        guard recordings.items.isEmpty else { return }
        let now = Date()
        func rec(_ minutesAgo: Double, _ text: String, _ dur: TimeInterval, _ provider: ProviderID,
                 _ category: String, _ source: String?, render: String? = nil, presetID: String? = nil) -> Recording {
            let ts = now.addingTimeInterval(-minutesAgo * 60)
            return Recording(filename: "demo-\(Int(minutesAgo)).m4a", timestamp: ts, duration: dur, status: .completed,
                             provider: provider, transcription: text, category: category, render: render,
                             renderPresetID: presetID, updatedAt: ts, source: source)
        }
        let seeded: [Recording] = [
            rec(2, "Refactor the auth module to use JWT tokens and add refresh-token rotation before the Thursday release.",
                9, .onDevice, WZCategories.code.id, "keyboard"),
            rec(14, "Reply to Anna: thanks for the update, let's push the launch to next Thursday so QA gets a full cycle.",
                12, .onDevice, WZCategories.work.id, "keyboard",
                render: "Hi Anna,\n\nThanks for the update. Let's move the launch to next Thursday so QA has a full cycle.\n\nBest,\nDaniel",
                presetID: "email"),
            rec(48, "Idea: a weekly digest that summarizes every voice note into three bullet points and one next action.",
                7, .onDevice, WZCategories.ideas.id, "watch"),
            rec(95, "Grocery: oat milk, sourdough, the good olive oil, lemons, and coffee beans.",
                6, .onDevice, WZCategories.todo.id, "app"),
            rec(60 * 26, "Standup notes: shipped the export pipeline, blocked on the staging cert, pairing with Mara after lunch.",
                15, .openAI, WZCategories.work.id, "app"),
            rec(60 * 27, "Text Sam: running ten late, grab us a table by the window if you can.",
                5, .onDevice, WZCategories.messages.id, "keyboard"),
            rec(60 * 50, "Book review notes: the second half drags but the ending lands. Recommend to the reading group.",
                11, .onDevice, WZCategories.personal.id, "app")
        ]
        seeded.forEach { recordings.add($0) }

        let cal = Calendar.current
        let todayKey = DigestGrouping.dayKey(for: now, calendar: cal)
        let todays = seeded.filter { DigestGrouping.dayKey(for: $0.timestamp, calendar: cal) == todayKey }
        digests.storeComposed(DailyDigest(
            id: todayKey, date: now, recordingIDs: todays.map(\.id), groups: [],
            summary: "Auth refactor is queued for Thursday; the launch moves a week so QA gets a full cycle. One product idea worth keeping: a weekly three-bullet digest of every voice note. Groceries are on the list for tonight.",
            summaryGeneratedAt: now), viaCloud: false)
    }
}

/// Root swapped in by RootView when the harness env var is set.
struct DesignHarnessRoot: View {
    let screen: String
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var recordings: RecordingsStore
    @EnvironmentObject private var digests: DigestStore
    @State private var seeded = false

    var body: some View {
        Group {
            if seeded {
                content
            } else {
                Color.black.ignoresSafeArea()
            }
        }
        .task {
            DesignHarness.seed(settings: settings, recordings: recordings, digests: digests)
            seeded = true
        }
    }

    @ViewBuilder private var content: some View {
        switch screen {
        case "onboarding":
            OnboardingView { }.environment(\.wz, WZTheme.of(true)).preferredColorScheme(.dark)
        case "detail": WZPhoneView(initialScreen: .detail)
        case "models": WZPhoneView(initialScreen: .models)
        case "settings": WZPhoneView(initialScreen: .settings)
        case "journal": WZPhoneView(initialScreen: .journal)
        case "recap": WZPhoneView(initialScreen: .recap)
        case "keyboard": KeyboardScene().environment(\.wz, WZTheme.of(true)).preferredColorScheme(.dark)
        case "triggers": TriggerScene().environment(\.wz, WZTheme.of(true)).preferredColorScheme(.dark)
        case "ipad-library", "ipad-journal", "ipad-settings":
            iPadSplitView(showEngineBar: false).environment(\.wzLiveJournal, true)
        default: WZPhoneView(initialScreen: .home)
        }
    }
}
#endif
