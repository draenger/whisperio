import { describe, it, expect } from 'vitest'
import {
  derivePrivacyView,
  planToggle,
  setResultMessage,
  eraseConfirmText,
  shouldShowLockedNotice,
  vaultReasonText,
  undeletedMessage,
  GITHUB_WARNING,
  RESET_CONFIRM,
  RESET_FAILED_MESSAGE,
  LOCKED_MESSAGE,
  type EncryptionStatus
} from '../src/renderer/components/settings/privacyState'

const base: EncryptionStatus = { enabled: false, sealedOnDisk: false, locked: false, vault: { ok: true } }

describe('derivePrivacyView edges', () => {
  it('locked comes from progress alone even if status says unlocked, and never allows toggling', () => {
    const v = derivePrivacyView(base, { state: 'locked', done: 0, total: 0 })
    expect(v).toMatchObject({ kind: 'locked', canToggle: false, checked: true, progressText: null, detail: LOCKED_MESSAGE })
  })

  it('locked beats migrating and a missing vault', () => {
    const v = derivePrivacyView(
      { ...base, locked: true, vault: { ok: false, reason: 'unavailable' } },
      { state: 'migrating', done: 1, total: 2 }
    )
    expect(v.kind).toBe('locked')
  })

  it('migrating labels follow the direction and clamp done to total', () => {
    const enc = derivePrivacyView({ ...base, enabled: true }, { state: 'migrating', done: 9, total: 4 })
    expect(enc).toMatchObject({ kind: 'migrating', label: 'Encrypting', checked: true, canToggle: false })
    expect(enc.progressText).toBe('Encrypting 4 of 4 recordings')
    const dec = derivePrivacyView(base, { state: 'migrating', done: 1, total: 4 })
    expect(dec).toMatchObject({ label: 'Decrypting', checked: false, canToggle: false })
    expect(dec.progressText).toBe('Decrypting 1 of 4 recordings')
  })

  it('weak-backend vault disables turning ON with the weak-keyring explanation', () => {
    const v = derivePrivacyView({ ...base, vault: { ok: false, reason: 'weak-backend' } }, null)
    expect(v).toMatchObject({ kind: 'unavailable', canToggle: false, checked: false })
    expect(v.detail).toBe(vaultReasonText('weak-backend'))
    expect(v.detail).not.toBe(vaultReasonText('unavailable'))
  })

  it('shows the retry hint only when some recordings are not converted, with the exact remainder', () => {
    const none = derivePrivacyView({ ...base, enabled: true }, { state: 'on', done: 3, total: 3 })
    expect(none.progressText).toBeNull()
    const some = derivePrivacyView({ ...base, enabled: true }, { state: 'on', done: 1, total: 4 })
    expect(some.progressText).toBe('3 recording(s) not converted yet. They are retried on next start.')
    expect(some.canToggle).toBe(true)
    const off = derivePrivacyView(base, { state: 'off', done: 0, total: 2 })
    expect(off.kind).toBe('off')
    expect(off.progressText).toContain('2 recording(s)')
  })

  it('null progress is fail-soft for off and on', () => {
    expect(derivePrivacyView(base, null)).toMatchObject({ kind: 'off', label: 'Off', canToggle: true, progressText: null })
    expect(derivePrivacyView({ ...base, enabled: true }, null)).toMatchObject({ kind: 'on', label: 'On', checked: true })
  })
})

describe('dialogs and messages edges', () => {
  it('planToggle enable carries the GitHub flag only when connected', () => {
    const connected = planToggle(true, { githubConnected: true, currentlyEnabled: false })
    expect(connected).toMatchObject({ kind: 'enable', warnGithub: true, confirmLabel: 'Encrypt' })
    const not = planToggle(true, { githubConnected: false, currentlyEnabled: false })
    expect(not).toMatchObject({ kind: 'enable', warnGithub: false })
    expect(GITHUB_WARNING).toMatch(/GitHub sync is on/)
  })

  it('planToggle disable ignores github and no-ops in both unchanged directions', () => {
    expect(planToggle(false, { githubConnected: true, currentlyEnabled: true })).toMatchObject({
      kind: 'disable',
      warnGithub: false,
      confirmLabel: 'Decrypt'
    })
    expect(planToggle(false, { githubConnected: true, currentlyEnabled: false })).toBeNull()
    expect(planToggle(true, { githubConnected: false, currentlyEnabled: true })).toBeNull()
  })

  it('setResultMessage: ok is silent, locked and both vault reasons are distinct messages', () => {
    expect(setResultMessage({ ok: true })).toBeNull()
    expect(setResultMessage({ ok: false, reason: 'locked' })).toBe(LOCKED_MESSAGE)
    expect(setResultMessage({ ok: false, reason: 'weak-backend' })).toBe(vaultReasonText('weak-backend'))
    expect(setResultMessage({ ok: false, reason: 'unavailable' })).toBe(vaultReasonText('unavailable'))
  })

  it('eraseConfirmText mentions key destruction only when encrypted', () => {
    expect(eraseConfirmText(true).body).toMatch(/destroys the encryption key first/)
    expect(eraseConfirmText(false).body).not.toMatch(/key/)
    expect(eraseConfirmText(false).confirmLabel).toBe('Erase all')
  })

  it('shouldShowLockedNotice is fail-soft for unknown status', () => {
    expect(shouldShowLockedNotice(null)).toBe(false)
    expect(shouldShowLockedNotice(undefined)).toBe(false)
    expect(shouldShowLockedNotice({ locked: false })).toBe(false)
    expect(shouldShowLockedNotice({ locked: true })).toBe(true)
  })

  it('undeletedMessage is null for 0/negative/NaN and counts otherwise', () => {
    expect(undeletedMessage(0)).toBeNull()
    expect(undeletedMessage(-3)).toBeNull()
    expect(undeletedMessage(NaN)).toBeNull()
    expect(undeletedMessage(1)).toContain('1 file(s)')
    expect(undeletedMessage(7)).toContain('7 file(s)')
  })

  it('reset texts state that nothing is deleted on failure and that the reset is irreversible', () => {
    expect(RESET_FAILED_MESSAGE).toMatch(/Nothing was deleted/)
    expect(RESET_CONFIRM.body).toMatch(/cannot be undone/)
    expect(RESET_CONFIRM.confirmLabel).toBe('Reset history')
  })
})
