import AppIntents

// App-target only (not compiled into the widget) — registers the Siri / Shortcuts /
// Back Tap phrases. Lives apart from DictateIntent.swift, which is shared with the
// widget target and must not pull an AppShortcutsProvider into the extension.
struct WhisperioShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: DictateIntent(),
            phrases: [
                "Dictate with \(.applicationName)",
                "Start \(.applicationName) dictation"
            ],
            shortTitle: "Dictate",
            systemImageName: "mic.fill"
        )
        AppShortcut(
            intent: StopDictationIntent(),
            phrases: [
                "Stop \(.applicationName) dictation",
                "Finish \(.applicationName) dictation"
            ],
            shortTitle: "Stop dictation",
            systemImageName: "stop.fill"
        )
    }
}
