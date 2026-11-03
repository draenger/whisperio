// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, type CSSProperties } from 'react'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { PrivacyPanel } from '../src/renderer/components/settings/PrivacyPanel'
import { darkTheme } from '../src/renderer/theme'

// Not runnable locally (jsdom missing); CI runs it. No JSX, same convention as UsagePanel.test.ts.

const FAKE_STYLES: Record<'card' | 'cardTitle' | 'hint', CSSProperties> = { card: {}, cardTitle: {}, hint: {} }

function mockApi(opts: { locked?: boolean; github?: boolean } = {}) {
  const setEncryption = vi.fn().mockResolvedValue({ ok: true })
  const disconnect = vi.fn().mockResolvedValue({})
  const resetLocked = vi.fn().mockResolvedValue(true)
  const deleteAll = vi.fn().mockResolvedValue(undefined)
  ;(window as unknown as { api: unknown }).api = {
    history: {
      getEncryption: vi.fn().mockResolvedValue({
        enabled: false,
        sealedOnDisk: !!opts.locked,
        locked: !!opts.locked,
        vault: { ok: true }
      }),
      getEncryptionStatus: vi.fn().mockResolvedValue({ state: opts.locked ? 'locked' : 'off', done: 0, total: 0 }),
      setEncryption,
      resetLocked
    },
    github: {
      status: vi.fn().mockResolvedValue({ connected: !!opts.github, repo: opts.github ? 'a/b' : '' }),
      disconnect
    },
    recordings: { deleteAll }
  }
  return { setEncryption, disconnect, resetLocked, deleteAll }
}

afterEach(() => cleanup())

describe('PrivacyPanel', () => {
  it('turning ON needs a confirm, then calls setEncryption(true)', async () => {
    const api = mockApi()
    render(createElement(PrivacyPanel, { s: FAKE_STYLES, theme: darkTheme }))
    const box = await screen.findByRole('checkbox', { hidden: true })
    fireEvent.click(box)
    expect(api.setEncryption).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByText('Encrypt'))
    await waitFor(() => expect(api.setEncryption).toHaveBeenCalledWith(true))
  })

  it('shows GitHub warning and disconnects sync when confirmed', async () => {
    const api = mockApi({ github: true })
    render(createElement(PrivacyPanel, { s: FAKE_STYLES, theme: darkTheme }))
    fireEvent.click(await screen.findByRole('checkbox', { hidden: true }))
    await screen.findByText(/GitHub sync is on/)
    fireEvent.click(screen.getByText('Encrypt'))
    await waitFor(() => expect(api.disconnect).toHaveBeenCalled())
  })

  it('locked history shows the message and Reset history after confirm', async () => {
    const api = mockApi({ locked: true })
    render(createElement(PrivacyPanel, { s: FAKE_STYLES, theme: darkTheme }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByText('Reset history'))
    const buttons = await screen.findAllByText('Reset history', { selector: 'button' })
    fireEvent.click(buttons[buttons.length - 1])
    await waitFor(() => expect(api.resetLocked).toHaveBeenCalled())
  })

  it('erase all confirms before deleting', async () => {
    const api = mockApi()
    render(createElement(PrivacyPanel, { s: FAKE_STYLES, theme: darkTheme }))
    fireEvent.click(await screen.findByText('Erase all history', { selector: 'button' }))
    expect(api.deleteAll).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByText('Erase all'))
    await waitFor(() => expect(api.deleteAll).toHaveBeenCalled())
  })
})
