import SwiftUI
import WhisperioKit

// Journal — the book library (port of PhoneJournal's library + book view). The shelf splits into
// two labeled sections per the wz2 design: "Automatic journals" (bound for you — derived live from
// the recordings: This week, one book per month, and topic auto-books that collect a category) and
// "Manual journals" (user-created notebooks; the dashed "New book" tile lives only here). Opening a
// book shows its chapters of day pages — the same day-digest cards as before: day title, category
// tags, note count, and either a "ready" check or a "Generate summary" call to action. Tapping a
// day card opens DigestDayView for that day. Reuses the same StyleKit surfaces as Home.
struct JournalView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var recordings: RecordingsStore
    @EnvironmentObject private var digests: DigestStore
    @EnvironmentObject private var settings: SettingsStore
    var onBack: () -> Void
    var openDay: (Date) -> Void
    // New page (journal composer) — the book view's + menu, per PhoneJournal's onAdd.
    var onAdd: () -> Void = {}
    // Today's page routes to the live running note (Scratchpad) instead of the generic digest —
    // per PhoneJournal's onToday. Defaults to a no-op for previews/galleries; AppShell wires the
    // real route.
    var onOpenToday: () -> Void = {}

    // Which book is open; nil → the library shelf. Ids are stable across re-derivation.
    @State private var openBookID: String? = nil
    // Manual notebooks persist as JSON (title + chapter names). Their pages are the shared day
    // pages and aren't bound to a notebook yet, so a fresh notebook matches the mock's empty state.
    @AppStorage("journal.manualBooks") private var manualBooksData = Data()

    var body: some View {
        ScreenScaffold {
            if let book = currentBook {
                bookView(book)
            } else {
                libraryView
            }
        }
    }

    // MARK: - Library (shelf)

    private var libraryView: some View {
        VStack(spacing: 0) {
            WHeader(title: "Journal", onBack: onBack)
            Text("Your notes, bound into books — by week, month or topic.")
                .font(WZFont.mono(10.5)).foregroundStyle(t.faint)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20).padding(.bottom, 8)
            if !shelfBooks.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 7) {
                        ForEach(shelfBooks) { book in
                            Button { openBookID = book.id } label: {
                                HStack(spacing: 6) {
                                    RoundedRectangle(cornerRadius: 2).fill(book.spine).frame(width: 10, height: 3)
                                    Text(book.title)
                                }
                                .font(WZFont.ui(11.5, .semibold))
                                .foregroundStyle(t.muted)
                                .padding(.horizontal, 11).padding(.vertical, 6)
                                .background(t.surface, in: Capsule())
                                .overlay(Capsule().stroke(t.line, lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 14)
                }
                .padding(.bottom, 6)
            }
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    bookSection("Automatic journals",
                                hint: "Bound for you — by week, month and topic",
                                books: automaticBooks, withNewBookTile: false)
                    bookSection("Manual journals",
                                hint: "Your own notebooks — pages, chapters, whatever you need",
                                books: manualJournalBooks, withNewBookTile: true)
                }
                .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 30)
            }
            // Re-reads whatever CloudKit has already imported locally for the journal —
            // same recourse Home's pull-to-refresh gives the recordings list.
            .refreshable { digests.requestCloudRefresh() }
        }
    }

    // A labeled shelf section: SectionLabel + faint mono hint on one baseline, then the 2-up grid.
    // The dashed "New book" tile is appended only under Manual journals.
    private func bookSection(_ label: String, hint: String,
                             books: [JournalBook], withNewBookTile: Bool) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                SectionLabel(text: label)
                Text(hint).font(WZFont.mono(9.5)).foregroundStyle(t.faint)
            }
            .padding(.leading, 4)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible())],
                      spacing: 12) {
                ForEach(books) { bookTile($0) }
                if withNewBookTile { newBookTile }
            }
        }
    }

    private func bookTile(_ book: JournalBook) -> some View {
        Button { openBookID = book.id } label: {
            HStack(spacing: 0) {
                // Book-edge illusion: a 7pt spine bar plus a 1pt paper highlight.
                Rectangle().fill(book.spine).frame(width: 7)
                Rectangle().fill(Color.white.opacity(0.14)).frame(width: 1)
                VStack(alignment: .leading, spacing: 0) {
                    WIcon("book", size: 17, weight: .regular).foregroundStyle(book.spine)
                    Spacer(minLength: 0)
                    Text(book.title)
                        .font(WZFont.display(17, .semibold)).foregroundStyle(t.text)
                        .lineLimit(2).multilineTextAlignment(.leading)
                    Text(book.sub)
                        .font(WZFont.mono(10)).foregroundStyle(t.faint)
                        .lineLimit(1).padding(.top, 4)
                    HStack(spacing: 6) {
                        Text("\(book.chapters.count) chapter\(book.chapters.count == 1 ? "" : "s")")
                            .font(WZFont.mono(9.5)).foregroundStyle(t.muted)
                        Spacer(minLength: 0)
                        Text("\(book.noteCount) note\(book.noteCount == 1 ? "" : "s")")
                            .font(WZFont.mono(9.5, .semibold)).foregroundStyle(book.spine)
                    }
                    .padding(.top, 9)
                }
                .padding(EdgeInsets(top: 16, leading: 12, bottom: 14, trailing: 14))
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(height: 170)
            .background(t.surface)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(t.line, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var newBookTile: some View {
        Button(action: addBook) {
            VStack(spacing: 8) {
                WIcon("plus", size: 20, weight: .regular)
                Text("New book").font(WZFont.ui(12.5, .semibold))
            }
            .foregroundStyle(t.faint)
            .frame(maxWidth: .infinity)
            .frame(height: 170)
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(t.line, style: StrokeStyle(lineWidth: 1.5, dash: [5, 5])))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Book view (chapters of day pages)

    private func bookView(_ book: JournalBook) -> some View {
        VStack(spacing: 0) {
            WHeader(title: book.title, onBack: { openBookID = nil }) {
                Menu {
                    Button(action: onAdd) { Label("New page", systemImage: "pencil") }
                    if book.isCustom {
                        Button { addChapter(to: book) } label: {
                            Label("New chapter", systemImage: "book.closed")
                        }
                    }
                } label: {
                    WIcon("plus", size: 17, weight: .regular)
                        .foregroundStyle(t.muted)
                        .frame(width: 38, height: 38)
                        .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 3).fill(book.spine).frame(width: 26, height: 5)
                Text(book.sub + (book.categoryID.map { " · auto-collects #\($0)" } ?? ""))
                    .font(WZFont.mono(10.5)).foregroundStyle(t.faint)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 20).padding(.bottom, 8)
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(book.chapters) { chapterSection($0) }
                }
                .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 30)
            }
            .refreshable { digests.requestCloudRefresh() }
        }
    }

    private func chapterSection(_ chapter: JournalBook.Chapter) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 8) {
                Text(chapter.title.uppercased())
                    .font(WZFont.mono(10.5, .semibold)).tracking(1.26).foregroundStyle(t.muted)
                Rectangle().fill(t.lineSoft).frame(height: 1).frame(maxWidth: .infinity)
                Text("\(chapter.days.count) page\(chapter.days.count == 1 ? "" : "s")")
                    .font(WZFont.mono(9.5)).foregroundStyle(t.faint)
            }
            .padding(.leading, 4)
            if chapter.days.isEmpty {
                Button(action: onAdd) {
                    HStack(spacing: 7) {
                        WIcon("plus", size: 14, weight: .regular)
                        Text("Add the first page")
                    }
                    .font(WZFont.ui(12.5)).foregroundStyle(t.faint)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 18).padding(.horizontal, 14)
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(t.line, style: StrokeStyle(lineWidth: 1.5, dash: [5, 5])))
                    .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
            } else {
                ForEach(chapter.days, id: \.key) { dayCard($0) }
            }
        }
    }

    // MARK: - Books model

    // A shelf book: automatic ones are derived live from the recordings; manual ones come from the
    // persisted notebooks. Topic auto-books carry the category they collect (their day pages hold
    // only that category's notes).
    private struct JournalBook: Identifiable {
        struct Chapter: Identifiable {
            let id: String
            let title: String
            let days: [JournalDay]
        }
        let id: String
        let title: String
        let sub: String
        let spine: Color
        let categoryID: String?
        let isCustom: Bool
        let chapters: [Chapter]
        var noteCount: Int {
            chapters.reduce(0) { $0 + $1.days.reduce(0) { $0 + $1.recs.count } }
        }
    }

    // System-bound books: "This week", one per month with journaled days (chapters by week), and a
    // topic auto-book per category that has notes.
    private var automaticBooks: [JournalBook] {
        let all = days
        guard !all.isEmpty else { return [] }
        let cal = Calendar.current
        let now = Date()
        var books: [JournalBook] = []

        let weekDays = all.filter { cal.isDate($0.date, equalTo: now, toGranularity: .weekOfYear) }
        if !weekDays.isEmpty {
            let notes = weekDays.reduce(0) { $0 + $1.recs.count }
            books.append(JournalBook(
                id: "week", title: "This week",
                sub: "\(weekDays.count) day\(weekDays.count == 1 ? "" : "s") · \(notes) note\(notes == 1 ? "" : "s")",
                spine: t.accent, categoryID: nil, isCustom: false,
                chapters: [.init(id: "days", title: "Days", days: weekDays)]))
        }

        let byMonth = Dictionary(grouping: all) { day -> String in
            let c = cal.dateComponents([.year, .month], from: day.date)
            return String(format: "%04d-%02d", c.year ?? 0, c.month ?? 0)
        }
        for (key, monthDays) in byMonth.sorted(by: { $0.key > $1.key }) {
            let sample = monthDays[0].date
            let f = DateFormatter()
            f.dateFormat = cal.isDate(sample, equalTo: now, toGranularity: .year) ? "MMMM" : "MMMM yyyy"
            let byWeek = Dictionary(grouping: monthDays) { cal.component(.weekOfYear, from: $0.date) }
            let chapters = byWeek.sorted { $0.key > $1.key }.map { week, weekDays in
                JournalBook.Chapter(id: "w\(week)", title: "Week \(week)",
                                    days: weekDays.sorted { $0.key > $1.key })
            }
            books.append(JournalBook(
                id: "month-\(key)", title: f.string(from: sample),
                sub: "\(monthDays.count) day\(monthDays.count == 1 ? "" : "s")",
                spine: cal.isDate(sample, equalTo: now, toGranularity: .month) ? .hex(0x3da2f7) : .hex(0x8a9bb0),
                categoryID: nil, isCustom: false, chapters: chapters))
        }

        for cat in WZCategories.all(with: settings.settings) {
            let catDays = all.compactMap { day -> JournalDay? in
                let recs = day.recs.filter { $0.category == cat.id }
                return recs.isEmpty ? nil : JournalDay(key: day.key, date: day.date, recs: recs)
            }
            guard !catDays.isEmpty else { continue }
            let notes = catDays.reduce(0) { $0 + $1.recs.count }
            books.append(JournalBook(
                id: "cat-\(cat.id)", title: cat.label,
                sub: "auto-book · \(notes) note\(notes == 1 ? "" : "s")",
                spine: cat.hue(t), categoryID: cat.id, isCustom: false,
                chapters: [.init(id: "days", title: "Days", days: catDays)]))
        }
        return books
    }

    // Persisted manual notebooks (title + chapter names only).
    private struct ManualBook: Codable, Identifiable {
        var id: UUID
        var title: String
        var chapters: [String]
    }

    private var manualBooks: [ManualBook] {
        (try? JSONDecoder().decode([ManualBook].self, from: manualBooksData)) ?? []
    }

    private func saveManualBooks(_ books: [ManualBook]) {
        manualBooksData = (try? JSONEncoder().encode(books)) ?? Data()
    }

    private var manualJournalBooks: [JournalBook] {
        manualBooks.map { mb in
            JournalBook(
                id: "manual-\(mb.id.uuidString)", title: mb.title, sub: "empty",
                spine: t.accentLite, categoryID: nil, isCustom: true,
                chapters: mb.chapters.enumerated().map { i, title in
                    .init(id: "c\(i)", title: title, days: [])
                })
        }
    }

    // Both automatic and manual books together — the combined list the chip row and the
    // current-book lookup both need.
    private var shelfBooks: [JournalBook] { automaticBooks + manualJournalBooks }

    private var currentBook: JournalBook? {
        guard let openBookID else { return nil }
        return shelfBooks.first { $0.id == openBookID }
    }

    private func addBook() {
        let n = manualBooks.count + 1
        let book = ManualBook(id: UUID(), title: "Notebook \(n)", chapters: ["Chapter 1"])
        saveManualBooks(manualBooks + [book])
        openBookID = "manual-\(book.id.uuidString)"
    }

    private func addChapter(to book: JournalBook) {
        var books = manualBooks
        guard let i = books.firstIndex(where: { "manual-\($0.id.uuidString)" == book.id }) else { return }
        books[i].chapters.append("Chapter \(books[i].chapters.count + 1)")
        saveManualBooks(books)
    }

    // MARK: - Day pages

    // A day that has notes: its key (YYYY-MM-DD), a representative date, and its recordings.
    private struct JournalDay { let key: String; let date: Date; let recs: [Recording] }

    // Completed recordings bucketed by calendar day, newest day first.
    private var days: [JournalDay] {
        let cal = Calendar.current
        let completed = recordings.items.filter { $0.status == .completed }
        return DigestGrouping.bucketByDay(completed, calendar: cal)
            .map { key, recs in JournalDay(key: key, date: recs.map(\.timestamp).max() ?? Date(), recs: recs) }
            .sorted { $0.key > $1.key }
    }

    // Today's page is a distinct "running note" shortcut into Scratchpad rather than the generic
    // digest card every other day gets — same live take count, primary-colored badge and
    // uppercase eyebrow the design uses for it (mob-screens.jsx pageCard('today')).
    private func todayCard(_ day: JournalDay) -> some View {
        Button(action: onOpenToday) {
            HStack(spacing: 11) {
                WIcon("pencil", size: 16, weight: .semibold)
                    .foregroundStyle(t.primaryInk)
                    .frame(width: 36, height: 36)
                    .background(t.primary, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text("TODAY · RUNNING NOTE")
                        .font(WZFont.mono(9.5, .semibold)).tracking(1.1).foregroundStyle(t.accentLite)
                    Text("\(day.recs.count) take\(day.recs.count == 1 ? "" : "s") so far — open to continue")
                        .font(WZFont.ui(13)).foregroundStyle(t.text)
                }
                Spacer(minLength: 0)
                WIcon("chevR", size: 15).foregroundStyle(t.faint)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(t.hair, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private func dayCard(_ day: JournalDay) -> some View {
        if Calendar.current.isDateInToday(day.date) {
            todayCard(day)
        } else {
            genericDayCard(day)
        }
    }

    private func genericDayCard(_ day: JournalDay) -> some View {
        let cats = categories(in: day.recs)
        let ready = digests.digest(for: day.key)?.summary?.isEmpty == false
        return Button { openDay(day.date) } label: {
            VStack(alignment: .leading, spacing: 9) {
                HStack {
                    SectionLabel(text: JournalFormat.dayTitle(day.date))
                    Spacer(minLength: 0)
                    Text("\(day.recs.count) note\(day.recs.count == 1 ? "" : "s")")
                        .font(WZFont.mono(10.5)).foregroundStyle(t.faint)
                }
                if !cats.isEmpty {
                    FlowLayout(spacing: 6) {
                        ForEach(cats) { CategoryTag(category: $0) }
                    }
                }

                if ready {
                    HStack(spacing: 7) {
                        WIcon("check", size: 13).foregroundStyle(t.green)
                        Text("Summary ready").font(WZFont.mono(11, .semibold)).foregroundStyle(t.green)
                        Spacer(minLength: 0)
                        if let at = digests.digest(for: day.key)?.summaryGeneratedAt {
                            Text(JournalFormat.generatedMeta(at)).font(WZFont.mono(10.5)).foregroundStyle(t.faint)
                        }
                    }
                } else {
                    HStack(spacing: 6) {
                        WIcon("spark", size: 13)
                        Text("Generate summary").font(WZFont.mono(11, .semibold))
                        WIcon("chevR", size: 13)
                    }
                    .foregroundStyle(t.accentLite)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(14)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    // The known categories present among a day's notes, in the canonical display order.
    private func categories(in recs: [Recording]) -> [WZCategory] {
        let cats = WZCategories.all(with: settings.settings)
        let present = Set(DigestGrouping.groupByCategory(recs, order: cats.map(\.id)).map(\.categoryID))
        return cats.filter { present.contains($0.id) }
    }
}

// Shared day/meta formatting for the journal screens.
enum JournalFormat {
    static func dayTitle(_ date: Date) -> String {
        let cal = Calendar.current
        if cal.isDateInToday(date) { return "Today" }
        if cal.isDateInYesterday(date) { return "Yesterday" }
        let f = DateFormatter()
        f.dateFormat = "EEE, MMM d"
        return f.string(from: date)
    }

    static func generatedMeta(_ date: Date) -> String {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return "Generated \(f.localizedString(for: date, relativeTo: Date()))"
    }
}
