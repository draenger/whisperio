import UIKit
import SwiftUI
import WhisperioKit

// Whisperio custom keyboard.
//
// The hero is a big mic key that uses the BOUNCE-TO-APP flow: it opens the main app via
// the `whisperio://dictate?return=keyboard` URL (requires Allow Full Access), the app
// records + transcribes with the existing engine, writes the transcript to the shared
// App Group, and when the user swipes back to the keyboard we read it and insert it via
// `textDocumentProxy.insertText`. Honest about iOS: no silent background paste, the user
// physically returns. Without Full Access we can't open the app, so we explain that state.
//
// Below the mic is a minimal-but-usable QWERTY so this is a real keyboard, not a stub:
// letters, shift, delete, space, return, and the globe (next-keyboard) key.
final class KeyboardViewController: UIInputViewController {

    private var hosting: UIHostingController<KeyboardRootView>?
    private let model = KeyboardModel()

    override func viewDidLoad() {
        super.viewDidLoad()
        SharedStore.recordKeyboardHeartbeat()   // lets the app detect the keyboard is installed

        model.controller = self
        let root = KeyboardRootView(model: model)
        let host = UIHostingController(rootView: root)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        host.view.backgroundColor = .clear
        addChild(host)
        view.addSubview(host.view)
        host.didMove(toParent: self)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        self.hosting = host
        refreshState()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        // Coming back from the app (the bounce flow): pick up and insert the transcript.
        insertPendingTranscriptIfAny()
        refreshState()
    }

    // MARK: - State shared with the SwiftUI surface

    func refreshState() {
        model.hasFullAccess = hasFullAccess
        model.needsGlobeKey = needsInputModeSwitchKey
    }

    private func insertPendingTranscriptIfAny() {
        if let text = SharedStore.consumePendingTranscript() {
            textDocumentProxy.insertText(text)
            model.lastInserted = text
        }
    }

    // MARK: - Key actions (driven from SwiftUI)

    func insert(_ s: String) { textDocumentProxy.insertText(s) }
    func deleteBackward() { textDocumentProxy.deleteBackward() }
    func insertSpace() { textDocumentProxy.insertText(" ") }
    func insertReturn() { textDocumentProxy.insertText("\n") }
    func advanceToNextKeyboard() { super.advanceToNextInputMode() }

    /// The mic key: open the app to dictate. Only possible with Full Access.
    func startDictation() {
        guard hasFullAccess else { model.showFullAccessHint = true; return }
        SharedStore.swipeBackExplainerShown = true
        openURL(SharedStore.dictateURL)
    }

    // MARK: - Helpers

    /// Opening a URL from a keyboard extension requires walking the responder chain to find
    /// an object that implements `openURL:` (UIApplication isn't directly available here).
    @discardableResult
    private func openURL(_ url: URL) -> Bool {
        var responder: UIResponder? = self
        let sel = sel_registerName("openURL:")
        while let r = responder {
            if r.responds(to: sel) {
                _ = r.perform(sel, with: url)
                return true
            }
            responder = r.next
        }
        return false
    }
}
