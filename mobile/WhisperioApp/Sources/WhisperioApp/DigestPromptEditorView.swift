import SwiftUI
import WhisperioKit

// Categorization prompts — design's `categorize` page (mob-settings.jsx:570-592). Structure:
// (1) an untitled "Auto-categorize" toggle; (2) while on, a single "Categorization prompt"
// textarea the user edits directly (live-bound, no Save button — mirrors the toggle's own
// immediacy) with an inline "Reset" link once it diverges from the shipped default, and a
// "Categories" group listing the 5 seed categories (fixed) plus any user-created ones
// (add via "New category", delete via the trailing trash on custom rows only — seeds are
// permanent). (3) The "Daily summary" prompt fields (DigestPromptStore-backed, unchanged from
// before this pass) stay as an extra group at the bottom — a real, already-shipped capability
// the design's mock doesn't happen to show on this page, kept as an honest superset.
//
// `autoCategorize` / `categorizationPrompt` / `customCategories` are new WhisperioSettings
// fields (see ruling R4/R7) — DigestStore is expected to honor `autoCategorize` (skip
// classification, no LLM call, notes keep their existing/default category when off) and to
// build the classification prompt from `categorizationPrompt` when on. `customCategories` is a
// flat `[String]` of user-added category names; the app-wide dynamic category list (used by
// Home's filter row, Detail's reassign menu, etc.) is expected to fold these in alongside the
// fixed seeds, cycling the design's hue palette by position — this page only owns the add/
// remove flow, not how other screens render a custom category's color.
struct DigestPromptEditorView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var digestPrompts: DigestPromptStore
    @EnvironmentObject private var settings: SettingsStore
    var onBack: () -> Void
    var toast: (String) -> Void

    // Daily summary fields only — classification is now the single live-bound
    // `categorizationPrompt` setting below, not a local draft.
    @State private var summaryIntro: String = ""
    @State private var summaryInstruction: String = ""
    @State private var showRestoreConfirm = false
    @State private var showAddCategory = false
    @State private var newCategoryName = ""

    // The shipped default (DigestPromptConfig.Defaults.classificationInstruction) — used both as
    // the Reset target and to decide whether the Reset link shows at all.
    private static let defaultCategorizationPrompt = DigestPromptConfig.Defaults.classificationInstruction

    // Design hint subs (mob-settings.jsx:8 CAT_HINTS), keyed by the app's existing WZCategory ids.
    private static let seedHints: [String: String] = [
        "work": "meetings, launches, clients",
        "code": "repos, APIs, shell commands",
        "ideas": "concepts, what-ifs, someday",
        "todo": "errands, groceries, chores",
        "messages": "texts, replies, quick pings",
    ]
    // Design order (mob-core.jsx M_CATS): Work, Code, Ideas, To-do, Messages.
    private static let seedOrder = ["work", "code", "ideas", "todo", "messages"]

    private var canSaveSummary: Bool {
        !summaryIntro.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !summaryInstruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var autoCategorize: Binding<Bool> {
        Binding(get: { settings.settings.autoCategorize },
                set: { var s = settings.settings; s.autoCategorize = $0; settings.settings = s })
    }

    private var categorizationPrompt: Binding<String> {
        Binding(get: { digestPrompts.config.classificationInstruction },
                set: { var c = digestPrompts.config; c.classificationInstruction = $0; digestPrompts.config = c })
    }

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: "Categorization prompts", onBack: onBack)
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 16) {
                        autoCategorizeGroup
                        if settings.settings.autoCategorize {
                            categorizationPromptCard
                            categoriesGroup
                        }
                        dailySummaryGroup
                    }
                    .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 28)
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
            Text("This brings back Whisperio's built-in daily-summary prompts and undoes your edits.")
        }
        .alert("New category", isPresented: $showAddCategory) {
            TextField("Name", text: $newCategoryName)
            Button("Add") { addCategory() }
            Button("Cancel", role: .cancel) { newCategoryName = "" }
        } message: {
            Text("Name it and describe when it applies")
        }
    }

    // MARK: - Auto-categorize toggle

    private var autoCategorizeGroup: some View {
        SettGroup {
            SettRow(icon: "spark", label: "Auto-categorize",
                    sub: "Sort every note into a category as it’s transcribed · on-device",
                    last: true) {
                WToggle(on: autoCategorize)
            }
        }
    }

    // MARK: - Categorization prompt

    private var categorizationPromptCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionLabel(text: "Categorization prompt")
                Spacer(minLength: 8)
                if digestPrompts.config.classificationInstruction != Self.defaultCategorizationPrompt {
                    Button {
                        var c = digestPrompts.config
                        c.classificationInstruction = Self.defaultCategorizationPrompt
                        digestPrompts.config = c
                    } label: {
                        HStack(spacing: 5) {
                            WIcon("sync", size: 12)
                            Text("Reset")
                        }
                        .font(WZFont.mono(11, .semibold)).foregroundStyle(t.accentLite)
                    }
                    .buttonStyle(.plain)
                }
            }
            TextEditor(text: categorizationPrompt)
                .font(WZFont.ui(13.5))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 108, maxHeight: 220)
                #if os(iOS)
                .textInputAutocapitalization(.sentences)
                #endif
                .padding(.horizontal, 13).padding(.vertical, 11)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
            Text("The model follows this instruction for every note. Mention your categories by name.")
                .font(WZFont.mono(11)).foregroundStyle(t.faint)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    // MARK: - Categories

    private var categoriesGroup: some View {
        SettGroup(title: "Categories") {
            ForEach(Self.seedOrder, id: \.self) { id in
                let cat = WZCategories.of(id)
                // Seeds are fixed — no onTap/chevron, since there's no real edit destination
                // for them (the design's own onTap here is a no-op stub, not a spec to follow).
                SettRow(icon: cat.icon, label: cat.label, sub: Self.seedHints[id], last: false)
            }
            ForEach(settings.settings.customCategories) { custom in
                SettRow(icon: custom.icon, label: custom.label, last: false) {
                    Button { removeCustomCategory(custom.id) } label: {
                        WIcon("trash", size: 13).foregroundStyle(t.muted)
                            .frame(width: 26, height: 26)
                            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(t.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
            SettRow(icon: "plus", label: "New category", sub: "Name it and describe when it applies",
                    last: true, onTap: { showAddCategory = true })
        }
    }

    private func addCategory() {
        let trimmed = newCategoryName.trimmingCharacters(in: .whitespacesAndNewlines)
        newCategoryName = ""
        guard !trimmed.isEmpty else { return }
        var s = settings.settings
        guard !s.customCategories.contains(where: { $0.label == trimmed }) else { return }
        let hueIndex = s.customCategories.count
        s.customCategories.append(CustomCategory(label: trimmed, hueIndex: hueIndex))
        settings.settings = s
    }

    private func removeCustomCategory(_ id: String) {
        var s = settings.settings
        s.customCategories.removeAll { $0.id == id }
        settings.settings = s
    }

    // MARK: - Daily summary (kept from before this pass — real, already-shipped capability)

    private var dailySummaryGroup: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Daily summary").padding(.leading, 4)
            promptField("Intro", $summaryIntro,
                        hint: "Opens the summary prompt. Use {date} for the day.",
                        minHeight: 90)
            promptField("Instruction", $summaryInstruction,
                        hint: "Closes it. Use {locale} for the interface language.",
                        minHeight: 170)

            GradButton(title: "Save prompts", icon: "check",
                       action: canSaveSummary ? saveSummary : {})
                .opacity(canSaveSummary ? 1 : 0.5)
                .allowsHitTesting(canSaveSummary)

            GhostButton(title: "Restore default prompts", icon: "sync") {
                showRestoreConfirm = true
            }
            .fixedSize()
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
        summaryIntro = digestPrompts.config.summaryIntro
        summaryInstruction = digestPrompts.config.summaryInstruction
    }

    private func saveSummary() {
        var config = digestPrompts.config
        config.summaryIntro = summaryIntro.trimmingCharacters(in: .whitespacesAndNewlines)
        config.summaryInstruction = summaryInstruction.trimmingCharacters(in: .whitespacesAndNewlines)
        digestPrompts.config = config
        toast("Prompts saved")
    }
}
