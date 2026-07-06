import SwiftUI
import WhisperioKit

// Categorization-prompt editor — the runtime-editable text of the two journaling prompts (classify
// a day's notes into categories, summarize the grouped day). Reached from Settings → Journaling.
// Mirrors PresetEditorView: multiline instruction fields, Save persists through DigestPromptStore,
// and "Restore defaults" brings back the shipped wording. The structural scaffolding the digest
// builder assembles (category list, note lines, group headers) is not editable here — only the
// prose — so an edit can never strip the data the model needs.
struct DigestPromptEditorView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var digestPrompts: DigestPromptStore
    var onBack: () -> Void
    var toast: (String) -> Void

    @State private var classificationIntro: String = ""
    @State private var classificationInstruction: String = ""
    @State private var summaryIntro: String = ""
    @State private var summaryInstruction: String = ""
    @State private var showRestoreConfirm = false

    private var canSave: Bool {
        !classificationIntro.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !classificationInstruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !summaryIntro.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !summaryInstruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: "Categorization prompts", onBack: onBack)
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 18) {
                        Text("How Whisperio's daily journal asks the AI to sort your notes into categories and summarize the day. Edit the wording to match your style — the category list and your notes are added automatically.")
                            .font(WZFont.ui(13)).foregroundStyle(t.muted).lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)

                        SectionLabel(text: "Classification").padding(.leading, 4)
                        promptField("Intro", $classificationIntro,
                                    hint: "Opens the classify prompt, before the category & note lists.",
                                    minHeight: 90)
                        promptField("Instruction", $classificationInstruction,
                                    hint: "Closes it — how the model should return the mapping.",
                                    minHeight: 150)

                        SectionLabel(text: "Daily summary").padding(.leading, 4)
                        promptField("Intro", $summaryIntro,
                                    hint: "Opens the summary prompt. Use {date} for the day.",
                                    minHeight: 90)
                        promptField("Instruction", $summaryInstruction,
                                    hint: "Closes it. Use {locale} for the interface language.",
                                    minHeight: 170)

                        GradButton(title: "Save prompts", icon: "check",
                                   action: canSave ? save : {})
                            .opacity(canSave ? 1 : 0.5)
                            .allowsHitTesting(canSave)

                        GhostButton(title: "Restore default prompts", icon: "sync") {
                            showRestoreConfirm = true
                        }
                    }
                    .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 28)
                }
            }
        }
        .onAppear(perform: load)
        .alert("Restore default prompts?", isPresented: $showRestoreConfirm) {
            Button("Restore", role: .destructive) {
                digestPrompts.restoreDefaults()
                load()
                toast("Prompts restored")
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This brings back Whisperio's built-in categorization prompts and undoes your edits.")
        }
    }

    private func promptField(_ label: String, _ text: Binding<String>,
                             hint: String, minHeight: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label).font(WZFont.ui(13, .semibold)).foregroundStyle(t.muted).padding(.leading, 4)
            TextEditor(text: text)
                .font(WZFont.mono(13))
                .scrollContentBackground(.hidden)
                .frame(minHeight: minHeight, maxHeight: 320)
                #if os(iOS)
                .textInputAutocapitalization(.sentences)
                #endif
                .padding(.horizontal, 9).padding(.vertical, 6)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
            Text(hint).font(WZFont.mono(11)).foregroundStyle(t.faint)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func load() {
        let c = digestPrompts.config
        classificationIntro = c.classificationIntro
        classificationInstruction = c.classificationInstruction
        summaryIntro = c.summaryIntro
        summaryInstruction = c.summaryInstruction
    }

    private func save() {
        digestPrompts.config = DigestPromptConfig(
            classificationIntro: classificationIntro.trimmingCharacters(in: .whitespacesAndNewlines),
            classificationInstruction: classificationInstruction.trimmingCharacters(in: .whitespacesAndNewlines),
            summaryIntro: summaryIntro.trimmingCharacters(in: .whitespacesAndNewlines),
            summaryInstruction: summaryInstruction.trimmingCharacters(in: .whitespacesAndNewlines))
        toast("Prompts saved")
        onBack()
    }
}
