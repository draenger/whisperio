import SwiftUI
import WhisperioKit

// Storage & data — port of the design's storage page: what Whisperio keeps on this device,
// auto-clean rules, one-tap cleanup, and the full "Erase all data" flow with confirmation.
struct StorageView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var recordings: RecordingsStore
    @EnvironmentObject private var digests: DigestStore
    var onBack: () -> Void
    var toast: (String) -> Void = { _ in }

    @State private var audioBytes: Int64 = 0
    @State private var transcriptBytes: Int64 = 0
    @State private var summaryBytes: Int64 = 0
    @State private var eraseOpen = false
    @State private var erased = false
    // Bytes freed by "Clear old recordings" — nil until run this visit.
    @State private var clearedBytes: Int64?
    // Bytes freed by the granular "Delete audio files" / "Delete daily summaries" rows —
    // each nil until run this visit, then holds what was actually freed.
    @State private var audioDeletedBytes: Int64?
    @State private var summariesDeletedBytes: Int64?
    @State private var transcriptsDeletedBytes: Int64?
    @State private var confirmDeleteAudio = false
    @State private var confirmDeleteSummaries = false
    @State private var confirmDeleteTranscripts = false

    private var totalBytes: Int64 { audioBytes + transcriptBytes + summaryBytes }

    private var autoDeleteBinding: Binding<Bool> {
        Binding(get: { settings.settings.autoDeleteEnabled },
                set: { settings.settings.autoDeleteEnabled = $0 })
    }

    private var keepAudioBinding: Binding<Bool> {
        Binding(get: { settings.settings.keepAudioRecordings },
                set: { settings.settings.keepAudioRecordings = $0 })
    }

    private var afterDaysBinding: Binding<String> {
        Binding(get: { "\(settings.settings.autoDeleteAfterDays)d" },
                set: { settings.settings.autoDeleteAfterDays = Int($0.dropLast()) ?? 7 })
    }

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: "Storage & data", onBack: onBack)
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 16) {
                        usageCard
                        autoCleanGroup
                        cleanupGroup
                        dangerGroup
                        Text("Auto-clean runs quietly when you open Whisperio. GitHub mirrors are never touched from here.")
                            .font(WZFont.ui(13.5)).foregroundStyle(t.muted).lineSpacing(4)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(16)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
                    }
                    .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 28)
                }
            }
        }
        .sheet(isPresented: $eraseOpen) {
            EraseSheet(totalLabel: Self.format(totalBytes),
                       cloudSynced: settings.settings.storageMode == .iCloud,
                       onErase: {
                           eraseOpen = false
                           eraseAll()
                       },
                       onCancel: { eraseOpen = false })
                .environment(\.wz, t)
                #if os(iOS)
                .presentationDetents([.medium])
                #endif
        }
        .alert("Delete all audio recordings?", isPresented: $confirmDeleteAudio) {
            Button("Delete", role: .destructive) { deleteAllAudio() }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("Removes every recorded audio file on this iPhone. Transcripts stay.")
        }
        .alert("Delete all daily summaries?", isPresented: $confirmDeleteSummaries) {
            Button("Delete", role: .destructive) { deleteAllSummaries() }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("Clears every day’s AI summary from the Journal. Recordings and transcripts stay.")
        }
        .alert("Delete all transcripts?", isPresented: $confirmDeleteTranscripts) {
            Button("Delete", role: .destructive) { deleteAllTranscripts() }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("Removes the text notes; audio stays.")
        }
        .onAppear(perform: measure)
    }

    // MARK: - Usage card

    private var usageCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                SectionLabel(text: "On this iPhone")
                Spacer(minLength: 0)
                Text(Self.format(totalBytes)).font(WZFont.mono(12.5)).foregroundStyle(t.text)
            }
            GeometryReader { geo in
                HStack(spacing: 0) {
                    if totalBytes > 0 {
                        Rectangle().fill(t.accent)
                            .frame(width: geo.size.width * CGFloat(audioBytes) / CGFloat(totalBytes))
                        Rectangle().fill(Color.hex(0x3da2f7))
                            .frame(width: geo.size.width * CGFloat(transcriptBytes) / CGFloat(totalBytes))
                        Rectangle().fill(t.green)
                    } else {
                        Rectangle().fill(t.surfaceUp)
                    }
                }
            }
            .frame(height: 10)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .animation(.easeOut(duration: 0.4), value: totalBytes)
            HStack(spacing: 14) {
                legend("Audio", audioBytes, t.accent)
                legend("Transcripts", transcriptBytes, Color.hex(0x3da2f7))
                legend("Summaries", summaryBytes, t.green)
            }
        }
        .padding(16)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    private func legend(_ label: String, _ bytes: Int64, _ color: Color) -> some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label).font(WZFont.mono(11)).foregroundStyle(t.muted)
            Text(Self.format(bytes)).font(WZFont.mono(11)).foregroundStyle(t.faint)
        }
    }

    // MARK: - Auto-clean

    private var autoCleanGroup: some View {
        SettGroup(title: "Auto-clean") {
            SettRow(icon: "trash", label: "Auto-delete transcripts",
                    sub: "Erase notes & audio on a schedule") {
                WToggle(on: autoDeleteBinding)
            }
            if settings.settings.autoDeleteEnabled {
                Segmented(value: afterDaysBinding,
                          options: [(id: "1d", label: "After 1 day"),
                                    (id: "7d", label: "7 days"),
                                    (id: "30d", label: "30 days")])
                    .padding(.top, 2).padding(.bottom, 13)
                    .overlay(alignment: .bottom) { Rectangle().fill(t.lineSoft).frame(height: 1) }
            }
            SettRow(icon: "mic", label: "Keep audio recordings",
                    sub: "Off keeps only text — audio is deleted right after transcription",
                    last: true) {
                WToggle(on: keepAudioBinding)
            }
        }
    }

    // MARK: - Clean up now

    private var cleanupGroup: some View {
        SettGroup(title: "Clean up now") {
            SettRow(icon: "sync", label: "Clear recordings older than 30 days",
                    sub: clearedBytes.map { "Done — freed \(Self.format($0))" }
                        ?? "Removes old audio files; transcripts stay",
                    onTap: clearedBytes == nil ? clearOldAudio : nil) {
                if clearedBytes != nil { WIcon("check", size: 17).foregroundStyle(t.green) }
            }
            SettRow(icon: "trash",
                    label: audioDeletedBytes != nil ? "Audio files — deleted" : "Delete audio files",
                    sub: audioDeletedBytes.map { "Freed \(Self.format($0))" }
                        ?? "Keeps every transcript — only the sound files go",
                    onTap: audioDeletedBytes == nil ? { confirmDeleteAudio = true } : nil) {
                if audioDeletedBytes != nil { WIcon("check", size: 17).foregroundStyle(t.green) }
            }
            SettRow(icon: "trash",
                    label: summariesDeletedBytes != nil ? "Daily summaries — deleted" : "Delete daily summaries",
                    sub: summariesDeletedBytes.map { "Freed \(Self.format($0))" }
                        ?? "Clears the Journal digests",
                    onTap: summariesDeletedBytes == nil ? { confirmDeleteSummaries = true } : nil) {
                if summariesDeletedBytes != nil { WIcon("check", size: 17).foregroundStyle(t.green) }
            }
            SettRow(icon: "trash",
                    label: transcriptsDeletedBytes != nil ? "Transcripts — deleted" : "Delete transcripts",
                    sub: transcriptsDeletedBytes.map { "Freed \(Self.format($0))" }
                        ?? "Removes the text notes; audio stays",
                    last: true,
                    onTap: transcriptsDeletedBytes == nil ? { confirmDeleteTranscripts = true } : nil) {
                if transcriptsDeletedBytes != nil { WIcon("check", size: 17).foregroundStyle(t.green) }
            }
        }
    }

    // MARK: - Danger zone

    // Separated from "Clean up now" per design: the irreversible full wipe gets its own
    // elevated red-tinted container with a DANGER eyebrow, not just a red-tinted row.
    private var dangerGroup: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("DANGER")
                .font(WZFont.mono(11, .semibold)).tracking(0.8).foregroundStyle(t.red)
                .padding(.leading, 2)
            Button(action: { if !erased { eraseOpen = true } }) {
                HStack(spacing: 13) {
                    WIcon("trash", size: 17, weight: .regular).foregroundStyle(t.red)
                        .frame(width: 34, height: 34)
                        .background(t.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(erased ? "All data erased" : "Erase all data…")
                            .font(WZFont.ui(14.5, .semibold)).foregroundStyle(t.red)
                        Text(erased ? "This iPhone is clean" : "Transcripts, audio and summaries")
                            .font(WZFont.ui(12)).foregroundStyle(t.muted)
                    }
                    Spacer(minLength: 0)
                    if erased { WIcon("check", size: 17).foregroundStyle(t.green) }
                }
                .padding(13)
            }
            .buttonStyle(.plain)
        }
        .padding(3)
        .background(t.red.opacity(0.05), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.red.opacity(0.3), lineWidth: 1))
    }

    // MARK: - Actions

    // Audio clips are written to tmp as whisperio-<uuid>.m4a; text lives in the Documents
    // JSON stores (recordings/journal) or the SwiftData store backing CloudKit sync.
    private static var audioDir: URL { FileManager.default.temporaryDirectory }

    private func audioFiles() -> [URL] {
        (try? FileManager.default.contentsOfDirectory(at: Self.audioDir,
                                                      includingPropertiesForKeys: [.fileSizeKey]))?
            .filter { $0.lastPathComponent.hasPrefix("whisperio-") && $0.pathExtension == "m4a" } ?? []
    }

    private static func size(of url: URL) -> Int64 {
        Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
    }

    private func measure() {
        audioBytes = audioFiles().reduce(0) { $0 + Self.size(of: $1) }
        // Transcripts = every transcription + render currently in memory; Summaries = every
        // cached daily-digest summary — a fair proxy for both backends (JSON file on disk,
        // SwiftData store for CloudKit), split the same 3 ways the design's usage bar is.
        let transcriptChars = recordings.items.reduce(0) {
            $0 + ($1.transcription?.count ?? 0) + ($1.render?.count ?? 0)
        }
        transcriptBytes = Int64(transcriptChars)
        summaryBytes = Int64(digests.digests.reduce(0) { $0 + ($1.summary?.count ?? 0) })
    }

    private func clearOldAudio() {
        let cutoff = Date().addingTimeInterval(-30 * 24 * 3600)
        var freed: Int64 = 0
        let old = Set(recordings.items.filter { $0.timestamp < cutoff }.map(\.filename))
        for url in audioFiles() {
            let values = try? url.resourceValues(forKeys: [.contentModificationDateKey])
            let stale = (values?.contentModificationDate ?? .distantPast) < cutoff
            if stale || old.contains(url.lastPathComponent) {
                freed += Self.size(of: url)
                try? FileManager.default.removeItem(at: url)
            }
        }
        clearedBytes = freed
        measure()
        toast("Freed \(Self.format(freed))")
    }

    // Deletes every audio file on this iPhone — the recordings themselves (transcripts, renders,
    // categories) are untouched, only their sound files go. Confirmed via confirmDeleteAudio.
    private func deleteAllAudio() {
        var freed: Int64 = 0
        for url in audioFiles() {
            freed += Self.size(of: url)
            try? FileManager.default.removeItem(at: url)
        }
        audioDeletedBytes = freed
        measure()
        toast("Freed \(Self.format(freed))")
    }

    // Clears just the AI-written summary text (and its timestamp) off every cached daily
    // digest — the day's real recording groups/categories stay, since those are derived from
    // recordings that are still there. Confirmed via confirmDeleteSummaries.
    private func deleteAllSummaries() {
        let freed = summaryBytes
        for digest in digests.digests where digest.summary != nil {
            digests.storeComposed(DailyDigest(id: digest.id, date: digest.date,
                                               recordingIDs: digest.recordingIDs, groups: digest.groups,
                                               summary: nil, summaryGeneratedAt: nil))
        }
        summariesDeletedBytes = freed
        measure()
        toast("Freed \(Self.format(freed))")
    }

    // Clears just the transcript/render text off every recording — the recordings themselves
    // (audio, categories) stay, since only their sound files carry the actual content once the
    // notes are gone. Confirmed via confirmDeleteTranscripts. Mirrors deleteAllAudio/
    // deleteAllSummaries: the real byte accounting comes from the store, not a guess.
    private func deleteAllTranscripts() {
        let freed = recordings.clearAllTranscripts()
        transcriptsDeletedBytes = freed
        measure()
        toast("Freed \(Self.format(freed))")
    }

    private func eraseAll() {
        for r in recordings.items { recordings.delete(r) }
        digests.eraseAll()
        for url in audioFiles() { try? FileManager.default.removeItem(at: url) }
        erased = true
        audioDeletedBytes = nil
        summariesDeletedBytes = nil
        transcriptsDeletedBytes = nil
        measure()
        toast("All data erased")
    }

    static func format(_ bytes: Int64) -> String {
        guard bytes > 0 else { return "0 MB" }
        let mb = Double(bytes) / 1_048_576
        if mb < 0.1 { return String(format: "%.0f KB", max(1, Double(bytes) / 1024)) }
        if mb < 1000 { return String(format: mb < 10 ? "%.1f MB" : "%.0f MB", mb) }
        return String(format: "%.1f GB", mb / 1024)
    }
}

// "Erase everything?" — the red confirmation moment before the irreversible wipe.
struct EraseSheet: View {
    @Environment(\.wz) private var t
    let totalLabel: String
    var cloudSynced: Bool
    var onErase: () -> Void
    var onCancel: () -> Void

    private var explainer: String {
        cloudSynced
            ? "Deletes all transcripts, audio and daily summaries — \(totalLabel). iCloud sync is on, so the deletion also reaches your other devices. GitHub mirrors are not touched. This can’t be undone."
            : "Deletes all transcripts, audio and daily summaries from this iPhone — \(totalLabel). Synced copies on GitHub are not touched. This can’t be undone."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            WIcon("trash", size: 26).foregroundStyle(t.red)
                .frame(width: 56, height: 56)
                .background(t.red.opacity(0.14), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .padding(.bottom, 16)

            Text("Erase everything?")
                .font(WZFont.display(21)).foregroundStyle(t.text).padding(.bottom, 10)

            Text(explainer)
                .font(WZFont.ui(14.5)).foregroundStyle(t.muted).lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true).padding(.bottom, 22)

            Button(action: onErase) {
                HStack(spacing: 8) {
                    WIcon("trash", size: 17)
                    Text("Erase all data")
                }
                .font(WZFont.ui(15, .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(t.red, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)
            .padding(.bottom, 10)

            GhostButton(title: "Cancel", action: onCancel)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(t.bg)
    }
}
