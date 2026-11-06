import UIKit
import SwiftUI
import WhisperioKit

// Whisperio custom keyboard.
//
// The mic signals an explicitly started, app-owned session through the App Group.
// Without a live session it uses the existing open-app dictation flow. The keyboard
// never owns microphone access and only inserts text while it is visible.
//
// Below the mic is a minimal-but-usable QWERTY so this is a real keyboard, not a stub:
// letters, shift, delete, space, return, and the globe (next-keyboard) key.
final class KeyboardViewController: UIInputViewController {

    private var hosting: UIHostingController<KeyboardRootView>?
    private let model = KeyboardModel()
    private let keyboardID = UUID()
    private var sessionObserver: KeyboardSessionObserver?
    private var sessionTimer: Timer?
    private var requestID: UUID?
    private var requestContext: String?
    private var contextRevision = 0
    private var requestRevision: Int?
    private var pendingSessionResult: KeyboardSessionResult?
    private var commandPending = false
    private var visible = false

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
        sessionObserver = KeyboardSessionObserver(names: [KeyboardSessionStore.stateNotification,
            KeyboardSessionStore.resultNotification]) { [weak self] in
            Task { @MainActor in self?.refreshSession() }
        }
        refreshState()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        visible = true
        sessionTimer?.invalidate()
        sessionTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            self?.refreshSession()
        }
        // Coming back from the app (the bounce flow): pick up and insert the transcript.
        applyPendingRewriteIfAny()
        insertPendingTranscriptIfAny()
        refreshState()
        refreshSession()
        updateSuggestions()
    }

    override func viewWillDisappear(_ animated: Bool) {
        visible = false
        contextRevision += 1
        sessionTimer?.invalidate()
        sessionTimer = nil
        super.viewWillDisappear(animated)
    }

    // Recompute predictions whenever the document text changes.
    override func textDidChange(_ textInput: UITextInput?) {
        super.textDidChange(textInput)
        contextRevision += 1
        updateSuggestions()
    }

    // MARK: - State shared with the SwiftUI surface

    func refreshState() {
        model.hasFullAccess = hasFullAccess
        model.needsGlobeKey = needsInputModeSwitchKey
        model.lastInserted = SharedStore.lastInsertedTranscript
    }

    private func refreshSession() {
        guard visible else { return }
        let snapshot = KeyboardSessionStore.snapshot()
        if let requestID, let result = KeyboardSessionStore.result(for: requestID),
           pendingSessionResult == nil {
            pendingSessionResult = result
            if requestContext != nil && requestRevision == contextRevision &&
                requestContext == textDocumentProxy.documentContextBeforeInput {
                insertSessionResult()
            } else {
                model.pendingSessionText = result.text
            }
        }
        guard let snapshot, snapshot.isLive(at: Date()) else {
            model.sessionStatus = "Start session in Whisperio"
            commandPending = false
            return
        }
        switch snapshot.phase {
        case .sessionActive: model.sessionStatus = "Ready"
        case .recording: model.sessionStatus = "Recording — tap mic to stop"
        case .transcribing: model.sessionStatus = "Transcribing"
        case .done: model.sessionStatus = "Result ready"
        case .error: model.sessionStatus = "Dictation failed — tap mic to retry"
        case .idle: model.sessionStatus = "Start session in Whisperio"
        }
        if snapshot.phase == .recording || snapshot.phase == .transcribing || snapshot.phase == .done || snapshot.phase == .error {
            commandPending = false
        }
    }

    func insertSessionResult() {
        guard let result = pendingSessionResult else { return }
        // No automatic replay after an extension restart or a changed input context.
        pendingSessionResult = nil
        model.pendingSessionText = nil
        textDocumentProxy.insertText(result.text)
        model.lastInserted = result.text
        SharedStore.setLastInsertedTranscript(result.text)
        requestID = nil
        requestContext = nil
        requestRevision = nil
        if let snapshot = KeyboardSessionStore.snapshot(), snapshot.isLive(at: Date()) {
            _ = KeyboardSessionStore.send(KeyboardSessionCommand(sessionID: snapshot.sessionID,
                requestID: result.requestID, keyboardID: keyboardID, action: .ackResult))
        }
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
        if let snapshot = KeyboardSessionStore.snapshot(), snapshot.isLive(at: Date()) {
            guard !commandPending else { return }
            let action: KeyboardSessionAction
            let id: UUID
            switch snapshot.phase {
            case .sessionActive, .error:
                action = .startRecording
                id = UUID()
                requestID = id
                requestContext = textDocumentProxy.documentContextBeforeInput
                requestRevision = contextRevision
                pendingSessionResult = nil
                model.pendingSessionText = nil
            case .recording:
                action = .stopRecording
                id = snapshot.requestID ?? requestID ?? UUID()
            default: return
            }
            commandPending = KeyboardSessionStore.send(KeyboardSessionCommand(sessionID: snapshot.sessionID,
                requestID: id, keyboardID: keyboardID, action: action))
            if !commandPending { model.sessionStatus = "Session unavailable — open Whisperio" }
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

    /// Existing open-app fallback, using UIKit's public URL API.
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
        return false
    }
}
