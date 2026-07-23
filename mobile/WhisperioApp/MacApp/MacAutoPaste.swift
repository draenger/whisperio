#if os(macOS)
import AppKit
import UserNotifications

// Native macOS port of desktop/src/main/dictation/autoPaste.ts — writes the transcribed (or
// rewritten) text to the pasteboard, then synthesizes ⌘V (and optionally Enter) so it lands in
// whatever app currently has focus. Electron used `systemPreferences.isTrustedAccessibilityClient`
// + AppleScript "System Events" keystrokes; the native app checks/prompts Accessibility via
// `AXIsProcessTrustedWithOptions` and posts the keystrokes itself via `CGEvent` instead of
// shelling out to osascript.
@MainActor
enum MacAutoPaste {
    /// True if Whisperio is Accessibility-trusted. With `prompt: true` this also adds Whisperio
    /// to the Accessibility list and shows the system permission prompt (first call only) —
    /// mirrors `ensureAccessibilityPermission(prompt)` in autoPaste.ts.
    @discardableResult
    static func ensureAccessibility(prompt: Bool) -> Bool {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        let options: [String: Bool] = [key: prompt]
        return AXIsProcessTrustedWithOptions(options as CFDictionary)
    }

    /// Write `text` to the pasteboard and, if Accessibility is granted, synthesize ⌘V (then
    /// optionally Enter). Returns `false` when Accessibility isn't granted — the text is still
    /// left on the clipboard and a local notification tells the user how to enable auto-paste,
    /// same fail-soft contract as autoPaste.ts's Notification fallback.
    @discardableResult
    static func paste(_ text: String, thenEnter: Bool) async -> Bool {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)

        guard ensureAccessibility(prompt: true) else {
            await notifyAccessibilityNeeded()
            return false
        }

        // Give the hotkey's own modifier keys (⌃⇧, ⌥⇧, …) time to release before we synthesize
        // ⌘V — mirrors autoPaste.ts's 300ms wait "for modifier keys from hotkey to release".
        try? await Task.sleep(nanoseconds: 300_000_000)

        postKeystroke(keyCode: 9, flags: .maskCommand) // 9 = 'v'

        if thenEnter {
            try? await Task.sleep(nanoseconds: 100_000_000)
            postKeystroke(keyCode: 36, flags: []) // 36 = Return
        }

        return true
    }

    private static func postKeystroke(keyCode: CGKeyCode, flags: CGEventFlags) {
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false) else { return }
        down.flags = flags
        up.flags = flags
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    private static func notifyAccessibilityNeeded() async {
        let center = UNUserNotificationCenter.current()
        _ = try? await center.requestAuthorization(options: [.alert])
        let content = UNMutableNotificationContent()
        content.title = "Whisperio"
        content.body = "Grant Accessibility to auto-paste — text is on your clipboard (⌘V)"
        let request = UNNotificationRequest(identifier: "whisperio.autopaste.accessibility",
                                            content: content, trigger: nil)
        try? await center.add(request)
    }
}
#endif
