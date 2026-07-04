import SwiftUI
import WhisperioKit

// Rewrite-preset editor — name + prompt for a render template. Reached from Settings ("New
// template" / tapping a preset) and from the Detail Template Builder flow (prefilled create-new).
// Seeds are editable (saving stores an override that keeps the id) and deletable (tombstoned).
struct PresetEditorView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var presets: PresetStore
    let original: RewritePreset
    var onBack: () -> Void
    var toast: (String) -> Void

    @State private var name: String
    @State private var prompt: String
    @State private var showDeleteConfirm = false

    init(preset: RewritePreset, onBack: @escaping () -> Void, toast: @escaping (String) -> Void) {
        self.original = preset
        self.onBack = onBack
        self.toast = toast
        _name = State(initialValue: preset.name)
        _prompt = State(initialValue: preset.prompt)
    }

    // Whether this preset already exists in the store (vs a brand-new draft). Drives the title
    // and whether Delete is offered.
    private var isExisting: Bool { presets.presets.contains { $0.id == original.id } }

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: isExisting ? "Edit template" : "New template", onBack: onBack)
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 18) {
                        nameField
                        promptField

                        GradButton(title: "Save template", icon: "check",
                                   action: canSave ? save : {})
                            .opacity(canSave ? 1 : 0.5)
                            .allowsHitTesting(canSave)

                        if isExisting {
                            GhostButton(title: "Delete template", icon: "trash") {
                                showDeleteConfirm = true
                            }
                        }
                    }
                    .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 28)
                }
            }
        }
        .alert("Delete this template?", isPresented: $showDeleteConfirm) {
            Button("Delete", role: .destructive) {
                presets.delete(id: original.id)
                toast("Template deleted")
                onBack()
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text(original.isSeed
                 ? "This hides the built-in template. You can bring it back with “Restore default templates”."
                 : "This removes your template. This can’t be undone.")
        }
    }

    private var nameField: some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionLabel(text: "Name").padding(.leading, 4)
            TextField("e.g. Meeting notes", text: $name)
                .font(WZFont.ui(14.5))
                .padding(.horizontal, 13).padding(.vertical, 12)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
        }
    }

    private var promptField: some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionLabel(text: "Instruction").padding(.leading, 4)
            // Multiline editor styled like plainField (hidden default background, mono face).
            TextEditor(text: $prompt)
                .font(WZFont.mono(13))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 180, maxHeight: 320)
                .padding(.horizontal, 9).padding(.vertical, 6)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
            Text("How Whisperio should rewrite a transcript. Written as an instruction to the model.")
                .font(WZFont.mono(11)).foregroundStyle(t.faint)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // Persist name + prompt, preserving the id / isSeed / icon / isMeta so a seed stays an
    // override and a user preset stays itself.
    private func save() {
        var p = original
        p.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        p.prompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        presets.upsert(p)
        toast("Template saved")
        onBack()
    }
}
