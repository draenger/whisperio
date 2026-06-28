import { app, net } from 'electron'
import { existsSync, mkdirSync, unlinkSync, readdirSync, statSync, createWriteStream } from 'fs'
import { join, basename, resolve, sep } from 'path'

export interface ModelInfo {
  id: string
  name: string
  size: string
  sizeBytes: number
  description: string
  filename: string
  url: string
}

export interface LocalModel {
  id: string
  name: string
  filename: string
  filepath: string
  size: number
  downloaded: boolean
}

export interface DownloadProgress {
  modelId: string
  percent: number
  downloadedBytes: number
  totalBytes: number
}

const MODELS: ModelInfo[] = [
  {
    id: 'tiny',
    name: 'Tiny',
    size: '75 MB',
    sizeBytes: 75_000_000,
    description: 'Fastest, lowest quality. Good for testing.',
    filename: 'ggml-tiny.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin'
  },
  {
    id: 'base',
    name: 'Base',
    size: '142 MB',
    sizeBytes: 142_000_000,
    description: 'Fast with decent quality.',
    filename: 'ggml-base.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin'
  },
  {
    id: 'small',
    name: 'Small',
    size: '466 MB',
    sizeBytes: 466_000_000,
    description: 'Good balance of speed and quality.',
    filename: 'ggml-small.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin'
  },
  {
    id: 'medium',
    name: 'Medium',
    size: '1.5 GB',
    sizeBytes: 1_500_000_000,
    description: 'High quality, needs more RAM.',
    filename: 'ggml-medium.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin'
  },
  {
    id: 'large-v3-turbo',
    name: 'Large V3 Turbo',
    size: '1.6 GB',
    sizeBytes: 1_600_000_000,
    description: 'Best speed/quality ratio. Recommended.',
    filename: 'ggml-large-v3-turbo.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin'
  },
  {
    id: 'large-v3',
    name: 'Large V3',
    size: '3.1 GB',
    sizeBytes: 3_100_000_000,
    description: 'Best quality. Needs 6+ GB RAM.',
    filename: 'ggml-large-v3.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin'
  }
]

const activeDownloads = new Map<string, { abort: () => void }>()
let progressCallback: ((progress: DownloadProgress) => void) | null = null

function getModelsDir(): string {
  const dir = join(app.getPath('userData'), 'models')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * Resolve a renderer-supplied model filename/id to an absolute path that is
 * provably confined to the models directory. Rejects anything that is not a
 * plain `.bin` basename (no separators, no `..`) to prevent path traversal.
 * Accepts an optional `custom:` id prefix used by the renderer.
 */
function resolveModelFile(name: string): string {
  const filename = name.startsWith('custom:') ? name.slice('custom:'.length) : name
  if (!filename || filename !== basename(filename) || !/^[\w.-]+\.bin$/.test(filename)) {
    throw new Error(`Invalid model filename: ${name}`)
  }
  const dir = resolve(getModelsDir())
  const filepath = resolve(dir, filename)
  if (filepath !== join(dir, filename) || !(filepath === dir || filepath.startsWith(dir + sep))) {
    throw new Error(`Model path escapes models directory: ${name}`)
  }
  return filepath
}

export function getAvailableModels(): ModelInfo[] {
  return MODELS
}

export function getLocalModels(): LocalModel[] {
  const dir = getModelsDir()
  return MODELS.map((model) => {
    const filepath = join(dir, model.filename)
    const exists = existsSync(filepath)
    let size = 0
    if (exists) {
      try {
        size = statSync(filepath).size
      } catch { /* ignore */ }
    }
    return {
      id: model.id,
      name: model.name,
      filename: model.filename,
      filepath,
      size,
      downloaded: exists && size > 0
    }
  })
}

export function getModelPath(modelId: string): string | null {
  const model = MODELS.find((m) => m.id === modelId)
  if (!model) return null
  const filepath = join(getModelsDir(), model.filename)
  return existsSync(filepath) ? filepath : null
}

export function setDownloadProgressCallback(cb: (progress: DownloadProgress) => void): void {
  progressCallback = cb
}

export function downloadModel(modelId: string): Promise<string> {
  const model = MODELS.find((m) => m.id === modelId)
  if (!model) return Promise.reject(new Error(`Unknown model: ${modelId}`))

  const filepath = join(getModelsDir(), model.filename)
  const tempPath = filepath + '.downloading'

  if (activeDownloads.has(modelId)) {
    return Promise.reject(new Error(`Already downloading: ${modelId}`))
  }

  return new Promise<string>((resolve, reject) => {
    let aborted = false

    const request = net.request({ url: model.url, redirect: 'follow' })

    activeDownloads.set(modelId, {
      abort: () => {
        aborted = true
        request.abort()
        try { unlinkSync(tempPath) } catch { /* ignore */ }
      }
    })

    request.on('response', (response) => {
      // Handle redirects (HuggingFace returns 302)
      if (response.statusCode === 302 || response.statusCode === 301) {
        const location = response.headers['location']
        const redirectUrl = Array.isArray(location) ? location[0] : location
        if (redirectUrl) {
          activeDownloads.delete(modelId)
          // Follow redirect
          downloadFromUrl(modelId, redirectUrl, filepath, tempPath)
            .then(resolve)
            .catch(reject)
          return
        }
      }

      if (response.statusCode !== 200) {
        activeDownloads.delete(modelId)
        reject(new Error(`Download failed: HTTP ${response.statusCode}`))
        return
      }

      handleDownloadResponse(modelId, response, filepath, tempPath, resolve, reject)
    })

    request.on('error', (err) => {
      activeDownloads.delete(modelId)
      if (!aborted) reject(err)
    })

    request.end()
  })
}

function downloadFromUrl(modelId: string, url: string, filepath: string, tempPath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let aborted = false
    const request = net.request({ url, redirect: 'follow' })

    activeDownloads.set(modelId, {
      abort: () => {
        aborted = true
        request.abort()
        try { unlinkSync(tempPath) } catch { /* ignore */ }
      }
    })

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        activeDownloads.delete(modelId)
        reject(new Error(`Download failed: HTTP ${response.statusCode}`))
        return
      }
      handleDownloadResponse(modelId, response, filepath, tempPath, resolve, reject)
    })

    request.on('error', (err) => {
      activeDownloads.delete(modelId)
      if (!aborted) reject(err)
    })

    request.end()
  })
}

function handleDownloadResponse(
  modelId: string,
  response: Electron.IncomingMessage,
  filepath: string,
  tempPath: string,
  resolve: (path: string) => void,
  reject: (err: Error) => void
): void {
  const contentLength = response.headers['content-length']
  const totalBytes = contentLength
    ? parseInt(Array.isArray(contentLength) ? contentLength[0] : contentLength, 10)
    : 0

  // Electron's IncomingMessage is a Node Readable at runtime but its typings
  // don't surface pause/resume; cast for backpressure control.
  const readable = response as unknown as NodeJS.ReadableStream
  const writeStream = createWriteStream(tempPath)
  let downloadedBytes = 0
  let lastProgressTime = 0
  let failed = false

  // Tear down on any failure (disk full / unwritable path / network error).
  // Without this, a WriteStream 'error' has no listener and crashes the whole
  // Electron main process, killing the tray app mid-download.
  const fail = (err: unknown): void => {
    if (failed) return
    failed = true
    writeStream.destroy()
    activeDownloads.delete(modelId)
    try { unlinkSync(tempPath) } catch { /* ignore */ }
    reject(err instanceof Error ? err : new Error(String(err)))
  }

  writeStream.on('error', fail)

  response.on('data', (chunk: Buffer) => {
    if (failed) return
    // Honor backpressure: if the OS write buffer is full, pause the network
    // stream until it drains so multi-GB models don't balloon RSS / OOM.
    const ok = writeStream.write(chunk)
    if (!ok) {
      readable.pause()
      writeStream.once('drain', () => {
        if (!failed) readable.resume()
      })
    }
    downloadedBytes += chunk.length

    const now = Date.now()
    if (now - lastProgressTime > 200) {
      lastProgressTime = now
      const percent = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0
      progressCallback?.({ modelId, percent, downloadedBytes, totalBytes })
    }
  })

  response.on('end', () => {
    if (failed) return
    // Resolve only after the bytes are actually flushed to disk (finish).
    writeStream.end(() => {
      if (failed) return
      activeDownloads.delete(modelId)
      try {
        if (existsSync(filepath)) unlinkSync(filepath)
        const { renameSync } = require('fs')
        renameSync(tempPath, filepath)
        progressCallback?.({ modelId, percent: 100, downloadedBytes, totalBytes })
        resolve(filepath)
      } catch (err) {
        fail(err)
      }
    })
  })

  response.on('error', fail)
}

export function cancelDownload(modelId: string): boolean {
  const download = activeDownloads.get(modelId)
  if (download) {
    download.abort()
    activeDownloads.delete(modelId)
    return true
  }
  return false
}

export function deleteModel(modelId: string): boolean {
  const model = MODELS.find((m) => m.id === modelId)
  if (!model) {
    // Try deleting as a custom model filename — validate/confine the path
    // first so a malicious renderer can't delete arbitrary files via `..`.
    let filepath: string
    try {
      filepath = resolveModelFile(modelId)
    } catch {
      return false
    }
    try {
      if (existsSync(filepath)) {
        unlinkSync(filepath)
        return true
      }
    } catch { /* ignore */ }
    return false
  }
  const filepath = join(getModelsDir(), model.filename)
  try {
    if (existsSync(filepath)) {
      unlinkSync(filepath)
      return true
    }
  } catch { /* ignore */ }
  return false
}

export function downloadCustomModel(url: string, filename: string): Promise<string> {
  // Validate the renderer-supplied filename and confine it to the models dir
  // before building any filesystem path (prevents path traversal).
  let filepath: string
  try {
    filepath = resolveModelFile(filename)
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)))
  }
  // Only allow http(s) downloads — reject file:, etc.
  try {
    const proto = new URL(url).protocol
    if (proto !== 'http:' && proto !== 'https:') {
      return Promise.reject(new Error(`Unsupported download URL protocol: ${proto}`))
    }
  } catch {
    return Promise.reject(new Error('Invalid download URL'))
  }

  const tempPath = filepath + '.downloading'
  const customId = `custom:${filename}`

  if (activeDownloads.has(customId)) {
    return Promise.reject(new Error(`Already downloading: ${filename}`))
  }

  return new Promise<string>((resolve, reject) => {
    let aborted = false

    const request = net.request({ url, redirect: 'follow' })

    activeDownloads.set(customId, {
      abort: () => {
        aborted = true
        request.abort()
        try { unlinkSync(tempPath) } catch { /* ignore */ }
      }
    })

    request.on('response', (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        const location = response.headers['location']
        const redirectUrl = Array.isArray(location) ? location[0] : location
        if (redirectUrl) {
          activeDownloads.delete(customId)
          downloadFromUrl(customId, redirectUrl, filepath, tempPath)
            .then(resolve)
            .catch(reject)
          return
        }
      }

      if (response.statusCode !== 200) {
        activeDownloads.delete(customId)
        reject(new Error(`Download failed: HTTP ${response.statusCode}`))
        return
      }

      handleDownloadResponse(customId, response, filepath, tempPath, resolve, reject)
    })

    request.on('error', (err) => {
      activeDownloads.delete(customId)
      if (!aborted) reject(err)
    })

    request.end()
  })
}

export function getCustomModels(): LocalModel[] {
  const dir = getModelsDir()
  const knownFilenames = new Set(MODELS.map((m) => m.filename))
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.bin') && !f.endsWith('.downloading') && !knownFilenames.has(f))
      .map((filename) => {
        const filepath = join(dir, filename)
        const size = statSync(filepath).size
        return {
          id: `custom:${filename}`,
          name: filename.replace('.bin', ''),
          filename,
          filepath,
          size,
          downloaded: true
        }
      })
  } catch { return [] }
}
