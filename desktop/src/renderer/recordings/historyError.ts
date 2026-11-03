export const HISTORY_UNREADABLE_MESSAGE =
  "Your history can't be read right now (the file is locked or damaged). Nothing was deleted — close other apps that may lock it (backup/antivirus) and try again."

const MARKER = '[INDEX_UNAVAILABLE]'

/** True when an IPC rejection came from recordingStore's IndexUnavailableError. */
export function isIndexUnavailable(err: unknown): boolean {
  if (err === null || err === undefined) return false
  const code = (err as { code?: unknown }).code
  if (code === 'INDEX_UNAVAILABLE') return true
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : (err as { message?: unknown }).message
  return typeof message === 'string' && message.includes(MARKER)
}
