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
    var openRec: (DemoRecording) -> Void
    var openRecording: () -> Void
    var openSettings: () -> Void
    var openJournal: () -> Void = {}

    // nil → the "All" filter (show every category).
    @State private var selectedCategory: String? = nil

    var body: some View {
        ScreenScaffold {
            ZStack(alignment: .bottom) {
                VStack(spacing: 0) {
                    WHeader(title: "Whisperio") {
                        HStack(spacing: 9) {
                            HeaderSyncGlyph()
                            SquareIconButton(icon: "book", action: openJournal)
                            SquareIconButton(icon: "settings", action: openSettings)
                        }
                    }
                    // search + filters
                    VStack(spacing: 13) {
                        HStack(spacing: 9) {
                            WIcon("search", size: 17, weight: .regular)
                            Text("Search transcripts").font(WZFont.ui(14.5))
                            Spacer()
                        }
                        .foregroundStyle(t.faint)
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
                                .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 140)
                            }
                        }
                    }
                }
                micDock
            }
        }
    }

    // The recordings that match the active category filter (All → everything). Category is
    // resolved through the store so live reassignments in Detail move rows between filters.
    private var visibleItems: [Recording] {
        guard let selectedCategory else { return recordings.items }
        return recordings.items.filter {
            recordings.categoryId(for: DemoRecording($0)) == selectedCategory
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
                        .padding(.horizontal, 14)
                    if idx < recs.count - 1 { Divider().overlay(t.lineSoft) }
                }
            }
            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
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

    private var micDock: some View {
        ZStack(alignment: .bottom) {
            LinearGradient(colors: [t.bg.opacity(0), t.bg], startPoint: .top, endPoint: .bottom)
                .frame(height: 190)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .ignoresSafeArea(edges: .bottom)
            Button(action: openRecording) {
                WIcon("mic", size: 28, weight: .bold).foregroundStyle(.white)
                    .frame(width: 72, height: 72)
                    .background(t.gradient, in: Circle())
                    .overlay(Circle().stroke(t.accent.opacity(t.dark ? 0.12 : 0.08), lineWidth: 6))
                    .shadow(color: t.accent.opacity(0.72), radius: 22, y: 24)
            }
            .buttonStyle(.plain)
            .padding(.bottom, 22)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
    }
}

// A recording row (port of RecRow).
struct RecRow: View {
    @Environment(\.wz) private var t
    let r: DemoRecording
    var category: WZCategory? = nil
    var onTap: () -> Void
    var onDelete: (() -> Void)? = nil
    @State private var copied = false

    private var srcIcon: String {
        switch r.src {
        case "watch": return "watch"; case "action": return "bolt"
        case "backtap": return "command"; case "keyboard": return "keyboard"
        default: return "mic"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            Button(action: onTap) {
                HStack(alignment: .top, spacing: 13) {
                    WIcon(srcIcon, size: 17, weight: .regular).foregroundStyle(t.accentLite)
                        .frame(width: 38, height: 38)
                        .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
                    VStack(alignment: .leading, spacing: 7) {
                        Text(r.title).font(WZFont.ui(14.5, .medium)).foregroundStyle(t.text)
                            .lineLimit(2).multilineTextAlignment(.leading).lineSpacing(2)
                        if let category {
                            CategoryTag(category: category)
                        }
                        HStack(spacing: 8) {
                            Text(r.app).foregroundStyle(t.muted)
                            Text("·"); Text(r.when); Text("·"); Text(r.dur)
                            Spacer(minLength: 0)
                            WIcon(r.engine == "cloud" ? "cloud" : "lock", size: 12, weight: .regular)
                                .foregroundStyle(r.engine == "cloud" ? t.amber : t.green)
                        }
                        .font(WZFont.mono(11)).foregroundStyle(t.faint)
                    }
                }
            }
            .buttonStyle(.plain)
            copyButton
        }
        .padding(.vertical, 13)
        .contextMenu {
            Button {
#if canImport(UIKit)
                UIPasteboard.general.string = r.title
#elseif canImport(AppKit)
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(r.title, forType: .string)
#endif
            } label: { Label("Copy", systemImage: "doc.on.doc") }
            if let onDelete {
                Button(role: .destructive, action: onDelete) {
                    Label("Delete", systemImage: "trash")
                }
            }
        }
    }

    private var copyButton: some View {
        Button {
#if canImport(UIKit)
            UIPasteboard.general.string = r.title
            UINotificationFeedbackGenerator().notificationOccurred(.success)
#elseif canImport(AppKit)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(r.title, forType: .string)
#endif
            copied = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { copied = false }
        } label: {
            WIcon(copied ? "check" : "copy", size: 16, weight: .regular)
                .foregroundStyle(copied ? t.green : t.accentLite)
                .frame(width: 36, height: 36)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(t.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}
