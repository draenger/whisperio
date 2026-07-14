import { vi, describe, it, expect, beforeEach } from 'vitest'

/**
 * Proves the actual consumer (transcribe.ts) — not just keyAccessor.ts in
 * isolation (see keyAccessor.test.ts) — builds its provider request using a
 * provider API key sourced from the encrypted key store, end to end through
 * the real `getEffectiveSettings()` composition. This module deliberately
 * leaves secure/keyAccessor.ts UNMOCKED so its real precedence logic runs;
 * only its two dependencies (settingsManager and secure/keyStore) are faked.
 */

const mockLoadSettings = vi.fn()
vi.mock('../src/main/settingsManager', () => ({
  loadSettings: (...args: unknown[]) => mockLoadSettings(...args),
  getActiveVocabulary: (settings: { customVocabulary?: string }) =>
    settings.customVocabulary?.trim() || ''
}))

const mockIsEncryptionAvailable = vi.fn()
const mockGetKey = vi.fn()
vi.mock('../src/main/secure/keyStore', () => ({
  isEncryptionAvailable: () => mockIsEncryptionAvailable(),
  getKey: (...args: unknown[]) => mockGetKey(...args),
  setKey: vi.fn(),
  deleteKey: vi.fn(),
  listKeys: () => []
}))

function createMockNetRequest(statusCode: number, body: string) {
  const requestListeners: Record<string, ((...args: unknown[]) => void)[]> = {}
  const responseListeners: Record<string, ((...args: unknown[]) => void)[]> = {}

  const mockResponse = {
    statusCode,
    on(event: string, handler: (...args: unknown[]) => void) {
      if (!responseListeners[event]) responseListeners[event] = []
      responseListeners[event].push(handler)
    }
  }

  const mockRequest = {
    setHeader: vi.fn(),
    write: vi.fn(),
    end: vi.fn(() => {
      queueMicrotask(() => {
        for (const h of requestListeners['response'] || []) h(mockResponse)
        queueMicrotask(() => {
          for (const h of responseListeners['data'] || []) h(Buffer.from(body))
          for (const h of responseListeners['end'] || []) h()
        })
      })
    }),
    on(event: string, handler: (...args: unknown[]) => void) {
      if (!requestListeners[event]) requestListeners[event] = []
      requestListeners[event].push(handler)
      return mockRequest
    }
  }

  return mockRequest
}

const mockNetRequest = vi.fn()
vi.mock('electron', () => ({
  net: {
    request: (...args: unknown[]) => mockNetRequest(...args)
  },
  Notification: class MockNotification {
    static isSupported = () => false
    show = vi.fn()
  },
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

import { transcribeAudio } from '../src/main/transcribe'

describe('transcribeAudio — provider key sourced from the encrypted key store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the key store value for the Authorization header when OS secure storage is available and settings.json has already been migrated (cleared)', async () => {
    mockIsEncryptionAvailable.mockReturnValue(true)
    mockGetKey.mockImplementation((name: string) => (name === 'openaiApiKey' ? 'sk-keystore-secret' : null))
    // Post-migration state: settings.json's plaintext copy is blanked, per
    // migrateProviderKeysToKeyStore's contract (never dropped, just cleared).
    mockLoadSettings.mockReturnValue({ openaiApiKey: '', transcriptionPrompt: '' })

    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'hello' }))
    mockNetRequest.mockReturnValue(mockReq)

    await transcribeAudio(Buffer.from('audio'), 'test.webm')

    expect(mockReq.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer sk-keystore-secret')
  })

  it('prefers the key store value over a stale settings.json copy when both are present', async () => {
    mockIsEncryptionAvailable.mockReturnValue(true)
    mockGetKey.mockImplementation((name: string) => (name === 'openaiApiKey' ? 'sk-fresh-from-keystore' : null))
    mockLoadSettings.mockReturnValue({ openaiApiKey: 'sk-stale-json-copy', transcriptionPrompt: '' })

    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'hello' }))
    mockNetRequest.mockReturnValue(mockReq)

    await transcribeAudio(Buffer.from('audio'), 'test.webm')

    expect(mockReq.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer sk-fresh-from-keystore')
  })

  it('falls back to the settings.json value when OS secure storage is unavailable, without consulting the key store', async () => {
    mockIsEncryptionAvailable.mockReturnValue(false)
    mockLoadSettings.mockReturnValue({ openaiApiKey: 'sk-plaintext-fallback', transcriptionPrompt: '' })

    const mockReq = createMockNetRequest(200, JSON.stringify({ text: 'hello' }))
    mockNetRequest.mockReturnValue(mockReq)

    await transcribeAudio(Buffer.from('audio'), 'test.webm')

    expect(mockReq.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer sk-plaintext-fallback')
    expect(mockGetKey).not.toHaveBeenCalled()
  })
})
