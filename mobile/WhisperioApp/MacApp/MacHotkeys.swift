#if os(macOS)
import SwiftUI
import Carbon.HIToolbox // RegisterEventHotKey

// A single key combination expressed in Carbon terms — the API RegisterEventHotKey needs
// (virtual keyCode + a bitmask of cmdKey/optionKey/controlKey/shiftKey), plus a precomputed
// human-readable label so UI code never has to re-derive it.
struct KeyCombo: Equatable, Codable {
    var keyCode: UInt32
    var carbonModifiers: UInt32
    var display: String
}

// The three global actions Electron's hotkeyManager.ts exposes; `command` there is "command
// mode — rewrite clipboard", kept as one word here to match the raw value used as the
// UserDefaults key suffix and the EventHotKeyID signature.
enum MacHotkeyAction: String, CaseIterable {
    case dictation
    case dictateAndSend
    case command
    case outputRecording
}

// Global hotkey registration/dispatch for the native Mac app, mirroring Electron's
// hotkeyManager.ts. Owns Carbon RegisterEventHotKey lifecycles and persists user overrides
// to UserDefaults as JSON so they survive relaunches independent of the rest of app state.
@MainActor
final class HotkeyCenter: ObservableObject {
    static let shared = HotkeyCenter()

    /// Set by whoever wants to react to hotkey presses (e.g. the app delegate). Called on
    /// the main actor since HotkeyCenter itself is main-actor-isolated.
    var handler: ((MacHotkeyAction) -> Void)?

    @Published private(set) var combos: [MacHotkeyAction: KeyCombo]

    // Carbon event-handler plumbing, kept alive for the process lifetime.
    private var eventHandlerRef: EventHandlerRef?
    private var hotKeyRefs: [MacHotkeyAction: EventHotKeyRef] = [:]
    // Stable, distinct ids so the Carbon callback can map an EventHotKeyID back to an action.
    private let signature: OSType = { UInt32(bigEndian: "WZHK".utf8.reduce(0) { $0 << 8 | UInt32($1) }) }()
    private var idForAction: [MacHotkeyAction: UInt32] = [
        .dictation: 1,
        .dictateAndSend: 2,
        .command: 3,
        .outputRecording: 4,
    ]
    private var actionForId: [UInt32: MacHotkeyAction] {
        Dictionary(uniqueKeysWithValues: idForAction.map { ($1, $0) })
    }

    // Combos are frozen while the settings recorder is capturing a new key combination, so a
    // stray global press doesn't fire the old action mid-recording.
    private var isPaused = false

    private static func defaultsKey(_ action: MacHotkeyAction) -> String {
        "wz.mac.hotkey.\(action.rawValue)"
    }

    // Mirror of Electron's hotkeyManager.ts defaults: dictation = ⌃⇧Space, command = ⌃⇧C,
    // dictateAndSend is opt-in (no default binding).
    private static func builtinDefault(_ action: MacHotkeyAction) -> KeyCombo? {
        let ctrlShift = UInt32(controlKey | shiftKey)
        switch action {
        case .dictation:
            return KeyCombo(keyCode: UInt32(kVK_Space), carbonModifiers: ctrlShift, display: "⌃⇧Space")
        case .command:
            return KeyCombo(keyCode: UInt32(kVK_ANSI_C), carbonModifiers: ctrlShift, display: "⌃⇧C")
        case .dictateAndSend, .outputRecording:
            return nil
        }
    }

    private init() {
        var loaded: [MacHotkeyAction: KeyCombo] = [:]
        for action in MacHotkeyAction.allCases {
            if let data = UserDefaults.standard.data(forKey: Self.defaultsKey(action)),
               let combo = try? JSONDecoder().decode(KeyCombo.self, from: data) {
                loaded[action] = combo
            } else if let def = Self.builtinDefault(action) {
                loaded[action] = def
            }
        }
        combos = loaded
    }

    func combo(for action: MacHotkeyAction) -> KeyCombo? {
        combos[action]
    }

    // Persists (or, if `nil`, clears) the user's override for `action`, then re-registers
    // every hotkey so the change takes effect immediately.
    func setCombo(_ combo: KeyCombo?, for action: MacHotkeyAction) {
        combos[action] = combo
        let key = Self.defaultsKey(action)
        if let combo, let data = try? JSONEncoder().encode(combo) {
            UserDefaults.standard.set(data, forKey: key)
        } else {
            // An explicit clear must persist as "no default either" — store an empty
            // sentinel rather than deleting the key, which would fall back to the builtin.
            UserDefaults.standard.set(Data(), forKey: key)
        }
        registerAll()
    }

    // Installs the Carbon event handler once (idempotent) and (re)registers every combo that
    // is currently set. Call at app launch, and again after any combo change.
    func registerAll() {
        installEventHandlerIfNeeded()
        for ref in hotKeyRefs.values {
            UnregisterEventHotKey(ref)
        }
        hotKeyRefs.removeAll()

        guard !isPaused else { return }

        for action in MacHotkeyAction.allCases {
            guard let combo = combos[action] else { continue }
            var hotKeyRef: EventHotKeyRef?
            var hotKeyID = EventHotKeyID(signature: signature, id: idForAction[action] ?? 0)
            let status = RegisterEventHotKey(
                combo.keyCode,
                combo.carbonModifiers,
                hotKeyID,
                GetEventDispatcherTarget(),
                0,
                &hotKeyRef
            )
            if status == noErr, let hotKeyRef {
                hotKeyRefs[action] = hotKeyRef
            } else {
                NSLog("[Whisperio] RegisterEventHotKey failed for \(action.rawValue): status \(status)")
            }
            _ = hotKeyID // silence unused-var warning if the block above changes
        }
    }

    /// Unregisters all hotkeys without touching the persisted combos, so the settings
    /// recorder can capture a fresh key combination without the old one firing mid-capture.
    func pause() {
        isPaused = true
        for ref in hotKeyRefs.values {
            UnregisterEventHotKey(ref)
        }
        hotKeyRefs.removeAll()
    }

    func resume() {
        isPaused = false
        registerAll()
    }

    private func installEventHandlerIfNeeded() {
        guard eventHandlerRef == nil else { return }
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let callback: EventHandlerUPP = { _, event, _ -> OSStatus in
            var hotKeyID = EventHotKeyID()
            let status = GetEventParameter(
                event,
                EventParamName(kEventParamDirectObject),
                EventParamType(typeEventHotKeyID),
                nil,
                MemoryLayout<EventHotKeyID>.size,
                nil,
                &hotKeyID
            )
            guard status == noErr else { return status }
            let id = hotKeyID.id
            Task { @MainActor in
                if let action = HotkeyCenter.shared.actionForId[id] {
                    HotkeyCenter.shared.handler?(action)
                }
            }
            return noErr
        }
        InstallEventHandler(GetEventDispatcherTarget(), callback, 1, &eventType, nil, &eventHandlerRef)
    }

    // MARK: - Display strings

    // Builds a keycap-style label from Carbon modifiers + a virtual keyCode, in the
    // conventional macOS symbol order ⌃⌥⇧⌘.
    static func displayString(keyCode: UInt32, carbonModifiers: UInt32) -> String {
        var s = ""
        if carbonModifiers & UInt32(controlKey) != 0 { s += "⌃" }
        if carbonModifiers & UInt32(optionKey) != 0 { s += "⌥" }
        if carbonModifiers & UInt32(shiftKey) != 0 { s += "⇧" }
        if carbonModifiers & UInt32(cmdKey) != 0 { s += "⌘" }
        s += displayName(keyCode: keyCode)
        return s
    }

    // Used by the settings recorder to render the raw key name while/after capturing.
    static func displayName(keyCode: UInt32) -> String {
        switch Int(keyCode) {
        case kVK_Space: return "Space"
        case kVK_Return: return "Return"
        case kVK_Tab: return "Tab"
        case kVK_Delete: return "Delete"
        case kVK_ForwardDelete: return "Fwd Delete"
        case kVK_Escape: return "Esc"
        case kVK_LeftArrow: return "←"
        case kVK_RightArrow: return "→"
        case kVK_UpArrow: return "↑"
        case kVK_DownArrow: return "↓"
        case kVK_Home: return "Home"
        case kVK_End: return "End"
        case kVK_PageUp: return "Page Up"
        case kVK_PageDown: return "Page Down"
        case kVK_F1: return "F1"
        case kVK_F2: return "F2"
        case kVK_F3: return "F3"
        case kVK_F4: return "F4"
        case kVK_F5: return "F5"
        case kVK_F6: return "F6"
        case kVK_F7: return "F7"
        case kVK_F8: return "F8"
        case kVK_F9: return "F9"
        case kVK_F10: return "F10"
        case kVK_F11: return "F11"
        case kVK_F12: return "F12"
        case kVK_ANSI_A: return "A"
        case kVK_ANSI_B: return "B"
        case kVK_ANSI_C: return "C"
        case kVK_ANSI_D: return "D"
        case kVK_ANSI_E: return "E"
        case kVK_ANSI_F: return "F"
        case kVK_ANSI_G: return "G"
        case kVK_ANSI_H: return "H"
        case kVK_ANSI_I: return "I"
        case kVK_ANSI_J: return "J"
        case kVK_ANSI_K: return "K"
        case kVK_ANSI_L: return "L"
        case kVK_ANSI_M: return "M"
        case kVK_ANSI_N: return "N"
        case kVK_ANSI_O: return "O"
        case kVK_ANSI_P: return "P"
        case kVK_ANSI_Q: return "Q"
        case kVK_ANSI_R: return "R"
        case kVK_ANSI_S: return "S"
        case kVK_ANSI_T: return "T"
        case kVK_ANSI_U: return "U"
        case kVK_ANSI_V: return "V"
        case kVK_ANSI_W: return "W"
        case kVK_ANSI_X: return "X"
        case kVK_ANSI_Y: return "Y"
        case kVK_ANSI_Z: return "Z"
        case kVK_ANSI_0: return "0"
        case kVK_ANSI_1: return "1"
        case kVK_ANSI_2: return "2"
        case kVK_ANSI_3: return "3"
        case kVK_ANSI_4: return "4"
        case kVK_ANSI_5: return "5"
        case kVK_ANSI_6: return "6"
        case kVK_ANSI_7: return "7"
        case kVK_ANSI_8: return "8"
        case kVK_ANSI_9: return "9"
        default: return "Key \(keyCode)"
        }
    }
}

// MARK: - Recorder control

// A clickable field that, when clicked, captures the next non-modifier keypress (with at
// least one of ctrl/opt/cmd held — shift alone is rejected to avoid clobbering ordinary
// shifted typing) and saves it as the combo for `action`. Esc cancels; the "×" clears.
struct KeyComboRecorderView: View {
    @Environment(\.wz) private var t
    let action: MacHotkeyAction
    @ObservedObject private var center = HotkeyCenter.shared
    @State private var isRecording = false
    @State private var monitor: Any?

    private var combo: KeyCombo? { center.combo(for: action) }

    var body: some View {
        HStack(spacing: 6) {
            Button {
                if isRecording {
                    stopRecording(cancelled: true)
                } else {
                    startRecording()
                }
            } label: {
                Text(isRecording ? "Press a key combo…" : (combo?.display ?? "None"))
                    .font(WZFont.ui(12, .medium))
                    .foregroundStyle(isRecording ? t.accent : (combo == nil ? t.muted : t.text))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .frame(minWidth: 120)
                    .background(
                        RoundedRectangle(cornerRadius: 6)
                            .fill(t.elevated)
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(isRecording ? t.accent : t.line, lineWidth: 1)
                            )
                    )
            }
            .buttonStyle(.plain)

            if combo != nil {
                Button {
                    center.setCombo(nil, for: action)
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(t.muted)
                }
                .buttonStyle(.plain)
            }
        }
        .onDisappear {
            if isRecording { stopRecording(cancelled: true) }
        }
    }

    private func startRecording() {
        isRecording = true
        center.pause()
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            if event.keyCode == UInt16(kVK_Escape) {
                stopRecording(cancelled: true)
                return nil
            }
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            let hasRequiredModifier = flags.contains(.control) || flags.contains(.option) || flags.contains(.command)
            guard hasRequiredModifier else {
                // Shift-only (or bare) keypresses don't qualify — swallow it and keep recording.
                return nil
            }
            var carbonModifiers: UInt32 = 0
            if flags.contains(.control) { carbonModifiers |= UInt32(controlKey) }
            if flags.contains(.option) { carbonModifiers |= UInt32(optionKey) }
            if flags.contains(.shift) { carbonModifiers |= UInt32(shiftKey) }
            if flags.contains(.command) { carbonModifiers |= UInt32(cmdKey) }
            let keyCode = UInt32(event.keyCode)
            let display = HotkeyCenter.displayString(keyCode: keyCode, carbonModifiers: carbonModifiers)
            center.setCombo(KeyCombo(keyCode: keyCode, carbonModifiers: carbonModifiers, display: display), for: action)
            stopRecording(cancelled: false)
            return nil
        }
    }

    private func stopRecording(cancelled: Bool) {
        if let monitor {
            NSEvent.removeMonitor(monitor)
        }
        monitor = nil
        isRecording = false
        center.resume()
    }
}
#endif
