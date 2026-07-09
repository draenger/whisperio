#if os(macOS)
import SwiftUI
import WhisperioKit

// Native macOS entry point. The Mac app renders the SHARED iPad UI (`iPadSplitView`) by
// compiling the iOS `Sources/WhisperioApp/` sources into this target — same views, same
// design language as iPad. macOS-unavailable files (watch / widget / keyboard / AppIntents
// providers / the iOS @main) are excluded via the target's build-file exception set; the
// remaining scattered iOS-only API is `#if os(iOS)`-gated inside the shared files.
//
// The canonical teal identity rides on `\.wz = .rezmeTheme` (the shared Theme.swift owns the
// `WZTheme` / `\.wz` environment). Default window ~1100x760 so the split view breathes.
@main
struct WhisperioMacApp: App {
    // Real, persisted stores so the Journal tab is live (store-backed digests over real notes),
    // not sample data. `wzLiveJournal` flips iPadSplitView's Journal onto JournalView/DigestDayView.
    @StateObject private var settings = SettingsStore()
    @StateObject private var recordings = RecordingsStore()
    @StateObject private var digests = DigestStore()

    var body: some Scene {
        WindowGroup("Whisperio") {
            iPadSplitView()
                .environment(\.wz, .rezmeTheme)
                .environment(\.wzLiveJournal, true)
                .environmentObject(settings)
                .environmentObject(recordings)
                .environmentObject(digests)
                .frame(minWidth: 820, minHeight: 560)
                .task { seedCloudKitSchema() }
        }
        .defaultSize(width: 1100, height: 760)
    }

#if DEBUG
    /// One-time CloudKit write: forces NSPersistentCloudKitContainer to JIT-create the
    /// `CD_RecordingEntity` schema in the DEVELOPMENT environment. Run this Debug build once on a
    /// Mac signed into iCloud, then Deploy Schema Changes to Production in the CloudKit Console.
    /// No-ops after the first run. Never ships (#if DEBUG). The seed row is safe to delete.
    @MainActor private func seedCloudKitSchema() {
        let key = "wz.cloudkit.schema.seeded"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        recordings.add(Recording(filename: "cloudkit-schema-seed",
                                 duration: 0.1,
                                 status: .completed,
                                 transcription: "CloudKit schema seed — safe to delete"))
        UserDefaults.standard.set(true, forKey: key)
        NSLog("[Whisperio] CloudKit schema seed written — check CloudKit Console (Development).")
    }
#endif
}
#endif
