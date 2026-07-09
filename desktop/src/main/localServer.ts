import { app, net } from 'electron'
import { existsSync, mkdirSync, unlinkSync, createWriteStream } from 'fs'
import { join } from 'path'
import { execFile, type ChildProcess } from 'child_process'

const WHISPER_CPP_RELEASE = 'v1.8.4'
const WHISPER_BIN_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_CPP_RELEASE}/whisper-bin-x64.zip`
const SERVER_PORT = 8178

// Idle reclaim: the whisper-server holds its loaded model resident in RAM/VRAM
// for the whole app lifetime. Without an idle sweep a user who transcribes once
// and then leaves the app open pays that memory cost indefinitely. Stamp
// `lastUsedAt` on start + on each transcription request (markServerUsed) and
// auto-stop the server once it has been idle past the TTL. It lazily re-spawns
// on the next startServer() call.
const DEFAULT_IDLE_TTL_MS = 15 * 60 * 1000
const IDLE_SWEEP_INTERVAL_MS = 60 * 1000

let serverProcess: ChildProcess | null = null
let serverStatus: 'stopped' | 'starting' | 'running' | 'error' = 'stopped'
let serverModel: string | null = null
let statusCallback: ((status: ServerStatus) => void) | null = null
let idleTtlMs = DEFAULT_IDLE_TTL_MS
let lastUsedAt = 0
let idleSweepTimer: ReturnType<typeof setInterval> | null = null

/** Override the idle TTL (ms) after which an idle server is auto-stopped. */
export function setIdleTtlMs(ms: number): void {
  idleTtlMs = ms
}

/**
 * Record that the local server was just used (a transcription request hit it).
 * Resets the idle clock so an actively-used server is not reclaimed.
 */
export function markServerUsed(): void {
  lastUsedAt = Date.now()
}

function clearIdleSweep(): void {
  if (idleSweepTimer) {
    clearInterval(idleSweepTimer)
    idleSweepTimer = null
  }
}

function startIdleSweep(): void {
  clearIdleSweep()
  lastUsedAt = Date.now()
  idleSweepTimer = setInterval(() => {
    if (serverStatus === 'running' && Date.now() - lastUsedAt >= idleTtlMs) {
      stopServer()
    }
  }, IDLE_SWEEP_INTERVAL_MS)
  // Don't let the sweep timer keep the event loop (or the Electron app) alive.
  idleSweepTimer.unref?.()
}

export interface ServerStatus {
  status: 'stopped' | 'starting' | 'running' | 'error'
  model: string | null
  port: number
  error?: string
  platform: string
}

function getServerDir(): string {
  const dir = join(app.getPath('userData'), 'whisper-server')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function getServerExePath(): string {
  return join(getServerDir(), 'whisper-server.exe')
}

function getModelsDir(): string {
  return join(app.getPath('userData'), 'models')
}

function emitStatus(error?: string): void {
  statusCallback?.({
    status: serverStatus,
    model: serverModel,
    port: SERVER_PORT,
    error,
    platform: process.platform
  })
}

export function setServerStatusCallback(cb: (status: ServerStatus) => void): void {
  statusCallback = cb
}

export function getServerStatus(): ServerStatus {
  return {
    status: serverStatus,
    model: serverModel,
    port: SERVER_PORT,
    platform: process.platform
  }
}

export function isServerBinaryAvailable(): boolean {
  return process.platform === 'win32' && existsSync(getServerExePath())
}

export async function downloadServerBinary(): Promise<string> {
  if (process.platform !== 'win32') {
    throw new Error('Auto-download is only available on Windows. Install whisper-server manually.')
  }

  const serverDir = getServerDir()
  const zipPath = join(serverDir, 'whisper-bin-x64.zip')

  // Download zip
  await downloadFile(WHISPER_BIN_URL, zipPath)

  // Extract all files from Release/ folder (server + required DLLs)
  const exePath = getServerExePath()
  await new Promise<void>((resolve, reject) => {
    execFile('powershell', [
      '-NoProfile', '-Command',
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
      `$zip = [System.IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/'/g, "''")}'); ` +
      `$needed = @('whisper-server.exe','whisper.dll','ggml.dll','ggml-base.dll','ggml-cpu.dll'); ` +
      `foreach ($entry in $zip.Entries) { ` +
      `  if ($needed -contains $entry.Name) { ` +
      `    $dest = Join-Path '${serverDir.replace(/'/g, "''")}' $entry.Name; ` +
      `    $stream = $entry.Open(); ` +
      `    $file = [System.IO.File]::Create($dest); ` +
      `    $stream.CopyTo($file); ` +
      `    $file.Close(); $stream.Close(); ` +
      `  } ` +
      `}; ` +
      `$zip.Dispose()`
    ], (err) => {
      try { unlinkSync(zipPath) } catch { /* ignore */ }
      if (err) reject(new Error(`Failed to extract: ${err.message}`))
      else resolve()
    })
  })

  return exePath
}

export async function startServer(modelFilename: string): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('Auto-start is only available on Windows.')
  }

  if (serverStatus === 'running' || serverStatus === 'starting') {
    throw new Error('Server is already running.')
  }

  const exePath = getServerExePath()
  if (!existsSync(exePath)) {
    serverStatus = 'starting'
    emitStatus()
    await downloadServerBinary()
  }

  const modelPath = join(getModelsDir(), modelFilename)
  if (!existsSync(modelPath)) {
    throw new Error(`Model not found: ${modelFilename}`)
  }

  serverStatus = 'starting'
  serverModel = modelFilename
  emitStatus()

  return new Promise<void>((resolve, reject) => {
    const proc = execFile(exePath, [
      '-m', modelPath,
      '--port', String(SERVER_PORT),
      '--host', '127.0.0.1'
    ])

    serverProcess = proc
    let started = false
    let assumeRunningTimer: NodeJS.Timeout | null = null
    const clearAssumeRunningTimer = (): void => {
      if (assumeRunningTimer) {
        clearTimeout(assumeRunningTimer)
        assumeRunningTimer = null
      }
    }

    const checkOutput = (data: string): void => {
      console.log(`[whisper-server] ${data}`)
      if (!started && (
        data.includes('listening') ||
        data.includes('model loaded') ||
        data.includes('HTTP server') ||
        data.includes('running') ||
        data.includes('ready')
      )) {
        started = true
        clearAssumeRunningTimer()
        serverStatus = 'running'
        startIdleSweep()
        emitStatus()
        resolve()
      }
    }

    proc.stdout?.on('data', checkOutput)
    proc.stderr?.on('data', checkOutput)

    proc.on('error', (err) => {
      clearAssumeRunningTimer()
      clearIdleSweep()
      serverStatus = 'error'
      serverProcess = null
      emitStatus(err.message)
      if (!started) reject(err)
    })

    proc.on('exit', (code) => {
      clearAssumeRunningTimer()
      clearIdleSweep()
      serverProcess = null
      if (serverStatus === 'running') {
        serverStatus = 'stopped'
        emitStatus()
      } else if (!started) {
        serverStatus = 'error'
        emitStatus(`Server exited with code ${code}`)
        reject(new Error(`Server exited with code ${code}`))
      }
    })

    // If server doesn't report "listening" in 30s, consider it running anyway.
    // The handle is cleared on success/error/exit so the timer doesn't leak and
    // fire stale logic up to 30s after the server already settled.
    assumeRunningTimer = setTimeout(() => {
      assumeRunningTimer = null
      if (!started && serverProcess && !serverProcess.killed) {
        started = true
        serverStatus = 'running'
        startIdleSweep()
        emitStatus()
        resolve()
      }
    }, 30_000)
  })
}

export function stopServer(): void {
  clearIdleSweep()
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill()
    serverProcess = null
  }
  serverStatus = 'stopped'
  serverModel = null
  emitStatus()
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: 'follow' })

    request.on('response', (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        const location = response.headers['location']
        const redirectUrl = Array.isArray(location) ? location[0] : location
        if (redirectUrl) {
          downloadFile(redirectUrl, destPath).then(resolve).catch(reject)
          return
        }
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${response.statusCode}`))
        return
      }

      // Electron's IncomingMessage is a Node Readable at runtime but its
      // typings don't surface pause/resume; cast for backpressure control.
      const readable = response as unknown as NodeJS.ReadableStream
      const writeStream = createWriteStream(destPath)
      let failed = false
      const fail = (err: unknown): void => {
        if (failed) return
        failed = true
        writeStream.destroy()
        try { unlinkSync(destPath) } catch { /* ignore */ }
        reject(err instanceof Error ? err : new Error(String(err)))
      }
      // Without an 'error' listener a disk-full / unwritable destination would
      // crash the Electron main process via an unhandled stream error.
      writeStream.on('error', fail)
      response.on('data', (chunk: Buffer) => {
        if (failed) return
        if (!writeStream.write(chunk)) {
          readable.pause()
          writeStream.once('drain', () => { if (!failed) readable.resume() })
        }
      })
      // Resolve only after bytes are flushed to disk, so a partial/corrupt zip
      // isn't reported as a successful download.
      response.on('end', () => {
        if (failed) return
        writeStream.end(() => { if (!failed) resolve() })
      })
      response.on('error', fail)
    })

    request.on('error', reject)
    request.end()
  })
}
