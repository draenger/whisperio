import { Notification, BrowserWindow } from 'electron'

export type ErrorCategory =
  | 'API_KEY_MISSING'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'TRANSCRIPTION_FAILED'
  | 'UNKNOWN'

export interface WhisperioError {
  category: ErrorCategory
  message: string
  provider: string
  timestamp: number
  rawError?: string
}

const MAX_RECENT_ERRORS = 50
const recentErrors: WhisperioError[] = []

export function categorizeError(statusCode: number | null, responseBody: string): ErrorCategory {
  if (statusCode === 401) return 'API_KEY_MISSING'
  if (statusCode === 402) return 'QUOTA_EXCEEDED'
  if (statusCode === 429) return 'RATE_LIMITED'

  if (responseBody.includes('insufficient_quota')) return 'QUOTA_EXCEEDED'

  if (statusCode !== null && statusCode >= 400) return 'TRANSCRIPTION_FAILED'

  return 'UNKNOWN'
}

export function getErrorMessage(category: ErrorCategory, fallback?: string): string {
  switch (category) {
    case 'API_KEY_MISSING':
      return 'Invalid API key. Check your settings.'
    case 'QUOTA_EXCEEDED':
      return 'API quota exceeded. Add more credits.'
    case 'RATE_LIMITED':
      return 'Rate limited. Please wait a moment.'
    case 'NETWORK_ERROR':
      return 'Network error. Check your connection.'
    case 'TRANSCRIPTION_FAILED':
      return fallback || 'Transcription failed. Please try again.'
    default:
      return fallback || 'An unexpected error occurred.'
  }
}

export function parseApiError(error: Error): { statusCode: number | null, responseBody: string } {
  const message = error.message || ''

  // Match patterns like "OpenAI API error 401: {...}" or "ElevenLabs API error 403: {...}"
  const statusMatch = message.match(/API error (\d+):\s*(.*)/)
  if (statusMatch) {
    return {
      statusCode: parseInt(statusMatch[1], 10),
      responseBody: statusMatch[2] || ''
    }
  }

  // Network-level errors (no HTTP status)
  if (
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('ETIMEDOUT') ||
    message.includes('network') ||
    message.includes('fetch failed')
  ) {
    return { statusCode: null, responseBody: message }
  }

  return { statusCode: null, responseBody: message }
}

export function handleTranscriptionError(error: Error, provider: string): void {
  const { statusCode, responseBody } = parseApiError(error)

  let category: ErrorCategory

  // Check for missing API key errors thrown before the request
  if (error.message.includes('No') && error.message.includes('API key configured')) {
    category = 'API_KEY_MISSING'
  } else if (statusCode === null && !responseBody.includes('API error')) {
    // No HTTP status code and not an API error — likely a network issue
    if (
      responseBody.includes('ECONNREFUSED') ||
      responseBody.includes('ENOTFOUND') ||
      responseBody.includes('ETIMEDOUT') ||
      responseBody.includes('network') ||
      responseBody.includes('fetch failed')
    ) {
      category = 'NETWORK_ERROR'
    } else {
      category = categorizeError(statusCode, responseBody)
    }
  } else {
    category = categorizeError(statusCode, responseBody)
  }

  const userMessage = getErrorMessage(category, error.message)

  const whisperioError: WhisperioError = {
    category,
    message: userMessage,
    provider,
    timestamp: Date.now(),
    rawError: error.message
  }

  addRecentError(whisperioError)
  notifyError('Transcription Error', userMessage)
  emitErrorToRenderer(whisperioError)

  console.error(`[Whisperio] ${provider} error [${category}]: ${error.message}`)
}

function addRecentError(error: WhisperioError): void {
  recentErrors.push(error)
  if (recentErrors.length > MAX_RECENT_ERRORS) {
    recentErrors.shift()
  }
}

export function getRecentErrors(): WhisperioError[] {
  return [...recentErrors]
}

export function notifyError(title: string, body: string): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body })
  notification.show()
}

export function notifyInfo(title: string, body: string): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body })
  notification.show()
}

function emitErrorToRenderer(error: WhisperioError): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('errors:new', error)
    }
  }
}
