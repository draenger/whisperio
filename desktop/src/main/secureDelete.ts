import {
  openSync,
  closeSync,
  fstatSync,
  writeSync,
  fsyncSync,
  linkSync,
  unlinkSync,
  readdirSync
} from 'fs'
import { join } from 'path'

/**
 * BEST-EFFORT secure deletion of PLAINTEXT left behind by the encryption migration (security L4).
 *
 * HONEST SCOPE (see docs/design/desktop-secure-deletion.md): overwriting a file in place only
 * reaches the same physical blocks on a conventional in-place filesystem on a spinning disk. SSD
 * wear-levelling / FTL remapping, copy-on-write filesystems (APFS, btrfs, ZFS, ReFS), journaling
 * with data journaling, snapshots (VSS, Time Machine, btrfs/ZFS), cloud sync and backups can all
 * keep old copies the app cannot reach. This narrows the window for a casual undelete tool; it is
 * not a guarantee. Nothing here ever throws or blocks the migration: on any failure the file is
 * simply unlinked (or left, if even that fails).
 */

/** Suffix of a hard link that pins a replaced plaintext inode until it has been overwritten. */
export const WIPE_SUFFIX = '.wipe.tmp'
const CHUNK = 64 * 1024

export type SecureDeleteResult = 'wiped' | 'unlinked' | 'failed'

/**
 * Overwrite `path` in place with zeros (open r+, no truncate - truncating would free the blocks
 * and let the zeros land elsewhere), fsync, then unlink. The overwrite is SKIPPED when the inode
 * has more than one name (nlink > 1): then the bytes are still live data under another name (e.g.
 * a crash left a pin link to the CURRENT file) and only this name is removed.
 * Never throws: 'wiped' = overwritten + unlinked, 'unlinked' = overwrite skipped/failed but the
 * name is gone, 'failed' = the name could not be removed.
 */
export function secureDeleteFile(path: string): SecureDeleteResult {
  let wiped = false
  let fd: number | null = null
  try {
    fd = openSync(path, 'r+')
    const st = fstatSync(fd)
    if (st.isFile() && st.nlink === 1 && st.size > 0) {
      const zeros = Buffer.alloc(Math.min(CHUNK, st.size))
      let off = 0
      while (off < st.size) {
        const n = Math.min(zeros.length, st.size - off)
        off += writeSync(fd, zeros, 0, n, off)
      }
      fsyncSync(fd)
      wiped = true
    }
  } catch {
    wiped = false // best-effort: fall through to a plain unlink
  } finally {
    if (fd !== null) {
      try { closeSync(fd) } catch { /* ignore */ }
    }
  }
  try {
    unlinkSync(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code !== 'ENOENT') return 'failed'
  }
  return wiped ? 'wiped' : 'unlinked'
}

/**
 * Before a plaintext file is atomically REPLACED by its sealed version (rename over it), pin the
 * plaintext inode with a hard link so it can be overwritten after the rename. Returns the link
 * path, or null when the filesystem cannot hard-link (FAT/exFAT, some network shares) or the file
 * does not exist - the caller then just proceeds without the wipe. Never throws.
 */
export function pinForWipe(path: string): string | null {
  const link = `${path}${WIPE_SUFFIX}`
  try {
    // A stale pin from a crash: remove it first (secureDeleteFile skips the overwrite if it is
    // still a second name of the live file).
    secureDeleteFile(link)
    linkSync(path, link)
    return link
  } catch {
    return null
  }
}

/**
 * Release a pin. After a SUCCESSFUL replace the pin is the only name of the old plaintext inode
 * (nlink 1) and is overwritten; if the replace failed it is still a second name of the live file
 * (nlink 2) and is only unlinked. Never throws.
 */
export function releasePin(link: string | null): SecureDeleteResult | null {
  if (!link) return null
  return secureDeleteFile(link)
}

/**
 * Crash recovery: wipe leftover pins in `dir` (a crash between pin and release). The nlink guard
 * in secureDeleteFile keeps a pin that still aliases a live file from zeroing it. Never throws.
 */
export function sweepPendingWipes(dir: string): number {
  let n = 0
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(WIPE_SUFFIX)) continue
      if (secureDeleteFile(join(dir, f)) !== 'failed') n++
    }
  } catch { /* best-effort */ }
  return n
}
