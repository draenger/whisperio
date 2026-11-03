# Zero-config local STT on macOS and Linux: Parakeet V3 vs whisper.cpp

Status: SPEC / draft for review. No code in this change. Written 2026-11-01 against `origin/main` @ 02ac773 (desktop 1.5.1).

Legend: **[V]** verified from a primary source fetched 2026-11-01 (URL given). **[3P]** third-party / vendor measurement. **[U]** unverified, must be checked before relying on it.

## 1. Goal and non-goals

**Goal.** A user on macOS (arm64 and x64) or Linux (x64, optionally arm64) installs Whisperio, opens Settings, picks "On-device", accepts one model download, and dictates with no API key, no server URL and no manual install. Works with Wi-Fi off after the download.

**Non-goals.**
- No change to the Windows path (bundled whisper-server stays as is).
- No streaming / partial results (the app transcribes a finished clip).
- No new cloud behavior, no telemetry.
- No GPU/CoreML tuning in v1.
- No replacement of the `selfhosted` provider; it stays the escape hatch for power users.
- No implementation in this PR.

## 2. Where we are today (grounded in code)

| Fact | Evidence |
|---|---|
| The only bundled local engine is whisper.cpp `whisper-server`, pinned `v1.8.4`, downloaded from the upstream `whisper-bin-x64.zip` (a Windows asset). | `desktop/src/main/localServer.ts:6-7` |
| Everything else is Windows-gated: binary availability, download, and start all test `process.platform === 'win32'`. Non-Windows throws "Install whisper-server manually." | `localServer.ts:140-147`, `localServer.ts:197-200` |
| Extraction is a PowerShell one-liner and the exe is `whisper-server.exe`. | `localServer.ts:109-111`, `localServer.ts:157-178` |
| The server runs on fixed port 8178, host 127.0.0.1, and readiness is a regex on stdout. | `localServer.ts:8`, `:19-27`, `:226-231` |
| Idle unload: 15 min TTL, 60 s sweep; `markServerUsed()` is called on every `dictation:transcribe`. | `localServer.ts:16-17`, `:50-52`, `:83-93`; `desktop/src/main/index.ts:330-334` |
| IPC surface: `server:status/start/stop`. | `index.ts:449-460` (`startServer` at `:455`) |
| Model catalog is six GGML files from `huggingface.co/ggerganov/whisper.cpp` (tiny 75 MB ... large-v3 3.1 GB; large-v3-turbo is listed as 1.6 GB, "Recommended"). | `desktop/src/main/modelManager.ts:30-84` |
| Download integrity is size-only: Content-Length vs received bytes, then on-disk size, then atomic rename. There is **no SHA-256 / signature check** anywhere in `modelManager.ts` or `localServer.ts` (grep for sha/createHash: no match). | `modelManager.ts:347-373` |
| Model path confinement: `resolveModelFile` accepts only a plain `*.bin` basename inside `userData/models`. A multi-file ONNX model does not fit this resolver. | `modelManager.ts:120-131` |
| Custom model URLs must be https (http only for loopback/private). Reusable for any new download. | `modelManager.ts:429-441` |
| Provider ids are a closed union; `selfhosted` is labelled "Local Model". | `desktop/src/main/settingsManager.ts:9-17`; `transcribe.ts:84-87` |
| Chain resolution: `providerChain`, else legacy `sttProvider` + optional fallback; unconfigured providers are filtered; per-hop failures notify and fall through. | `transcribe.ts:456-501` |
| `selfhosted` is "configured" iff `openaiBaseUrl` is non-empty; it POSTs to `/inference` (whisper.cpp) or `/v1/audio/transcriptions`, sends `prompt` (user prompt + vocabulary) and `language`. | `transcribe.ts:515`, `:558-592`, `:678-717`, `:532-538` |
| Usage metering marks only `selfhosted` as local (cost forced to 0). A new local provider must be added here or it will be costed as cloud. | `transcribe.ts:489` |
| Packaging: mac builds x64+arm64 zip+dmg, hardened runtime + notarize, custom entitlements; Linux builds AppImage + deb x64 only; `asarUnpack` currently lists only koffi and active-win. | `.devops/electron-builder.yml:8-14`, `:50-81`, `:82-91` |
| PARITY states the gap: "zero-config bundled server mac/Linux = Phase 2". | `docs/PARITY.md:20` |
| Our own comparison ranks this as improvement #4 (size L) and notes Handy's `transcribe-rs` is MIT. | `C:/Users/dkwar/bees/ops/handy-vs-whisperio-1101.md` (Top improvements #4) |
| Product invariants: STT through the provider abstraction; never break offline, every network path fails soft; settings additive and migrated; language-agnostic; typecheck + `test:coverage` green. | `desktop/CLAUDE.md` (Feature-line invariants) |
| Release reality: the macOS CI leg was removed (no macOS runners); a mac release is built by hand on a Mac. | `docs/PARITY.md:28`; `.devops/electron-builder.yml:64-69` |

## 3. Research findings

### 3.1 NVIDIA Parakeet TDT 0.6B v3
Source: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3 (fetched 2026-11-01)
- **[V]** 25 European languages, **Polish ("pl") is included**; automatic language detection, no prompting needed.
- **[V]** License of the weights: **CC BY 4.0** (page says ready for commercial and non-commercial use). Attribution required.
- **[V]** ~600M parameters; punctuation and capitalization are emitted automatically; word- and segment-level timestamps supported.
- **[V]** Polish WER (no punctuation/case): FLEURS 7.31 %, MLS 7.28 %.
- **[V]** Long audio: up to 24 min with full attention on an A100 80 GB, up to 3 h with local attention. Min 2 GB RAM to load.
- **[V]** The model card does not compare against Whisper and does not publish CPU speed. Its RTFx 3,332 is a GPU leaderboard number, not a CPU number.
- **[V]** No prompt / context-biasing input is described on the card.

ONNX int8 conversion used by sherpa-onnx: https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html (fetched 2026-11-01)
- **[V]** `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`: encoder.int8.onnx 622 MB, decoder 12 MB, joiner 6.1 MB, tokens 92 KB, **about 640 MB total**. Page lists no fp32 variant. Tarball: `github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2`.
- **[V]** Input: mono 16-bit WAV, any sample rate (resampled). Sample RTF 0.325 with 2 threads on English; with VAD on a long file RTF 0.028. Hardware not stated, so treat as indicative only.

Third-party comparison (Handy's own model site, Polish, FLEURS, Q8_0 WER): https://models.handy.computer/languages/pl (fetched 2026-11-01) **[3P]**, measured by the Handy project (GPU/CPU speed on an AMD 4750U):

| Model | PL WER % | CPU speed (x realtime) | Size | License |
|---|---|---|---|---|
| whisper-large-v3 | 4.69 | 1.0 | 1.55 GB | Apache-2.0 (as listed there) |
| whisper-large-v3-turbo | 5.81 | 1.4 | 0.83 GB | Apache-2.0 |
| parakeet-tdt-0.6b-v3 | 7.37 | 13.7 | 0.69 GB | CC-BY-4.0 |
| whisper-medium | 8.59 | 1.9 | 0.77 GB | Apache-2.0 |

Reading: Parakeet V3 is about 10x faster on CPU than Whisper turbo and about 1.6 WER points worse on Polish. Whisper large-v3 is the Polish quality leader. **[U]** the table is a single third-party run on one laptop CPU; reproduce on our own Polish dictation clips before deciding the default (see section 10).
A WebSearch for a first-party Parakeet-vs-Whisper Polish benchmark found none (only vendor blog posts); those are not cited.

### 3.2 Runtimes
- **sherpa-onnx** (Apache-2.0), https://github.com/k2-fsa/sherpa-onnx (fetched 2026-11-01): **[V]** supports Linux/macOS/Windows, x86_64 and arm64, a Node.js addon (`sherpa-onnx-node`), WebAssembly, and NeMo transducer (Parakeet) models.
- **sherpa-onnx-node 2.0.1**, https://registry.npmjs.org/sherpa-onnx-node/latest (fetched 2026-11-01): **[V]** Apache-2.0; `optionalDependencies` for `sherpa-onnx-{win-x64,win-ia32,win-arm64,linux-x64,linux-arm64,darwin-x64,darwin-arm64}` all at 2.0.1; no install script (no postinstall download); wrapper itself is 64 KB.
- Platform packages, https://registry.npmjs.org/sherpa-onnx-linux-x64/latest and `.../sherpa-onnx-darwin-arm64/latest`: **[V]** unpacked size **33.2 MB (linux-x64)** and **34.1 MB (darwin-arm64)**, 7 files, Apache-2.0. They carry the native addon plus onnxruntime shared libs. darwin-x64 and linux-arm64 sizes **[U]** (not fetched).
- **glibc baseline: [U].** No stated minimum found for the node platform packages. A search only surfaced that sherpa-onnx *Python wheels* are `manylinux_2_17` and that onnxruntime wheels have been reported to need glibc 2.28 (a user report, not authoritative). Action: run `readelf -V` on the shipped `.so` files on a Linux worker and record the highest `GLIBC_2.x`.
- **transcribe-rs** (Handy), https://github.com/cjpais/transcribe-rs (fetched 2026-11-01): **[V]** MIT; Parakeet runs via ONNX Runtime (int8 files: `encoder-model.int8.onnx`, `decoder_joint-model.int8.onnx`, `nemo128.onnx`, `vocab.txt`); Whisper via whisper.cpp with Metal/Vulkan/CUDA. It is a **Rust** crate, so using it in Electron means a Rust N-API build or a sidecar binary we compile ourselves. Not recommended for us (extra toolchain, no prebuilt Node binding found). Its model packaging (`parakeet-v3-int8.tar.gz`, or HF `istupakov/parakeet-tdt-0.6b-v3-onnx`) is a useful reference, not a dependency.
- **onnxruntime-node** directly: **[U]** not researched in depth. We would have to re-implement the TDT decoder loop, mel features and tokenization that sherpa-onnx already provides. Rejected on effort, not on feasibility.
- Handy itself, https://github.com/cjpais/Handy (fetched 2026-11-01): **[V]** MIT, Win/mac/Linux, Parakeet V3 described as "CPU-optimized with automatic language detection". The README does not state the runtime or model size. Handy name/logo are excluded from the MIT grant.

### 3.3 whisper.cpp on macOS / Linux (the alternative)
- https://github.com/ggml-org/whisper.cpp (fetched 2026-11-01): **[V]** MIT; Apple Silicon is first-class, "inference runs fully on the GPU via Metal"; optional Core ML encoder (>3x vs CPU, needs Python tooling to generate); quantized models supported; `whisper-server` is an example target built with CMake.
- **[V]** **Upstream publishes no macOS or Linux server binaries.** Release `v1.8.4` assets (GitHub API, https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/v1.8.4, fetched 2026-11-01): `whisper-bin-{Win32,x64}.zip`, `whisper-blas-bin-*.zip`, `whisper-cublas-*`, `whisper-v1.8.4-xcframework.zip`, `whispercpp.jar.zip`; nothing for Linux, no mac CLI/server. The latest release `v1.9.5` (2026-10-06) lists **no assets at all**. Linux has Docker images only. So option B means **we build, sign and host** `whisper-server` for darwin-arm64, darwin-x64, linux-x64 (+arm64) ourselves.
- Models: the same GGML files already in our catalog (`modelManager.ts:30-84`). Quality per the section 3.1 table; Metal speed numbers for Apple Silicon **[U]** (no primary source fetched).

### 3.4 macOS signing / notarization implications
- Every native Mach-O in the bundle must be signed with hardened runtime or notarization fails (general electron-builder experience, e.g. https://github.com/electron-userland/electron-builder/issues/3940, **[3P]**). `.node`/`.dylib` files must be unpacked from the asar. **[U]** whether electron-builder's default smart-unpack covers `sherpa-onnx-darwin-*` `.dylib`s; we would list `node_modules/sherpa-onnx-*/**` in `asarUnpack` explicitly (same pattern as koffi/active-win at `.devops/electron-builder.yml:8-14`).
- Option A ships native code **inside the app bundle** (signed and notarized with the app via the existing `notarize: true`, `electron-builder.yml:69`). Whether the addon needs `com.apple.security.cs.disable-library-validation` is **[U]**; verify on a Mac.
- Option B ships an executable that must be built by us. If downloaded at runtime (as on Windows, `localServer.ts:144-195`), macOS Gatekeeper blocks an unsigned/quarantined binary unless we sign+notarize it and pin its hash; embedding it in the bundle removes the download but adds a few MB per arch **[U]** (not measured). Either way B adds a build+sign pipeline we do not have.

## 4. Options

| | A: sherpa-onnx + Parakeet V3 | B: bundle whisper.cpp server on mac/Linux | C: both |
|---|---|---|---|
| Polish quality (FLEURS WER, [3P]) | 7.37 % (card: 7.31 %) | turbo 5.81 %, large-v3 4.69 % | user picks |
| Model download | ~640 MB (int8, [V]) | small 466 MB, turbo ~0.8-1.6 GB (our catalog) | both |
| Runtime payload | ~34 MB npm platform pkg ([V]) | few MB per arch [U] + build infra | both |
| CPU speed | ~13.7x realtime ([3P]) | ~1.4x turbo / 1.0x large-v3 ([3P]); Metal on Apple Silicon much faster [U] | both |
| Language handling | auto-detect only; no language param, no prompt | `language` + `prompt` supported (already wired, `transcribe.ts:678-717`) | both |
| License | sherpa-onnx Apache-2.0; weights CC BY 4.0 | whisper.cpp MIT; GGML weights per catalog source [U] | union |
| Packaging effort | Low-medium: npm dep, asarUnpack, utility process, archive model flow | High: CMake matrix for 3-4 targets, mac sign/notarize, hosting, hash pinning; reuse `localServer.ts` after un-gating win32 | sum |
| Reuses existing code | modelManager download plumbing (partly), provider chain | `localServer.ts` start/stop/idle | both |
| Main risks | Polish 1.5-2.7 pts worse; vocab prompt unsupported; glibc floor [U]; 640 MB first run | no upstream binaries; we own builds/CVEs; Gatekeeper; slow on CPU-only Linux | scope creep |

## 5. Recommendation

1. **Ship Option A first** as a new `parakeet` on-device provider: smallest to build (no native compile, prebuilt Apache-2.0 addon), fastest on CPU (what makes zero-config feel good), acceptable Polish, and it can later serve Windows too.
2. **Keep `selfhosted` unchanged** for users wanting Whisper large-v3/turbo quality (they can already point it at their own whisper-server). Do **not** build option B now; revisit as "C" only if the Polish bake-off (section 10) shows Parakeet is unacceptable for the owner's own use; Metal-backed whisper.cpp on Apple Silicon would then be the follow-up.
3. **Gate the default** on a measured Polish comparison on real dictation clips on a Mac and a Linux box.

## 6. Where it plugs in (additive)

Provider
- Add `'parakeet'` to `ProviderId` (`settingsManager.ts:9-17`) and a label in `PROVIDER_LABELS` (`transcribe.ts:84-87`), e.g. "On-device (Parakeet)".
- `isProviderConfigured` (`transcribe.ts:504-`): configured iff the model files are present (cheap `existsSync`, no network).
- `transcribeWithProvider` (`transcribe.ts:540-`): new branch that converts the clip to 16 kHz mono PCM and calls the engine; it ignores `transcriptionLanguage` and the vocab prompt (section 8).
- Metering: extend the `isLocal` test at `transcribe.ts:489` to include `parakeet`.
- Chain: because the chain already skips unconfigured providers and falls through on error (`transcribe.ts:456-501`), "Parakeet last in chain" gives a free offline fallback when cloud fails, with no new fail-soft code.

Engine host (new module, e.g. `desktop/src/main/localStt/parakeetEngine.ts`)
- Load `sherpa-onnx-node` lazily (dynamic import) so the Windows build and unsupported platforms never touch it.
- Run recognition in an Electron `utilityProcess`, not the main thread, so a 640 MB model load or a native crash cannot freeze or kill the main process.
- Reuse the idle-unload idea from `localServer.ts:16-17,50-52,83-93` (same TTL; `markServerUsed` is already called at `index.ts:334`), but unload by ending the utility process.
- Do not fold this into `localServer.ts`'s HTTP/port model; no listening socket is needed (also avoids fixed-port 8178 collisions, `localServer.ts:8`). Use new IPC channel names so the existing Windows UI is untouched.

Model management (`modelManager.ts`)
- Add a second catalog kind, "archive model": url, `sizeBytes`, **`sha256`**, `files[]`, target dir `userData/models/parakeet-tdt-0.6b-v3-int8/`. Do not loosen `resolveModelFile` (`:120-131`, `.bin` only); add a separate directory-confined resolver.
- Reuse the streaming downloader, progress callback, cancel, temp-file + atomic rename (`modelManager.ts:268-384`) and `assertSecureModelUrl` (`:429-441`). Add what is missing today: **SHA-256 verification** before the rename (current check is size-only, `:347-373`) and tar.bz2 extraction in Node (needs a small dependency **[U]**, or host a `.tar.gz`/per-file mirror).
- Host: upstream sherpa-onnx release URL pinned by hash; consider mirroring on our GitHub Releases to survive upstream deletion (open question 5).

Settings (additive, migrated; `desktop/CLAUDE.md`)
- Add only `onDeviceModel: 'parakeet-tdt-0.6b-v3-int8'` (enum for later models); "model ready" is derived, not stored. Never drop existing keys; default chain unchanged for existing users.

Packaging (`.devops/electron-builder.yml`)
- `asarUnpack`: add `node_modules/sherpa-onnx-node/**` and `node_modules/sherpa-onnx-*/**` (pattern at `:8-14`).
- Each mac arch needs its own platform package (mac is built per arch, `:73-80`); whether a universal build is wanted is **[U]**. Linux x64 only for now (`:84-89`); arm64 Linux is a stretch goal.
- No change to Windows packaging.

## 7. First-run UX

- Settings > Speech recognition: new card "On-device (offline)". Suggested default for new mac/Linux installs with no API keys; existing users see it as an option only.
- Copy: "Download the on-device speech model (about 640 MB)? Runs entirely on this computer, no account or key needed. You can delete it any time."
- States: not downloaded / downloading with percent and Cancel (progress exists, `modelManager.ts:25-30`, `:166-168`) / verifying / ready / error with Retry. Check free disk space before starting.
- If the user presses the dictation hotkey with no key and no model, show the same inline-hint pattern used for other missing providers (fail-soft path, `docs/PARITY.md:20`) offering the download, never a silent failure.
- No automatic download; always explicit consent (metered connections).

## 8. Language, vocabulary, formatting

- Today `transcriptionLanguage` ('auto' default, `settingsManager.ts:74,279`) and the vocabulary prompt (`transcribe.ts:532-538`) are sent to every Whisper-style backend. **Parakeet V3 has no language parameter and no prompt input** [V: model card shows neither]; sherpa-onnx hotword support for NeMo transducers is **[U]**.
- Behavior: Parakeet always auto-detects among its 25 languages. If `transcriptionLanguage` is set to a language outside that set (e.g. Japanese), the provider should report "not supported" and let the chain fall through rather than emit wrong-language text. If set to a supported language, ignore it and show a note that it is auto-detected.
- Short Polish clips could be mis-detected as another Slavic language **[U]** (Handy has an open French-accent bug, #1853, per our comparison); include in the bake-off.
- Vocabulary: the exact-spelling hint is lost for this provider. Existing mitigation: the LLM cleanup step receives `vocab` (`transcribe.ts:266-270`, `:404-407`), so spellings can be corrected when a cleanup provider is configured. Without one, vocabulary does not apply on-device; say so in the UI.
- Output already has punctuation and casing [V], so cleanup-off stays usable. Timestamps exist but are unused in v1.
- Audio: recorder output container (webm/opus vs wav) per platform is **[U]**; convert to 16 kHz mono PCM in the utility process. Clips longer than a few minutes need chunking (VAD or fixed windows); v1 limit is an open item.

## 9. Offline, privacy, legal

- **Offline invariant** (`desktop/CLAUDE.md`): after the one-time download the provider makes zero network calls. The download is the only network path and fails soft (no model -> provider unconfigured -> chain skips it). No audio leaves the device on this path; metering records it as local, cost 0.
- **No telemetry** in the engine: npm metadata shows no install script [V]; runtime code review for network calls is **[U]**.
- **Licenses.** The repo is PolyForm Noncommercial (`LICENSE.md`; `TRADEMARKS.md` covers name/logo). Third-party parts keep their own licenses and must ship notices:
  - sherpa-onnx and bundled onnxruntime libs: Apache-2.0 (onnxruntime itself is MIT) - include license/NOTICE texts in app resources.
  - Parakeet weights: **CC BY 4.0** - attribution, license link, and an indication of changes. The int8 ONNX conversion is a modification; credit NVIDIA and k2-fsa.
  - Handy / transcribe-rs (MIT): only if we copy code or recipe; keep copyright + permission notice.
  - Add a "Third-party notices" entry in About (existence of such a surface is **[U]**) and a `THIRD_PARTY_NOTICES.md`; state in README that PolyForm NC covers Whisperio code only.
  - Permissive (Apache/MIT/CC BY) parts do not become non-commercial by living in a PolyForm NC repo, and do not block a future commercial license of the app code.
- Do not imply NVIDIA endorsement; "NVIDIA" and "Parakeet" are their marks. Not legal advice; Daniel to confirm.

## 10. Test plan

Unit (CI, no model, no native addon; fits `test:coverage`)
- Fake engine behind an interface (`transcribe(pcm) -> text`): provider branch, `isProviderConfigured` by model presence, chain fall-through when the engine throws, metering `isLocal` and cost 0, language-unsupported gating, vocabulary not sent.
- Model manager: archive entry, SHA-256 mismatch rejects and deletes temp, truncated download rejected (existing behavior), path confinement of the new resolver (traversal cases like `resolveModelFile`), cancel mid-download.
- Idle unload with fake timers (mirror existing server idle tests).
- Settings migration: old settings load unchanged, default chain unchanged.

Smoke on real hardware (human or a Mac/Linux worker; per `docs/PARITY.md` "never claim a platform verified that wasn't exercised")
- macOS arm64 and x64: fresh install of the signed+notarized build, download model, airplane-mode dictation, `spctl -a -vv` and `codesign --verify --deep --strict`, mic permission unaffected.
- Linux x64 AppImage and deb on the oldest distro we intend to support (glibc floor) and one current distro.
- Polish bake-off: about 30 real Polish dictation clips (short and 60 s+, with names and English terms): WER for Parakeet V3 vs whisper turbo vs large-v3; latency and real-time factor on M-series, Intel Mac, mid-range Linux laptop. Record results in this doc.
- Failure drills: kill the utility process mid-clip, delete a model file, full disk, offline during download.

## 11. Effort (Sonnet-lane days; one work item per PR)

| Item | Days |
|---|---|
| Engine host: utility process, lazy sherpa-onnx-node, PCM conversion, chunking, idle unload, fake-engine interface | 2 |
| Provider wiring (`ProviderId`, label, configured, branch, metering, language gating) + tests | 1 |
| Model manager: archive catalog, SHA-256, extraction, resolver, tests | 1.5 |
| Packaging: asarUnpack, per-arch platform packages, entitlement check, notices | 1 |
| Settings UI first-run card, states, copy | 1.5 |
| Docs/notices/PARITY update | 0.5 |
| **Subtotal implementation** | **7.5** |
| Mac/Linux smoke + Polish bake-off (human/Mac worker, mostly wall-clock) | 1-2 |
| Contingency for glibc / notarization surprises | 1-2 |
| **Total A** | **about 10-11** |
| Option B increment (CMake matrix, sign/notarize, hosting, un-gate win32 at `localServer.ts:141-147,198-200`, tests) | +6-8 |

These are estimates, not measurements.

## 12. Risks

1. Polish accuracy below expectation (7.4 % vs 5.8 % / 4.7 % FLEURS, [3P]); mitigated by the bake-off gate and keeping `selfhosted`.
2. No vocabulary/prompt biasing on-device; mitigated only when LLM cleanup is configured.
3. Language mis-detect on short clips; no way to force a language.
4. Native addon + macOS notarization/entitlement surprises; mac cannot be verified in CI today (no macOS runners).
5. glibc floor on older Linux distros **[U]**.
6. 640 MB download and at least 2 GB RAM when loaded ([V] model card); low-RAM machines.
7. Supply chain: no hash pinning exists today (`modelManager.ts:347-373`); an upstream release asset could be replaced. Pin SHA-256, consider mirroring.
8. Upstream churn (sherpa-onnx 2.x API); pin exact version.
9. License attribution mistakes (CC BY 4.0): cheap to get right, costly to miss.

## 13. Open questions for Daniel

1. Is Polish quality 1.5-2.7 WER points below Whisper turbo/large-v3 acceptable for the default on-device choice, or must the mac default be Metal whisper.cpp (option B/C)?
2. Is a 640 MB default first-run offer acceptable, or also offer a smaller option (e.g. whisper small 466 MB, which needs B)?
3. Who runs mac verification (no macOS CI runner): you by hand per release, or a Mac worker?
4. Linux scope: x64 only (matches current AppImage/deb) or add arm64?
5. Mirror the model on our GitHub Releases (resilience, hash control) or depend on upstream sherpa-onnx assets?
6. Should the on-device provider also ship on Windows (it could replace the whisper-server download for most users)? Out of scope here but it shapes the settings design.
7. OK to add a Third-party notices surface in About and a `THIRD_PARTY_NOTICES.md`?
8. Default for new users with no keys on mac/Linux: auto-open the on-device card, or keep the current API-key first run?

## 14. Unverified items (summary)

- Polish WER for Parakeet vs Whisper from a first-party source (only the model card's 7.31 % FLEURS and Handy's third-party table).
- glibc minimum for sherpa-onnx node platform packages; sizes of `darwin-x64` and `linux-arm64` packages.
- Whether electron-builder auto-unpacks and signs the sherpa-onnx dylibs; need for `disable-library-validation`.
- Hotword/context-biasing support for NeMo transducers in sherpa-onnx.
- Metal speed of whisper.cpp large-v3-turbo on Apple Silicon; size of a self-built mac/Linux `whisper-server`.
- bz2 extraction dependency choice; existence of a Third-party notices surface in the renderer.
- Recorder output container (webm vs wav) on each platform.
