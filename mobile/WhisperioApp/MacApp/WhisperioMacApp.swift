#if os(macOS)
import SwiftUI
import AppKit
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
    init() {
        // macOS has no UIAppFonts — the generated Info.plist never registers the bundled
        // Space Grotesk / IBM Plex / JetBrains Mono files, so every WZFont .custom(...) was
        // silently falling back to the system font (wrong metrics → mis-sized buttons and
        // titles across the whole Mac app). Register them explicitly at launch.
        for url in Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? [] {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
    // Real, persisted stores so the Journal tab is live (store-backed digests over real notes),
    // not sample data. `wzLiveJournal` flips iPadSplitView's Journal onto JournalView/DigestDayView.
    @StateObject private var settings = SettingsStore()
    @StateObject private var recordings = RecordingsStore()
    @StateObject private var digests = DigestStore()
    // On-device Whisper (WhisperKit) download/model state — same singleton the iOS entry
    // point injects, so Mac's ModelsView sees the real, shared on-disk state too.
    @StateObject private var localWhisperModels = LocalWhisperModelManager.shared

    var body: some Scene {
        WindowGroup("Whisperio") {
            // Theme comes from iPadSplitView itself (persisted "wz.split.dark" @AppStorage →
            // .environment(\.wz, ...)) so Settings' Dark-mode toggle really re-themes the app —
            // a hardcoded .rezmeTheme here would freeze it dark.
            iPadSplitView()
                .environment(\.wzLiveJournal, true)
                .environmentObject(settings)
                .environmentObject(recordings)
                .environmentObject(digests)
                .environmentObject(localWhisperModels)
                .frame(minWidth: 820, minHeight: 560)
                .task {
                    // Register for remote (silent) push so NSPersistentCloudKitContainer gets an
                    // APNs device token and can receive the CloudKit "database changed" push that
                    // drives background sync (pairs with the aps-environment entitlement on the
                    // Mac target). Unlike iOS, macOS apps are not suspended in the background, so
                    // there is no `UIBackgroundModes` key for macOS — that Info.plist key only
                    // exists on iOS/iPadOS/tvOS and is not read on this platform. The Mac target
                    // intentionally has no such entry in project.pbxproj; registering for remote
                    // notifications here is sufficient for a running (or launched-at-login) Mac
                    // app to receive the silent push while it's up.
                    NSApplication.shared.registerForRemoteNotifications()
                    #if DEBUG
                    seedCloudKitSchema()
                    #endif
                }
        }
        .defaultSize(width: 1100, height: 760)

        // Native macOS Settings window (⌘,) — F7/R8: the app previously had no "Launch at
        // login" control anywhere (grepped; none existed), so this is a new, real surface for
        // it rather than a relabel of an existing stub.
        Settings {
            MacGeneralSettingsView()
        }
    }

#if DEBUG
    /// One-time explicit CloudKit schema creation via `initializeCloudKitSchema(options:)`,
    /// covering both `RecordingEntity` and `DigestEntity`, in the DEVELOPMENT environment. Run
    /// this Debug build once on a Mac signed into iCloud, then Deploy Schema Changes to
    /// Production in the CloudKit Console. No-ops after the first run. Never ships (#if DEBUG).
    @MainActor private func seedCloudKitSchema() {
        let key = "wz.cloudkit.schema.seeded"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        do {
            try WhisperioCloudKit.initializeSchemaForDevelopment()
            UserDefaults.standard.set(true, forKey: key)
            NSLog("[Whisperio] CloudKit schema initialized (RecordingEntity + DigestEntity) — check CloudKit Console (Development).")
        } catch {
            NSLog("[Whisperio] CloudKit schema initialization failed: \(error)")
        }
    }
#endif
}
#endif
