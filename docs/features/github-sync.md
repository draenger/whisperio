# Feature — GitHub sync (mobile → Markdown in a Git repo)

## What it does

Mirrors this device's transcripts, AI renders, and daily summaries into a **GitHub repository as
Markdown files**, committed via the GitHub API. This is Whisperio's cross-ecosystem sync path (the
one that can reach Windows, unlike CloudKit): the user owns the repo, the data lands as plain files.

## User-facing flow

1. Settings → **Sync to GitHub** opens the config screen
   (`mobile/WhisperioApp/Sources/WhisperioApp/GitHubSyncView.swift:12`; routed via the `.githubSync`
   screen at `mobile/WhisperioApp/Sources/WhisperioApp/AppShell.swift:132`).
2. Enter a personal access token, owner, repo (and optional branch / path prefix). Sync becomes
   available once token + owner + repo are all present
   (`mobile/WhisperioApp/Sources/WhisperioApp/GitHubSyncView.swift:28`).
3. Tap **Sync now**; a manifest records status and the committed blob shas so the next run only pushes
   what changed (`mobile/WhisperioApp/Sources/WhisperioApp/GitHubSyncView.swift:108`).

## How it works (code path)

1. **Config + secret.** Repo coordinates live in settings — `githubSyncEnabled`, `githubOwner`,
   `githubRepo`, `githubBranch`, `githubPathPrefix`
   (`mobile/WhisperioKit/Sources/WhisperioKit/Settings.swift:54`) — while the token is stored in the
   **Keychain**, not the settings blob
   (`mobile/WhisperioKit/Sources/WhisperioKit/Keychain.swift:14`).
2. **File layout (pure).** `GitHubPaths` derives the repo paths: a per-recording folder
   (`mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/GitHubPaths.swift:53`), the recording dir
   under the prefix/category (`mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/GitHubPaths.swift:67`),
   `transcript.md` / `render.md` (`mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/GitHubPaths.swift:71`),
   and the daily synthesis path
   (`mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/GitHubPaths.swift:75`).
3. **Markdown (pure).** `MarkdownRenderer` renders a transcript
   (`mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/MarkdownRenderer.swift:24`), an AI render
   (`mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/MarkdownRenderer.swift:42`), and the day
   synthesis (`mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/MarkdownRenderer.swift:60`).
4. **Diff.** Each candidate file is hashed as a Git blob
   (`mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/GitBlob.swift:7`); `SyncPlan.build` compares
   against the known tree and emits only changed `FileChange`s
   (`mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/SyncPlan.swift:27`), from the `SyncItem` /
   `DailySynthesis` inputs (`mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/SyncModels.swift:6`,
   `mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/SyncModels.swift:44`).
5. **Commit.** `GitHubClient` reads the branch head oid
   (`mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/GitHubClient.swift:89`), verifies access
   (`mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/GitHubClient.swift:101`) and the current tree
   (`mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/GitHubClient.swift:109`), then commits the
   changed files. The screen persists the resulting manifest
   (`mobile/WhisperioApp/Sources/WhisperioApp/GitHubSyncView.swift:160`;
   `GitHubSyncManifest` at `mobile/WhisperioApp/Sources/WhisperioApp/GitHubSyncView.swift:258`,
   loaded at `mobile/WhisperioApp/Sources/WhisperioApp/GitHubSyncView.swift:285`).

## Entry points (file:line)

- `mobile/WhisperioApp/Sources/WhisperioApp/GitHubSyncView.swift:12` — the config + "Sync now" screen.
- `mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/GitHubClient.swift:63` — the GitHub API client.
- `mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/SyncPlan.swift:19` — change planning.
- `mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/GitHubPaths.swift:11` — repo path layout.
- `mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/MarkdownRenderer.swift:6` — file rendering.

## Data touched

- **Sends** transcript/render/summary Markdown to the user's own GitHub repo over HTTPS.
- **Token** lives in the Keychain (`mobile/WhisperioKit/Sources/WhisperioKit/Keychain.swift:14`);
  repo coordinates in settings (`mobile/WhisperioKit/Sources/WhisperioKit/Settings.swift:54`).
- **Manifest** (last status + committed shas) persisted locally
  (`mobile/WhisperioApp/Sources/WhisperioApp/GitHubSyncView.swift:258`).

## Edge cases

- **Incomplete config** — sync stays disabled until token + owner + repo are set
  (`mobile/WhisperioApp/Sources/WhisperioApp/GitHubSyncView.swift:28`).
- **Nothing changed** — `SyncPlan` emits no `FileChange`s, so an unchanged run commits nothing
  (`mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/SyncPlan.swift:58`).
- **API errors** — surfaced as typed `GitHubError`s
  (`mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/GitHubClient.swift:40`).

## Related tests

- `mobile/WhisperioKit/Tests/WhisperioKitTests/GitHubSyncTests.swift:1` — path layout, blob hashing,
  Markdown rendering, and change planning.
