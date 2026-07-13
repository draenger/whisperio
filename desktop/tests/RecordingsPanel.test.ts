// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createElement } from 'react'
import { render, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { RecordingsView } from '../src/renderer/components/recordings/RecordingsPanel'

/**
 * ROUGH-FIRST on-demand cleanup (v1.4 PR2): renderer coverage for
 * RecordingsPanel's "Clean up" action.
 *
 * No JSX here (plain createElement calls) — same convention as
 * tests/CleanupPanel.test.ts and tests/ThemeContext.test.ts: this repo's
 * *.test.ts files don't have the React JSX runtime wired up.
 *
 * src/renderer/**\/*.tsx is excluded from the coverage gate (vitest.config.ts),
 * but this still exercises the real render + IPC-call + fail-soft-hint
 * behavior rather than just typechecking it.
 */

const RECORDING = {
  id: 'rec-1',
  filename: 'recording-1.webm',
  filepath: '/tmp/recording-1.webm',
  timestamp: 1710000000000,
  duration: 12.5,
  status: 'completed' as const,
  provider: 'openai',
  transcription: 'um so like we need to finish the report by friday',
  size: 4096
}

const TEMPLATES = [{ id: 't1', name: 'Notes', prompt: 'Reformat as bullet notes.' }]

function mockApi(overrides: Partial<Record<string, unknown>> = {}): {
  cleanup: ReturnType<typeof vi.fn>
} {
  const cleanup = vi.fn()
  const api = {
    recordings: {
      list: vi.fn().mockResolvedValue([{ ...RECORDING }]),
      getAudio: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(true),
      deleteAll: vi.fn().mockResolvedValue(undefined),
      reprocess: vi.fn().mockResolvedValue(null),
      cleanup,
      ...((overrides.recordings as Record<string, unknown>) ?? {})
    },
    settings: {
      load: vi.fn().mockResolvedValue({ cleanupMode: 'full', cleanupTemplates: TEMPLATES }),
      ...((overrides.settings as Record<string, unknown>) ?? {})
    }
  }
  // @ts-expect-error minimal test double — only the methods this panel calls are exercised
  window.api = api
  return { cleanup }
}

async function openDetail(): Promise<void> {
  await waitFor(() => expect(screen.getByText(/we need to finish the report/)).toBeTruthy())
  fireEvent.click(screen.getByText(/we need to finish the report/))
  await waitFor(() => expect(screen.getByText('Clean up')).toBeTruthy())
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true
  })
})

afterEach(() => {
  cleanup()
  // @ts-expect-error test cleanup of the global test double
  delete window.api
})

describe('RecordingsPanel — on-demand Clean up action', () => {
  it('renders a Clean up trigger for a completed recording with a transcript, opening a menu with mode/templates/custom', async () => {
    mockApi()
    render(createElement(RecordingsView))
    await openDetail()

    fireEvent.click(screen.getByText('Clean up'))
    expect(screen.getByTestId('cleanup-menu')).toBeTruthy()
    expect(screen.getByText('Clean up (full)')).toBeTruthy()
    expect(screen.getByText('Notes')).toBeTruthy()
    expect(screen.getByText('Custom instruction…')).toBeTruthy()
  })

  it('emits the IPC call with the template id and renders the result with a Copy button', async () => {
    const { cleanup: cleanupMock } = mockApi()
    cleanupMock.mockResolvedValue({ text: '- Finish the report by Friday', ok: true, cleanedWith: 'Notes' })

    render(createElement(RecordingsView))
    await openDetail()

    fireEvent.click(screen.getByText('Clean up'))
    fireEvent.click(screen.getByText('Notes'))

    expect(cleanupMock).toHaveBeenCalledWith('rec-1', { templateId: 't1' })

    await waitFor(() => expect(screen.getByText('- Finish the report by Friday')).toBeTruthy())
    expect(screen.getByText('Cleaned (Notes)')).toBeTruthy()

    const resultBlock = screen.getByTestId('cleanup-result')
    fireEvent.click(within(resultBlock).getByText('Copy'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('- Finish the report by Friday')
  })

  it('sends the default mode option for the plain "Clean up (full)" menu item', async () => {
    const { cleanup: cleanupMock } = mockApi()
    cleanupMock.mockResolvedValue({ text: 'Cleaned.', ok: true, cleanedWith: 'full' })

    render(createElement(RecordingsView))
    await openDetail()

    fireEvent.click(screen.getByText('Clean up'))
    fireEvent.click(screen.getByText('Clean up (full)'))

    expect(cleanupMock).toHaveBeenCalledWith('rec-1', { mode: 'full' })
    await waitFor(() => expect(screen.getByText('Cleaned.')).toBeTruthy())
  })

  it('sends a custom instruction when typed into the "Custom instruction…" field and Apply is clicked', async () => {
    const { cleanup: cleanupMock } = mockApi()
    cleanupMock.mockResolvedValue({ text: 'Summarized.', ok: true, cleanedWith: 'Custom instruction' })

    render(createElement(RecordingsView))
    await openDetail()

    fireEvent.click(screen.getByText('Clean up'))
    fireEvent.click(screen.getByText('Custom instruction…'))

    const textarea = screen.getByPlaceholderText('e.g. Summarize in two sentences')
    fireEvent.change(textarea, { target: { value: 'Summarize in one sentence' } })
    fireEvent.click(screen.getByText('Apply'))

    expect(cleanupMock).toHaveBeenCalledWith('rec-1', { customInstruction: 'Summarize in one sentence' })
    await waitFor(() => expect(screen.getByText('Summarized.')).toBeTruthy())
  })

  it('fails soft with an inline hint (no cleaned text, no error dialog) when the result is ok: false', async () => {
    const { cleanup: cleanupMock } = mockApi()
    cleanupMock.mockResolvedValue({ text: 'um so like we need to finish the report by friday', ok: false, cleanedWith: 'full' })

    render(createElement(RecordingsView))
    await openDetail()

    fireEvent.click(screen.getByText('Clean up'))
    fireEvent.click(screen.getByText('Clean up (full)'))

    await waitFor(() => expect(screen.getByTestId('cleanup-hint')).toBeTruthy())
    expect(screen.getByTestId('cleanup-hint').textContent).toMatch(/AI unreachable — raw kept/)
  })

  it('fails soft with the same inline hint when the IPC call itself rejects (e.g. no handler registered)', async () => {
    const { cleanup: cleanupMock } = mockApi()
    cleanupMock.mockRejectedValue(new Error('No handler registered for recordings:cleanup'))

    render(createElement(RecordingsView))
    await openDetail()

    fireEvent.click(screen.getByText('Clean up'))
    fireEvent.click(screen.getByText('Clean up (full)'))

    await waitFor(() => expect(screen.getByTestId('cleanup-hint')).toBeTruthy())
    expect(screen.getByTestId('cleanup-hint').textContent).toMatch(/AI unreachable — raw kept/)
  })

  it('hydrates a persisted cleanedText/cleanedWith from the recording entry without an extra IPC call', async () => {
    const { cleanup: cleanupMock } = mockApi({
      recordings: {
        list: vi.fn().mockResolvedValue([
          { ...RECORDING, cleanedText: 'Previously cleaned text', cleanedWith: 'light' }
        ])
      }
    })

    render(createElement(RecordingsView))
    await openDetail()

    expect(screen.getByText('Previously cleaned text')).toBeTruthy()
    expect(screen.getByText('Cleaned (light)')).toBeTruthy()
    expect(cleanupMock).not.toHaveBeenCalled()
  })
})
