import AppIntents
import Foundation

// Launch commands a trigger (widget / Control Center / Back Tap / Siri) leaves for
// the app to pick up. A persisted flag is the reliable channel: on a COLD launch the
// SwiftUI view tree (and any NotificationCenter observer) isn't mounted yet when the
// intent's perform() runs, so a posted notification would be dropped. The app reads
// this flag on appear / when it becomes active. The notification is kept as a fast
// path for the already-running case.
enum DictationCommand: String {
    case start, stop
}

enum DictationLaunch {
    private static let key = "whisperio.pendingCommand"
    static func set(_ c: DictationCommand) { UserDefaults.standard.set(c.rawValue, forKey: key) }
    static func consume() -> DictationCommand? {
        guard let raw = UserDefaults.standard.string(forKey: key) else { return nil }
        UserDefaults.standard.removeObject(forKey: key)
        return DictationCommand(rawValue: raw)
    }
}

// Start a new dictation (bind to double tap / widget / Control Center / Siri).
struct DictateIntent: AppIntent {
    static var title: LocalizedStringResource = "Dictate with Whisperio"
    static var description = IntentDescription("Start a new Whisperio dictation.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        DictationLaunch.set(.start)
        NotificationCenter.default.post(name: .whisperioStartDictation, object: nil)
        return .result()
    }
}

// Stop recording and transcribe (bind to triple tap / Siri).
struct StopDictationIntent: AppIntent {
    static var title: LocalizedStringResource = "Stop Whisperio dictation"
    static var description = IntentDescription("Stop recording and transcribe.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        DictationLaunch.set(.stop)
        NotificationCenter.default.post(name: .whisperioStopDictation, object: nil)
        return .result()
    }
}

extension Notification.Name {
    static let whisperioStartDictation = Notification.Name("ai.whisperio.startDictation")
    static let whisperioStopDictation = Notification.Name("ai.whisperio.stopDictation")
}
