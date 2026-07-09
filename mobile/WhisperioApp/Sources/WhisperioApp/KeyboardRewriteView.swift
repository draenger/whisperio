import SwiftUI
import WhisperioKit

// Keyboard rewrite hand-off screen.
// The keyboard chooses a shipped rewrite prompt, the app runs it on the pending text,
// and the result is pushed back to the keyboard for replacement when the user returns.
struct KeyboardRewriteView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var presets: PresetStore
    let source: String
    let presetID: String
    var onBack: () -> Void
    var onDone: (String) -> Void

    @State private var running = false
    @State private var errorMessage: String?
    @State private var showConsent = false
    @State private var queuedPreset: RewritePreset?

    private var selectedPreset: RewritePreset {
        presets.presets.first { $0.id == presetID }
        ?? presets.presets.first { $0.id == "clean-up" }
        ?? RewritePresetCatalog.seeds.first { !$0.isMeta }
        ?? RewritePresetCatalog.seeds[0]
    }

    private var rewriter: Rewriter { settings.makeRewriter() }

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: "Rewrite", onBack: onBack)
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 16) {
                        VStack(alignment: .leading, spacing: 8) {
                            SectionLabel(text: "Source").padding(.leading, 4)
                            Text(source.isEmpty ? "No text to rewrite." : source)
                                .font(WZFont.ui(16)).foregroundStyle(t.text).lineSpacing(4)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(16)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            SectionLabel(text: "Prompt").padding(.leading, 4)
                            HStack(spacing: 10) {
                                WIcon(selectedPreset.icon, size: 16).foregroundStyle(t.accentLite)
                                    .frame(width: 34, height: 34)
                                    .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(selectedPreset.name).font(WZFont.ui(15, .semibold)).foregroundStyle(t.text)
                                    Text(selectedPreset.isMeta ? "Template builder" : "Shipped prompt")
                                        .font(WZFont.ui(12)).foregroundStyle(t.muted)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(14)
                            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
                        }

                        if running {
                            processing
                        } else if let errorMessage {
                            StateBanner(tone: .warn, icon: "x", title: "Rewrite failed", sub: errorMessage)
                        } else {
                            GradButton(title: "Start rewrite", icon: "spark", action: run)
                        }
                    }
                    .padding(.horizontal, 18).padding(.top, 8).padding(.bottom, 28)
                }
            }
        }
        .sheet(isPresented: $showConsent) {
            CloudConsentSheet(provider: .openAI,
                              onAccept: {
                                  showConsent = false
                                  if let queuedPreset { run(queuedPreset) }
                              },
                              onCancel: { showConsent = false })
                .environment(\.wz, t)
                #if os(iOS)
                .presentationDetents([.medium, .large])
                #endif
        }
        .onAppear {
            if source.isEmpty { errorMessage = "No source text was passed from the keyboard." }
            else if !running { run() }
        }
    }

    private var processing: some View {
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

    private func run() {
        run(selectedPreset)
    }

    private func run(_ preset: RewritePreset) {
        guard !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        if rewriter.isConfigured {
            running = true
            errorMessage = nil
            Task {
                do {
                    let out = try await rewriter.run(preset: preset, transcript: source)
                    SharedStore.setRewriteResult(out)
                    running = false
                    onDone(out)
                } catch {
                    running = false
                    errorMessage = error.localizedDescription
                }
            }
        } else if !settings.settings.cloudConsentGranted {
            queuedPreset = preset
            showConsent = true
        } else {
            errorMessage = "Add your OpenAI key in Settings to use rewrite."
        }
    }
}
