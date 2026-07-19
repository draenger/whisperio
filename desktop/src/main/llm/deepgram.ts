// STT provider client: Deepgram (v1.6 parity with the mobile app's DeepgramProvider.swift).
//
// Cloud transcription via Deepgram's pre-recorded `listen` endpoint (BYO key).
// Nova models — unlike the multipart providers, this is a raw-audio POST (no
// multipart form): the model/options travel in the query string and the
// transcript is nested in the JSON response. Mirrors
// mobile/WhisperioApp/Sources/WhisperioApp/Engine/DeepgramProvider.swift.
import { net, app } from 'electron'
import { handleTranscriptionError } from '../errorHandler'

const DEEPGRAM_LISTEN_URL = 'https://api.deepgram.com/v1/listen'
export const DEFAULT_DEEPGRAM_MODEL = 'nova-3'

interface DeepgramResponse {
  results?: {
    channels?: { alternatives?: { transcript?: string }[] }[]
  }
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

export function deepgramTranscribe(
  apiKey: string,
  audioBuffer: Buffer,
  model: string,
  language = 'auto'
): Promise<string> {
  const apiModel = model?.trim() || DEFAULT_DEEPGRAM_MODEL
  const params = new URLSearchParams({ model: apiModel, smart_format: 'true' })
  if (language && language !== 'auto') params.set('language', language)
  const url = `${DEEPGRAM_LISTEN_URL}?${params.toString()}`

  return new Promise<string>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        request.abort()
        const err = new Error('Deepgram transcription request timed out after 45s')
        handleTranscriptionError(err, 'deepgram')
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

    const request = net.request({ method: 'POST', url })
    request.setHeader('Authorization', `Token ${apiKey}`)
    request.setHeader('Content-Type', 'application/octet-stream')

    const chunks: Buffer[] = []

    request.on('response', (response) => {
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      response.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf-8')
        if (response.statusCode !== 200) {
          if (isDev()) console.error(`[Whisperio] Deepgram API error body: ${responseBody}`)
          const err = new Error(`Deepgram API error ${response.statusCode}`)
          handleTranscriptionError(err, 'deepgram')
          settle(reject)(err)
          return
        }
        try {
          const data = JSON.parse(responseBody) as DeepgramResponse
          const text = data.results?.channels?.[0]?.alternatives?.[0]?.transcript
          if (typeof text !== 'string') {
            throw new Error('no transcript in response')
          }
          settle(resolve)(text)
        } catch {
          const err = new Error(`Deepgram returned no transcript (HTTP ${response.statusCode})`)
          handleTranscriptionError(err, 'deepgram')
          settle(reject)(err)
        }
      })
      response.on('error', (err: Error) => {
        handleTranscriptionError(err, 'deepgram')
        settle(reject)(err)
      })
    })

    request.on('error', (err: Error) => {
      handleTranscriptionError(err, 'deepgram')
      settle(reject)(err)
    })
    request.write(audioBuffer)
    request.end()
  })
}
