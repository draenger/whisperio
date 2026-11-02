// Pure helpers (no electron import) that validate renderer-supplied IPC input.
// Defense in depth: a compromised renderer must not be able to steer file paths
// or call sensitive handlers from a foreign frame.

/** True for our own renderer origins: bundled file:// pages, or the Vite dev server. */
export function isTrustedAppUrl(url: string | undefined | null, devUrl?: string | undefined): boolean {
  if (!url) return false
  if (url.startsWith('file://')) return true
  if (devUrl) {
    // Compare on a boundary so http://localhost:5173.evil.com does not match http://localhost:5173.
    if (url === devUrl) return true
    const base = devUrl.endsWith('/') ? devUrl : devUrl + '/'
    if (url.startsWith(base)) return true
  }
  return false
}

export interface SenderLike {
  senderFrame?: { url?: string | null } | null
  sender?: { getURL?: () => string } | null
}

/** Throws unless the IPC event originates from one of our own frames. */
export function assertTrustedSender(event: SenderLike, devUrl: string | undefined = process.env['ELECTRON_RENDERER_URL']): void {
  let url: string | null | undefined
  try {
    url = event?.senderFrame?.url ?? event?.sender?.getURL?.()
  } catch {
    url = undefined
  }
  if (!isTrustedAppUrl(url, devUrl)) {
    throw new Error('IPC call rejected: untrusted sender')
  }
}

export interface SanitizedRecordingUpdate {
  status?: 'completed' | 'failed' | 'pending'
  transcription?: string
  error?: string
}

const MAX_TRANSCRIPTION = 5_000_000
const MAX_ERROR = 20_000
const STATUSES = ['completed', 'failed', 'pending']

/**
 * Reduce a renderer-supplied recordings:update payload to the fields the UI
 * legitimately edits (status, transcription, error). Everything else
 * (filepath, filename, id, size, timestamps, segments, ...) is dropped.
 */
export function sanitizeRecordingUpdate(updates: unknown): SanitizedRecordingUpdate {
  const out: SanitizedRecordingUpdate = {}
  if (!updates || typeof updates !== 'object') return out
  const u = updates as Record<string, unknown>
  if (typeof u.status === 'string' && STATUSES.includes(u.status)) {
    out.status = u.status as SanitizedRecordingUpdate['status']
  }
  if (typeof u.transcription === 'string' && u.transcription.length <= MAX_TRANSCRIPTION) {
    out.transcription = u.transcription
  }
  if ('error' in u && (u.error === undefined || (typeof u.error === 'string' && u.error.length <= MAX_ERROR))) {
    out.error = u.error as string | undefined
  }
  return out
}
