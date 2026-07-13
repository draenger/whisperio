// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, waitFor, cleanup } from '@testing-library/react'
import { ThemeProvider, useTheme } from '../src/renderer/ThemeContext'

/**
 * STEP0 theming wiring: ThemeProvider is the single place that stamps
 * <html data-theme>/<html data-accent> so tokens.css's [data-theme]/
 * [data-accent] selectors resolve the right --wsp-* literal. These tests
 * cover that stamping plus the "never leave the UI on an unknown theme"
 * fallback contract — they don't assert on rendered colors (that's what
 * tokens.css + buildTheme's var()-reference tests in theme.test.ts cover).
 *
 * No JSX here (plain createElement calls): vitest's default esbuild
 * transform for this repo's tests doesn't have the React JSX runtime wired
 * up, and this is a plain .test.ts, not .tsx.
 */

function Probe(): null {
  useTheme()
  return null
}

function mockSettingsApi(settings: Record<string, unknown>): { load: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> } {
  const api = {
    load: vi.fn().mockResolvedValue({ theme: 'dark', accentColor: 'teal', ...settings }),
    save: vi.fn().mockResolvedValue(undefined)
  }
  // @ts-expect-error minimal test double — only .settings.{load,save} are exercised by ThemeContext
  window.api = { settings: api }
  return api
}

function renderProvider(): void {
  render(createElement(ThemeProvider, null, createElement(Probe)))
}

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-accent')
  // @ts-expect-error test cleanup of the global test double
  delete window.api
})

describe('ThemeProvider data-theme/data-accent stamping', () => {
  it('defaults <html data-theme> to dark before settings finish loading', () => {
    mockSettingsApi({})
    renderProvider()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.accent).toBe('teal')
  })

  it('stamps the persisted theme and accent once settings load', async () => {
    mockSettingsApi({ theme: 'light', accentColor: 'amber' })
    renderProvider()
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('light')
      expect(document.documentElement.dataset.accent).toBe('amber')
    })
  })

  it('maps legacy theme "violet-legacy" to "dark" (VIOLET-OUT)', async () => {
    mockSettingsApi({ theme: 'violet-legacy' })
    renderProvider()
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark')
    })
  })

  it('maps legacy accent "violet" to "teal" (VIOLET-OUT)', async () => {
    mockSettingsApi({ accentColor: 'violet' })
    renderProvider()
    await waitFor(() => {
      expect(document.documentElement.dataset.accent).toBe('teal')
    })
  })

  it('maps both legacy theme and accent together, idempotently on repeated loads', async () => {
    const api = mockSettingsApi({ theme: 'violet-legacy', accentColor: 'violet' })
    renderProvider()
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark')
      expect(document.documentElement.dataset.accent).toBe('teal')
    })
    // Simulate a second load (e.g. re-mount) resolving the same persisted
    // legacy values — mapping must be stable, not compound further.
    await api.load()
    renderProvider()
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark')
      expect(document.documentElement.dataset.accent).toBe('teal')
    })
  })

  it('falls back to dark when the persisted theme value is unrecognized', async () => {
    const api = mockSettingsApi({ theme: 'chartreuse' })
    renderProvider()
    await waitFor(() => {
      expect(api.load).toHaveBeenCalled()
    })
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('falls back to dark when theme is missing from settings entirely', async () => {
    const api = mockSettingsApi({})
    api.load.mockResolvedValue({ accentColor: 'blue' })
    renderProvider()
    await waitFor(() => {
      expect(document.documentElement.dataset.accent).toBe('blue')
    })
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
