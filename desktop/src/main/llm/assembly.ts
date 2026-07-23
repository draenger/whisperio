// STT provider client: AssemblyAI (v1.6 parity with the mobile app's AssemblyAIProvider.swift).
//
// Cloud transcription via AssemblyAI (BYO key). Universal models — a
// three-step async flow: upload the raw audio, create a transcript job, then
// poll until it completes. Uses plain `fetch` (not electron's `net`) since
// this is a multi-call JSON flow, not a single multipart upload — same
// rationale as transcribe.ts's replicateTranscribe(). Mirrors
// mobile/WhisperioApp/Sources/WhisperioApp/Engine/AssemblyAIProvider.swift.
import { app } from 'electron'
import { handleTranscriptionError } from '../errorHandler'
import { assemblyAISegments, type SpeakerSegment, type AssemblyAIUtterance } from '../dictation/conversation'

export interface DiarizedResult {
  segments: SpeakerSegment[]
  text: string
}

const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2'
export const DEFAULT_ASSEMBLYAI_MODEL = 'universal'
// Poll every 2s, up to ~5 minutes, before giving up on a stuck job — same
// budget as the mobile provider.
const POLL_INTERVAL_MS = 2_000
const MAX_POLLS = 150
const REQUEST_TIMEOUT_MS = 30_000

interface UploadResponse {
  upload_url?: string
}

interface JobResponse {
  id?: string
  status?: string
  text?: string
  error?: string
  utterances?: AssemblyAIUtterance[]
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

async function assemblyRequest(url: string, init: RequestInit, step: string): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    handleTranscriptionError(error, 'assemblyai')
    throw error
  } finally {
    clearTimeout(timeout)
  }

  const rawText = await response.text()
  if (!response.ok) {
    if (isDev()) console.error(`[Whisperio] AssemblyAI ${step} error body: ${rawText}`)
    const err = new Error(`AssemblyAI ${step} error ${response.status}`)
    handleTranscriptionError(err, 'assemblyai')
    throw err
  }
  try {
    return JSON.parse(rawText) as Record<string, unknown>
  } catch {
    const err = new Error(`Failed to parse AssemblyAI ${step} response (HTTP ${response.status})`)
    handleTranscriptionError(err, 'assemblyai')
    throw err
  }
}

async function assemblyAIRun(
  apiKey: string,
  audioBuffer: Buffer,
  model: string,
  language: string,
  speakerLabels: boolean
): Promise<JobResponse> {
  const apiModel = model?.trim() || DEFAULT_ASSEMBLYAI_MODEL

  // 1. Upload the raw audio; the response carries a private URL for step 2.
  const uploaded = (await assemblyRequest(
    `${ASSEMBLYAI_BASE}/upload`,
    {
      method: 'POST',
      headers: { authorization: apiKey, 'Content-Type': 'application/octet-stream' },
      body: audioBuffer
    },
    'upload'
  )) as UploadResponse
  const audioUrl = uploaded.upload_url
  if (!audioUrl) {
    const err = new Error('AssemblyAI upload did not return an upload_url.')
    handleTranscriptionError(err, 'assemblyai')
    throw err
  }

  // 2. Create the transcript job.
  const auto = language === 'auto' || !language
  const jobBody: Record<string, unknown> = {
    audio_url: audioUrl,
    speech_model: apiModel,
    language_detection: auto ? true : undefined,
    language_code: auto ? undefined : language,
    speaker_labels: speakerLabels || undefined
  }
  const job = (await assemblyRequest(
    `${ASSEMBLYAI_BASE}/transcript`,
    {
      method: 'POST',
      headers: { authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(jobBody)
    },
    'transcript'
  )) as JobResponse
  if (!job.id) {
    const err = new Error('AssemblyAI did not return a transcript job id.')
    handleTranscriptionError(err, 'assemblyai')
    throw err
  }

  // 3. Poll until the job settles.
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    const state = (await assemblyRequest(
      `${ASSEMBLYAI_BASE}/transcript/${job.id}`,
      { method: 'GET', headers: { authorization: apiKey } },
      'status'
    )) as JobResponse
    if (state.status === 'completed') {
      if (typeof state.text !== 'string') {
        const err = new Error('AssemblyAI returned no transcript.')
        handleTranscriptionError(err, 'assemblyai')
        throw err
      }
      return state
    }
    if (state.status === 'error') {
      const err = new Error(`AssemblyAI failed: ${state.error ?? 'unknown error'}`)
      handleTranscriptionError(err, 'assemblyai')
      throw err
    }
    // queued / processing — keep polling
  }

  const timeoutErr = new Error('AssemblyAI timed out waiting for the transcript.')
  handleTranscriptionError(timeoutErr, 'assemblyai')
  throw timeoutErr
}

export async function assemblyAITranscribe(
  apiKey: string,
  audioBuffer: Buffer,
  model: string,
  language = 'auto'
): Promise<string> {
  const state = await assemblyAIRun(apiKey, audioBuffer, model, language, false)
  return state.text as string
}

/**
 * Diarizing variant of assemblyAITranscribe: `speaker_labels=true` requests
 * AssemblyAI's per-utterance speaker breakdown (mirrors
 * AssemblyAIProvider.swift's diarized transcribe). Maps `utterances` ->
 * SpeakerSegment via assemblyAISegments(); `text` is the plain-transcript
 * fallback from the same job so callers always get a usable string even if
 * utterances comes back empty.
 */
export async function assemblyAITranscribeDiarized(
  apiKey: string,
  audioBuffer: Buffer,
  model: string,
  language = 'auto'
): Promise<DiarizedResult> {
  const state = await assemblyAIRun(apiKey, audioBuffer, model, language, true)
  const utterances = state.utterances ?? []
  const segments = assemblyAISegments(utterances)
  const fallbackText = (state.text as string) ?? ''
  const text = segments.length > 0 ? segments.map((s) => s.text).join(' ') : fallbackText
  return { segments, text }
}
