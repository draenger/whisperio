import { app, net } from 'electron'
import { existsSync, mkdirSync, unlinkSync, readdirSync, statSync, createWriteStream } from 'fs'
import { join } from 'path'

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

  const writeStream = createWriteStream(tempPath)
  let downloadedBytes = 0
  let lastProgressTime = 0

  response.on('data', (chunk: Buffer) => {
    writeStream.write(chunk)
    downloadedBytes += chunk.length

    const now = Date.now()
    if (now - lastProgressTime > 200) {
      lastProgressTime = now
      const percent = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0
      progressCallback?.({ modelId, percent, downloadedBytes, totalBytes })
    }
  })

  response.on('end', () => {
    writeStream.end(() => {
      activeDownloads.delete(modelId)
      try {
        if (existsSync(filepath)) unlinkSync(filepath)
        const { renameSync } = require('fs')
        renameSync(tempPath, filepath)
        progressCallback?.({ modelId, percent: 100, downloadedBytes, totalBytes })
        resolve(filepath)
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  })

  response.on('error', (err: Error) => {
    writeStream.end()
    activeDownloads.delete(modelId)
    try { unlinkSync(tempPath) } catch { /* ignore */ }
    reject(err)
  })
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
    // Try deleting as custom model filename
    const filepath = join(getModelsDir(), modelId)
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
  const filepath = join(getModelsDir(), filename)
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
