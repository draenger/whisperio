#if os(macOS)
import AppKit
import ApplicationServices
import CoreGraphics

/// Copy-and-paste bridge for finished dictation, mirroring the Electron desktop's
/// `desktop/src/main/dictation/autoPaste.ts` behavior on native macOS.
///
/// The contract is deliberately graceful: the transcript is **always** placed on the general
/// pasteboard, so the user can press ⌘V manually no matter what. If the user has left auto-paste
/// on AND granted Accessibility (`AXIsProcessTrustedWithOptions`), Whisperio additionally
/// synthesizes a ⌘V keystroke via `CGEvent` into whatever app currently holds focus — the overlay
/// pill is a non-activating panel, so focus never left the user's target field.
///
/// Accessibility (not the App Sandbox mic/network grants) is the gate for *posting* events into
/// other apps. The first delivery with auto-paste enabled calls the trust check with `prompt: true`,
/// which registers Whisperio in System Settings › Privacy & Security › Accessibility and shows the
/// one-time system dialog. Until the user flips that switch, `AXIsProcessTrusted*` returns false and
/// we fall back to copy-only, surfacing `Outcome.needsAccessibility` so the caller can tell the user.
enum AutoPaste {
    /// UserDefaults flag (Mac-only preference, same house style as `whisperio.mac.autoUpdate`).
    /// Absent ⇒ treated as ON — auto-paste is the expected default for a dictation tool.
    static let enabledDefaultsKey = "whisperio.mac.autoPaste"

    /// What actually happened, so the UI can show the right one-liner.
    enum Outcome {
        case pasted            // copied + ⌘V synthesized into the focused app
        case copiedOnly        // copied; auto-paste turned off by the user
        case needsAccessibility // copied; auto-paste on but Accessibility not granted yet
    }

    static var isEnabled: Bool {
        // `object(forKey:)` distinguishes "never set" (default ON) from an explicit `false`.
        UserDefaults.standard.object(forKey: enabledDefaultsKey) as? Bool ?? true
    }

    /// Whether Whisperio is trusted to post synthetic events into other apps. With `prompt: true`
    /// the first call adds the app to the Accessibility list and shows the system dialog.
    static func hasAccessibilityPermission(prompt: Bool = false) -> Bool {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        return AXIsProcessTrustedWithOptions([key: prompt] as CFDictionary)
    }

    /// Put text on the general pasteboard. Always safe; never depends on any permission.
    static func copy(_ text: String) {
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(text, forType: .string)
    }

    /// Copy the transcript and, when permitted, paste it into the frontmost app.
    ///
    /// The ⌘V is posted after a short delay so the hotkey's own modifier keys (⌃⇧ held during
    /// ⌃⇧Space) have time to release — otherwise the synthetic ⌘V collides with still-down
    /// modifiers and the paste is swallowed, exactly as the Electron path waits 300 ms.
    @MainActor
    @discardableResult
    static func deliver(_ text: String) -> Outcome {
        copy(text)
        guard isEnabled else { return .copiedOnly }
        guard hasAccessibilityPermission(prompt: true) else { return .needsAccessibility }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { synthesizePaste() }
        return .pasted
    }

    /// Synthesize a ⌘V key-down/up pair into the HID event stream (delivered to the focused app).
    private static func synthesizePaste() {
        let source = CGEventSource(stateID: .combinedSessionState)
        let vKey: CGKeyCode = 0x09  // ANSI 'v'
        let down = CGEvent(keyboardEventSource: source, virtualKey: vKey, keyDown: true)
        let up = CGEvent(keyboardEventSource: source, virtualKey: vKey, keyDown: false)
        down?.flags = .maskCommand
        up?.flags = .maskCommand
        down?.post(tap: .cghidEventTap)
        up?.post(tap: .cghidEventTap)
    }
}
#endif
