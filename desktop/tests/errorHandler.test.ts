import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockNotificationShow, mockNotificationIsSupported, mockGetAllWindows } = vi.hoisted(() => {
  return {
    mockNotificationShow: vi.fn(),
    mockNotificationIsSupported: vi.fn(() => true),
    mockGetAllWindows: vi.fn(() => [])
  }
})

vi.mock('electron', () => ({
  Notification: class MockNotification {
    static isSupported = mockNotificationIsSupported
    title: string
    body: string
    constructor(opts: { title: string, body: string }) {
      this.title = opts.title
      this.body = opts.body
      mockNotificationShow(opts)
    }
    show = vi.fn()
  },
  BrowserWindow: {
    getAllWindows: () => mockGetAllWindows()
  }
}))

import {
  categorizeError,
  getErrorMessage,
  parseApiError,
  handleTranscriptionError,
  getRecentErrors,
  notifyError,
  notifyInfo
} from '../src/main/errorHandler'

describe('errorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear the recent errors list by handling enough to cycle through
    // We access the module fresh each test via the imports
  })

  describe('categorizeError', () => {
    it('returns API_KEY_MISSING for status 401', () => {
      expect(categorizeError(401, '')).toBe('API_KEY_MISSING')
    })

    it('returns QUOTA_EXCEEDED for status 402', () => {
      expect(categorizeError(402, '')).toBe('QUOTA_EXCEEDED')
    })

    it('returns RATE_LIMITED for status 429', () => {
      expect(categorizeError(429, '')).toBe('RATE_LIMITED')
    })

    it('returns QUOTA_EXCEEDED when response body contains insufficient_quota', () => {
      expect(categorizeError(400, '{"error":{"code":"insufficient_quota"}}')).toBe('QUOTA_EXCEEDED')
    })

    it('returns TRANSCRIPTION_FAILED for other 4xx/5xx status codes', () => {
      expect(categorizeError(500, '')).toBe('TRANSCRIPTION_FAILED')
      expect(categorizeError(403, '')).toBe('TRANSCRIPTION_FAILED')
    })

    it('returns UNKNOWN when no status code and no matching body', () => {
      expect(categorizeError(null, 'some random error')).toBe('UNKNOWN')
    })
  })

  describe('getErrorMessage', () => {
    it('returns correct message for API_KEY_MISSING', () => {
      expect(getErrorMessage('API_KEY_MISSING')).toBe('Invalid API key. Check your settings.')
    })

    it('returns correct message for QUOTA_EXCEEDED', () => {
      expect(getErrorMessage('QUOTA_EXCEEDED')).toBe('API quota exceeded. Add more credits.')
    })

    it('returns correct message for RATE_LIMITED', () => {
      expect(getErrorMessage('RATE_LIMITED')).toBe('Rate limited. Please wait a moment.')
    })

    it('returns correct message for NETWORK_ERROR', () => {
      expect(getErrorMessage('NETWORK_ERROR')).toBe('Network error. Check your connection.')
    })

    it('returns fallback for TRANSCRIPTION_FAILED when provided', () => {
      expect(getErrorMessage('TRANSCRIPTION_FAILED', 'Custom fail')).toBe('Custom fail')
    })

    it('returns default message for TRANSCRIPTION_FAILED without fallback', () => {
      expect(getErrorMessage('TRANSCRIPTION_FAILED')).toBe('Transcription failed. Please try again.')
    })

    it('returns fallback for UNKNOWN when provided', () => {
      expect(getErrorMessage('UNKNOWN', 'Something broke')).toBe('Something broke')
    })

    it('returns default message for UNKNOWN without fallback', () => {
      expect(getErrorMessage('UNKNOWN')).toBe('An unexpected error occurred.')
    })
  })

  describe('parseApiError', () => {
    it('extracts status code and body from OpenAI API error', () => {
      const err = new Error('OpenAI API error 401: {"error":"unauthorized"}')
      const result = parseApiError(err)
      expect(result.statusCode).toBe(401)
      expect(result.responseBody).toBe('{"error":"unauthorized"}')
    })

    it('extracts status code and body from ElevenLabs API error', () => {
      const err = new Error('ElevenLabs API error 403: {"error":"forbidden"}')
      const result = parseApiError(err)
      expect(result.statusCode).toBe(403)
      expect(result.responseBody).toBe('{"error":"forbidden"}')
    })

    it('returns null statusCode for network errors', () => {
      const err = new Error('ECONNREFUSED')
      const result = parseApiError(err)
      expect(result.statusCode).toBeNull()
      expect(result.responseBody).toBe('ECONNREFUSED')
    })

    it('returns null statusCode for unknown errors', () => {
      const err = new Error('Something went wrong')
      const result = parseApiError(err)
      expect(result.statusCode).toBeNull()
      expect(result.responseBody).toBe('Something went wrong')
    })

    it('handles insufficient_quota in response body', () => {
      const err = new Error('OpenAI API error 402: {"error":{"code":"insufficient_quota"}}')
      const result = parseApiError(err)
      expect(result.statusCode).toBe(402)
      expect(result.responseBody).toContain('insufficient_quota')
    })
  })

  describe('handleTranscriptionError', () => {
    it('adds error to recent errors list', () => {
      const initialCount = getRecentErrors().length
      handleTranscriptionError(new Error('OpenAI API error 401: unauthorized'), 'openai')
      expect(getRecentErrors().length).toBe(initialCount + 1)
    })

    it('creates error with correct category for 401', () => {
      handleTranscriptionError(new Error('OpenAI API error 401: unauthorized'), 'openai')
      const errors = getRecentErrors()
      const last = errors[errors.length - 1]
      expect(last.category).toBe('API_KEY_MISSING')
      expect(last.provider).toBe('openai')
      expect(last.message).toBe('Invalid API key. Check your settings.')
    })

    it('creates error with correct category for insufficient_quota', () => {
      handleTranscriptionError(
        new Error('OpenAI API error 402: {"error":{"code":"insufficient_quota"}}'),
        'openai'
      )
      const errors = getRecentErrors()
      const last = errors[errors.length - 1]
      expect(last.category).toBe('QUOTA_EXCEEDED')
      expect(last.message).toBe('API quota exceeded. Add more credits.')
    })

    it('creates error with correct category for 429', () => {
      handleTranscriptionError(new Error('OpenAI API error 429: rate limited'), 'openai')
      const errors = getRecentErrors()
      const last = errors[errors.length - 1]
      expect(last.category).toBe('RATE_LIMITED')
    })

    it('detects missing API key errors', () => {
      handleTranscriptionError(
        new Error('No OpenAI API key configured. Open Settings to set it.'),
        'openai'
      )
      const errors = getRecentErrors()
      const last = errors[errors.length - 1]
      expect(last.category).toBe('API_KEY_MISSING')
    })

    it('detects network errors', () => {
      handleTranscriptionError(new Error('ECONNREFUSED'), 'openai')
      const errors = getRecentErrors()
      const last = errors[errors.length - 1]
      expect(last.category).toBe('NETWORK_ERROR')
    })

    it('fires a notification', () => {
      mockNotificationShow.mockClear()
      handleTranscriptionError(new Error('OpenAI API error 401: unauthorized'), 'openai')
      expect(mockNotificationShow).toHaveBeenCalledWith({
        title: 'Transcription Error',
        body: 'Invalid API key. Check your settings.'
      })
    })

    it('includes timestamp and rawError', () => {
      const before = Date.now()
      handleTranscriptionError(new Error('OpenAI API error 500: server error'), 'openai')
      const errors = getRecentErrors()
      const last = errors[errors.length - 1]
      expect(last.timestamp).toBeGreaterThanOrEqual(before)
      expect(last.rawError).toBe('OpenAI API error 500: server error')
    })
  })

  describe('recent errors list', () => {
    it('limits stored errors to MAX_RECENT_ERRORS (50)', () => {
      // Add 55 errors
      for (let i = 0; i < 55; i++) {
        handleTranscriptionError(new Error(`OpenAI API error 500: error ${i}`), 'openai')
      }
      const errors = getRecentErrors()
      expect(errors.length).toBeLessThanOrEqual(50)
    })

    it('returns a copy of the errors array', () => {
      const errors1 = getRecentErrors()
      const errors2 = getRecentErrors()
      expect(errors1).not.toBe(errors2)
      expect(errors1).toEqual(errors2)
    })
  })

  describe('notifyError', () => {
    it('creates and shows a Notification with given title and body', () => {
      mockNotificationShow.mockClear()
      notifyError('Test Title', 'Test Body')
      expect(mockNotificationShow).toHaveBeenCalledWith({
        title: 'Test Title',
        body: 'Test Body'
      })
    })

    it('does nothing when Notification is not supported', () => {
      mockNotificationIsSupported.mockReturnValue(false)
      mockNotificationShow.mockClear()
      notifyError('Title', 'Body')
      expect(mockNotificationShow).not.toHaveBeenCalled()
      mockNotificationIsSupported.mockReturnValue(true)
    })
  })

  describe('notifyInfo', () => {
    it('creates and shows a Notification with given title and body', () => {
      mockNotificationShow.mockClear()
      notifyInfo('Info Title', 'Info Body')
      expect(mockNotificationShow).toHaveBeenCalledWith({
        title: 'Info Title',
        body: 'Info Body'
      })
    })

    it('does nothing when Notification is not supported', () => {
      mockNotificationIsSupported.mockReturnValue(false)
      mockNotificationShow.mockClear()
      notifyInfo('Title', 'Body')
      expect(mockNotificationShow).not.toHaveBeenCalled()
      mockNotificationIsSupported.mockReturnValue(true)
    })
  })
})
