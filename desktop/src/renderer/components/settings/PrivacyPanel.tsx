import { useState, useEffect, useCallback, type CSSProperties, type ReactElement } from 'react'
import type { Theme } from '../../theme'
import { SectionHeader, ToggleRow } from './SettingsForm'
import {
  derivePrivacyView,
  planToggle,
  setResultMessage,
  eraseConfirmText,
  shouldShowLockedNotice,
  GITHUB_WARNING,
  LOCKED_MESSAGE,
  RESET_CONFIRM,
  RESET_TRANSIENT_CONFIRM,
  LOCKED_TRANSIENT_MESSAGE,
  TRY_AGAIN_STILL_LOCKED,
  isTransientLock,
  KEY_REMOVAL_NOTE,
  RESET_FAILED_MESSAGE,
  undeletedMessage,
  type EncryptionStatus,
  type EncryptionProgress,
  type ToggleDialog
} from './privacyState'

/*
 * Settings > Privacy: opt-in "Encrypt history and recordings" (default OFF), erase-all
 * (crypto-shred when encrypted) and the locked-history reset. All decisions live in privacyState.ts;
 * this file only renders and calls window.api.history / window.api.recordings.
 */

interface SettingsStyles {
  card: CSSProperties
  cardTitle: CSSProperties
  hint: CSSProperties
}

type Pending = { type: 'toggle'; dialog: ToggleDialog } | { type: 'erase' } | { type: 'reset' } | null

const POLL_MS = 1000

export function PrivacyPanel({ s, theme }: { s: SettingsStyles; theme: Theme }): ReactElement {
  const [status, setStatus] = useState<EncryptionStatus | null>(null)
  const [progress, setProgress] = useState<EncryptionProgress | null>(null)
  const [githubConnected, setGithubConnected] = useState(false)
  const [pending, setPending] = useState<Pending>(null)
  const [turnOffSync, setTurnOffSync] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [st, pr] = await Promise.all([
        window.api.history.getEncryption(),
        window.api.history.getEncryptionStatus()
      ])
      setStatus(st)
      setProgress(pr)
    } catch {
      /* fail-soft: keep the previous status */
    }
  }, [])

  useEffect(() => {
    refresh()
    window.api.github
      .status()
      .then((g) => setGithubConnected(!!g.connected && !!g.repo))
      .catch(() => setGithubConnected(false))
  }, [refresh])

  // Poll while a migration runs so the progress text moves. The tick calls only the cheap status
  // endpoint (cached counts in main); the full refresh (index decrypt) runs once when it ends.
  const migrating = progress?.state === 'migrating'
  useEffect(() => {
    if (!migrating) return
    const t = setInterval(async () => {
      try {
        const pr = await window.api.history.getEncryptionStatus()
        if (pr.state === 'migrating') setProgress(pr)
        else await refresh()
      } catch {
        /* keep the previous progress */
      }
    }, POLL_MS)
    return () => clearInterval(t)
  }, [migrating, refresh])

  const view = status ? derivePrivacyView(status, progress) : null
  const transient = !!status && isTransientLock(status, progress)
  const encrypted = !!status && (status.enabled || status.sealedOnDisk)

  const requestToggle = (next: boolean): void => {
    if (!status) return
    const dialog = planToggle(next, { githubConnected, currentlyEnabled: status.enabled })
    if (dialog) {
      setTurnOffSync(true)
      setPending({ type: 'toggle', dialog })
    }
  }

  const confirm = async (): Promise<void> => {
    if (!pending) return
    setBusy(true)
    setMessage(null)
    try {
      if (pending.type === 'toggle') {
        const enable = pending.dialog.kind === 'enable'
        const res = await window.api.history.setEncryption(enable)
        setMessage(setResultMessage(res))
        // Only after encryption really turned on: never drop sync for a switch that failed.
        if (res.ok && enable && pending.dialog.warnGithub && turnOffSync) {
          await window.api.github.disconnect()
          setGithubConnected(false)
        }
      } else if (pending.type === 'erase') {
        const res = await window.api.recordings.deleteAll()
        setMessage(undeletedMessage(res ? res.undeleted : 0))
      } else {
        const res = await window.api.history.resetLocked(
          transient ? { confirmDestroy: true } : undefined
        )
        setMessage(res.ok ? undeletedMessage(res.undeleted) : RESET_FAILED_MESSAGE)
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
      setPending(null)
      await refresh()
    }
  }

  let dialogTitle = ''
  let dialogConfirm = ''
  let dialogBody: string[] = []
  if (pending?.type === 'toggle') {
    dialogTitle = pending.dialog.title
    dialogConfirm = pending.dialog.confirmLabel
    dialogBody = pending.dialog.body
  } else if (pending?.type === 'erase') {
    const t = eraseConfirmText(encrypted)
    dialogTitle = t.title
    dialogConfirm = t.confirmLabel
    dialogBody = [t.body]
  } else if (pending?.type === 'reset') {
    const r = transient ? RESET_TRANSIENT_CONFIRM : RESET_CONFIRM
    dialogTitle = r.title
    dialogConfirm = r.confirmLabel
    dialogBody = [r.body]
  }
  const enableDialog = pending?.type === 'toggle' && pending.dialog.kind === 'enable'

  const dangerBtn: CSSProperties = {
    background: 'transparent',
    border: `1px solid ${theme.danger}`,
    color: theme.danger,
    borderRadius: '8px',
    padding: '7px 14px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer'
  }

  return (
    <div style={s.card}>
      <SectionHeader title="Privacy" theme={theme} s={s} />

      {view && (
        <>
          <ToggleRow
            label="Encrypt history and recordings"
            description={
              'Encrypts transcripts and kept recordings on this device. If you lose access to this ' +
              "device's secure storage, encrypted history cannot be recovered."
            }
            checked={view.checked}
            onChange={(v) => {
              if (view.canToggle && !busy) requestToggle(v)
            }}
            theme={theme}
          />
          <div style={{ ...s.hint, marginTop: '4px' }} role="status">
            {view.label}: {view.detail}
            {view.progressText ? ` ${view.progressText}` : ''}
          </div>
        </>
      )}

      {shouldShowLockedNotice(status) && (
        <div
          role="alert"
          style={{
            marginTop: '12px',
            padding: '12px',
            border: `1px solid ${theme.danger}`,
            borderRadius: '8px',
            color: theme.text
          }}
        >
          <div style={{ fontWeight: 600 }}>{transient ? LOCKED_TRANSIENT_MESSAGE : LOCKED_MESSAGE}</div>
          <div style={{ ...s.hint, margin: '4px 0 10px' }}>
            Resetting destroys the encrypted history and starts fresh. Nothing is created silently. {KEY_REMOVAL_NOTE}
          </div>
          {transient && (
            <button
              style={{ ...dangerBtn, marginRight: '8px' }}
              disabled={busy}
              onClick={async () => {
                setMessage(null)
                await refresh()
                const st = await window.api.history.getEncryption().catch(() => null)
                if (st && st.locked) setMessage(TRY_AGAIN_STILL_LOCKED)
              }}
            >
              Try again
            </button>
          )}
          <button style={dangerBtn} disabled={busy} onClick={() => setPending({ type: 'reset' })}>
            {transient ? 'Reset history...' : 'Reset history'}
          </button>
        </div>
      )}

      {message && (
        <div role="alert" style={{ ...s.hint, color: theme.danger, marginTop: '8px' }}>
          {message}
        </div>
      )}

      {!shouldShowLockedNotice(status) && (
        <div style={{ marginTop: '14px' }}>
          <div style={{ fontSize: '14px', fontWeight: 500, color: theme.text }}>Erase all history</div>
          <div style={{ ...s.hint, margin: '2px 0 8px' }}>
            Deletes every recording and transcript, including index.json.corrupt-* backups. When history is encrypted the key file is removed first.
          </div>
          <button style={dangerBtn} disabled={busy} onClick={() => setPending({ type: 'erase' })}>
            Erase all history
          </button>
        </div>
      )}

      {pending && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={dialogTitle}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'color-mix(in srgb, var(--wsp-bg) 70%, transparent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div
            style={{
              background: theme.bgSecondary,
              border: `1px solid ${theme.border}`,
              borderRadius: '12px',
              padding: '20px',
              maxWidth: '440px',
              color: theme.text,
              boxShadow: theme.shadow
            }}
          >
            <h3 style={{ margin: '0 0 10px', fontSize: '16px' }}>{dialogTitle}</h3>
            {dialogBody.map((p, i) => (
              <p key={i} style={{ ...s.hint, margin: '0 0 8px' }}>
                {p}
              </p>
            ))}
            {pending.type === 'toggle' && pending.dialog.warnGithub && (
              <label style={{ display: 'block', margin: '8px 0', fontSize: '12.5px', color: theme.text }}>
                <input type="checkbox" checked={turnOffSync} onChange={(e) => setTurnOffSync(e.target.checked)} />{' '}
                {GITHUB_WARNING} Turn GitHub sync off.
              </label>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px' }}>
              <button
                onClick={() => setPending(null)}
                disabled={busy}
                style={{
                  background: 'transparent',
                  border: `1px solid ${theme.border}`,
                  color: theme.text,
                  borderRadius: '8px',
                  padding: '7px 14px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirm}
                disabled={busy}
                style={{
                  background: enableDialog ? theme.accent : theme.danger,
                  color: enableDialog ? theme.accentInk : theme.bg,
                  border: 'none',
                  borderRadius: '8px',
                  padding: '7px 14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {busy ? 'Working...' : dialogConfirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
