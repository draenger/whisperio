/**
 * Best-effort "do not record this in clipboard history / cloud sync" markers
 * for clipboard writes made by Whisperio (dictated text, and the restored
 * previous content, which may be a password).
 *
 * Electron-free: the clipboard and platform are injected for testing.
 *
 * Caveat: Electron's writeBuffer commits a separate clipboard write, and the
 * OS-level write may REPLACE earlier content. So after marking we verify the
 * text is still readable and, if the marker write clobbered it, write the plain
 * text again (marker lost, paste still works). Whether the markers survive on a
 * given OS/Electron build must be confirmed on a real device.
 */

export interface TransientClipboardLike {
  readText(): string
  writeText(text: string): void
  writeBuffer(format: string, buffer: Buffer): void
}

const DWORD_ZERO = (): Buffer => Buffer.alloc(4)

/** [format, payload] pairs per platform; empty list = nothing to mark. */
export function transientFormats(platform: NodeJS.Platform): Array<[string, Buffer]> {
  if (platform === 'win32') {
    return [
      // Presence of the format is the signal; a DWORD payload is used because
      // zero-length clipboard handles are not reliably accepted.
      ['ExcludeClipboardContentFromMonitorProcessing', DWORD_ZERO()],
      ['CanIncludeInClipboardHistory', DWORD_ZERO()],
      ['CanUploadToCloudClipboard', DWORD_ZERO()]
    ]
  }
  if (platform === 'darwin') {
    return [
      ['org.nspasteboard.TransientType', Buffer.from('')],
      ['org.nspasteboard.ConcealedType', Buffer.from('')]
    ]
  }
  return []
}

/**
 * Add the transient markers to what is currently on the clipboard. Never
 * throws; each format is attempted independently. Returns the number written.
 * If `expectedText` is given and a marker write clobbered it, it is rewritten.
 */
export function markClipboardTransient(
  cb: TransientClipboardLike,
  platform: NodeJS.Platform,
  expectedText?: string,
  repair?: () => void
): number {
  let written = 0
  for (const [format, buf] of transientFormats(platform)) {
    try {
      cb.writeBuffer(format, buf)
      written++
    } catch (err) {
      console.warn(`[Whisperio] clipboard marker ${format} failed:`, (err as Error)?.message)
    }
  }
  if (written > 0 && expectedText !== undefined) {
    try {
      if (cb.readText() !== expectedText) (repair ?? (() => cb.writeText(expectedText)))()
    } catch {
      /* best effort */
    }
  }
  return written
}

/** Write `text` to the clipboard and mark it transient (best effort). */
export function writeTransientText(
  cb: TransientClipboardLike,
  text: string,
  platform: NodeJS.Platform
): void {
  cb.writeText(text)
  markClipboardTransient(cb, platform, text)
}
