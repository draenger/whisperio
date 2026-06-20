import { net } from 'electron'
import { loadSettings, AppSettings, type ProviderId } from './settingsManager'
import { handleTranscriptionError, notifyInfo } from './errorHandler'

const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1'
const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text'
const DEFAULT_PROMPT = ''
const DEFAULT_MODEL = 'gpt-4o-transcribe'
const SELFHOSTED_MODEL = 'whisper-1'

const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  elevenlabs: 'ElevenLabs',
  selfhosted: 'Local Model'
}

interface TranscribeResult {
  text: string
}

interface ChatResponse {
  choices: { message: { content: string } }[]
}

export async function transcribeAudio(audioBuffer: Buffer, filename: string): Promise<string> {
  const settings = loadSettings()

  // Build effective chain: use providerChain if set, otherwise legacy sttProvider + fallback
  let chain: ProviderId[]
  if (settings.providerChain && settings.providerChain.length > 0) {
    chain = settings.providerChain
  } else {
    chain = [settings.sttProvider || 'openai']
    if (settings.fallbackEnabled) {
      const fallback: ProviderId = settings.sttProvider === 'openai' ? 'elevenlabs' : 'openai'
      chain.push(fallback)
    }
  }

  // Filter to only configured providers, but keep at least the first one to get a proper error
  const configuredChain = chain.filter((p) => isProviderConfigured(settings, p))
  if (configuredChain.length === 0) {
    // Try the first provider anyway — it will throw a descriptive error
    configuredChain.push(chain[0])
  }

  let firstError: Error | null = null

  for (let i = 0; i < configuredChain.length; i++) {
    const provider = configuredChain[i]
    try {
      return await transcribeWithProvider(settings, provider, audioBuffer, filename)
    } catch (err) {
      if (!firstError) firstError = err instanceof Error ? err : new Error(String(err))
      if (i < configuredChain.length - 1) {
        const next = configuredChain[i + 1]
        notifyInfo('Whisperio', `${PROVIDER_LABELS[provider]} failed. Trying ${PROVIDER_LABELS[next]}...`)
      }
    }
  }

  throw firstError || new Error('No providers configured. Open Settings to set up a provider.')
}

function isProviderConfigured(settings: AppSettings, provider: ProviderId): boolean {
  if (provider === 'openai') return !!(settings.openaiApiKey || settings.openaiBaseUrl?.trim())
  if (provider === 'elevenlabs') return !!settings.elevenlabsApiKey
  if (provider === 'selfhosted') return !!settings.openaiBaseUrl?.trim()
  return false
}

async function transcribeWithProvider(
  settings: AppSettings,
  provider: ProviderId,
  audioBuffer: Buffer,
  filename: string
): Promise<string> {
  if (provider === 'elevenlabs') {
    const apiKey = settings.elevenlabsApiKey
    if (!apiKey) {
      const err = new Error('No ElevenLabs API key configured. Open Settings to set it.')
      handleTranscriptionError(err, 'elevenlabs')
      throw err
    }
    const vocab = settings.customVocabulary?.trim() || ''
    const lang = settings.transcriptionLanguage?.trim() || 'auto'
    return elevenLabsTranscribe(apiKey, audioBuffer, filename, vocab, lang)
  }

  if (provider === 'selfhosted') {
    const baseUrl = settings.openaiBaseUrl?.trim()
    if (!baseUrl) {
      const err = new Error('No self-hosted server URL configured. Open Settings to set it.')
      handleTranscriptionError(err, 'selfhosted')
      throw err
    }
    const model = settings.whisperModel?.trim() || SELFHOSTED_MODEL
    const basePrompt = settings.transcriptionPrompt || DEFAULT_PROMPT
    const vocab = settings.customVocabulary?.trim()
    const prompt = vocab
      ? `${basePrompt}\n\nTechnical terms that may appear (use these exact spellings): ${vocab}`
      : basePrompt
    const lang = settings.transcriptionLanguage?.trim() || 'auto'
    // whisper.cpp uses /inference, OpenAI-compatible servers use /v1/audio/transcriptions
    const endpoint = baseUrl.includes('/v1') ? `${baseUrl}/audio/transcriptions` : `${baseUrl}/inference`
    return whisperTranscribe('', audioBuffer, filename, prompt, endpoint, model, true, lang)
  }

  // openai
  const apiKey = settings.openaiApiKey
  if (!apiKey) {
    const err = new Error('No OpenAI API key configured. Open Settings to set it.')
    handleTranscriptionError(err, 'openai')
    throw err
  }

  const baseUrl = DEFAULT_OPENAI_BASE
  const model = DEFAULT_MODEL

  const basePrompt = settings.transcriptionPrompt || DEFAULT_PROMPT
  const vocab = settings.customVocabulary?.trim()
  const prompt = vocab
    ? `${basePrompt}\n\nTechnical terms that may appear (use these exact spellings): ${vocab}`
    : basePrompt

  const lang = settings.transcriptionLanguage?.trim() || 'auto'
  let text = await whisperTranscribe(apiKey, audioBuffer, filename, prompt, baseUrl, model, false, lang)

  if (settings.aiPostProcessing && text && vocab) {
    try {
      text = await postProcessWithLLM(apiKey, text, vocab, baseUrl)
    } catch (err) {
      console.error('[Whisperio] AI post-processing failed, using raw transcript:', err)
    }
  }

  return text
}

function whisperTranscribe(apiKey: string, audioBuffer: Buffer, filename: string, prompt: string, baseUrl: string, model: string, directUrl = false, language = 'auto'): Promise<string> {
  const boundary = `----Whisperio${Date.now()}`

  const parts: Buffer[] = []

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/webm\r\n\r\n`
  ))
  parts.push(audioBuffer)
  parts.push(Buffer.from('\r\n'))

  if (!directUrl) {
    // OpenAI format — send model and prompt
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`
    ))
    if (prompt) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${prompt}\r\n`
      ))
    }
  }

  // response_format for whisper.cpp
  if (directUrl) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n`
    ))
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="temperature"\r\n\r\n0\r\n`
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
        const err = new Error('OpenAI transcription request timed out after 45s')
        handleTranscriptionError(err, 'openai')
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

    const request = net.request({
      method: 'POST',
      url: directUrl ? baseUrl : `${baseUrl}/audio/transcriptions`
    })

    if (apiKey) {
      request.setHeader('Authorization', `Bearer ${apiKey}`)
    }
    request.setHeader('Content-Type', `multipart/form-data; boundary=${boundary}`)

    const chunks: Buffer[] = []

    request.on('response', (response) => {
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      response.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf-8')
        console.log(`[Whisperio] Transcription response (${response.statusCode}): ${responseBody.substring(0, 200)}`)
        if (response.statusCode !== 200) {
          const err = new Error(`OpenAI API error ${response.statusCode}: ${responseBody}`)
          handleTranscriptionError(err, directUrl ? 'selfhosted' : 'openai')
          settle(reject)(err)
          return
        }
        try {
          const data = JSON.parse(responseBody) as TranscribeResult
          console.log(`[Whisperio] Transcribed text: "${data.text?.substring(0, 100)}"`)
          settle(resolve)(data.text)
        } catch {
          const err = new Error(`Failed to parse response: ${responseBody}`)
          handleTranscriptionError(err, 'openai')
          settle(reject)(err)
        }
      })
      response.on('error', (err: Error) => {
        handleTranscriptionError(err, 'openai')
        settle(reject)(err)
      })
    })

    request.on('error', (err: Error) => {
      handleTranscriptionError(err, 'openai')
      settle(reject)(err)
    })
    request.write(body)
    request.end()
  })
}

function elevenLabsTranscribe(apiKey: string, audioBuffer: Buffer, filename: string, vocabulary: string, language: string): Promise<string> {
  const boundary = `----Whisperio${Date.now()}`
  const parts: Buffer[] = []

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/webm\r\n\r\n`
  ))
  parts.push(audioBuffer)
  parts.push(Buffer.from('\r\n'))

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model_id"\r\n\r\nscribe_v2\r\n`
  ))

  if (language && language !== 'auto') {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="language_code"\r\n\r\n${language}\r\n`
    ))
  }

  if (vocabulary) {
    const keyterms = vocabulary.split(',').map((t) => t.trim()).filter(Boolean)
    for (const term of keyterms) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="keyterms"\r\n\r\n${term}\r\n`
      ))
    }
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`))

  const body = Buffer.concat(parts)

  return new Promise<string>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        request.abort()
        const err = new Error('ElevenLabs transcription request timed out after 45s')
        handleTranscriptionError(err, 'elevenlabs')
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

    const request = net.request({
      method: 'POST',
      url: ELEVENLABS_STT_URL
    })

    request.setHeader('xi-api-key', apiKey)
    request.setHeader('Content-Type', `multipart/form-data; boundary=${boundary}`)

    const chunks: Buffer[] = []

    request.on('response', (response) => {
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      response.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf-8')
        if (response.statusCode !== 200) {
          const err = new Error(`ElevenLabs API error ${response.statusCode}: ${responseBody}`)
          handleTranscriptionError(err, 'elevenlabs')
          settle(reject)(err)
          return
        }
        try {
          const data = JSON.parse(responseBody) as TranscribeResult
          settle(resolve)(data.text)
        } catch {
          const err = new Error(`Failed to parse response: ${responseBody}`)
          handleTranscriptionError(err, 'elevenlabs')
          settle(reject)(err)
        }
      })
      response.on('error', (err: Error) => {
        handleTranscriptionError(err, 'elevenlabs')
        settle(reject)(err)
      })
    })

    request.on('error', (err: Error) => {
      handleTranscriptionError(err, 'elevenlabs')
      settle(reject)(err)
    })
    request.write(body)
    request.end()
  })
}

function postProcessWithLLM(apiKey: string, text: string, vocabulary: string, baseUrl: string): Promise<string> {
  const body = JSON.stringify({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          `Fix misrecognized technical terms in this speech-to-text transcript. ` +
          `Use these exact spellings: ${vocabulary}\n\n` +
          `Rules:\n` +
          `- Only fix obvious speech recognition errors (e.g. "get" → "git", "get hub" → "GitHub")\n` +
          `- Do NOT change meaning, rephrase, add words, or remove words\n` +
          `- Preserve the original language (Polish/English)\n` +
          `- Return ONLY the corrected text, nothing else`
      },
      { role: 'user', content: text }
    ]
  })

  return new Promise<string>((resolve, reject) => {
    const request = net.request({
      method: 'POST',
      url: `${baseUrl}/chat/completions`
    })

    if (apiKey) {
      request.setHeader('Authorization', `Bearer ${apiKey}`)
    }
    request.setHeader('Content-Type', 'application/json')

    const chunks: Buffer[] = []

    request.on('response', (response) => {
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      response.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf-8')
        if (response.statusCode !== 200) {
          reject(new Error(`OpenAI Chat API error ${response.statusCode}: ${responseBody}`))
          return
        }
        try {
          const data = JSON.parse(responseBody) as ChatResponse
          const corrected = data.choices?.[0]?.message?.content?.trim()
          resolve(corrected || text)
        } catch {
          reject(new Error(`Failed to parse Chat response: ${responseBody}`))
        }
      })
      response.on('error', (err: Error) => reject(err))
    })

    request.on('error', (err: Error) => reject(err))
    request.write(body)
    request.end()
  })
}
