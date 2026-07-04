#if os(macOS)
import Foundation
import AppKit
import Carbon.HIToolbox

/// System-wide ⌃⇧Space hotkey via Carbon `RegisterEventHotKey`.
///
/// Carbon hotkeys fire even when Whisperio isn't frontmost and — unlike a `CGEventTap` — need no
/// Accessibility permission, so this works on first launch. Each press invokes `handler` on the
/// main queue; the app wires that to `MacDictationController.toggle()` (start / stop dictation +
/// show / hide the overlay). Mirrors the Electron desktop hotkey manager
/// (`desktop/src/main/dictation/hotkeyManager.ts`).
final class HotkeyManager {
    private var hotKeyRef: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?
    private let handler: () -> Void

    /// 'WZKY' — a per-app signature so our hotkey id can't collide with another app's.
    private static let signature: OSType = 0x575A4B59
    private let hotKeyID = EventHotKeyID(signature: HotkeyManager.signature, id: 1)

    init(handler: @escaping () -> Void) {
        self.handler = handler
    }

    /// Install the Carbon event handler and register ⌃⇧Space. Safe to call once; a second call
    /// is a no-op while a registration is live.
    func register() {
        guard hotKeyRef == nil else { return }

        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: OSType(kEventHotKeyPressed)
        )
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()

        InstallEventHandler(
            GetApplicationEventTarget(),
            { _, event, userData -> OSStatus in
                guard let userData, let event else { return noErr }
                let manager = Unmanaged<HotkeyManager>.fromOpaque(userData).takeUnretainedValue()
                var firedID = EventHotKeyID()
                let status = GetEventParameter(
                    event,
                    EventParamName(kEventParamDirectObject),
                    EventParamType(typeEventHotKeyID),
                    nil,
                    MemoryLayout<EventHotKeyID>.size,
                    nil,
                    &firedID
                )
                if status == noErr, firedID.id == manager.hotKeyID.id {
                    DispatchQueue.main.async { manager.handler() }
                }
                return noErr
            },
            1,
            &eventType,
            selfPtr,
            &eventHandler
        )

        let keyCode = UInt32(kVK_Space)
        let modifiers = UInt32(controlKey | shiftKey)
        RegisterEventHotKey(
            keyCode,
            modifiers,
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
    }

    func unregister() {
        if let hotKeyRef { UnregisterEventHotKey(hotKeyRef) }
        if let eventHandler { RemoveEventHandler(eventHandler) }
        hotKeyRef = nil
        eventHandler = nil
    }

    deinit { unregister() }
}
#endif
