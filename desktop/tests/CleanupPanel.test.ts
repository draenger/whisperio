// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, type CSSProperties } from 'react'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import {
  CleanupPanel,
  isOnDeviceBaseUrl,
  type CleanupPanelProps,
  type CleanupMode,
  type AiProvider,
  type CleanupTemplate
} from '../src/renderer/components/settings/CleanupPanel'
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
const FAKE_STYLES: Record<'card' | 'cardTitle' | 'label' | 'input' | 'select' | 'hint' | 'textarea', CSSProperties> = {
  card: {},
  cardTitle: {},
  label: {},
  input: {},
  select: {},
  hint: {},
  textarea: {}
}

function makeProps(overrides: Partial<CleanupPanelProps> = {}): CleanupPanelProps {
  return {
    cleanupEnabled: false,
    setCleanupEnabled: vi.fn(),
    cleanupMode: 'light' as CleanupMode,
    setCleanupMode: vi.fn(),
    cleanupAuto: false,
    setCleanupAuto: vi.fn(),
    cleanupTemplates: [],
    setCleanupTemplates: vi.fn(),
    aiProvider: 'openai' as AiProvider,
    setAiProvider: vi.fn(),
    aiBaseUrl: '',
    setAiBaseUrl: vi.fn(),
    aiModel: '',
    setAiModel: vi.fn(),
    anthropicApiKey: '',
    setAnthropicApiKey: vi.fn(),
    replicateApiKey: '',
    setReplicateApiKey: vi.fn(),
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
    expect(screen.getByText('Enable AI cleanup')).toBeTruthy()
    expect(screen.queryByText('Clean up automatically after dictation')).toBeNull()
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

  it('renders the auto-cleanup toggle (default OFF) once enabled, and emits a change when clicked', () => {
    const setCleanupAuto = vi.fn()
    const { container } = render(
      createElement(CleanupPanel, makeProps({ cleanupEnabled: true, cleanupAuto: false, setCleanupAuto }))
    )
    expect(screen.getByText('Clean up automatically after dictation')).toBeTruthy()

    const checkboxes = container.querySelectorAll('input[type="checkbox"]')
    // First checkbox is "Enable AI cleanup", second is the auto toggle.
    fireEvent.click(checkboxes[1])
    expect(setCleanupAuto).toHaveBeenCalledWith(true)
  })

  it('does not crash when cleanupAuto/setCleanupAuto are omitted (pre-wiring callers)', () => {
    const props = makeProps({ cleanupEnabled: true })
    delete (props as Partial<CleanupPanelProps>).cleanupAuto
    delete (props as Partial<CleanupPanelProps>).setCleanupAuto
    expect(() => render(createElement(CleanupPanel, props))).not.toThrow()
    // Defaults to unchecked (false) when the prop isn't supplied.
    expect(screen.getByText('Clean up automatically after dictation')).toBeTruthy()
  })

  it('shows the Anthropic API key field only when aiProvider is anthropic', () => {
    const { rerender } = render(createElement(CleanupPanel, makeProps({ cleanupEnabled: true, aiProvider: 'openai' })))
    expect(screen.queryByText('Anthropic API Key')).toBeNull()

    rerender(createElement(CleanupPanel, makeProps({ cleanupEnabled: true, aiProvider: 'anthropic' })))
    expect(screen.getByText('Anthropic API Key')).toBeTruthy()
  })

  it('lists Replicate alongside OpenAI/Anthropic/Local in the provider select', () => {
    render(createElement(CleanupPanel, makeProps({ cleanupEnabled: true })))
    expect(screen.getByText('Replicate (cloud)')).toBeTruthy()
  })

  it('shows the Replicate API key field only when aiProvider is replicate', () => {
    const { rerender } = render(createElement(CleanupPanel, makeProps({ cleanupEnabled: true, aiProvider: 'openai' })))
    expect(screen.queryByText('Replicate API Key')).toBeNull()

    rerender(createElement(CleanupPanel, makeProps({ cleanupEnabled: true, aiProvider: 'replicate' })))
    expect(screen.getByText('Replicate API Key')).toBeTruthy()
  })

  it('emits a change when the Replicate API key field is edited', () => {
    const setReplicateApiKey = vi.fn()
    render(createElement(CleanupPanel, makeProps({ cleanupEnabled: true, aiProvider: 'replicate', setReplicateApiKey })))
    fireEvent.change(screen.getByPlaceholderText('r8_...'), { target: { value: 'r8_secret' } })
    expect(setReplicateApiKey).toHaveBeenCalledWith('r8_secret')
  })

  it('renders the model picker as a dropdown for a hosted provider', () => {
    render(createElement(CleanupPanel, makeProps({ cleanupEnabled: true, aiProvider: 'openai' })))
    expect(screen.getByTestId('model-select')).toBeTruthy()
  })

  it('renders the model picker as free text for the local provider', () => {
    render(createElement(CleanupPanel, makeProps({ cleanupEnabled: true, aiProvider: 'local' })))
    expect(screen.getByTestId('model-freetext')).toBeTruthy()
    expect(screen.queryByTestId('model-select')).toBeNull()
  })

  it('renders the model picker as free text when aiBaseUrl is on-device, even for a hosted provider', () => {
    render(createElement(CleanupPanel, makeProps({ cleanupEnabled: true, aiProvider: 'openai', aiBaseUrl: 'http://127.0.0.1:11434' })))
    expect(screen.getByTestId('model-freetext')).toBeTruthy()
    expect(screen.queryByTestId('model-select')).toBeNull()
  })

  it('shows the on-device badge for a loopback base URL and hides it for a cloud host', () => {
    const { rerender } = render(
      createElement(CleanupPanel, makeProps({ cleanupEnabled: true, aiBaseUrl: 'http://127.0.0.1:11434' }))
    )
    expect(screen.getByTestId('ondevice-badge')).toBeTruthy()

    rerender(createElement(CleanupPanel, makeProps({ cleanupEnabled: true, aiBaseUrl: 'https://api.openai.com' })))
    expect(screen.queryByTestId('ondevice-badge')).toBeNull()
  })

  describe('cleanup templates editor', () => {
    const templates: CleanupTemplate[] = [
      { id: 'email', name: 'Email', prompt: 'Reformat as an email.' }
    ]

    it('renders existing templates and edits emit through setCleanupTemplates', () => {
      const setCleanupTemplates = vi.fn()
      render(createElement(CleanupPanel, makeProps({ cleanupEnabled: true, cleanupTemplates: templates, setCleanupTemplates })))

      const nameInput = screen.getByPlaceholderText('Template name (e.g. Email)') as HTMLInputElement
      expect(nameInput.value).toBe('Email')

      fireEvent.change(nameInput, { target: { value: 'Work email' } })
      expect(setCleanupTemplates).toHaveBeenCalledWith([{ id: 'email', name: 'Work email', prompt: 'Reformat as an email.' }])
    })

    it('adds a blank template when "+ Add template" is clicked', () => {
      const setCleanupTemplates = vi.fn()
      render(createElement(CleanupPanel, makeProps({ cleanupEnabled: true, cleanupTemplates: [], setCleanupTemplates })))

      fireEvent.click(screen.getByText('+ Add template'))
      expect(setCleanupTemplates).toHaveBeenCalledTimes(1)
      const added = setCleanupTemplates.mock.calls[0][0]
      expect(added).toHaveLength(1)
      expect(added[0]).toMatchObject({ name: '', prompt: '' })
      expect(typeof added[0].id).toBe('string')
      expect(added[0].id.length).toBeGreaterThan(0)
    })

    it('removes a template when its Remove button is clicked', () => {
      const setCleanupTemplates = vi.fn()
      render(createElement(CleanupPanel, makeProps({ cleanupEnabled: true, cleanupTemplates: templates, setCleanupTemplates })))

      fireEvent.click(screen.getByTitle('Remove "Email"'))
      expect(setCleanupTemplates).toHaveBeenCalledWith([])
    })

    it('does not crash when cleanupTemplates/setCleanupTemplates are omitted (pre-wiring callers)', () => {
      const props = makeProps({ cleanupEnabled: true })
      delete (props as Partial<CleanupPanelProps>).cleanupTemplates
      delete (props as Partial<CleanupPanelProps>).setCleanupTemplates
      expect(() => render(createElement(CleanupPanel, props))).not.toThrow()
      expect(screen.getByText('+ Add template')).toBeTruthy()
    })
  })
})
