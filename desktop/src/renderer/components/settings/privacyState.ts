/*
 * Pure logic behind Settings > Privacy (history encryption). Kept out of the .tsx so it is unit
 * tested and counted by coverage; PrivacyPanel.tsx only renders what these functions decide.
 */

export type VaultAvailability = { ok: true } | { ok: false; reason: 'unavailable' | 'weak-backend' }

export interface EncryptionStatus {
  enabled: boolean
  sealedOnDisk: boolean
  locked: boolean
  vault: VaultAvailability
}

export interface EncryptionProgress {
  state: 'off' | 'on' | 'migrating' | 'locked'
  done: number
  total: number
}

export type SetResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'weak-backend' | 'locked' }

export const LOCKED_MESSAGE = "History is encrypted and can't be unlocked on this device."

export type PrivacyKind = 'off' | 'on' | 'migrating' | 'locked' | 'unavailable'

export interface PrivacyView {
  kind: PrivacyKind
  label: string
  detail: string
  /** Switch position. */
  checked: boolean
  /** The switch can be flipped (not while migrating, locked or when the OS key vault is missing). */
  canToggle: boolean
  /** "Converting 3 of 10 recordings", or a retry hint, or null. */
  progressText: string | null
}

/** Maps main-process status + progress to what the panel shows. Fail-closed: locked wins. */
export function derivePrivacyView(status: EncryptionStatus, progress: EncryptionProgress | null): PrivacyView {
  if (status.locked || progress?.state === 'locked') {
    return {
      kind: 'locked',
      label: 'Locked',
      detail: LOCKED_MESSAGE,
      checked: true,
      canToggle: false,
      progressText: null
    }
  }
  if (progress?.state === 'migrating') {
    return {
      kind: 'migrating',
      label: status.enabled ? 'Encrypting' : 'Decrypting',
      detail: 'Converting saved recordings. You can keep dictating.',
      checked: status.enabled,
      canToggle: false,
      progressText: progressLabel(progress, status.enabled)
    }
  }
  if (!status.enabled && !status.vault.ok) {
    return {
      kind: 'unavailable',
      label: 'Unavailable',
      detail: vaultReasonText(status.vault.reason),
      checked: false,
      canToggle: false,
      progressText: null
    }
  }
  const pending = progress && progress.done < progress.total ? progress : null
  return {
    kind: status.enabled ? 'on' : 'off',
    label: status.enabled ? 'On' : 'Off',
    detail: status.enabled
      ? 'History and kept recordings are stored encrypted on this device.'
      : 'History and kept recordings are stored as readable files.',
    checked: status.enabled,
    canToggle: true,
    progressText: pending
      ? `${pending.total - pending.done} recording(s) not converted yet. They are retried on next start.`
      : null
  }
}

function progressLabel(p: EncryptionProgress, enabling: boolean): string {
  return `${enabling ? 'Encrypting' : 'Decrypting'} ${Math.min(p.done, p.total)} of ${p.total} recordings`
}

export function vaultReasonText(reason: 'unavailable' | 'weak-backend'): string {
  return reason === 'weak-backend'
    ? "This system's secure storage is too weak to protect the key (no keyring). Encryption is unavailable."
    : "The operating system's secure storage is unavailable, so encryption cannot be turned on."
}

export function setResultMessage(res: SetResult): string | null {
  if (res.ok) return null
  if (res.reason === 'locked') return LOCKED_MESSAGE
  return vaultReasonText(res.reason)
}

export interface ToggleContext {
  /** GitHub sync is connected to a repo. */
  githubConnected: boolean
  currentlyEnabled: boolean
}

export type ToggleDialog =
  | {
      kind: 'enable'
      /** Show the "GitHub sync is on" warning + offer to turn sync off (design 4.2). */
      warnGithub: boolean
      title: string
      body: string[]
      confirmLabel: string
    }
  | { kind: 'disable'; warnGithub: false; title: string; body: string[]; confirmLabel: string }

/** Every flip needs a confirm; this decides which dialog and whether the GitHub warning shows. */
export function planToggle(next: boolean, ctx: ToggleContext): ToggleDialog | null {
  if (next === ctx.currentlyEnabled) return null
  if (next) {
    return {
      kind: 'enable',
      warnGithub: ctx.githubConnected,
      title: 'Encrypt history and recordings?',
      body: [
        'Transcripts and kept recordings are encrypted on this device with a key held by your operating system (Keychain, DPAPI or keyring). It protects against someone copying your files or backups.',
        'If you lose access to this device\'s secure storage (reset the OS profile, move to another PC, lose the keychain), encrypted history cannot be recovered.',
        'Existing items are converted in the background. Deleting the old readable copies does not guarantee physical erasure on SSDs; only data written encrypted from the start is guaranteed.',
        'It does not protect against malware running as you, nor files you export.'
      ],
      confirmLabel: 'Encrypt'
    }
  }
  return {
    kind: 'disable',
    warnGithub: false,
    title: 'Turn off encryption?',
    body: [
      'History and recordings are decrypted back to readable files. Anyone with access to your files will be able to read them.'
    ],
    confirmLabel: 'Decrypt'
  }
}

export const GITHUB_WARNING =
  'GitHub sync is on. Synced data is not covered by this setting and stays readable on GitHub. You can turn sync off now.'

export type EraseStep = 'confirm' | 'shred-key' | 'delete-files'

/** Documented order of an encrypted erase (design 4.3): key first, then files. */
export const ERASE_ORDER: readonly EraseStep[] = ['confirm', 'shred-key', 'delete-files']

export function eraseConfirmText(encrypted: boolean): { title: string; body: string; confirmLabel: string } {
  return {
    title: 'Erase all history?',
    body: encrypted
      ? 'This destroys the encryption key first, then deletes every recording and transcript. It cannot be undone.'
      : 'This deletes every recording and transcript. It cannot be undone.',
    confirmLabel: 'Erase all'
  }
}

export const RESET_CONFIRM = {
  title: 'Reset history?',
  body: 'The encrypted history cannot be opened, so it is destroyed (the key and all files are deleted) and Whisperio starts with an empty history and encryption off. This cannot be undone.',
  confirmLabel: 'Reset history'
}

/** The recordings window shows the locked notice only when status says locked (null = unknown, fail-soft). */
export function shouldShowLockedNotice(status: { locked: boolean } | null | undefined): boolean {
  return !!status && status.locked === true
}

export const RESET_FAILED_MESSAGE =
  'History was not reset: it is not locked encrypted history, or the encryption key could not be destroyed. Nothing was deleted.'
