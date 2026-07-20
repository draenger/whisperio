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
    // R11: the Save button flips to a "Saved ✓" confirmed state briefly before the screen
    // dismisses, instead of navigating back immediately.
    @State private var saved = false

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

                        GradButton(title: saved ? "Saved ✓" : "Save template",
                                   icon: saved ? nil : "check",
                                   action: (canSave && !saved) ? save : {})
                            .opacity(canSave ? 1 : 0.5)
                            .allowsHitTesting(canSave && !saved)

                        if isExisting {
                            GhostButton(title: "Delete template", icon: "trash") {
                                showDeleteConfirm = true
                            }
                        }
                    }
                    .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 28)
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
                .font(WZFont.ui(13))
                .padding(.horizontal, 13).padding(.vertical, 12)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
        }
    }

    private var promptField: some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionLabel(text: "Instruction").padding(.leading, 4)
            // Multiline editor styled like plainField (hidden default background, mono face).
            // R11: TextEditor has no native placeholder — overlay ghost copy when empty.
            TextEditor(text: $prompt)
                .font(WZFont.mono(13))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 180, maxHeight: 320)
                .padding(.horizontal, 13).padding(.vertical, 11)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
                .overlay(alignment: .topLeading) {
                    if prompt.isEmpty {
                        Text("How Whisperio should rewrite a transcript…")
                            .font(WZFont.mono(13)).foregroundStyle(t.faint)
                            .padding(.horizontal, 13 + 5).padding(.vertical, 11 + 8)
                            .allowsHitTesting(false)
                    }
                }
            Text("How Whisperio should rewrite a transcript. Written as an instruction to the model.")
                .font(WZFont.mono(11)).foregroundStyle(t.faint)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // Persist name + prompt, preserving the id / isSeed / icon / isMeta so a seed stays an
    // override and a user preset stays itself. R11: the button shows a "Saved ✓" confirmed
    // state for ~700ms (matching the design's setTimeout) before navigating back; the toast
    // still fires immediately.
    private func save() {
        var p = original
        p.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        p.prompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        presets.upsert(p)
        toast("Template saved")
        saved = true
        Task {
            try? await Task.sleep(for: .milliseconds(700))
            onBack()
        }
    }
}
