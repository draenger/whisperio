// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, type CSSProperties } from 'react'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { SettingsForm } from '../src/renderer/components/settings/SettingsForm'
import { SelfhostedSettings, type SelfhostedSettingsProps } from '../src/renderer/components/settings/SettingsForm'
import { darkTheme } from '../src/renderer/theme'

/**
 * PACZKA 3: coverage for the two SettingsForm findings —
 *  1. The custom-model-URL download feature was fully implemented (ModelsTab)
 *     but unreachable (no nav entry rendered it). It has been ported into
 *     SelfhostedSettings, which already had a live nav path via the
 *     Providers tab -> "Local Model" -> cog. This proves the ported block
 *     still drives the real IPC (models.downloadCustom) with the entered
 *     values.
 *  2. settings.load() had no .catch, so a rejection stranded the window on
 *     "Loading..." forever. This proves a rejection now still clears the
 *     loading state (onto a retry screen) instead of hanging.
 *
 * No JSX (plain createElement calls) — same convention as
 * tests/CleanupPanel.test.ts / tests/UsagePanel.test.ts.
 */

const FAKE_STYLES = {
  container: {}, scrollArea: {}, sidebar: {}, sidebarLabel: {}, navItem: {}, navItemActive: {},
  versionBadge: {}, card: {}, cardTitle: {}, label: {}, input: {}, select: {}, textarea: {}, hint: {},
  footer: {}, button: {}
} as unknown as CSSProperties & Record<string, CSSProperties>

afterEach(() => cleanup())

function selfhostedProps(overrides: Partial<SelfhostedSettingsProps> = {}): SelfhostedSettingsProps {
  return {
    openaiBaseUrl: '',
    setOpenaiBaseUrl: vi.fn(),
    whisperModel: '',
    setWhisperModel: vi.fn(),
    sttApiKey: '',
    setSttApiKey: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s: FAKE_STYLES as any,
    theme: darkTheme,
    ...overrides
  }
}

function mockModelsApi(overrides: {
  available?: ReturnType<typeof vi.fn>
  local?: ReturnType<typeof vi.fn>
  cancelDownload?: ReturnType<typeof vi.fn>
} = {}): { downloadCustom: ReturnType<typeof vi.fn>; cancelDownload: ReturnType<typeof vi.fn> } {
  const downloadCustom = vi.fn().mockResolvedValue('/tmp/custom-model.bin')
  const cancelDownload = overrides.cancelDownload ?? vi.fn().mockResolvedValue(true)
  // @ts-expect-error minimal test double — only models/server are exercised
  window.api = {
    models: {
      available: overrides.available ?? vi.fn().mockResolvedValue([]),
      local: overrides.local ?? vi.fn().mockResolvedValue([]),
      download: vi.fn(),
      delete: vi.fn(),
      downloadCustom,
      cancelDownload,
      onDownloadProgress: vi.fn().mockReturnValue(() => {})
    },
    server: {
      status: vi.fn().mockResolvedValue({ status: 'stopped', model: null, port: 8178, platform: 'darwin' }),
      start: vi.fn(),
      stop: vi.fn(),
      onStatusChanged: vi.fn().mockReturnValue(() => {})
    }
  }
  return { downloadCustom, cancelDownload }
}

describe('SelfhostedSettings — custom model URL (formerly-unreachable ModelsTab feature)', () => {
  it('renders the ported Custom Model URL fields next to the catalog list', async () => {
    mockModelsApi()
    render(createElement(SelfhostedSettings, selfhostedProps()))
    await waitFor(() => expect(screen.getByText('Custom model URL')).toBeTruthy())
    expect(screen.getByPlaceholderText('https://huggingface.co/user/repo/resolve/main/model.bin')).toBeTruthy()
  })

  it('calls window.api.models.downloadCustom with the entered URL and filename', async () => {
    const { downloadCustom } = mockModelsApi()
    render(createElement(SelfhostedSettings, selfhostedProps()))
    await waitFor(() => expect(screen.getByText('Custom model URL')).toBeTruthy())

    fireEvent.change(
      screen.getByPlaceholderText('https://huggingface.co/user/repo/resolve/main/model.bin'),
      { target: { value: 'https://huggingface.co/user/repo/resolve/main/model.bin' } }
    )
    fireEvent.change(
      screen.getByPlaceholderText('Filename (optional, auto-detected from URL)'),
      { target: { value: 'my-model' } }
    )
    fireEvent.click(screen.getByText('Download from URL'))

    await waitFor(() =>
      expect(downloadCustom).toHaveBeenCalledWith(
        'https://huggingface.co/user/repo/resolve/main/model.bin',
        'my-model.bin'
      )
    )
  })

  it('disables the download button until a URL is entered', async () => {
    mockModelsApi()
    render(createElement(SelfhostedSettings, selfhostedProps()))
    await waitFor(() => expect(screen.getByText('Custom model URL')).toBeTruthy())
    const button = screen.getByText('Download from URL') as HTMLButtonElement
    expect(button.disabled).toBe(true)

    fireEvent.change(
      screen.getByPlaceholderText('https://huggingface.co/user/repo/resolve/main/model.bin'),
      { target: { value: 'https://example.com/model.bin' } }
    )
    expect(button.disabled).toBe(false)
  })
})

describe('SelfhostedSettings — cancel an in-progress model download', () => {
  const MODEL = { id: 'ggml-base', name: 'Base', size: '142MB', description: '', filename: 'ggml-base.bin' }

  it('shows a Cancel button next to the progress percent while a model is downloading, and calls models.cancelDownload on click', async () => {
    const { cancelDownload } = mockModelsApi({
      available: vi.fn().mockResolvedValue([MODEL]),
      local: vi.fn().mockResolvedValue([{ id: MODEL.id, name: MODEL.name, filename: MODEL.filename, size: 0, downloaded: false }])
    })
    render(createElement(SelfhostedSettings, selfhostedProps()))
    await waitFor(() => expect(screen.getByText('Base')).toBeTruthy())

    // Kick off a download the same way the real UI does — click "Get".
    fireEvent.click(screen.getByText('Get'))
    await waitFor(() => expect(screen.getByText('0%')).toBeTruthy())
    expect(screen.getByText('Cancel')).toBeTruthy()

    fireEvent.click(screen.getByText('Cancel'))

    await waitFor(() => expect(cancelDownload).toHaveBeenCalledWith(MODEL.id))
    // Local download state clears once cancelled — back to the "Get" affordance.
    await waitFor(() => expect(screen.queryByText('Cancel')).toBeNull())
    expect(screen.getByText('Get')).toBeTruthy()
  })

  it('logs a warning but still clears local state when cancelDownload reports no active download', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { cancelDownload } = mockModelsApi({
      available: vi.fn().mockResolvedValue([MODEL]),
      local: vi.fn().mockResolvedValue([{ id: MODEL.id, name: MODEL.name, filename: MODEL.filename, size: 0, downloaded: false }]),
      cancelDownload: vi.fn().mockResolvedValue(false)
    })
    render(createElement(SelfhostedSettings, selfhostedProps()))
    await waitFor(() => expect(screen.getByText('Base')).toBeTruthy())

    fireEvent.click(screen.getByText('Get'))
    await waitFor(() => expect(screen.getByText('Cancel')).toBeTruthy())
    fireEvent.click(screen.getByText('Cancel'))

    await waitFor(() => expect(cancelDownload).toHaveBeenCalledWith(MODEL.id))
    expect(warn).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Cancel')).toBeNull())
    warn.mockRestore()
  })
})

describe('SettingsForm — settings.load() failure handling', () => {
  function mockCoreApi(overrides: { load?: ReturnType<typeof vi.fn> } = {}): void {
    const load = overrides.load ?? vi.fn().mockResolvedValue({})
    // @ts-expect-error minimal test double — only what SettingsForm touches on
    // an initial mount of the (default) General tab is provided.
    window.api = {
      settings: {
        load,
        save: vi.fn().mockResolvedValue({}),
        pauseHotkeys: vi.fn(),
        resumeHotkeys: vi.fn(),
        onSetTab: vi.fn().mockReturnValue(() => {})
      },
      window: {
        getVersion: vi.fn().mockResolvedValue('1.5.0'),
        minimize: vi.fn(),
        maximize: vi.fn(),
        close: vi.fn()
      },
      updater: {
        getStatus: vi.fn().mockResolvedValue({ status: 'idle', currentVersion: '1.5.0' }),
        check: vi.fn(),
        install: vi.fn(),
        onStatus: vi.fn().mockReturnValue(() => {})
      }
    }
  }

  it('clears the loading state and shows a retry screen when settings.load() rejects', async () => {
    mockCoreApi({ load: vi.fn().mockRejectedValue(new Error('IPC not wired yet')) })
    render(createElement(SettingsForm))

    // Never gets stuck on the infinite "Loading..." screen...
    expect(screen.getByText('Loading...')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Loading...')).toBeNull())
    // ...instead lands on a distinct retry affordance.
    expect(screen.getByText('Failed to load settings.')).toBeTruthy()
    expect(screen.getByText('Retry')).toBeTruthy()
  })

  it('retry re-invokes settings.load() and proceeds to the real form on success', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('IPC not wired yet'))
      .mockResolvedValueOnce({})
    mockCoreApi({ load })
    render(createElement(SettingsForm))

    await waitFor(() => expect(screen.getByText('Failed to load settings.')).toBeTruthy())
    fireEvent.click(screen.getByText('Retry'))

    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Failed to load settings.')).toBeNull())
    await waitFor(() => expect(screen.queryByText('Loading...')).toBeNull())
  })

  it('renders straight through to the real form when settings.load() resolves normally', async () => {
    mockCoreApi()
    render(createElement(SettingsForm))
    await waitFor(() => expect(screen.queryByText('Loading...')).toBeNull())
    expect(screen.queryByText('Failed to load settings.')).toBeNull()
  })
})
