// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, type CSSProperties } from 'react'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { CleanupPanel, isOnDeviceBaseUrl, type CleanupPanelProps, type CleanupMode, type AiProvider } from '../src/renderer/components/settings/CleanupPanel'
import { darkTheme } from '../src/renderer/theme'

/**
 * PACZKA A-UI: renderer coverage for the "AI Cleanup" settings panel.
 *
 * No JSX here (plain createElement calls) — matches tests/ThemeContext.test.ts:
 * vitest's default esbuild transform for this repo's *.test.ts files doesn't
 * have the React JSX runtime wired up.
 *
 * src/renderer/**\/*.tsx is excluded from the coverage gate (vitest.config.ts —
 * React UI components are exercised by manual/smoke testing, not the coverage
 * threshold), but the pure `isOnDeviceBaseUrl` classifier is real, isolatable
 * logic, so it gets direct unit coverage below in addition to the render tests.
 */

// Minimal stand-in for makeStyles(theme)'s output — CleanupPanel only reads
// these six keys (see its local SettingsStyles type), so this fake only
// needs to be *structurally* wide enough to satisfy that, not a full replica.
const FAKE_STYLES: Record<'card' | 'cardTitle' | 'label' | 'input' | 'select' | 'hint', CSSProperties> = {
  card: {},
  cardTitle: {},
  label: {},
  input: {},
  select: {},
  hint: {}
}

function makeProps(overrides: Partial<CleanupPanelProps> = {}): CleanupPanelProps {
  return {
    cleanupEnabled: false,
    setCleanupEnabled: vi.fn(),
    cleanupMode: 'light' as CleanupMode,
    setCleanupMode: vi.fn(),
    aiProvider: 'openai' as AiProvider,
    setAiProvider: vi.fn(),
    aiBaseUrl: '',
    setAiBaseUrl: vi.fn(),
    aiModel: '',
    setAiModel: vi.fn(),
    anthropicApiKey: '',
    setAnthropicApiKey: vi.fn(),
    s: FAKE_STYLES,
    theme: darkTheme,
    ...overrides
  }
}

afterEach(() => cleanup())

describe('isOnDeviceBaseUrl', () => {
  it('treats loopback and private hostnames as on-device', () => {
    expect(isOnDeviceBaseUrl('http://127.0.0.1:11434')).toBe(true)
    expect(isOnDeviceBaseUrl('127.0.0.1:11434')).toBe(true) // bare host:port, no scheme
    expect(isOnDeviceBaseUrl('localhost:8080')).toBe(true)
    expect(isOnDeviceBaseUrl('http://10.0.0.5:9000')).toBe(true)
    expect(isOnDeviceBaseUrl('http://192.168.1.20')).toBe(true)
    expect(isOnDeviceBaseUrl('http://172.20.0.4')).toBe(true)
    expect(isOnDeviceBaseUrl('http://my-mac.local:11434')).toBe(true)
  })

  it('treats hosted cloud APIs as not on-device', () => {
    expect(isOnDeviceBaseUrl('https://api.openai.com')).toBe(false)
    expect(isOnDeviceBaseUrl('https://api.anthropic.com')).toBe(false)
    expect(isOnDeviceBaseUrl('https://172.32.0.4')).toBe(false) // just outside 172.16-31 private range
  })

  it('fails soft (false, never throws) on empty or malformed input', () => {
    expect(isOnDeviceBaseUrl('')).toBe(false)
    expect(isOnDeviceBaseUrl('   ')).toBe(false)
    expect(() => isOnDeviceBaseUrl('not a url at all :::')).not.toThrow()
    expect(isOnDeviceBaseUrl('not a url at all :::')).toBe(false)
  })
})

describe('CleanupPanel', () => {
  it('renders the master toggle and hides mode/provider fields while disabled', () => {
    render(createElement(CleanupPanel, makeProps({ cleanupEnabled: false })))
    expect(screen.getByText('Clean up transcriptions')).toBeTruthy()
    expect(screen.queryByText('Cleanup level')).toBeNull()
    expect(screen.queryByText('AI Provider')).toBeNull()
    // Fail-soft hint is always visible, enabled or not.
    expect(screen.getByText(/raw transcription is pasted/i)).toBeTruthy()
  })

  it('emits a change when the master toggle is clicked', () => {
    const setCleanupEnabled = vi.fn()
    const { container } = render(createElement(CleanupPanel, makeProps({ cleanupEnabled: false, setCleanupEnabled })))
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkbox).toBeTruthy()
    fireEvent.click(checkbox)
    expect(setCleanupEnabled).toHaveBeenCalledWith(true)
  })

  it('shows the mode Segmented + provider fields once enabled, and switching modes emits a change', () => {
    const setCleanupMode = vi.fn()
    render(createElement(CleanupPanel, makeProps({ cleanupEnabled: true, cleanupMode: 'light', setCleanupMode })))
    expect(screen.getByText('Cleanup level')).toBeTruthy()
    expect(screen.getByText('AI Provider')).toBeTruthy()

    fireEvent.click(screen.getByText('Full'))
    expect(setCleanupMode).toHaveBeenCalledWith('full')
  })

  it('shows the Anthropic API key field only when aiProvider is anthropic', () => {
    const { rerender } = render(createElement(CleanupPanel, makeProps({ cleanupEnabled: true, aiProvider: 'openai' })))
    expect(screen.queryByText('Anthropic API Key')).toBeNull()

    rerender(createElement(CleanupPanel, makeProps({ cleanupEnabled: true, aiProvider: 'anthropic' })))
    expect(screen.getByText('Anthropic API Key')).toBeTruthy()
  })

  it('shows the on-device badge for a loopback base URL and hides it for a cloud host', () => {
    const { rerender } = render(
      createElement(CleanupPanel, makeProps({ cleanupEnabled: true, aiBaseUrl: 'http://127.0.0.1:11434' }))
    )
    expect(screen.getByTestId('ondevice-badge')).toBeTruthy()

    rerender(createElement(CleanupPanel, makeProps({ cleanupEnabled: true, aiBaseUrl: 'https://api.openai.com' })))
    expect(screen.queryByTestId('ondevice-badge')).toBeNull()
  })
})
