# Desktop: best-effort secure deletion of migrated plaintext (L4/L5)

Status: implemented (desktop, stacked on the D1–D3 encryption PRs #24/#35/#38).
Companion to `docs/design/opt-in-encryption.md` (PR #18). It changes no crypto primitive,
key handling or vault format (index envelope `av=2`, `WHSPAUD` audio, `data-vault.key`).

## Problem

Turning "Encrypt history" ON replaces plaintext files with their sealed versions:

| Plaintext | How it was replaced (before) |
|---|---|
| `recordings/index.json` | sealed tmp file `rename`d over it |
| kept audio `*.webm` (encrypt migration) | sealed `*.webm.mig.tmp` `rename`d over it |
| `index.json.corrupt-*` quarantine backups | sealed to `<name>.sealed.json`, plaintext `unlink`ed |

A rename-over or unlink only frees the old blocks. Until something else reuses them, the
plaintext transcript and audio can be recovered with any undelete or forensic tool (**L4**).

Separately, `sealCorruptBackups()` chose files by prefix (`index.json.corrupt-*`, not ending
in `.sealed.json`). A crash leftover such as `index.json.corrupt-N.sealed.json.tmp` was
therefore sealed again into `…tmp.sealed.json`. That name is outside `CORRUPT_BACKUP_RE`, so
erase and locked reset never deleted it. It outlived the crypto-shred and every later re-enable
as an undecryptable orphan (**L5**). The common case, where erase/reset delete
`*.sealed.json` backups, already landed in #38.

## Design

`src/main/secureDelete.ts` provides the following. It is best-effort and never throws:

- **`secureDeleteFile(path)`** opens with `r+` (no truncate; truncating would free the blocks
  and send the zeros somewhere else). It overwrites the file's full length with zeros in 64 KiB
  chunks, calls `fsync`, then `unlink`s. The overwrite runs only when `fstat().nlink === 1`. If
  the inode has another name, its bytes are still live data, so only this name is removed. If the
  overwrite fails, it falls back to a plain unlink. It returns `wiped | unlinked | failed`.
- **Pin, then replace, then release.** The plaintext inode must be reachable after the atomic
  rename, so it is hard-linked first (`<file>.wipe.tmp`). After a successful rename the pin is the
  inode's only name and gets zeroed. If the rename failed, the pin still aliases the live file
  (`nlink 2`), so it is only unlinked. `index.json` always exists throughout, which keeps the
  existing crash-safety of the atomic write.
- **No hard links** (FAT/exFAT, some network shares): `pinForWipe` returns `null` and the
  migration continues exactly as before, with no wipe.
- **Crash recovery:** `sweepPendingWipes(dir)` runs when encryption is turned ON, at the start of
  every audio migration (including the startup `resumeAudioMigration`), and before the
  post-shred wipe. It wipes leftover pins. The `nlink` guard prevents a pin that still aliases a
  live file (crash before the rename) from zeroing it.

Where it is applied:

- `writeIndexFile(…, wipePrevious)`. It is set only when a **plaintext** index is replaced by a
  **sealed** one: `setHistoryEncryption(true)`, and `saveIndex` when the flag is ON but the index
  is still plain after a crash between the flag write and the rewrite. Saves while encryption is
  off or already sealed are unchanged.
- `migrateAudio('encrypt')` for each converted clip. `decrypt` replaces ciphertext, so it has
  nothing to wipe.
- `sealCorruptBackups()` for the plaintext backup after its sealed copy is in place. It now
  matches exact plaintext names only (`^index\.json\.corrupt-[0-9]+(\.json)?$`), which closes L5.

## Limits (read before claiming anything to users)

This narrows the window for casual recovery. **It does not guarantee the plaintext is gone.**

- **SSDs / NVMe / eMMC / USB flash:** wear-levelling and the FTL remap logical blocks. An in-place
  overwrite usually goes to *new* physical cells, and the old cells stay readable to firmware-level
  or chip-off recovery until garbage collection or TRIM erases them. Only full-disk encryption
  (BitLocker, FileVault, LUKS) or a drive-level secure erase protects data already written.
- **Copy-on-write filesystems** (APFS, btrfs, ZFS, ReFS) never overwrite in place, so the zeros
  land in new extents. Snapshots (Time Machine local snapshots, btrfs/ZFS snapshots, Windows VSS /
  Previous Versions) keep the old blocks no matter what.
- **Journaling** with data journaling (`ext4 data=journal`), and filesystem compression or
  dedup, can hold extra copies.
- **Earlier versions of the index are not reached.** While encryption was off, every save
  replaced `index.json` atomically, and each one freed an older plaintext version. Only the
  version that is current at migration time is wiped. The same applies to temp files from
  earlier crashes that were already unlinked.
- **Outside the app's directory:** cloud sync (OneDrive/Dropbox/iCloud of `userData`), backups,
  antivirus quarantine, swap/hibernation files and crash dumps.
- **The erase/reset path still uses a plain unlink.** After a crypto-shred the remaining files are
  ciphertext under a destroyed key, so overwriting them adds little. Plaintext
  `index.json.corrupt-*` backups removed by erase while encryption is off are not overwritten
  either (possible follow-up).

User-facing copy must therefore say "encrypts new and existing history" and must **not** promise
that earlier plaintext has been securely erased. Users who need that should enable full-disk
encryption.

## Tests

- `desktop/tests/secureDelete.test.ts`: zero overwrite over the full length (chunked; and on
  POSIX, verified by reading the old inode through a held fd), no truncate, the `nlink` guard,
  the pin/replace/release flow, no hard-link support, I/O failure falls back to unlink, unlink
  failure is reported rather than thrown, and the stale-pin sweep.
- `desktop/tests/recordingStore-secureDelete.test.ts`: index wipe when encryption is turned ON
  (and on the crash-recovery save), no wipe on unrelated saves, audio encrypt wipes and decrypt
  does not, the migration still completes without hard links or with overwrite I/O errors,
  corrupt-backup wipe, crash leftovers (including a pin that aliases a live clip), and for L5:
  no sealed backup survives erase or reset followed by re-enable, and leftovers are never
  re-sealed into un-shreddable names.
