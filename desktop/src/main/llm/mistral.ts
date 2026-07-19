// STT provider client: Mistral (v1.6 parity with the mobile app's MistralProvider.swift).
//
// Cloud transcription via Mistral's OpenAI-compatible audio/transcriptions
// endpoint (BYO key) — Voxtral open-weights models. Same multipart request/JSON
// `{ text }` response shape as the OpenAI/Groq STT paths, just a fixed Mistral
// base URL and Mistral's own model catalog. Mirrors
// mobile/WhisperioApp/Sources/WhisperioApp/Engine/MistralProvider.swift.
import { net, app } from 'electron'
import { handleTranscriptionError } from '../errorHandler'

const MISTRAL_STT_URL = 'https://api.mistral.ai/v1/audio/transcriptions'
export const DEFAULT_MISTRAL_MODEL = 'voxtral-small-latest'

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

export function mistralTranscribe(
  apiKey: string,
  audioBuffer: Buffer,
  filename: string,
  prompt: string,
  model: string,
  language = 'auto'
): Promise<string> {
  const apiModel = model?.trim() || DEFAULT_MISTRAL_MODEL
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
        const err = new Error('Mistral transcription request timed out after 45s')
        handleTranscriptionError(err, 'mistral')
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

    const request = net.request({ method: 'POST', url: MISTRAL_STT_URL })
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
          if (isDev()) console.error(`[Whisperio] Mistral API error body: ${responseBody}`)
          const err = new Error(`Mistral API error ${response.statusCode}`)
          handleTranscriptionError(err, 'mistral')
          settle(reject)(err)
          return
        }
        try {
          const data = JSON.parse(responseBody) as TranscribeResult
          settle(resolve)(data.text)
        } catch {
          const err = new Error(`Failed to parse transcription response (HTTP ${response.statusCode})`)
          handleTranscriptionError(err, 'mistral')
          settle(reject)(err)
        }
      })
      response.on('error', (err: Error) => {
        handleTranscriptionError(err, 'mistral')
        settle(reject)(err)
      })
    })

    request.on('error', (err: Error) => {
      handleTranscriptionError(err, 'mistral')
      settle(reject)(err)
    })
    request.write(body)
    request.end()
  })
}
