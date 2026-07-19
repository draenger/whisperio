import SwiftUI
import WhisperioKit
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

// Recordings home — the settled "second brain" variant: day-grouped cards, search,
// filter chips, and the gradient mic dock. Port of Home(variant:'brain') in wz-iphone.jsx.
struct HomeView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var recordings: RecordingsStore
    @EnvironmentObject private var digests: DigestStore
    @EnvironmentObject private var settings: SettingsStore
    var openRec: (DemoRecording) -> Void
    var openRecording: () -> Void
    var openConversation: () -> Void = {}
    var openSettings: () -> Void
    var openJournal: () -> Void = {}
    var openScratchpad: () -> Void = {}

    // nil → the "All" filter (show every category).
    @State private var selectedCategory: String? = nil
    @State private var searchText = ""

    var body: some View {
        ScreenScaffold {
            ZStack(alignment: .bottom) {
                VStack(spacing: 0) {
                    WHeader(title: "Whisperio") {
                        HStack(spacing: 9) {
                            HeaderSyncGlyph()
                            SquareIconButton(icon: "edit", action: openScratchpad)
                            SquareIconButton(icon: "book", action: openJournal)
                            SquareIconButton(icon: "settings", action: openSettings)
                        }
                    }
                    // In every other mode the header's small iCloud glyph is the whole affordance
                    // (unchanged); in `.manual` nothing nudges automatically, so the user asked
                    // for a button that's actually easy to hit — bigger, on the main screen, with
                    // its own progress state and a last-synced timestamp underneath.
                    if settings.settings.syncMode == .manual {
                        HomeSyncButton(action: syncNow)
                            .padding(.horizontal, 16).padding(.top, 10)
                    }
                    // search + filters
                    VStack(spacing: 13) {
                        HStack(spacing: 9) {
                            WIcon("search", size: 17, weight: .regular).foregroundStyle(t.faint)
                            TextField("Search transcripts", text: $searchText)
                                .font(WZFont.ui(14.5))
                                .foregroundStyle(t.text)
                                .textFieldStyle(.plain)
                                #if os(iOS)
                                .textInputAutocapitalization(.never)
                                #endif
                                .autocorrectionDisabled()
                            if !searchText.isEmpty {
                                Button { searchText = "" } label: {
                                    WIcon("x", size: 13, weight: .regular).foregroundStyle(t.faint)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 13).padding(.vertical, 11)
                        .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(t.line, lineWidth: 1))

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 7) {
                                CategoryFilterChip(category: nil, selected: selectedCategory == nil) {
                                    withAnimation(.easeInOut(duration: 0.2)) { selectedCategory = nil }
                                }
                                ForEach(WZCategories.all) { cat in
                                    CategoryFilterChip(category: cat, selected: selectedCategory == cat.id) {
                                        withAnimation(.easeInOut(duration: 0.2)) { selectedCategory = cat.id }
                                    }
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 6)

                    if recordings.items.isEmpty {
                        emptyState
                    } else {
                        let visible = visibleItems
                        if visible.isEmpty {
                            filteredEmptyState
                        } else {
                            ScrollView(showsIndicators: false) {
                                VStack(spacing: 18) {
                                    todaysDigestCard
                                    let today = visible.filter { Calendar.current.isDateInToday($0.timestamp) }
                                    let earlier = visible.filter { !Calendar.current.isDateInToday($0.timestamp) }
                                    if !today.isEmpty { brainGroup("Today", today) }
                                    if !earlier.isEmpty { brainGroup("Earlier", earlier) }
                                }
                                .padding(.horizontal, 16).padding(.top, 18).padding(.bottom, 150)
                            }
                            // Rows fade out under the filter chips instead of clipping hard
                            // against them — the top-edge mirror of the dictate bar's fade.
                            .overlay(alignment: .top) {
                                LinearGradient(colors: [t.bg, t.bg.opacity(0)],
                                               startPoint: .top, endPoint: .bottom)
                                    .frame(height: 30)
                                    .allowsHitTesting(false)
                            }
                            // Re-reads whatever CloudKit has already imported locally — this is
                            // not a network push/pull (SwiftData exposes no such API), so it only
                            // surfaces rows that landed silently since the last read.
                            .refreshable { recordings.requestCloudRefresh() }
                        }
                    }
                }
                dictateBar
            }
        }
    }

    // "Today's digest" card — a gradient icon tile + one-line preview of today's journal entry,
    // sitting above the grouped list. Tapping it opens the Journal (same destination as the book
    // icon in the header). Reads the cached DailyDigest for today's day key; before a summary
    // exists it falls back to a note count so the card is never blank.
    private var todaysDigestCard: some View {
        let dayKey = DigestGrouping.dayKey(for: Date(), calendar: .current)
        let summary = digests.digest(for: dayKey)?.summary
        let todayCount = recordings.items.filter { Calendar.current.isDateInToday($0.timestamp) }.count
        let preview: String
        if let summary, !summary.isEmpty {
            preview = summary
        } else if todayCount > 0 {
            preview = "\(todayCount) note\(todayCount == 1 ? "" : "s") today — tap to summarize"
        } else {
            preview = "Dictate a note to start today's digest"
        }
        return Button(action: openJournal) {
            HStack(spacing: 13) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous).fill(t.gradient)
                    WIcon("book", size: 18, weight: .semibold).foregroundStyle(.white)
                }
                .frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: 4) {
                    Text("TODAY'S DIGEST")
                        .font(WZFont.mono(11, .semibold)).tracking(1.1).foregroundStyle(t.accentLite)
                    Text(preview)
                        .font(WZFont.ui(13.5)).foregroundStyle(t.muted)
                        .lineLimit(1).truncationMode(.tail)
                }
                Spacer(minLength: 0)
                WIcon("chevR", size: 14, weight: .semibold).foregroundStyle(t.faint)
            }
            .padding(14)
            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // The recordings that match the active category filter (All → everything) and the search
    // bar's text (matched against transcript/app/category, case-insensitive). Category is
    // resolved through the store so live reassignments in Detail move rows between filters.
    private var visibleItems: [Recording] {
        var items = recordings.items
        if let selectedCategory {
            items = items.filter { recordings.categoryId(for: DemoRecording($0)) == selectedCategory }
        }
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return items }
        return items.filter {
            let demo = DemoRecording($0)
            return demo.title.localizedCaseInsensitiveContains(query)
                || demo.app.localizedCaseInsensitiveContains(query)
                || WZCategories.of(demo.category).label.localizedCaseInsensitiveContains(query)
        }
    }

    private func brainGroup(_ label: String, _ recs: [Recording]) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            SectionLabel(text: label)
            VStack(spacing: 0) {
                ForEach(Array(recs.enumerated()), id: \.element.id) { idx, item in
                    let demo = DemoRecording(item)
                    let cat = WZCategories.of(recordings.categoryId(for: demo))
                    RecRow(r: demo, category: cat, onTap: { openRec(demo) }, onDelete: { recordings.delete(item) })
                    if idx < recs.count - 1 { Divider().overlay(t.lineSoft) }
                }
            }
            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            // The card clips its rows so the sliding content and the red delete action stay
            // inside the rounded corners while a row is swiped open.
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Spacer()
            WIcon("mic", size: 34, weight: .regular).foregroundStyle(t.faint)
            Text("No recordings yet").font(WZFont.ui(16, .semibold)).foregroundStyle(t.text)
            Text("Tap the mic to dictate your first note.")
                .font(WZFont.ui(13.5)).foregroundStyle(t.muted)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.bottom, 120)
    }

    private var filteredEmptyState: some View {
        let cat = selectedCategory.map { WZCategories.of($0) }
        return VStack(spacing: 12) {
            Spacer()
            WIcon(cat?.icon ?? "search", size: 30, weight: .regular).foregroundStyle(t.faint)
            Text("Nothing in \(cat?.label ?? "this filter")")
                .font(WZFont.ui(16, .semibold)).foregroundStyle(t.text)
            Text("No transcripts are tagged here yet.")
                .font(WZFont.ui(13.5)).foregroundStyle(t.muted)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.bottom, 120)
    }

    // Manual-mode Sync button's tap handler: nudge both stores' local snapshot. Mirrors what the
    // automatic scenePhase nudge and the interval timer already do (AppShell.swift) — the only
    // difference in manual mode is that nothing calls this except the user's tap.
    private func syncNow() {
        recordings.requestCloudRefresh()
        digests.requestCloudRefresh()
    }

    // Full-width gradient "Dictate" pill, fading the list out beneath it — replaces the old
    // round FAB per the redesign brief (HOME: "full-width gradient 'Dictate' pill... REPLACES
    // the round FAB").
    private var dictateBar: some View {
        ZStack(alignment: .bottom) {
            LinearGradient(colors: [t.bg.opacity(0), t.bg], startPoint: .top, endPoint: .bottom)
                .frame(height: 140)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .ignoresSafeArea(edges: .bottom)
                .allowsHitTesting(false)
            HStack(spacing: 10) {
                Button(action: openRecording) {
                    HStack(spacing: 10) {
                        WIcon("mic", size: 20, weight: .bold)
                        Text("Dictate").font(WZFont.display(16, .semibold))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(t.gradient, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(.white.opacity(0.22), lineWidth: 1)
                            .blendMode(.overlay)
                    )
                    .shadow(color: t.accent.opacity(0.45), radius: 20, y: 14)
                }
                .buttonStyle(.plain)

                // Conversation mode — records everyone near the mic and separates speakers.
                Button(action: openConversation) {
                    WIcon("people", size: 19, weight: .bold)
                        .foregroundStyle(t.accentLite)
                        .frame(width: 56, height: 56)
                        .background(t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .stroke(t.accent.opacity(0.35), lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Record a conversation")
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 18)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
    }
}

// A recording row (port of RecRow — variant D "eyebrow"): meta strip on top with a small
// source glyph, title beneath. Double-tap copies the transcript (centered "Copied" pill for
// ~1.3s); swiping left slides the row open to −88 and reveals an 80pt red Delete action
// behind it — snaps open past halfway, and a tap while open just closes it again. The
// trailing copy button of the previous variant is gone: double-tap replaced it.
struct RecRow: View {
    @Environment(\.wz) private var t
    let r: DemoRecording
    var category: WZCategory? = nil
    var onTap: () -> Void
    var onDelete: (() -> Void)? = nil
    @State private var copied = false
    // Horizontal slide of the row content: 0 (closed) … openOffset (delete revealed).
    @State private var dx: CGFloat = 0
    // dx captured when a horizontal drag claims the gesture; nil while not dragging.
    @State private var dragBase: CGFloat? = nil

    private let openOffset: CGFloat = -88
    private let snap = Animation.timingCurve(0.2, 0.8, 0.3, 1, duration: 0.22)

    private var srcIcon: String {
        switch r.src {
        case "watch": return "watch"; case "action": return "bolt"
        case "backtap": return "command"; case "keyboard": return "keyboard"
        default: return "mic"
        }
    }

    var body: some View {
        rowContent
            .offset(x: dx)
            // Stationary layer behind the sliding content — exposed as the row moves left.
            .background(alignment: .trailing) { deleteAction }
    }

    private var rowContent: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 7) {
                WIcon(srcIcon, size: 12, weight: .regular).foregroundStyle(t.accentLite)
                Text(r.when); Text("·"); Text(r.dur)
                Spacer(minLength: 0)
                if let category {
                    let hue = category.hue(t)
                    HStack(spacing: 5) {
                        Circle().fill(hue).frame(width: 6, height: 6)
                        Text(category.label).fontWeight(.semibold)
                    }
                    .foregroundStyle(hue)
                }
                WIcon(r.engine == "cloud" ? "cloud" : "lock", size: 11, weight: .regular)
                    .foregroundStyle(r.engine == "cloud" ? t.amber : t.green)
            }
            .font(WZFont.mono(10)).foregroundStyle(t.faint)

            Text(r.title).font(WZFont.ui(14.5, .medium)).foregroundStyle(t.text)
                .lineLimit(2).multilineTextAlignment(.leading).lineSpacing(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16).padding(.vertical, 11)
        .background(t.surface)
        .overlay { if copied { copiedOverlay } }
        .contentShape(Rectangle())
        // Double-tap declared first so it wins; SwiftUI then delays the single tap until the
        // double-tap has failed — the native equivalent of the mock's 270ms disambiguation.
        .onTapGesture(count: 2) { handleDoubleTap() }
        .onTapGesture { handleSingleTap() }
        .simultaneousGesture(swipe)
        .contextMenu {
            Button(action: copyTranscript) { Label("Copy", systemImage: "doc.on.doc") }
            if let onDelete {
                Button(role: .destructive, action: onDelete) {
                    Label("Delete", systemImage: "trash")
                }
            }
        }
    }

    // 80pt red column (trash glyph over "Delete") pinned to the trailing edge, only visible
    // once the row has actually slid (dx < −8), so it never ghosts through the closed row.
    private var deleteAction: some View {
        Button {
            withAnimation(.easeOut(duration: 0.22)) { onDelete?() }
        } label: {
            VStack(spacing: 4) {
                WIcon("trash", size: 16, weight: .regular)
                Text("Delete").font(WZFont.ui(11, .semibold))
            }
            .foregroundStyle(.white)
            .frame(width: 80)
            .frame(maxHeight: .infinity)
            .background(t.red)
        }
        .buttonStyle(.plain)
        .opacity(dx < -8 ? 1 : 0)
    }

    private var copiedOverlay: some View {
        ZStack {
            t.bg.opacity(0.55)
            HStack(spacing: 7) {
                WIcon("check", size: 14, weight: .semibold)
                Text("Copied").font(WZFont.ui(12.5, .semibold))
            }
            .foregroundStyle(t.green)
            .padding(.horizontal, 14).padding(.vertical, 7)
            .background(t.elevated, in: Capsule())
            .overlay(Capsule().stroke(t.green.opacity(0.4), lineWidth: 1))
        }
        .transition(.opacity)
        .allowsHitTesting(false)
    }

    // Horizontal-only drag: claimed at the first change whose horizontal travel beats the
    // vertical, so the enclosing ScrollView keeps vertical pans. Clamped to [openOffset, 0];
    // on release it snaps open past the halfway point, closed otherwise (mirrors the mock).
    private var swipe: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { g in
                guard onDelete != nil else { return }
                let base: CGFloat
                if let dragBase {
                    base = dragBase
                } else {
                    guard abs(g.translation.width) > abs(g.translation.height) else { return }
                    base = dx
                    dragBase = base
                }
                dx = min(0, max(openOffset, base + g.translation.width))
            }
            .onEnded { _ in
                guard dragBase != nil else { return }
                dragBase = nil
                withAnimation(snap) { dx = dx < openOffset / 2 ? openOffset : 0 }
            }
    }

    private func handleSingleTap() {
        if dx != 0 { withAnimation(snap) { dx = 0 }; return }
        onTap()
    }

    private func handleDoubleTap() {
        if dx != 0 { withAnimation(snap) { dx = 0 }; return }
        copyTranscript()
    }

    private func copyTranscript() {
#if canImport(UIKit)
        UIPasteboard.general.string = r.title
        UINotificationFeedbackGenerator().notificationOccurred(.success)
#elseif canImport(AppKit)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(r.title, forType: .string)
#endif
        withAnimation(.easeOut(duration: 0.18)) { copied = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.3) {
            withAnimation(.easeOut(duration: 0.18)) { copied = false }
        }
    }
}

// The manual-sync-mode call to action on Home: deliberately larger and easier to hit than the
// header's discreet iCloud glyph — the user asked for this literally ("ten guzik sie powieksza
// zeby bylo latwiej go kliknac na glownej stronce"), since in `.manual` mode nothing else ever
// nudges CloudKit. Shows the same in-flight state `isSyncing` already publishes (an animated
// spinner swaps in for the icon) and a relative "last synced" timestamp underneath so a tap has
// visible feedback beyond the spinner alone.
struct HomeSyncButton: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var recordings: RecordingsStore
    @EnvironmentObject private var digests: DigestStore
    var action: () -> Void

    private var isSyncing: Bool { recordings.isSyncing || digests.isSyncing }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                ZStack {
                    if isSyncing {
                        ProgressView().tint(.white)
                    } else {
                        WIcon("sync", size: 22, weight: .bold).foregroundStyle(.white)
                    }
                }
                .frame(width: 46, height: 46)
                VStack(alignment: .leading, spacing: 2) {
                    Text(isSyncing ? "Syncing…" : "Sync now")
                        .font(WZFont.ui(15.5, .semibold)).foregroundStyle(.white)
                    Text(lastSyncedLabel)
                        .font(WZFont.ui(12)).foregroundStyle(.white.opacity(0.78))
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 18).padding(.vertical, 15)
            .background(t.gradient, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .shadow(color: t.accent.opacity(0.4), radius: 18, y: 10)
        }
        .buttonStyle(.plain)
        .animation(.easeInOut(duration: 0.2), value: isSyncing)
        .accessibilityLabel(isSyncing ? "Syncing" : "Sync now")
        .accessibilityHint(lastSyncedLabel)
    }

    private var lastSyncedLabel: String {
        let latest = [recordings.lastImportAt, digests.lastImportAt].compactMap { $0 }.max()
        guard let latest else { return "Not synced yet on this device" }
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return "Last synced \(f.localizedString(for: latest, relativeTo: Date()))"
    }
}
