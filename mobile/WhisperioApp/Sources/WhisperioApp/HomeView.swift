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
    var openRecap: () -> Void = {}

    // nil → the "All" filter (show every category).
    @State private var selectedCategory: String? = nil
    @State private var searchText = ""

    var body: some View {
        ScreenScaffold {
            ZStack(alignment: .bottom) {
                VStack(spacing: 0) {
                    WHeader(title: "Whisperio") {
                        HStack(spacing: 9) {
                            if weeklyCloudSpendUSD > 0 {
                                weeklyCloudSpendBadge
                            }
                            if settings.settings.syncMode == .manual {
                                HomeSyncButton(action: syncNow)
                            } else {
                                HeaderSyncGlyph()
                            }
                            SquareIconButton(icon: "settings", action: openSettings)
                        }
                    }
                    // Pinned block (never scrolls away): journal/recap row, search bar, category
                    // chips — port of PhoneHome's `t.design === 'redesign'` row sitting between
                    // the header and the search bar (mob-screens.jsx ~95-118). The recap streak
                    // tile is this row's only entry point to Recap now that the header's bolt
                    // glyph is gone.
                    VStack(spacing: 13) {
                        // Equal heights like the JSX flex row: the stretch frames live INSIDE
                        // each card (before its background) — an outer frame on the Button
                        // grows an invisible box while the visible card keeps natural height.
                        HStack(spacing: 9) {
                            todaysDigestCard
                            recapStreakTile
                        }
                        .fixedSize(horizontal: false, vertical: true)
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
                                ForEach(WZCategories.all(with: settings.settings)) { cat in
                                    CategoryFilterChip(category: cat, selected: selectedCategory == cat.id) {
                                        withAnimation(.easeInOut(duration: 0.2)) { selectedCategory = cat.id }
                                    }
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 16).padding(.top, 4)

                    if recordings.items.isEmpty {
                        emptyState
                    } else {
                        let visible = visibleItems
                        if visible.isEmpty {
                            filteredEmptyState
                        } else {
                            ScrollView(showsIndicators: false) {
                                VStack(spacing: 18) {
                                    let today = visible.filter { Calendar.current.isDateInToday($0.timestamp) }
                                    let earlier = visible.filter { !Calendar.current.isDateInToday($0.timestamp) }
                                    if !today.isEmpty { brainGroup("Today", today) }
                                    if !earlier.isEmpty { brainGroup("Earlier", earlier) }
                                }
                                .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 150)
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

    // "My journal" tile — the pinned flex-1 entry point into the Journal, port of PhoneHome's
    // journal button (mob-screens.jsx ~97-103: pencil badge on `t.primary`/`t.primaryInk`,
    // "My journal" eyebrow). Reads the cached DailyDigest for today's day key; before a summary
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
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous).fill(t.primary)
                    WIcon("pencil", size: 17, weight: .semibold).foregroundStyle(t.primaryInk)
                }
                .frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: 4) {
                    Text("MY JOURNAL")
                        .font(WZFont.mono(10, .semibold)).tracking(1.1).foregroundStyle(t.accentLite)
                    Text(preview)
                        .font(WZFont.ui(13)).foregroundStyle(t.muted)
                        .lineLimit(2).truncationMode(.tail)
                }
                Spacer(minLength: 0)
                WIcon("chevR", size: 14, weight: .semibold).foregroundStyle(t.faint)
            }
            .padding(.vertical, 12).padding(.horizontal, 14)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .background(t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(t.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // Weekly cloud-spend badge — the header pill from mob-screens.jsx ~93 ("$0.48" style),
    // tap → Recap. KEEP IN SYNC with RecapView's totalCostUSD/engineMinutes/rate(for:) — this
    // mirrors that exact aggregation (this week's cloud minutes × ProviderPricing rates for the
    // sub-model currently configured in Settings) rather than a second, drifting cost model.
    // No USD/EUR toggle: there is no real FX source in the app, so only USD is shown (documented
    // deviation from the design's currency switcher). Hidden entirely at $0 — an honest empty
    // state rather than a fabricated "$0.00".
    private var weeklyCloudSpendBadge: some View {
        Button(action: openRecap) {
            Text("$" + String(format: "%.2f", weeklyCloudSpendUSD))
                .font(WZFont.mono(10.5, .bold))
                .foregroundStyle(t.accentLite)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(t.accent.opacity(0.12), in: Capsule())
                .overlay(Capsule().stroke(t.hair, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Cloud spend this week, $\(String(format: "%.2f", weeklyCloudSpendUSD))")
    }

    private var weekInterval: DateInterval {
        var calendar = Calendar.current
        calendar.firstWeekday = 2   // matches RecapView's Mon–Sun week
        return calendar.dateInterval(of: .weekOfYear, for: Date())
            ?? DateInterval(start: Date().addingTimeInterval(-7 * 24 * 3600), duration: 7 * 24 * 3600)
    }

    // Minutes spoken this week, bucketed by transcribing engine — same shape as RecapView's
    // `engineMinutes`, recomputed here since Home has no dependency on Recap.
    private var weeklyEngineMinutes: [(provider: ProviderID, minutes: Double)] {
        let week = weekInterval
        let items = recordings.items.filter {
            week.contains($0.timestamp) && $0.provider != nil && $0.duration > 0
        }
        var totals: [ProviderID: Double] = [:]
        for r in items { totals[r.provider!, default: 0] += r.duration / 60 }
        return totals.map { (provider: $0.key, minutes: $0.value) }
    }

    // Published per-minute list price for `provider`, using the sub-model currently configured
    // in Settings — identical logic to RecapView's `rate(for:)`.
    private func weeklyRate(for provider: ProviderID) -> Double? {
        let s = settings.settings
        switch provider {
        case .onDevice:
            return 0
        case .localWhisper:
            return 0   // Free, on-device — same treatment as .onDevice.
        case .openAI:
            guard s.openAIBaseURL.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
            return ProviderPricing.ratePerMinuteUSD(provider: .openAI, model: s.whisperModel)
        case .elevenLabs:
            return ProviderPricing.ratePerMinuteUSD(provider: .elevenLabs, model: "")
        case .groq:
            return ProviderPricing.ratePerMinuteUSD(provider: .groq, model: s.groqModel)
        case .deepgram:
            return ProviderPricing.ratePerMinuteUSD(provider: .deepgram, model: s.deepgramModel)
        case .assemblyAI:
            return ProviderPricing.ratePerMinuteUSD(provider: .assemblyAI, model: s.assemblyAIModel)
        case .mistral:
            return ProviderPricing.ratePerMinuteUSD(provider: .mistral, model: s.mistralModel)
        case .replicate:
            return ProviderPricing.ratePerMinuteUSD(provider: .replicate, model: s.replicateModel)
        case .selfHosted:
            return 0   // Free — the user's own hardware, same treatment as on-device.
        }
    }

    private var weeklyCloudSpendUSD: Double {
        weeklyEngineMinutes.reduce(0) { total, entry in
            guard entry.provider != .onDevice, let rate = weeklyRate(for: entry.provider) else { return total }
            return total + rate * entry.minutes
        }
    }

    // Recap streak tile — the 76pt companion to the journal tile (mob-screens.jsx ~104-108: bolt
    // icon, streak value, uppercase "Recap" label). This is now the body's only entry point to
    // Recap — the header's bolt glyph was removed in favor of this real, streak-bearing tile.
    // The streak itself mirrors RecapView.streaks.current exactly (days-with-a-note run ending
    // today or yesterday); a zero streak renders neutrally rather than claiming a fake "0d" win.
    private var recapStreakTile: some View {
        let streak = currentStreak
        return Button(action: openRecap) {
            VStack(spacing: 4) {
                WIcon("bolt", size: 17, weight: .regular).foregroundStyle(t.accentLite)
                Text(streak > 0 ? "\(streak)d" : "–")
                    .font(WZFont.display(15, .bold))
                    .foregroundStyle(streak > 0 ? t.text : t.faint)
                Text("RECAP")
                    .font(WZFont.mono(8.5, .semibold)).tracking(1.0).foregroundStyle(t.faint)
            }
            .frame(width: 76)
            .frame(maxHeight: .infinity)
            .padding(.vertical, 12)
            .background(t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(t.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(streak > 0 ? "Weekly recap, \(streak) day streak" : "Weekly recap")
    }

    // Days-with-a-note streak ending today (or yesterday, so a streak isn't lost the instant the
    // clock passes midnight before today's first note lands) — the same definition RecapView's
    // `streaks.current` uses, computed independently here since Home has no dependency on Recap.
    private var currentStreak: Int {
        let calendar = Calendar.current
        let days = Set(recordings.items.map { calendar.startOfDay(for: $0.timestamp) })
        guard !days.isEmpty else { return 0 }
        var probe = calendar.startOfDay(for: Date())
        if !days.contains(probe) {
            guard let yesterday = calendar.date(byAdding: .day, value: -1, to: probe) else { return 0 }
            probe = yesterday
        }
        var current = 0
        while days.contains(probe) {
            current += 1
            guard let prev = calendar.date(byAdding: .day, value: -1, to: probe) else { break }
            probe = prev
        }
        return current
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
                || WZCategories.of(demo.category, with: settings.settings).label.localizedCaseInsensitiveContains(query)
        }
    }

    private func brainGroup(_ label: String, _ recs: [Recording]) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            SectionLabel(text: label)
            VStack(spacing: 0) {
                ForEach(Array(recs.enumerated()), id: \.element.id) { idx, item in
                    let demo = DemoRecording(item)
                    let cat = WZCategories.of(recordings.categoryId(for: demo), with: settings.settings)
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
        let cat = selectedCategory.map { WZCategories.of($0, with: settings.settings) }
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
            HStack(spacing: 9) {
                Button(action: openRecording) {
                    HStack(spacing: 10) {
                        WIcon("mic", size: 20, weight: .bold)
                        Text("Dictate").font(WZFont.display(16, .semibold))
                    }
                    .foregroundStyle(t.primaryInk)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(t.primary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .shadow(color: t.accent.opacity(0.45), radius: 20, y: 14)
                }
                .buttonStyle(.plain)

                // Conversation mode — records everyone near the mic and separates speakers.
                Button(action: openConversation) {
                    WIcon("people", size: 20, weight: .bold)
                        .foregroundStyle(t.accentLite)
                        .frame(width: 56, height: 56)
                        .background(t.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(t.accent.opacity(0.35), lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Record a conversation")
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 26)
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
    // Resting slide of the row content: 0 (closed) or openOffset (delete revealed).
    @State private var committed: CGFloat = 0
    // Live drag delta. @GestureState so the system resets it even when the ScrollView wins
    // the pan and CANCELS this gesture (no onEnded) — plain @State left the row stuck
    // mid-slide and its stale bookkeeping was what froze vertical scrolling over open rows.
    @GestureState private var slide: CGFloat = 0
    // Rendered offset — always derived, never stored, so a cancelled gesture cannot leave
    // the row in a state the next pan has to fight.
    private var dx: CGFloat { min(0, max(openOffset, committed + slide)) }

    private let openOffset: CGFloat = -88
    private let snap = Animation.timingCurve(0.2, 0.8, 0.3, 1, duration: 0.22)


    var body: some View {
        rowContent
            .offset(x: dx)
            .animation(slide == 0 ? snap : nil, value: dx)
            // Stationary layer behind the sliding content — exposed as the row moves left.
            .background(alignment: .trailing) { deleteAction }
    }

    private var rowContent: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 7) {
                WIcon(r.srcIcon, size: 12, weight: .regular).foregroundStyle(t.accentLite)
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
        // Plain .gesture (NOT simultaneous): the ScrollView's pan and this drag are then
        // arbitrated exclusively by the system — every vertical pan goes to the list (also
        // over a swiped-open row), and this gesture only ever receives decisively
        // horizontal movement. simultaneousGesture ran both at once, which is what made
        // rows wiggle during scrolls and scrolling die over an open row.
        .gesture(swipe)
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
        DragGesture(minimumDistance: 15)
            .updating($slide) { g, state, _ in
                guard onDelete != nil else { return }
                // Track only once the movement is decisively horizontal (or the row was
                // already mid-slide this gesture). Vertical pans that reach here (rare —
                // the ScrollView normally claims them first) simply never engage.
                guard state != 0 || abs(g.translation.width) > abs(g.translation.height) * 1.5
                else { return }
                state = g.translation.width
            }
            .onEnded { g in
                guard onDelete != nil,
                      abs(g.translation.width) > abs(g.translation.height) * 1.5 || committed != 0
                else { return }
                let end = min(0, max(openOffset, committed + g.translation.width))
                withAnimation(snap) { committed = end < openOffset / 2 ? openOffset : 0 }
            }
    }

    private func handleSingleTap() {
        if committed != 0 { withAnimation(snap) { committed = 0 }; return }
        onTap()
    }

    private func handleDoubleTap() {
        if committed != 0 { withAnimation(snap) { committed = 0 }; return }
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

// The manual-sync-mode header affordance: a compact tri-state icon button (due/syncing/done)
// that lives inline in the header's icon row instead of a full-width row below it. `syncing`
// mirrors the real `isSyncing` flags already published by the stores; `done` is local UI state
// (`justCompleted`) that flips on the syncing→idle transition and dismisses back to `due` on tap
// — the same shape as the design's `setSt('done')`/`setSt('due')`, without ever presenting the
// dismissal itself as a data field.
struct HomeSyncButton: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var recordings: RecordingsStore
    @EnvironmentObject private var digests: DigestStore
    var action: () -> Void

    @State private var justCompleted = false

    private var isSyncing: Bool { recordings.isSyncing || digests.isSyncing }

    var body: some View {
        Button {
            if isSyncing {
                return
            } else if justCompleted {
                justCompleted = false
            } else {
                action()
            }
        } label: {
            ZStack {
                if !isSyncing && !justCompleted {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(t.accent.opacity(0.12))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.hair, lineWidth: 1))
                }
                if isSyncing {
                    ProgressView().controlSize(.mini).tint(t.accentLite)
                } else if justCompleted {
                    WIcon("cloud", size: 15, weight: .regular).foregroundStyle(t.faint)
                } else {
                    WIcon("sync", size: 16, weight: .regular).foregroundStyle(t.accentLite)
                }
            }
            .frame(width: 38, height: 38)
        }
        .buttonStyle(.plain)
        .animation(.easeInOut(duration: 0.2), value: isSyncing)
        .onChange(of: isSyncing) { was, now in
            if was && !now { justCompleted = true }
        }
        .accessibilityLabel(isSyncing ? "Syncing" : (justCompleted ? "Synced" : "Sync now"))
        .accessibilityHint("iCloud sync · \(lastSyncedLabel)")
    }

    private var lastSyncedLabel: String {
        let latest = [recordings.lastImportAt, digests.lastImportAt].compactMap { $0 }.max()
        guard let latest else { return "not synced yet on this device" }
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return "synced \(f.localizedString(for: latest, relativeTo: Date()))"
    }
}
