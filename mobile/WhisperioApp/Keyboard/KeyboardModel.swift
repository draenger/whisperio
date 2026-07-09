import SwiftUI

/// Observable state bridge between the `KeyboardViewController` (UIKit) and the SwiftUI
/// keyboard surface. The controller owns the `textDocumentProxy`; the view calls back
/// into it for every key.
@MainActor
final class KeyboardModel: ObservableObject {
    weak var controller: KeyboardViewController?

    @Published var hasFullAccess = false
    @Published var needsGlobeKey = true
    @Published var showFullAccessHint = false
    @Published var shifted = true
    @Published var lastInserted: String?
    @Published var pendingRewrite: String?
    @Published var suggestions: [String] = []

    func tap(_ ch: String) {
        controller?.insert(shifted ? ch.uppercased() : ch)
        if shifted { shifted = false }   // one-shot shift, like the system keyboard
    }
    /// Insert a literal character (numbers / symbols plane — no shift transform).
    func type(_ ch: String) { controller?.insert(ch) }
    func space() { controller?.insertSpace() }
    func returnKey() { controller?.insertReturn() }
    func backspace() { controller?.deleteBackward() }
    func nextKeyboard() { controller?.advanceToNextKeyboard() }
    func toggleShift() { shifted.toggle() }
    func mic() { controller?.startDictation() }
    func rewrite(presetID: String) { controller?.startRewrite(presetID: presetID) }
    func pickSuggestion(_ word: String) { controller?.applySuggestion(word) }
}
