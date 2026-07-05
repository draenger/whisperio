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

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: "Transcript", onBack: onBack) {
                    SquareIconButton(icon: "more")
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

                        VStack(alignment: .leading, spacing: 0) {
                            SectionLabel(text: "Transcript").padding(.bottom, 12)
                            Text(r.title)
                                .font(WZFont.ui(17)).foregroundStyle(t.text).lineSpacing(4)
                                .fixedSize(horizontal: false, vertical: true)
                                .textSelection(.enabled)
                        }
                        .padding(18)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))

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
                    GhostButton(title: "Copy", icon: "copy") { copy(r.title) }
                    shareButton(r.title)
                    GhostButton(title: "Rewrite", icon: "spark") { showRewriteSheet = true }
                }
                .padding(.horizontal, 18).padding(.top, 12).padding(.bottom, 32)
            }
            .onAppear {
                categoryId = recordings.categoryId(for: r)
                render = r.render
                renderPresetID = r.renderPresetID
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
                let out = try await rewriter.run(preset: preset, transcript: r.title)
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

    // MARK: - Cards

    private var processingCard: some View {
        HStack(spacing: 11) {
            ProgressView().tint(t.accent)
            Text("Rewriting…").font(WZFont.ui(14, .medium)).foregroundStyle(t.muted)
            Spacer(minLength: 0)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    private func renderCard(_ text: String) -> some View {
        let name = presets.presets.first { $0.id == renderPresetID }?.name ?? "Rewrite"
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                SectionLabel(text: name)
                Spacer(minLength: 0)
                PrivacyBadge(mode: .cloud, small: true)
            }
            Text(text)
                .font(WZFont.ui(16)).foregroundStyle(t.text).lineSpacing(4)
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
// Bottom sheet listing the rewrite presets, styled like CloudConsentSheet. Presets are passed in
// (not read from the environment) so the sheet renders regardless of environmentObject propagation.
private struct RewriteSheet: View {
    @Environment(\.wz) private var t
    let presets: [RewritePreset]
    var onPick: (RewritePreset) -> Void
    var onClose: () -> Void

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
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(t.bg.ignoresSafeArea())
    }
}
