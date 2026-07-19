// STT provider client: Groq (v1.6 parity with the mobile app's GroqProvider.swift).
//
// Cloud transcription via Groq's OpenAI-compatible audio/transcriptions endpoint
// (BYO key) — fastest hosted Whisper inference. Same request/response shape as
// the OpenAI STT path in transcribe.ts (multipart form: file + model + optional
// prompt/language, JSON `{ text }` response), just a fixed Groq base URL and
// Groq's own model catalog. Mirrors mobile/WhisperioApp/Sources/WhisperioApp/Engine/GroqProvider.swift.
import { net, app } from 'electron'
import { handleTranscriptionError } from '../errorHandler'

const GROQ_STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
export const DEFAULT_GROQ_MODEL = 'whisper-large-v3-turbo'

interface TranscribeResult {
  text: string
}

// True only in unpackaged (development) builds — see transcribe.ts's isDev()
// doc comment for why this is duplicated per-file rather than shared.
function isDev(): boolean {
  try {
    return !app.isPackaged
  } catch {
    return false
  }
}

export function groqTranscribe(
  apiKey: string,
  audioBuffer: Buffer,
  filename: string,
  prompt: string,
  model: string,
  language = 'auto'
): Promise<string> {
  const apiModel = model?.trim() || DEFAULT_GROQ_MODEL
  const boundary = `----Whisperio${Date.now()}`
  const parts: Buffer[] = []

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/webm\r\n\r\n`
  ))
  parts.push(audioBuffer)
  parts.push(Buffer.from('\r\n'))

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${apiModel}\r\n`
  ))
  if (prompt) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${prompt}\r\n`
    ))
  }
  if (language && language !== 'auto') {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language}\r\n`
    ))
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`))
  const body = Buffer.concat(parts)

  return new Promise<string>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        request.abort()
        const err = new Error('Groq transcription request timed out after 45s')
        handleTranscriptionError(err, 'groq')
        reject(err)
      }
    }, 45_000)

    const settle = <T>(fn: (val: T) => void) => (val: T) => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        fn(val)
      }
    }

    const request = net.request({ method: 'POST', url: GROQ_STT_URL })
    request.setHeader('Authorization', `Bearer ${apiKey}`)
    request.setHeader('Content-Type', `multipart/form-data; boundary=${boundary}`)

    const chunks: Buffer[] = []

    request.on('response', (response) => {
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      response.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf-8')
        if (response.statusCode !== 200) {
          if (isDev()) console.error(`[Whisperio] Groq API error body: ${responseBody}`)
          const err = new Error(`Groq API error ${response.statusCode}`)
          handleTranscriptionError(err, 'groq')
          settle(reject)(err)
          return
        }
        try {
          const data = JSON.parse(responseBody) as TranscribeResult
          settle(resolve)(data.text)
        } catch {
          const err = new Error(`Failed to parse transcription response (HTTP ${response.statusCode})`)
          handleTranscriptionError(err, 'groq')
          settle(reject)(err)
        }
      })
      response.on('error', (err: Error) => {
        handleTranscriptionError(err, 'groq')
        settle(reject)(err)
      })
    })

    request.on('error', (err: Error) => {
      handleTranscriptionError(err, 'groq')
      settle(reject)(err)
    })
    request.write(body)
    request.end()
  })
}
