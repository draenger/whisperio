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

        // Custom keyboards have NO intrinsic height — without an explicit constraint the
        // input view collapses (often to ~0pt) and the keyboard renders invisible/blank
        // even though it's enabled in Settings. Pin a concrete height; priority 999 so it
        // yields gracefully to the system's own input-view constraints instead of conflicting.
        let heightConstraint = view.heightAnchor.constraint(equalToConstant: 300)
        heightConstraint.priority = UILayoutPriority(999)
        heightConstraint.isActive = true

        self.hosting = host
        refreshState()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        // Coming back from the app (the bounce flow): pick up and insert the transcript.
        applyPendingRewriteIfAny()
        insertPendingTranscriptIfAny()
        refreshState()
        updateSuggestions()
    }

    // Recompute predictions whenever the document text changes.
    override func textDidChange(_ textInput: UITextInput?) {
        super.textDidChange(textInput)
        updateSuggestions()
    }

    // MARK: - State shared with the SwiftUI surface

    func refreshState() {
        model.hasFullAccess = hasFullAccess
        model.needsGlobeKey = needsInputModeSwitchKey
        model.lastInserted = SharedStore.lastInsertedTranscript
    }

    private func insertPendingTranscriptIfAny() {
        if let text = SharedStore.consumePendingTranscript() {
            textDocumentProxy.insertText(text)
            model.lastInserted = text
            SharedStore.setLastInsertedTranscript(text)
        }
    }

    private func applyPendingRewriteIfAny() {
        guard let text = SharedStore.consumeRewriteResult() else { return }
        if let last = SharedStore.lastInsertedTranscript ?? model.lastInserted, !last.isEmpty {
            for _ in 0..<last.count { textDocumentProxy.deleteBackward() }
        }
        textDocumentProxy.insertText(text)
        model.lastInserted = text
        SharedStore.setLastInsertedTranscript(text)
    }

    // MARK: - Key actions (driven from SwiftUI)

    func insert(_ s: String) { textDocumentProxy.insertText(s) }
    func deleteBackward() { textDocumentProxy.deleteBackward() }
    func insertSpace() { textDocumentProxy.insertText(" ") }
    func insertReturn() { textDocumentProxy.insertText("\n") }
    func advanceToNextKeyboard() { super.advanceToNextInputMode() }

    // MARK: - Predictive suggestions (offline, via UITextChecker)

    private let checker = UITextChecker()

    /// The partial word currently being typed (trailing run of letters before the caret).
    private func currentPartialWord() -> String {
        let ctx = textDocumentProxy.documentContextBeforeInput ?? ""
        let trailing = ctx.reversed().prefix { $0.isLetter }
        return String(trailing.reversed())
    }

    func updateSuggestions() {
        let word = currentPartialWord()
        guard word.count >= 1 else { model.suggestions = []; return }
        let lang = textDocumentProxy.documentInputMode?.primaryLanguage ?? "en_US"
        let nsword = word as NSString
        let range = NSRange(location: 0, length: nsword.length)
        // Completions extend the partial word; guesses fix likely misspellings.
        var out = checker.completions(forPartialWordRange: range, in: word, language: lang) ?? []
        if out.isEmpty {
            out = checker.guesses(forWordRange: range, in: word, language: lang) ?? []
        }
        model.suggestions = Array(out.prefix(3))
    }

    /// Replace the current partial word with the chosen suggestion + a trailing space.
    func applySuggestion(_ word: String) {
        let partial = currentPartialWord()
        for _ in 0..<partial.count { textDocumentProxy.deleteBackward() }
        textDocumentProxy.insertText(word + " ")
        model.shifted = false
        updateSuggestions()
    }

    /// The mic key: open the app to dictate. Only possible with Full Access.
    func startDictation() {
        guard hasFullAccess else {
            // No Full Access → we physically can't open the app. Surface why.
            model.showFullAccessHint = true
            return
        }
        SharedStore.swipeBackExplainerShown = true
        if !openURL(SharedStore.dictateURL) {
            // Opening failed despite Full Access — tell the user instead of failing silently.
            model.showFullAccessHint = true
        }
    }

    /// Rewrite the latest inserted transcript with one of our shipped prompts.
    func startRewrite(presetID: String) {
        guard hasFullAccess else {
            model.showFullAccessHint = true
            return
        }
        guard let source = SharedStore.lastInsertedTranscript ?? model.lastInserted,
              !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            model.showFullAccessHint = true
            return
        }
        SharedStore.setRewriteSource(source)
        SharedStore.setRewritePresetID(presetID)
        if !openURL(SharedStore.rewriteURL) {
            model.showFullAccessHint = true
        }
    }

    // MARK: - Helpers

    /// Open a URL from the keyboard extension. The only way is to walk the responder chain
    /// to the host `UIApplication` and call the modern `open(_:options:completionHandler:)`.
    /// (The old single-arg `openURL:` selector was removed from UIKit, so `responds(to:)`
    /// against it now fails and nothing happens — that was the "button does nothing" bug.)
    @discardableResult
    private func openURL(_ url: URL) -> Bool {
        var responder: UIResponder? = self
        while let r = responder {
            if let app = r as? UIApplication {
                app.open(url, options: [:], completionHandler: nil)
                return true
            }
            responder = r.next
        }
        // Fallback for OS versions where UIApplication isn't reachable in the chain:
        // try the legacy selector as a last resort.
        let sel = sel_registerName("openURL:")
        responder = self
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
