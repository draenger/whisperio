import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { RecordingEntry } from '../src/main/recordingStore'
import type { OnDemandCleanupResult } from '../src/main/transcribe'

const mockGetRecording = vi.fn()
const mockUpdateRecording = vi.fn()
vi.mock('../src/main/recordingStore', () => ({
  getRecording: (...args: unknown[]) => mockGetRecording(...args),
  updateRecording: (...args: unknown[]) => mockUpdateRecording(...args)
}))

const mockLoadSettings = vi.fn()
vi.mock('../src/main/settingsManager', () => ({
  loadSettings: (...args: unknown[]) => mockLoadSettings(...args),
  getActiveVocabulary: (settings: { customVocabulary?: string }) =>
    settings.customVocabulary?.trim() || ''
}))

vi.mock('electron', () => ({
  net: { request: vi.fn() },
  app: { isPackaged: false },
  Notification: class MockNotification {
    static isSupported = () => false
    show = vi.fn()
  },
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

// This test imports and exercises the REAL `recordings:cleanup` IPC handler
// body — `handleRecordingsCleanup`, exported from transcribe.ts and called
// directly by ipcMain.handle('recordings:cleanup', ...) in index.ts. Only
// recordingStore and settingsManager are mocked (the same boundary
// transcribe.test.ts uses elsewhere); cleanupOnDemand itself runs for real,
// so this also covers the cleanupEnabled guard end-to-end for the on-demand
// path, not just via a hand-copied mirror of the handler.
import { getRecording, updateRecording } from '../src/main/recordingStore'
import { handleRecordingsCleanup } from '../src/main/transcribe'

describe('recordings:cleanup IPC handler (handleRecordingsCleanup)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails soft with "no transcript" when the recording has no transcription, without calling loadSettings/updateRecording', async () => {
    mockGetRecording.mockReturnValue({ id: 'rec-1', transcription: undefined } as Partial<RecordingEntry>)

    const result = await handleRecordingsCleanup('rec-1', { mode: 'full' })

    expect(result).toEqual({ text: '', ok: false, cleanedWith: 'no transcript' })
    expect(mockLoadSettings).not.toHaveBeenCalled()
    expect(mockUpdateRecording).not.toHaveBeenCalled()
  })

  it('fails soft with "no transcript" when the recording id is not found', async () => {
    mockGetRecording.mockReturnValue(null)

    const result = await handleRecordingsCleanup('missing', { mode: 'light' })

    expect(result).toEqual({ text: '', ok: false, cleanedWith: 'no transcript' })
    expect(mockLoadSettings).not.toHaveBeenCalled()
    expect(mockUpdateRecording).not.toHaveBeenCalled()
  })

  it('persists cleanedText and cleanedWith on a successful cleanup', async () => {
    mockGetRecording.mockReturnValue({ id: 'rec-2', transcription: 'raw transcript text' })
    mockLoadSettings.mockReturnValue({
      cleanupEnabled: true,
      openaiApiKey: 'sk-test',
      aiProvider: 'openai',
      cleanupTemplates: []
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'Cleaned text.' } }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await handleRecordingsCleanup('rec-2', { mode: 'full' })

    expect(mockUpdateRecording).toHaveBeenCalledWith('rec-2', {
      cleanedText: 'Cleaned text.',
      cleanedWith: 'full'
    })
    expect(result).toEqual<OnDemandCleanupResult>({ text: 'Cleaned text.', ok: true, cleanedWith: 'full' })

    vi.unstubAllGlobals()
  })

  it('on a fail-soft cleanupOnDemand result (e.g. unknown template), persists undefined cleanedText but keeps cleanedWith', async () => {
    mockGetRecording.mockReturnValue({ id: 'rec-3', transcription: 'raw transcript text' })
    mockLoadSettings.mockReturnValue({
      cleanupEnabled: true,
      openaiApiKey: 'sk-test',
      aiProvider: 'openai',
      cleanupTemplates: []
    })

    const result = await handleRecordingsCleanup('rec-3', { templateId: 'does-not-exist' })

    expect(mockUpdateRecording).toHaveBeenCalledWith('rec-3', {
      cleanedText: undefined,
      cleanedWith: 'unknown template'
    })
    expect(result).toEqual({ text: 'raw transcript text', ok: false, cleanedWith: 'unknown template' })
  })

  it('fails soft with "cleanup disabled" (and still persists it) when settings.cleanupEnabled is false — the toggle actually gates the real handler', async () => {
    mockGetRecording.mockReturnValue({ id: 'rec-4', transcription: 'raw transcript text' })
    mockLoadSettings.mockReturnValue({
      cleanupEnabled: false,
      openaiApiKey: 'sk-test',
      aiProvider: 'openai',
      cleanupTemplates: []
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await handleRecordingsCleanup('rec-4', { mode: 'full' })

    expect(result).toEqual({ text: 'raw transcript text', ok: false, cleanedWith: 'cleanup disabled' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockUpdateRecording).toHaveBeenCalledWith('rec-4', {
      cleanedText: undefined,
      cleanedWith: 'cleanup disabled'
    })

    vi.unstubAllGlobals()
  })
})
