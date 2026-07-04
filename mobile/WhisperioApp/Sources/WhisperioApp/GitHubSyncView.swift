import SwiftUI
import WhisperioKit

// Sync to GitHub — mirror this device's transcripts, AI renders, and daily summaries into a Git
// repo as Markdown. Reached from Settings ("Sync to GitHub"). The pure sync engine (paths, blob
// diffing, the GraphQL commit) lives in WhisperioKit/GitHubSync; this screen owns the config UI,
// the consent reminder, and a small local manifest for idempotency + last-synced status.
//
// Everything here is BYO: the personal access token is Keychain-backed (scrubbed from the settings
// blob by SettingsStore) and nothing leaves the device until the user taps Sync.

struct GitHubSyncView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var recordings: RecordingsStore
    @EnvironmentObject private var digests: DigestStore
    var onBack: () -> Void
    var toast: (String) -> Void = { _ in }

    @State private var manifest = GitHubSyncManifest.load()
    @State private var syncing = false     // a "Sync now" commit is in flight
    @State private var testing = false     // a "Test connection" probe is in flight

    // Enabled once the token + owner + repo are all present — mirrors `makeGitHubSync()`'s gate so
    // the actions stay disabled until a request could actually succeed.
    private var isConfigured: Bool {
        let s = settings.settings
        return !s.githubToken.trimmingCharacters(in: .whitespaces).isEmpty
            && !s.githubOwner.trimmingCharacters(in: .whitespaces).isEmpty
            && !s.githubRepo.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private var busy: Bool { syncing || testing }

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: "Sync to GitHub", onBack: onBack)
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 18) {
                        // Repository config — the token is a secret (Keychain-backed), the rest are
                        // plain fields matching the cloud-engine key entry area in Settings.
                        VStack(alignment: .leading, spacing: 9) {
                            SectionLabel(text: "Repository").padding(.leading, 4)
                            keyField("Personal access token", binding(\.githubToken))
                            plainField("Owner (user or org)", "octocat", binding(\.githubOwner))
                            plainField("Repository", "notes", binding(\.githubRepo))
                            plainField("Branch", "main", binding(\.githubBranch))
                            plainField("Folder (optional)", "whisperio", binding(\.githubPathPrefix))
                        }

                        SettGroup(title: "Status") {
                            SettRow(icon: "sync", label: "Last synced", sub: statusSubtitle, last: true) {
                                Circle().fill(statusColor).frame(width: 10, height: 10)
                            }
                        }

                        VStack(spacing: 10) {
                            GradButton(title: syncing ? "Syncing…" : "Sync now", icon: "sync") { syncNow() }
                                .disabled(!isConfigured || busy)
                                .opacity(isConfigured && !busy ? 1 : 0.5)
                            GhostButton(title: testing ? "Testing…" : "Test connection", icon: "shield") { testConnection() }
                                .disabled(!isConfigured || busy)
                                .opacity(isConfigured && !busy ? 1 : 0.5)
                        }

                        Text("Syncing uploads your transcripts, AI renders & daily summaries to GitHub — they leave this device.")
                            .font(WZFont.ui(12.5)).foregroundStyle(t.muted).lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, 4)
                    }
                    .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 28)
                }
            }
        }
    }

    // MARK: - Status row

    private var statusColor: Color {
        switch manifest.lastStatus {
        case .synced, .upToDate: return t.green
        case .failed:            return t.red
        case nil:                return t.faint
        }
    }

    private var statusSubtitle: String {
        guard let at = manifest.lastSyncedAt else { return "Never synced" }
        let when = Self.relativeFormatter.localizedString(for: at, relativeTo: Date())
        switch manifest.lastStatus {
        case .failed: return "Last attempt failed \(when)"
        default:      return "Synced \(when)"
        }
    }

    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f
    }()

    // MARK: - Actions

    // Commit every completed recording (transcript + optional render) and each summarized day to the
    // repo in one atomic commit. Idempotent: the local manifest's blob shas are merged with the live
    // repo tree so unchanged files are skipped (SyncPlan diffs on git blob sha).
    private func syncNow() {
        guard let client = settings.makeGitHubSync() else { return }
        let items = recordings.items
            .filter { $0.status == .completed
                && !($0.transcription ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .map(SyncItem.init)
        let syntheses = digests.digests.compactMap(DailySynthesis.init)
        let prefix = settings.settings.githubPathPrefix
        let known = manifest.blobShas
        syncing = true
        Task {
            do {
                let head = try await client.headOid()
                var remote = known
                for (path, sha) in try await client.remoteBlobShas(prefix: prefix) { remote[path] = sha }
                let changes = SyncPlan.build(items: items, syntheses: syntheses,
                                             prefix: prefix, remoteBlobShas: remote)
                if changes.isEmpty {
                    for c in changes { remote[c.path] = c.blobSha }
                    finish(status: .upToDate, shas: remote, message: "Already up to date")
                    return
                }
                let msg = "Sync \(changes.count) file\(changes.count == 1 ? "" : "s") from Whisperio"
                _ = try await client.createCommit(expectedHeadOid: head, changes: changes, message: msg)
                var updated = remote
                for c in changes { updated[c.path] = c.blobSha }
                finish(status: .synced, shas: updated,
                       message: "Synced \(changes.count) file\(changes.count == 1 ? "" : "s")")
            } catch {
                finish(status: .failed, shas: nil, message: "Sync failed: \(Self.describe(error))")
            }
        }
    }

    // Probe read access to the repo (GET /repos/{owner}/{repo}) so the user can validate their token
    // + owner/repo before a first sync, without writing anything.
    private func testConnection() {
        guard let client = settings.makeGitHubSync() else { return }
        testing = true
        Task {
            do {
                let name = try await client.checkAccess()
                await MainActor.run { testing = false; toast("Connected · \(name)") }
            } catch {
                await MainActor.run { testing = false; toast("Failed: \(Self.describe(error))") }
            }
        }
    }

    // Persist the outcome to the manifest and surface a toast. `shas` nil on failure keeps the last
    // known idempotency map intact so a transient error doesn't force a full re-commit next time.
    @MainActor
    private func finish(status: GitHubSyncManifest.Status, shas: [String: String]?, message: String) {
        syncing = false
        manifest.lastStatus = status
        manifest.lastSyncedAt = Date()
        if let shas { manifest.blobShas = shas }
        manifest.save()
        toast(message)
    }

    // Compact, human-facing message for the toast — GitHubError carries a status + body we surface
    // tersely; anything else falls back to its localized description.
    private static func describe(_ error: Error) -> String {
        switch error {
        case GitHubError.http(let status, _) where status == 401: return "bad token"
        case GitHubError.http(let status, _) where status == 404: return "repo not found"
        case GitHubError.http(let status, _): return "HTTP \(status)"
        case GitHubError.noResponse, GitHubError.invalidURL: return "no response"
        default: return (error as NSError).localizedDescription
        }
    }

    // MARK: - Field helpers (mirror SettingsView's key/plain field styling)

    private func keyField(_ label: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionLabel(text: label).padding(.leading, 4)
            SecureField("paste token…", text: text)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .font(WZFont.mono(13))
                .padding(.horizontal, 13).padding(.vertical, 12)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
        }
        .padding(.top, 2)
    }

    private func plainField(_ label: String, _ placeholder: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionLabel(text: label).padding(.leading, 4)
            TextField(placeholder, text: text)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .font(WZFont.mono(13))
                .padding(.horizontal, 13).padding(.vertical, 12)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
        }
        .padding(.top, 2)
    }

    private func binding(_ keyPath: WritableKeyPath<WhisperioSettings, String>) -> Binding<String> {
        Binding(get: { settings.settings[keyPath: keyPath] },
                set: { var s = settings.settings; s[keyPath: keyPath] = $0; settings.settings = s })
    }
}

// MARK: - Recording / digest → sync model mappers

extension SyncItem {
    /// Flatten a persisted `Recording` into the sync shape. `categoryId` keeps the recording's own
    /// id (it drives the repo folder), while `categoryLabel` is resolved through the app taxonomy
    /// (`WZCategories.of`, which falls back to Work) for the frontmatter/UI.
    init(_ r: Recording) {
        let categoryId = r.category ?? WZCategories.work.id
        self.init(id: r.id,
                  categoryId: categoryId,
                  categoryLabel: WZCategories.of(categoryId).label,
                  timestamp: r.timestamp,
                  provider: r.provider,
                  transcript: r.transcription ?? "",
                  aiRender: r.render,
                  duration: r.duration)
    }
}

extension DailySynthesis {
    /// A day's digest becomes a synthesis only once it has a non-empty summary — otherwise nil so
    /// the caller skips it (mirrors `MarkdownRenderer` skipping an empty render).
    init?(_ d: DailyDigest) {
        guard let summary = d.summary,
              !summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        self.init(date: d.date, body: summary, sourceIds: d.recordingIDs)
    }
}

// MARK: - Local sync manifest

/// Small on-device record of the last sync: when it ran, whether it succeeded, and the git blob
/// shas of everything mirrored so far. The shas feed `SyncPlan` so an unchanged file is never
/// re-committed (idempotency); the timestamp + status drive the Status row. Persisted as JSON in
/// Documents alongside recordings.json / journal.json.
struct GitHubSyncManifest: Codable, Equatable {
    enum Status: String, Codable { case synced, upToDate, failed }

    var lastSyncedAt: Date?
    var lastStatus: Status?
    var blobShas: [String: String]

    init(lastSyncedAt: Date? = nil, lastStatus: Status? = nil, blobShas: [String: String] = [:]) {
        self.lastSyncedAt = lastSyncedAt
        self.lastStatus = lastStatus
        self.blobShas = blobShas
    }

    // Tolerant decoding — a legacy/partial blob missing any field falls back to a default instead of
    // throwing, so a stored manifest is never lost (mirrors the kit's Codable house style).
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        lastSyncedAt = try c.decodeIfPresent(Date.self, forKey: .lastSyncedAt)
        lastStatus = try c.decodeIfPresent(Status.self, forKey: .lastStatus)
        blobShas = try c.decodeIfPresent([String: String].self, forKey: .blobShas) ?? [:]
    }

    private static var fileURL: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent("github-sync-manifest.json")
    }

    static func load() -> GitHubSyncManifest {
        guard let data = try? Data(contentsOf: fileURL),
              let m = try? JSONDecoder().decode(GitHubSyncManifest.self, from: data) else {
            return GitHubSyncManifest()
        }
        return m
    }

    func save() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        try? data.write(to: Self.fileURL, options: [.atomic])
    }
}
