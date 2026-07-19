import SwiftUI
import WhisperioKit
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

// Transcript detail — shows the real transcript with source/privacy badges, plus Copy, Share
// and Rewrite. Rewrite reformats the transcript with a cloud text-LLM (render presets): the
// result is shown in its own card below and persisted onto the recording. (No fake "raw vs
// cleaned" toggle — the engine returns one transcript.)
struct DetailView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var recordings: RecordingsStore
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var presets: PresetStore
    let r: DemoRecording
    var onBack: () -> Void
    var toast: (String) -> Void
    // Route to Settings when the cloud rewrite is missing an API key (consent alone isn't enough).
    var openSettings: () -> Void = {}
    // Route a Template Builder result into the preset editor (prefilled create-new flow).
    var openPresetEditor: (RewritePreset) -> Void = { _ in }
    // Mirrors PhoneDetail's `initialSheet` prop (mob-screens.jsx) — opens the Rewrite sheet
    // immediately on appear. No vendored JSX caller passes it true either; kept for structural
    // parity so a future real trigger (if one is ever added) has somewhere to plug in. AppShell's
    // single call site leaves this at its default, so today's behavior is unchanged.
    var initialShowRewriteSheet: Bool = false

    // The recording's category, resolved live from the store so a reassignment here shows up
    // on Home too. Seeded from the store on appear (falls back to the recording's own tag).
    @State private var categoryId: String = WZCategories.work.id
    private var category: WZCategory { WZCategories.of(categoryId) }

    // Rewrite state — the produced render (seeded from the recording on appear), an in-flight
    // flag for the inline processing card, and the two bottom sheets.
    @State private var render: String?
    @State private var renderPresetID: String?
    @State private var rewriting = false
    @State private var showRewriteSheet = false
    @State private var showConsent = false

    // Conversation state — rename-speaker alert target/text and the in-flight flag for
    // LLM name guessing.
    @State private var renameSpeaker: String?
    @State private var renameText = ""
    @State private var guessingNames = false

    // Retranscribe state — in-flight flag, plus the engine awaiting the "you'll lose the
    // speaker labels" confirmation when a conversation is re-run on a non-diarizing engine.
    @State private var retranscribing = false
    @State private var confirmPlainEngine: ProviderID?

    // The backing Recording, resolved live from the store so speaker renames (and any
    // cross-device sync) show up immediately. nil for sample rows.
    private var source: Recording? {
        guard let id = r.sourceId else { return nil }
        return recordings.items.first { $0.id == id }
    }
    private var segments: [SpeakerSegment] { source?.segments ?? [] }
    private var speakerNames: [String: String] { source?.speakerNames ?? [:] }
    private var isConversation: Bool { !segments.isEmpty }
    // The text Copy/Share act on: conversations use the speaker-labeled rendering.
    private var shareableTranscript: String {
        isConversation
            ? SpeakerSegmentBuilder.transcriptText(segments: segments, names: speakerNames)
            : r.title
    }

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: "Transcript", onBack: onBack) {
                    moreMenu
                }
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(spacing: 8) {
                            SourceBadge(src: r.src)
                            PrivacyBadge(mode: r.engine == "cloud" ? .cloud : .device, small: true)
                            Spacer(minLength: 0)
                            categoryMenu
                        }
                        Text("\(r.app) · \(r.when) · \(r.dur) · \(r.words) words")
                            .font(WZFont.mono(11)).foregroundStyle(t.faint)

                        if isConversation {
                            conversationCard
                        } else {
                            VStack(alignment: .leading, spacing: 0) {
                                SectionLabel(text: "Transcript").padding(.bottom, 12)
                                Text(source?.transcription ?? r.title)
                                    .font(WZFont.ui(17)).foregroundStyle(t.text).lineSpacing(4)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .textSelection(.enabled)
                            }
                            .padding(18)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
                        }

                        if retranscribing {
                            retranscribingCard
                        }
                        if rewriting {
                            processingCard
                        } else if let render {
                            renderCard(render)
                        }
                    }
                    .padding(.horizontal, 18).padding(.top, 8)
                    .animation(.easeInOut(duration: 0.2), value: rewriting)
                }

                // actions
                HStack(spacing: 9) {
                    GhostButton(title: "Copy", icon: "copy") { copy(shareableTranscript) }
                    shareButton(shareableTranscript)
                    GhostButton(title: "Rewrite", icon: "spark") { showRewriteSheet = true }
                }
                .padding(.horizontal, 18).padding(.top, 12).padding(.bottom, 32)
            }
            .onAppear {
                categoryId = recordings.categoryId(for: r)
                render = r.render
                renderPresetID = r.renderPresetID
                if initialShowRewriteSheet { showRewriteSheet = true }
            }
        }
        .sheet(isPresented: $showRewriteSheet) {
            RewriteSheet(presets: presets.presets,
                         onPick: pick,
                         onClose: { showRewriteSheet = false })
                .environment(\.wz, t)
                #if os(iOS)
                .presentationDetents([.medium, .large])
                #endif
        }
        .sheet(isPresented: $showConsent) {
            CloudConsentSheet(provider: .openAI,
                              onAccept: grantConsent,
                              onCancel: { showConsent = false })
                .environment(\.wz, t)
                #if os(iOS)
                .presentationDetents([.medium, .large])
                #endif
        }
        .alert("Name this speaker", isPresented: Binding(
            get: { renameSpeaker != nil },
            set: { if !$0 { renameSpeaker = nil } }
        )) {
            TextField("Name, nickname, role…", text: $renameText)
            Button("Save") { commitRename() }
            Button("Cancel", role: .cancel) { renameSpeaker = nil }
        } message: {
            Text("Shown instead of the generic label, everywhere this conversation appears.")
        }
        // The informed-consent moment for non-diarizing engines on a conversation: speaker
        // detection needs one of the diarizing cloud engines, so a plain engine drops the labels.
        .alert("Speakers need the cloud", isPresented: Binding(
            get: { confirmPlainEngine != nil },
            set: { if !$0 { confirmPlainEngine = nil } }
        )) {
            Button("Retranscribe anyway") {
                if let engine = confirmPlainEngine { retranscribe(engine) }
                confirmPlainEngine = nil
            }
            Button("Cancel", role: .cancel) { confirmPlainEngine = nil }
        } message: {
            Text("Speaker detection needs a diarizing cloud engine (ElevenLabs, Deepgram, or AssemblyAI) — retranscribing with \(confirmPlainEngine.map(engineName) ?? "another engine") produces plain text and removes the speaker labels.")
        }
    }

    // MARK: - Retranscribe

    // The saved clip on disk, if it still exists — retranscription needs the audio.
    private var audioURL: URL? {
        guard let source, !source.filename.isEmpty else { return nil }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(source.filename)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    private var moreMenu: some View {
        Menu {
            Section("Retranscribe audio") {
                if audioURL == nil {
                    Button {} label: {
                        Label("No audio saved", systemImage: "waveform.slash")
                    }
                    .disabled(true)
                } else {
                    engineOption(.onDevice, "Apple — on-device", "cpu")
                    engineOption(.openAI, "OpenAI — cloud", "globe")
                    engineOption(.groq, "Groq — cloud", "globe")
                    engineOption(.mistral, "Mistral — cloud", "globe")
                    engineOption(.elevenLabs,
                                 isConversation ? "ElevenLabs — keeps speakers" : "ElevenLabs — cloud",
                                 "globe")
                    engineOption(.deepgram,
                                 isConversation ? "Deepgram — keeps speakers" : "Deepgram — cloud",
                                 "globe")
                    engineOption(.assemblyAI,
                                 isConversation ? "AssemblyAI — keeps speakers" : "AssemblyAI — cloud",
                                 "globe")
                }
            }
            Button(role: .destructive) {
                if let source { recordings.delete(source) }
                onBack()
            } label: {
                Label("Delete note", systemImage: WZIcon.symbol("trash"))
            }
        } label: {
            WIcon("more", size: 19, weight: .regular)
                .foregroundStyle(t.muted)
                .frame(width: 38, height: 38)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
        }
        .disabled(retranscribing)
    }

    private func engineOption(_ id: ProviderID, _ title: String, _ icon: String) -> some View {
        Button { chooseEngine(id) } label: {
            Label(settings.isEngineReady(id) ? title : "\(title) · set up in Settings",
                  systemImage: WZIcon.symbol(icon))
        }
    }

    private func chooseEngine(_ id: ProviderID) {
        guard settings.isEngineReady(id) else {
            toast(settings.settings.cloudConsentGranted
                  ? "Add the API key in Settings → Models first"
                  : "Cloud engines need consent — Settings → Models")
            openSettings()
            return
        }
        if isConversation && !settings.isDiarizingEngine(id) {
            confirmPlainEngine = id   // inform before dropping the speaker labels
        } else {
            retranscribe(id)
        }
    }

    private func retranscribe(_ id: ProviderID) {
        guard let source, let url = audioURL, !retranscribing else { return }
        retranscribing = true
        Task {
            guard let data = try? Data(contentsOf: url) else {
                retranscribing = false
                toast("Couldn’t read the saved audio")
                return
            }
            let clip = AudioClip(data: data, filename: source.filename, duration: source.duration)
            if settings.isDiarizingEngine(id), isConversation {
                // Conversations re-run through the exact engine the user picked so speakers
                // survive — never substitute a different diarizing engine.
                guard let transcriber = settings.makeDiarizingProvider(id) else {
                    retranscribing = false
                    openSettings()
                    return
                }
                do {
                    let result = try await transcriber.transcribeDiarized(clip)
                    applyRetranscription(settings.cleanup(result.text), id,
                                         result.segments.isEmpty ? nil : result.segments)
                } catch {
                    retranscribing = false
                    toast("Retranscription failed")
                }
            } else {
                guard let chain = settings.makeSingleEngineChain(id) else {
                    retranscribing = false
                    openSettings()
                    return
                }
                switch await chain.transcribe(clip) {
                case .success(let tr):
                    applyRetranscription(settings.cleanup(tr.text), tr.provider, nil)
                case .failure:
                    retranscribing = false
                    toast("Retranscription failed")
                }
            }
        }
    }

    private func applyRetranscription(_ text: String, _ provider: ProviderID,
                                      _ newSegments: [SpeakerSegment]?) {
        recordings.setTranscription(text, provider: provider, segments: newSegments, for: r)
        retranscribing = false
        toast("Retranscribed · \(engineName(provider))")
    }

    private func engineName(_ id: ProviderID) -> String {
        switch id {
        case .onDevice: return "Apple on-device"
        case .openAI: return "OpenAI"
        case .elevenLabs: return "ElevenLabs"
        case .groq: return "Groq"
        case .deepgram: return "Deepgram"
        case .assemblyAI: return "AssemblyAI"
        case .mistral: return "Mistral"
        }
    }

    private var retranscribingCard: some View {
        HStack(spacing: 11) {
            ProgressView().tint(t.accent)
            Text("Retranscribing…").font(WZFont.mono(13)).foregroundStyle(t.accentLite)
            Spacer(minLength: 0)
        }
        .padding(18)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    // MARK: - Rewrite flow

    // A preset was chosen from the sheet. Gate on the rewriter being configured (cloud consent +
    // key): missing consent presents the consent sheet, a missing key routes to Settings — never
    // a silent failure. The meta "Template Builder" preset authors a new template instead of
    // rendering the transcript.
    private func pick(_ preset: RewritePreset) {
        showRewriteSheet = false
        let rewriter = settings.makeRewriter()
        guard rewriter.isConfigured else {
            // Defer so the picker sheet finishes dismissing before we present the next one.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                if !settings.settings.cloudConsentGranted {
                    showConsent = true
                } else {
                    openSettings()   // consented, but no OpenAI key yet
                }
            }
            return
        }
        if preset.isMeta { runTemplateBuilder(preset, rewriter) }
        else { runRewrite(preset, rewriter) }
    }

    private func runRewrite(_ preset: RewritePreset, _ rewriter: Rewriter) {
        rewriting = true
        Task {
            do {
                let out = try await rewriter.run(preset: preset, transcript: shareableTranscript)
                render = out
                renderPresetID = preset.id
                recordings.setRender(out, presetID: preset.id, for: r)
                rewriting = false
            } catch {
                rewriting = false
                toast("Rewrite failed")
            }
        }
    }

    private func runTemplateBuilder(_ preset: RewritePreset, _ rewriter: Rewriter) {
        rewriting = true
        Task {
            do {
                let out = try await rewriter.run(preset: preset, transcript: r.title)
                rewriting = false
                let draft = RewritePreset(id: UUID().uuidString, name: "New template",
                                          prompt: out, icon: "spark")
                openPresetEditor(draft)
            } catch {
                rewriting = false
                toast("Couldn’t build template")
            }
        }
    }

    // Accepting cloud consent from the rewrite flow: persist the grant, then route to Settings if
    // the OpenAI key still isn't set (otherwise the user has everything they need to tap Rewrite).
    private func grantConsent() {
        var s = settings.settings
        s.cloudConsentGranted = true
        settings.settings = s
        showConsent = false
        if settings.settings.openAIKey.trimmingCharacters(in: .whitespaces).isEmpty {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { openSettings() }
        } else {
            toast("Cloud rewrite enabled")
        }
    }

    // MARK: - Conversation (diarized transcript)

    // Speaker-labeled transcript: one row per segment, the speaker chip is tappable to
    // rename. "Name with AI" reads the conversation for introductions/addressing and fills
    // names in — manual names always win over guesses.
    private var conversationCard: some View {
        let order = SpeakerSegmentBuilder.speakerOrder(segments)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                SectionLabel(text: "Conversation")
                Spacer(minLength: 0)
                if guessingNames {
                    ProgressView().tint(t.accent).scaleEffect(0.8)
                } else {
                    Button(action: guessNames) {
                        HStack(spacing: 5) {
                            WIcon("spark", size: 11)
                            Text("Name with AI")
                        }
                        .font(WZFont.mono(10, .semibold))
                        .foregroundStyle(t.accentLite)
                        .padding(.horizontal, 9).padding(.vertical, 4)
                        .background(t.accent.opacity(0.14), in: Capsule())
                        .overlay(Capsule().stroke(t.accent.opacity(0.28), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.bottom, 14)

            VStack(alignment: .leading, spacing: 14) {
                ForEach(Array(segments.enumerated()), id: \.offset) { _, seg in
                    let color = speakerColor(order.firstIndex(of: seg.speaker) ?? 0)
                    VStack(alignment: .leading, spacing: 5) {
                        Button {
                            renameText = speakerNames[seg.speaker] ?? ""
                            renameSpeaker = seg.speaker
                        } label: {
                            HStack(spacing: 5) {
                                Circle().fill(color).frame(width: 7, height: 7)
                                Text(SpeakerSegmentBuilder.displayName(
                                    for: seg.speaker, names: speakerNames, order: order))
                                WIcon("pencil", size: 8.5)
                            }
                            .font(WZFont.mono(11, .semibold))
                            .foregroundStyle(color)
                        }
                        .buttonStyle(.plain)
                        Text(seg.text)
                            .font(WZFont.ui(16)).foregroundStyle(t.text).lineSpacing(4)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    // Stable per-speaker accent: the theme accent for the first voice, then distinct hues
    // matching the design (amber, violet, pink, mint, yellow).
    private func speakerColor(_ index: Int) -> Color {
        let palette: [Color] = [t.accent, .hex(0xf59e0b), .hex(0xa78bfa),
                                .hex(0xf472b6), .hex(0x34d399), .hex(0xfbbf24)]
        return palette[index % palette.count]
    }

    private func commitRename() {
        guard let speaker = renameSpeaker else { return }
        var names = speakerNames
        let name = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { names.removeValue(forKey: speaker) } else { names[speaker] = name }
        recordings.setSpeakerNames(names, for: r)
        renameSpeaker = nil
    }

    // Ask the chat LLM to infer names from the conversation itself (introductions, being
    // addressed by name). Same gating as Rewrite: consent sheet first, then Settings for
    // the missing key. Guesses never overwrite names the user typed.
    private func guessNames() {
        let client = settings.makeChatClient()
        guard client.isConfigured else {
            if !settings.settings.cloudConsentGranted { showConsent = true } else { openSettings() }
            return
        }
        guessingNames = true
        let prompt = SpeakerNameGuess.prompt(segments: segments)
        let known = SpeakerSegmentBuilder.speakerOrder(segments)
        Task {
            defer { guessingNames = false }
            do {
                let raw = try await client.complete(
                    messages: [ChatMessage(role: "user", content: prompt)],
                    model: settings.settings.chatModel, temperature: 0)
                let guessed = SpeakerNameGuess.parse(raw, knownSpeakers: known)
                let merged = guessed.merging(speakerNames) { _, manual in manual }
                if merged == speakerNames {
                    toast("No names revealed in the conversation")
                } else {
                    recordings.setSpeakerNames(merged, for: r)
                    toast("Named \(merged.count) speaker\(merged.count == 1 ? "" : "s")")
                }
            } catch {
                toast("Couldn’t name speakers")
            }
        }
    }

    // MARK: - Cards

    private var processingCard: some View {
        HStack(spacing: 11) {
            ProgressView().tint(t.accent)
            Text("Rewriting…").font(WZFont.ui(14)).foregroundStyle(t.muted)
            Spacer(minLength: 0)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    private func renderCard(_ text: String) -> some View {
        let name = presets.presets.first { $0.id == renderPresetID }?.name
            ?? (renderPresetID == "custom" ? "Custom" : "Rewrite")
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                SectionLabel(text: name)
                Spacer(minLength: 0)
                PrivacyBadge(mode: .cloud, small: true)
            }
            Text(text)
                .font(WZFont.ui(16)).foregroundStyle(t.text).lineSpacing(5)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            HStack(spacing: 9) {
                GhostButton(title: "Copy", icon: "copy") { copy(text) }
                shareButton(text)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    // MARK: - Shared actions

    private func copy(_ text: String) {
#if canImport(UIKit)
        UIPasteboard.general.string = text
        UINotificationFeedbackGenerator().notificationOccurred(.success)
#elseif canImport(AppKit)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
#endif
        toast("Copied!")
    }

    private func shareButton(_ text: String) -> some View {
        ShareLink(item: text) {
            HStack(spacing: 8) {
                WIcon("share", size: 16)
                Text("Share")
            }
            .font(WZFont.ui(14, .semibold)).foregroundStyle(t.text)
            .frame(maxWidth: .infinity).padding(.vertical, 12).padding(.horizontal, 18)
            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(t.line, lineWidth: 1))
        }
    }

    // Reassign the recording's category. Selecting a category writes it back to the store so
    // the Home list + filter row reflect the change immediately.
    private var categoryMenu: some View {
        Menu {
            ForEach(WZCategories.all) { cat in
                Button {
                    categoryId = cat.id
                    recordings.setCategory(cat.id, for: r)
#if canImport(UIKit)
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
#endif
                } label: {
                    Label(cat.label, systemImage: WZIcon.symbol(cat.icon))
                    if cat.id == categoryId { Image(systemName: "checkmark") }
                }
            }
        } label: {
            let c = category.hue(t)
            HStack(spacing: 5) {
                WIcon(category.icon, size: 10.5)
                Text(category.label)
                WIcon("chevD", size: 9)
            }
            .font(WZFont.mono(10, .semibold))
            .foregroundStyle(c)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(c.opacity(t.dark ? 0.14 : 0.10), in: Capsule())
            .overlay(Capsule().stroke(c.opacity(t.dark ? 0.28 : 0.24), lineWidth: 1))
        }
    }
}

// MARK: - Rewrite preset picker
// Bottom sheet: pick a saved preset OR write a one-off instruction. Styled like CloudConsentSheet.
// Presets are passed in (not read from the environment) so the sheet renders regardless of
// environmentObject propagation. The custom instruction runs as a transient (unsaved) preset — to
// keep it, the user saves a template in Settings instead.
private struct RewriteSheet: View {
    @Environment(\.wz) private var t
    let presets: [RewritePreset]
    var onPick: (RewritePreset) -> Void
    var onClose: () -> Void

    // A one-off instruction the user types here; runs without being saved as a preset.
    @State private var customPrompt: String = ""

    private var canRunCustom: Bool {
        !customPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Rewrite with…").font(WZFont.display(20)).foregroundStyle(t.text)
                Spacer()
                Button(action: onClose) {
                    WIcon("x", size: 16).foregroundStyle(t.muted)
                        .frame(width: 34, height: 34)
                        .background(t.surfaceUp, in: Circle())
                }
                .buttonStyle(.plain)
            }
            .padding(.bottom, 6)

            Text("Reformat this transcript with AI. Your text is sent to the cloud model.")
                .font(WZFont.ui(13)).foregroundStyle(t.muted).lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 16)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(spacing: 0) {
                        ForEach(Array(presets.enumerated()), id: \.element.id) { idx, p in
                            SettRow(icon: p.icon, label: p.name,
                                    sub: p.isMeta ? "Build a new template from your voice" : nil,
                                    last: idx == presets.count - 1,
                                    onTap: { onPick(p) })
                        }
                    }
                    .padding(.horizontal, 16)
                    .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))

                    customSection
                }
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(t.bg.ignoresSafeArea())
    }

    // A free-text instruction field + run button, for a rewrite you don't want to save as a preset.
    private var customSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "Or write your own").padding(.leading, 4)
            TextEditor(text: $customPrompt)
                .font(WZFont.mono(13))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 96, maxHeight: 200)
                #if os(iOS)
                .textInputAutocapitalization(.sentences)
                #endif
                .padding(.horizontal, 9).padding(.vertical, 6)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
                .overlay(alignment: .topLeading) {
                    if customPrompt.isEmpty {
                        Text("Rewrite this as formal meeting minutes…")
                            .font(WZFont.mono(13)).foregroundStyle(t.faint)
                            .padding(.horizontal, 14).padding(.vertical, 14)
                            .allowsHitTesting(false)
                    }
                }
            Text("A one-off instruction. It isn’t saved — add a template in Settings to keep it.")
                .font(WZFont.mono(11)).foregroundStyle(t.faint)
                .fixedSize(horizontal: false, vertical: true)
            GradButton(title: "Rewrite with this", icon: "spark",
                       action: canRunCustom ? runCustom : {})
                .opacity(canRunCustom ? 1 : 0.5)
                .allowsHitTesting(canRunCustom)
        }
    }

    private func runCustom() {
        let prompt = customPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else { return }
        // Transient preset — stable "custom" id (not persisted), never a seed, never meta, so it
        // flows through the normal rewrite path.
        onPick(RewritePreset(id: "custom", name: "Custom", prompt: prompt, icon: "spark"))
    }
}
