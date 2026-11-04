import { describe, it, expect } from 'vitest'
import {
  derivePrivacyView,
  planToggle,
  setResultMessage,
  eraseConfirmText,
  shouldShowLockedNotice,
  vaultReasonText,
  ERASE_ORDER,
  LOCKED_MESSAGE,
  INDEX_UNAVAILABLE_MESSAGE,
  isIndexUnavailable,
  undeletedMessage,
  type EncryptionStatus
} from '../src/renderer/components/settings/privacyState'

const base: EncryptionStatus = { enabled: false, sealedOnDisk: false, locked: false, vault: { ok: true } }

describe('derivePrivacyView', () => {
  it('off by default and toggleable', () => {
    const v = derivePrivacyView(base, { state: 'off', done: 0, total: 0 })
    expect(v).toMatchObject({ kind: 'off', checked: false, canToggle: true, progressText: null })
  })
  it('on', () => {
    const v = derivePrivacyView({ ...base, enabled: true }, { state: 'on', done: 3, total: 3 })
    expect(v).toMatchObject({ kind: 'on', checked: true, canToggle: true, progressText: null })
  })
  it('migrating shows progress and blocks the switch', () => {
    const v = derivePrivacyView({ ...base, enabled: true }, { state: 'migrating', done: 2, total: 10 })
    expect(v.kind).toBe('migrating')
    expect(v.canToggle).toBe(false)
    expect(v.progressText).toBe('Encrypting 2 of 10 recordings')
    const d = derivePrivacyView(base, { state: 'migrating', done: 1, total: 4 })
    expect(d.progressText).toBe('Decrypting 1 of 4 recordings')
  })
  it('stalled migration reports leftovers', () => {
    const v = derivePrivacyView({ ...base, enabled: true }, { state: 'on', done: 7, total: 10 })
    expect(v.progressText).toContain('3 recording(s) not converted')
  })
  it('locked wins over everything', () => {
    const v = derivePrivacyView({ ...base, enabled: true, locked: true }, { state: 'migrating', done: 0, total: 1 })
    expect(v).toMatchObject({ kind: 'locked', detail: LOCKED_MESSAGE, canToggle: false })
    expect(derivePrivacyView(base, { state: 'locked', done: 0, total: 0 }).kind).toBe('locked')
  })
  it('missing vault disables turning ON', () => {
    const v = derivePrivacyView({ ...base, vault: { ok: false, reason: 'weak-backend' } }, null)
    expect(v).toMatchObject({ kind: 'unavailable', canToggle: false })
    expect(v.detail).toBe(vaultReasonText('weak-backend'))
  })
  it('already ON stays toggleable (turn OFF) even if the vault vanished', () => {
    const v = derivePrivacyView({ ...base, enabled: true, vault: { ok: false, reason: 'unavailable' } }, null)
    expect(v.canToggle).toBe(true)
  })
})

describe('planToggle', () => {
  it('no dialog when nothing changes', () => {
    expect(planToggle(false, { githubConnected: false, currentlyEnabled: false })).toBeNull()
    expect(planToggle(true, { githubConnected: true, currentlyEnabled: true })).toBeNull()
  })
  it('enable always confirms and mentions key loss and SSD remnants', () => {
    const d = planToggle(true, { githubConnected: false, currentlyEnabled: false })!
    expect(d.kind).toBe('enable')
    const text = d.body.join(' ')
    expect(text).toContain('cannot be recovered')
    expect(text).toContain('SSD')
    expect(d.warnGithub).toBe(false)
  })
  it('enable warns when GitHub sync is on', () => {
    expect(planToggle(true, { githubConnected: true, currentlyEnabled: false })!.warnGithub).toBe(true)
  })
  it('disable confirms and never shows the GitHub warning', () => {
    const d = planToggle(false, { githubConnected: true, currentlyEnabled: true })!
    expect(d).toMatchObject({ kind: 'disable', warnGithub: false })
  })
})

describe('messages', () => {
  it('maps set results', () => {
    expect(setResultMessage({ ok: true })).toBeNull()
    expect(setResultMessage({ ok: false, reason: 'locked' })).toBe(LOCKED_MESSAGE)
    expect(setResultMessage({ ok: false, reason: 'unavailable' })).toBe(vaultReasonText('unavailable'))
  })
  it('erase text differs when encrypted', () => {
    expect(eraseConfirmText(true).body).toContain('key')
    expect(eraseConfirmText(false).body).not.toContain('key')
  })
  it('locked notice only for locked===true', () => {
    expect(shouldShowLockedNotice({ locked: true })).toBe(true)
    expect(shouldShowLockedNotice({ locked: false })).toBe(false)
    expect(shouldShowLockedNotice(null)).toBe(false)
    expect(shouldShowLockedNotice(undefined)).toBe(false)
  })
  it('documented erase order is key before files', () => {
    expect(ERASE_ORDER.indexOf('shred-key')).toBeLessThan(ERASE_ORDER.indexOf('delete-files'))
  })
})

describe('index unavailable (plain history merely unreadable)', () => {
  it('has its own state and copy, no toggle, never the encrypted-key message', () => {
    const st = { ...base, locked: true, lockKind: 'unavailable' as const }
    expect(isIndexUnavailable(st)).toBe(true)
    const v = derivePrivacyView(st, { state: 'unavailable', done: 0, total: 0 })
    expect(v).toMatchObject({ kind: 'index-unavailable', canToggle: false, detail: INDEX_UNAVAILABLE_MESSAGE })
    expect(v.detail).toContain('nothing was deleted')
    expect(v.detail).not.toContain('encrypted')
  })
  it('progress alone also selects it; transient/locked are not unavailable', () => {
    expect(isIndexUnavailable(base, { state: 'unavailable' })).toBe(true)
    expect(isIndexUnavailable({ ...base, locked: true, lockKind: 'transient' })).toBe(false)
  })
  it('undeletedMessage says files are removed on next start', () => {
    expect(undeletedMessage(2)).toContain('removed on next start')
  })
})
