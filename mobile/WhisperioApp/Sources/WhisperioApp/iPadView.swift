import SwiftUI
import WhisperioKit
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

// iPad — Obsidian-style split view. Port of WZiPad / AppleSplit (mob-screens.jsx).
// A segmented Library / Journal toggle sits at the top: Library is the recording library
// (sidebar + transcript detail); Journal is the per-day AI daily-summary view (day index +
// summary card + category groups). Renders responsively; on a real iPad it fills the window.
//
// The live journal (JournalView / DigestDayView) is store-backed and used in the phone shell;
// this split is a self-contained visual over WZSample data (no stores injected here), so the
// Journal tab mirrors that design on the same sample recordings.
struct iPadSplitView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var settings: SettingsStore
    // Set by the live shell (Mac/iPad entry) once the real stores are injected. When true the
    // Journal tab is store-backed (JournalView + DigestDayView); otherwise it stays on sample data.
    @Environment(\.wzLiveJournal) private var liveJournal
    // Design's `engineBar` prop (mob-screens.jsx AppleSplit): shown for the Mac variant, false
    // ("plain") for iPad. Defaults to true so existing callers (Mac, Gallery preview) are unchanged;
    // the real iPad entry point in AppShell.swift passes false.
    var showEngineBar: Bool = true
    @State private var tab = "library"   // library | journal
    @State private var sel = WZSample.recordings[0].id
    @State private var showCloudConsent = false
    @State private var pendingCloudEngine: ProviderID?
    private var cur: DemoRecording { WZSample.recordings.first { $0.id == sel } ?? WZSample.recordings[0] }
    private var primaryEngine: ProviderID { settings.settings.providerChain.first ?? .onDevice }
    private var cloudConsentGranted: Bool { settings.settings.cloudConsentGranted }

    var body: some View {
        VStack(spacing: 0) {
            if showEngineBar {
                engineBar
            }
            HStack {
                segmented.frame(width: 260)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 18).padding(.vertical, 12)
            .overlay(alignment: .bottom) { Rectangle().fill(t.lineSoft).frame(height: 1) }
            if tab == "library" {
                HStack(spacing: 0) {
                    sidebar.frame(width: 320)
                    Rectangle().fill(t.line).frame(width: 1)
                    detail.frame(maxWidth: .infinity)
                }
            } else if liveJournal {
                IPadLiveJournal(onExit: { withAnimation(.easeInOut(duration: 0.18)) { tab = "library" } })
            } else {
                iPadJournal()
            }
        }
        .background(t.bg.ignoresSafeArea())
        .overlay {
            if showCloudConsent {
                ConsentSheet(onClose: { withAnimation { showCloudConsent = false } },
                             onConfirm: confirmCloudEngine)
                    .transition(.opacity)
            }
        }
    }

    // Compact, read-only engine status strip (mob-screens.jsx AppleSplit `engineBar`): a thin
    // full-width row — cog glyph, muted "Engines:" label, a mono read-only rendering of the
    // active provider chain with faint arrow separators, and a right-aligned PrivacyBadge. Not
    // a selector; the strip itself carries no per-item highlight/interaction chrome. Wrapped in
    // a `Menu` so the real "change primary engine" capability (incl. the cloud-consent flow) is
    // still reachable from the same control, matching the strip's appearance when closed.
    private var engineBar: some View {
        Menu {
            engineChoice(id: .onDevice, title: "On-device")
            engineChoice(id: .openAI, title: "OpenAI")
            engineChoice(id: .elevenLabs, title: "ElevenLabs")
        } label: {
            HStack(spacing: 10) {
                WIcon("settings", size: 15).foregroundStyle(t.faint)
                Text("Engines:").font(WZFont.ui(13)).foregroundStyle(t.muted)
                Text(engineChainText).font(WZFont.mono(12.5)).foregroundStyle(t.text)
                Spacer(minLength: 0)
                PrivacyBadge(mode: settings.settings.isCloud(primaryEngine) ? .cloud : .device, small: true)
            }
            .padding(.horizontal, 16).padding(.vertical, 9)
            .background(t.surface)
            .overlay(alignment: .bottom) { Rectangle().fill(t.line).frame(height: 1) }
            .contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
        .accessibilityLabel("Engines: \(engineChainText). Tap to change the primary transcription engine.")
    }

    // Read-only "On-device → OpenAI → ElevenLabs"-style rendering of the live provider chain,
    // reflecting the real SettingsStore data (not a hardcoded sample string).
    private var engineChainText: String {
        settings.settings.providerChain.map(engineLabel).joined(separator: " → ")
    }

    private func engineLabel(_ id: ProviderID) -> String {
        switch id {
        case .onDevice: return "On-device"
        case .openAI: return "OpenAI"
        case .elevenLabs: return "ElevenLabs"
        case .groq: return "Groq"
        case .deepgram: return "Deepgram"
        case .assemblyAI: return "AssemblyAI"
        case .mistral: return "Mistral"
        }
    }

    private func engineChoice(id: ProviderID, title: String) -> some View {
        let needsConsent = settings.settings.isCloud(id) && !cloudConsentGranted
        return Button {
            selectEngine(id)
        } label: {
            if id == primaryEngine {
                Label(title, systemImage: "checkmark")
            } else if needsConsent {
                Label(title, systemImage: "lock")
            } else {
                Text(title)
            }
        }
    }

    private func selectEngine(_ id: ProviderID) {
        guard id != primaryEngine else { return }
        if settings.settings.isCloud(id) && !settings.settings.cloudConsentGranted {
            pendingCloudEngine = id
            withAnimation(.easeInOut(duration: 0.18)) { showCloudConsent = true }
            return
        }
        applyEngine(id)
    }

    private func applyEngine(_ id: ProviderID) {
        var s = settings.settings
        s.providerChain = [id]
        settings.settings = s
    }

    private func confirmCloudEngine() {
        let id = pendingCloudEngine ?? .openAI
        var s = settings.settings
        s.cloudConsentGranted = true
        s.providerChain = [id]
        settings.settings = s
        pendingCloudEngine = nil
        showCloudConsent = false
    }

    private var segmented: some View {
        HStack(spacing: 3) {
            segItem(id: "library", label: "Library", icon: "list")
            segItem(id: "journal", label: "Journal", icon: "book")
        }
        .padding(3)
        .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    private func segItem(id: String, label: String, icon: String) -> some View {
        let on = tab == id
        return Button { withAnimation(.easeInOut(duration: 0.18)) { tab = id } } label: {
            HStack(spacing: 6) {
                WIcon(icon, size: 13); Text(label)
            }
            .font(WZFont.ui(13, .semibold))
            .foregroundStyle(on ? .white : t.muted)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(on ? t.accent : .clear, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                WGhost(size: 24)
                Text("Whisperio").font(WZFont.display(20)).foregroundStyle(t.text)
                Spacer()
                // Sample split-view (no live store injected) — a static iCloud glyph mirrors the
                // sample PrivacyBadge beside it, matching the phone Home header treatment.
                SyncStatusGlyph(isCloudBacked: true, isSyncing: false)
                PrivacyBadge(mode: .device, small: true)
            }
            .padding(.horizontal, 18).padding(.top, 20).padding(.bottom, 12)
            HStack(spacing: 8) {
                WIcon("search", size: 16, weight: .regular); Text("Search").font(WZFont.ui(14)); Spacer()
            }
            .foregroundStyle(t.faint).padding(.horizontal, 12).padding(.vertical, 9)
            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(t.line, lineWidth: 1))
            .padding(.horizontal, 16).padding(.bottom, 12)
            HStack(spacing: 16) {
                Text("All").foregroundStyle(t.accentLite); Text("Keyboard"); Text("Watch")
            }
            .font(WZFont.mono(11, .semibold)).foregroundStyle(t.faint).padding(.horizontal, 18).padding(.bottom, 6)
            ScrollView {
                VStack(spacing: 2) {
                    ForEach(WZSample.recordings) { r in
                        Button { sel = r.id } label: { sidebarRow(r) }.buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 10).padding(.top, 8)
            }
        }
        .background(t.bg2)
    }

    private func sidebarRow(_ r: DemoRecording) -> some View {
        let on = sel == r.id
        let icon = r.src == "watch" ? "watch" : r.src == "action" ? "bolt" : r.src == "keyboard" ? "keyboard" : "mic"
        return HStack(alignment: .top, spacing: 11) {
            WIcon(icon, size: 15, weight: .regular).foregroundStyle(t.accentLite)
                .frame(width: 32, height: 32)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(t.line, lineWidth: 1))
            VStack(alignment: .leading, spacing: 5) {
                Text(r.title).font(WZFont.ui(13.5, .medium)).foregroundStyle(t.text).lineLimit(2).multilineTextAlignment(.leading)
                Text("\(r.app) · \(r.when)").font(WZFont.mono(10.5)).foregroundStyle(t.faint)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(on ? t.accent.opacity(t.dark ? 0.14 : 0.08) : .clear, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(on ? t.hair : .clear, lineWidth: 1))
    }

    private var detail: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                SourceBadge(src: cur.src)
                PrivacyBadge(mode: cur.engine == "cloud" ? .cloud : .device, small: true)
                Text("\(cur.app) · \(cur.when) · \(cur.dur) · \(cur.words) words")
                    .font(WZFont.mono(12)).foregroundStyle(t.faint)
                Spacer()
                GhostButton(title: "Copy", icon: "copy").fixedSize()
                GradButton(title: "Insert", icon: "arrowUR").fixedSize()
            }
            .padding(.horizontal, 32).padding(.vertical, 18)
            .overlay(alignment: .bottom) { Rectangle().fill(t.lineSoft).frame(height: 1) }
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 7) { WIcon("spark", size: 13); Text("CLEANED UP ON-DEVICE") }
                        .font(WZFont.mono(11, .semibold)).tracking(1.1).foregroundStyle(t.accentLite).padding(.bottom, 14)
                    Text(cur.title).font(WZFont.display(28, .medium)).foregroundStyle(t.text).lineSpacing(8)
                    HStack(spacing: 16) {
                        Circle().fill(t.gradient).frame(width: 46, height: 46)
                            .overlay(WIcon("bolt", size: 20).foregroundStyle(.white))
                        MiniWave(color: t.accent, n: 64, height: 32).frame(maxWidth: .infinity)
                        Text(cur.dur).font(WZFont.mono(13)).foregroundStyle(t.faint)
                    }
                    .padding(.horizontal, 22).padding(.vertical, 18).padding(.top, 30)
                    .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
                }
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 40).padding(.vertical, 32)
            }
        }
    }
}

// Store-backed Journal for the live iPad/Mac shell: the real JournalView day index on the left,
// the real DigestDayView for the selected day on the right. Both read the injected RecordingsStore /
// DigestStore / SettingsStore, so summaries generate and notes reflect live edits. Only constructed
// when `wzLiveJournal` is true (stores present), so the sample path never resolves those objects.
private struct IPadLiveJournal: View {
    @Environment(\.wz) private var t
    var onExit: () -> Void = {}
    @State private var day: Date?

    var body: some View {
        HStack(spacing: 0) {
            JournalView(onBack: onExit, openDay: { day = $0 })
                .frame(width: 320)
            Rectangle().fill(t.line).frame(width: 1)
            Group {
                if let day {
                    DigestDayView(day: day,
                                  onBack: { self.day = nil },
                                  openRec: { _ in },
                                  openSettings: {},
                                  toast: { _ in })
                        .id(day)
                } else {
                    placeholder
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var placeholder: some View {
        VStack(spacing: 12) {
            WIcon("book", size: 34, weight: .regular).foregroundStyle(t.faint)
            Text("Select a day").font(WZFont.ui(16, .semibold)).foregroundStyle(t.text)
            Text("Pick a day from the journal to see its summary and notes.")
                .font(WZFont.ui(13.5)).foregroundStyle(t.muted).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(40)
        .background(t.bg2)
    }
}

// The Journal tab of the iPad split — a day index (Today / Yesterday) on the left and, on the
// right, the day's AI daily-summary card over the day's notes grouped by category. Visual peer
// of the phone's JournalView + DigestDayView, over the same WZSample recordings.
private struct iPadJournal: View {
    @Environment(\.wz) private var t
    @State private var selDay = "today"
    @State private var generatedDays: Set<String> = ["yesterday"]
    @State private var generating = false
    private let demoSummary = "You shipped the export pipeline and unblocked staging, pushed the launch to Thursday to give QA a full cycle, and captured a few ideas — including a weekly digest that condenses each voice note into three bullets."

    private struct JDay { let id: String; let title: String; let recs: [DemoRecording] }

    private var days: [JDay] {
        let today = WZSample.recordings.filter { $0.when != "Yesterday" }
        let yest  = WZSample.recordings.filter { $0.when == "Yesterday" }
        return [JDay(id: "today", title: "Today", recs: today),
                JDay(id: "yesterday", title: "Yesterday", recs: yest)]
    }
    private var current: JDay { days.first { $0.id == selDay } ?? days[0] }

    // Distinct categories present in a day's notes, in canonical order.
    private func categories(_ recs: [DemoRecording]) -> [WZCategory] {
        let present = Set(recs.map(\.category))
        return WZCategories.all.filter { present.contains($0.id) }
    }

    var body: some View {
        HStack(spacing: 0) {
            dayIndex.frame(width: 320)
            Rectangle().fill(t.line).frame(width: 1)
            dayDetail.frame(maxWidth: .infinity)
        }
    }

    private var dayIndex: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionLabel(text: "Journal")
                .padding(.horizontal, 18).padding(.top, 20).padding(.bottom, 12)
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(days, id: \.id) { day in
                        Button { selDay = day.id } label: { dayCard(day) }.buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12).padding(.top, 4)
            }
        }
        .background(t.bg2)
    }

    private func dayCard(_ day: JDay) -> some View {
        let on = selDay == day.id
        let ready = generatedDays.contains(day.id)
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(day.title).font(WZFont.display(16, .medium)).foregroundStyle(t.text)
                Spacer(minLength: 0)
                Text("\(day.recs.count) note\(day.recs.count == 1 ? "" : "s")")
                    .font(WZFont.mono(11)).foregroundStyle(t.faint)
            }
            FlowLayout(spacing: 6) {
                ForEach(categories(day.recs)) { CategoryTag(category: $0) }
            }
            if ready {
                HStack(spacing: 6) {
                    WIcon("check", size: 12).foregroundStyle(t.green)
                    Text("Summary ready").font(WZFont.mono(10.5, .semibold)).foregroundStyle(t.green)
                }
            } else {
                HStack(spacing: 6) {
                    WIcon("spark", size: 12).foregroundStyle(t.accentLite)
                    Text("Generate summary").font(WZFont.mono(10.5, .semibold)).foregroundStyle(t.accentLite)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(on ? t.accent.opacity(t.dark ? 0.14 : 0.08) : t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(on ? t.hair : t.line, lineWidth: 1))
    }

    private var dayDetail: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(current.title).font(WZFont.display(28, .medium)).foregroundStyle(t.text)
                summaryCard
                ForEach(categories(current.recs)) { cat in
                    groupSection(cat)
                }
            }
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 40).padding(.vertical, 30)
        }
    }

    private var summaryCard: some View {
        let ready = generatedDays.contains(selDay)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                SectionLabel(text: "Daily summary")
                Spacer(minLength: 0)
                PrivacyBadge(mode: .cloud, small: true)
            }
            if generating {
                HStack(spacing: 11) {
                    ProgressView().tint(t.accent)
                    Text("Summarizing your day…").font(WZFont.ui(14, .medium)).foregroundStyle(t.muted)
                    Spacer(minLength: 0)
                }
            } else if ready {
                Text(demoSummary)
                    .font(WZFont.ui(15)).foregroundStyle(t.text).lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
                HStack {
                    Spacer(minLength: 0)
                    GhostButton(title: "Copy", icon: "copy") { copy(demoSummary) }.fixedSize()
                    GhostButton(title: "Regenerate", icon: "sync") { generate() }.fixedSize()
                }
            } else {
                Text("Group this day’s notes by category and write a short digest with AI.")
                    .font(WZFont.ui(13.5)).foregroundStyle(t.muted).lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                GradButton(title: "Generate summary", icon: "spark") { generate() }.fixedSize()
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    private func copy(_ text: String) {
#if canImport(UIKit)
        UIPasteboard.general.string = text
        UINotificationFeedbackGenerator().notificationOccurred(.success)
#elseif canImport(AppKit)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
#endif
    }

    private func generate() {
        let day = selDay
        withAnimation { generating = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) {
            withAnimation { generating = false; generatedDays.insert(day) }
        }
    }

    private func groupSection(_ cat: WZCategory) -> some View {
        let recs = current.recs.filter { $0.category == cat.id }
        return VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 8) {
                SectionLabel(text: cat.label)
                CategoryTag(category: cat)
            }
            VStack(spacing: 0) {
                ForEach(Array(recs.enumerated()), id: \.element.id) { idx, r in
                    HStack(alignment: .top, spacing: 11) {
                        WIcon(cat.icon, size: 14, weight: .regular).foregroundStyle(cat.hue(t))
                            .frame(width: 30, height: 30)
                            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(t.line, lineWidth: 1))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(r.title).font(WZFont.ui(14)).foregroundStyle(t.text)
                                .lineLimit(2).multilineTextAlignment(.leading)
                            Text("\(r.app) · \(r.when) · \(r.dur)").font(WZFont.mono(10.5)).foregroundStyle(t.faint)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 11)
                    if idx < recs.count - 1 { Divider().overlay(t.lineSoft) }
                }
            }
            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
        }
    }
}
