#if os(macOS)
import SwiftUI

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
        }
        .defaultSize(width: 1100, height: 760)
    }
}
#endif
