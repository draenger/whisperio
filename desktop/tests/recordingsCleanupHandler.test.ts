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

  // Context-aware tone (v1.5 Work Item B): the recording's context snapshot,
  // captured at RECORDING time (not at this "Clean up" click), drives the
  // tone profile fed into the mode-based cleanup rewrite.
  describe('context-aware tone', () => {
    it("resolves a tone profile from the recording's captured context and injects it into the cleanup prompt", async () => {
      mockGetRecording.mockReturnValue({
        id: 'rec-5',
        transcription: 'raw transcript text',
        recordedProcessName: 'Slack',
        recordedWindowTitle: '#general'
      })
      mockLoadSettings.mockReturnValue({
        cleanupEnabled: true,
        openaiApiKey: 'sk-test',
        aiProvider: 'openai',
        cleanupTemplates: [],
        contextAwareTone: true,
        toneMap: { slack: 'casual' }
      })
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'yo, cleaned up' } }] })
      })
      vi.stubGlobal('fetch', fetchMock)

      await handleRecordingsCleanup('rec-5', { mode: 'full' })

      const completionCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/chat/completions'))
      const body = JSON.parse((completionCall as [string, RequestInit])[1].body as string)
      expect(JSON.stringify(body)).toContain('relaxed register')

      vi.unstubAllGlobals()
    })

    it('does not inject any tone when contextAwareTone is off, even with a matching recorded context', async () => {
      mockGetRecording.mockReturnValue({
        id: 'rec-6',
        transcription: 'raw transcript text',
        recordedProcessName: 'Slack',
        recordedWindowTitle: '#general'
      })
      mockLoadSettings.mockReturnValue({
        cleanupEnabled: true,
        openaiApiKey: 'sk-test',
        aiProvider: 'openai',
        cleanupTemplates: [],
        contextAwareTone: false,
        toneMap: { slack: 'casual' }
      })
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'Cleaned.' } }] })
      })
      vi.stubGlobal('fetch', fetchMock)

      await handleRecordingsCleanup('rec-6', { mode: 'full' })

      const completionCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/chat/completions'))
      const body = JSON.parse((completionCall as [string, RequestInit])[1].body as string)
      expect(JSON.stringify(body)).toContain('Tone profile: (none)')

      vi.unstubAllGlobals()
    })

    it('resolves to the neutral profile (not "(none)") for a recording with no captured context, when contextAwareTone is on', async () => {
      mockGetRecording.mockReturnValue({
        id: 'rec-7',
        transcription: 'raw transcript text'
        // no recordedProcessName — saved before this feature landed
      })
      mockLoadSettings.mockReturnValue({
        cleanupEnabled: true,
        openaiApiKey: 'sk-test',
        aiProvider: 'openai',
        cleanupTemplates: [],
        contextAwareTone: true,
        toneMap: { slack: 'casual' }
      })
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'Cleaned.' } }] })
      })
      vi.stubGlobal('fetch', fetchMock)

      await handleRecordingsCleanup('rec-7', { mode: 'full' })

      const completionCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/chat/completions'))
      const body = JSON.parse((completionCall as [string, RequestInit])[1].body as string)
      // No context to match -> resolveToneProfile falls back to 'neutral',
      // which is itself a (harmless) tone description, not the "(none)"
      // no-tone-at-all sentinel — that sentinel is reserved for
      // contextAwareTone being off entirely (see the test above).
      expect(JSON.stringify(body)).toContain('balanced, plain register')
      expect(JSON.stringify(body)).not.toContain('Tone profile: (none)')

      vi.unstubAllGlobals()
    })

    it('does not inject tone for a template-based (format) cleanup, even when contextAwareTone is on', async () => {
      mockGetRecording.mockReturnValue({
        id: 'rec-8',
        transcription: 'raw transcript text',
        recordedProcessName: 'Slack'
      })
      mockLoadSettings.mockReturnValue({
        cleanupEnabled: true,
        openaiApiKey: 'sk-test',
        aiProvider: 'openai',
        cleanupTemplates: [{ id: 'email', name: 'Email', prompt: 'Reformat as an email.' }],
        contextAwareTone: true,
        toneMap: { slack: 'casual' }
      })
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'Dear team, ...' } }] })
      })
      vi.stubGlobal('fetch', fetchMock)

      await handleRecordingsCleanup('rec-8', { templateId: 'email' })

      const completionCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/chat/completions'))
      const body = JSON.parse((completionCall as [string, RequestInit])[1].body as string)
      // buildFormatMessages has no tone slot at all — nothing to assert it's
      // "(none)" for, just that the relaxed-register wording never appears.
      expect(JSON.stringify(body)).not.toContain('relaxed register')

      vi.unstubAllGlobals()
    })
  })
})
