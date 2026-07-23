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
  deleteByDate: ReturnType<typeof vi.fn>
} {
  const cleanup = vi.fn()
  const deleteByDate = vi.fn().mockResolvedValue(undefined)
  const api = {
    recordings: {
      list: vi.fn().mockResolvedValue([{ ...RECORDING }]),
      getAudio: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(true),
      deleteAll: vi.fn().mockResolvedValue(undefined),
      deleteByDate,
      reprocess: vi.fn().mockResolvedValue(null),
      cleanup,
      ...((overrides.recordings as Record<string, unknown>) ?? {})
    },
    settings: {
      load: vi.fn().mockResolvedValue({ cleanupMode: 'full', cleanupTemplates: TEMPLATES }),
      ...((overrides.settings as Record<string, unknown>) ?? {})
    },
    conversation: {
      available: vi.fn().mockResolvedValue(true),
      save: vi.fn().mockResolvedValue({ ...RECORDING }),
      ...((overrides.conversation as Record<string, unknown>) ?? {})
    }
  }
  // @ts-expect-error minimal test double — only the methods this panel calls are exercised
  window.api = api
  return { cleanup, deleteByDate }
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

  it('groups recordings by local day with a header per day, then deletes a day after a second confirm click', async () => {
    // Local-time Date constructor (not a UTC ISO string) so the group key
    // this test asserts on matches dayKeyOf's local getFullYear/Month/Date
    // regardless of the machine's timezone.
    const recA = {
      ...RECORDING,
      id: 'rec-a',
      timestamp: new Date(2024, 2, 10, 9, 0, 0).getTime(),
      transcription: 'first day recording transcript'
    }
    const recB = {
      ...RECORDING,
      id: 'rec-b',
      timestamp: new Date(2024, 2, 11, 9, 0, 0).getTime(),
      transcription: 'second day recording transcript'
    }
    const listMock = vi.fn()
      .mockResolvedValueOnce([recA, recB])
      .mockResolvedValueOnce([recB])
    const { deleteByDate } = mockApi({
      recordings: {
        list: listMock
      }
    })

    render(createElement(RecordingsView))

    await waitFor(() => expect(screen.getByText(/first day recording transcript/)).toBeTruthy())
    expect(screen.getByText(/second day recording transcript/)).toBeTruthy()

    const dayHeaderA = screen.getByTestId('day-header-2024-03-10')
    const dayHeaderB = screen.getByTestId('day-header-2024-03-11')
    expect(within(dayHeaderA).getByText('2024-03-10')).toBeTruthy()
    expect(within(dayHeaderA).getByText('1 recording')).toBeTruthy()
    expect(within(dayHeaderB).getByText('2024-03-11')).toBeTruthy()
    expect(within(dayHeaderB).getByText('1 recording')).toBeTruthy()

    const deleteDayButton = within(dayHeaderA).getByText('Delete this day')
    fireEvent.click(deleteDayButton)
    expect(within(dayHeaderA).getByText('Confirm?')).toBeTruthy()
    expect(deleteByDate).not.toHaveBeenCalled()

    fireEvent.click(within(dayHeaderA).getByText('Confirm?'))
    expect(deleteByDate).toHaveBeenCalledWith('2024-03-10')

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText(/first day recording transcript/)).toBeNull())
    expect(screen.getByText(/second day recording transcript/)).toBeTruthy()
    expect(screen.queryByTestId('day-header-2024-03-10')).toBeNull()
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
