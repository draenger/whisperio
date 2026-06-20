import { app, net } from 'electron'
import { existsSync, mkdirSync, unlinkSync, createWriteStream } from 'fs'
import { join } from 'path'
import { execFile, type ChildProcess } from 'child_process'

const WHISPER_CPP_RELEASE = 'v1.8.4'
const WHISPER_BIN_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_CPP_RELEASE}/whisper-bin-x64.zip`
const SERVER_PORT = 8178

let serverProcess: ChildProcess | null = null
let serverStatus: 'stopped' | 'starting' | 'running' | 'error' = 'stopped'
let serverModel: string | null = null
let statusCallback: ((status: ServerStatus) => void) | null = null

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
        serverStatus = 'running'
        emitStatus()
        resolve()
      }
    }

    proc.stdout?.on('data', checkOutput)
    proc.stderr?.on('data', checkOutput)

    proc.on('error', (err) => {
      serverStatus = 'error'
      serverProcess = null
      emitStatus(err.message)
      if (!started) reject(err)
    })

    proc.on('exit', (code) => {
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

    // If server doesn't report "listening" in 30s, consider it running anyway
    setTimeout(() => {
      if (!started && serverProcess && !serverProcess.killed) {
        started = true
        serverStatus = 'running'
        emitStatus()
        resolve()
      }
    }, 30_000)
  })
}

export function stopServer(): void {
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

      const writeStream = createWriteStream(destPath)
      response.on('data', (chunk: Buffer) => writeStream.write(chunk))
      response.on('end', () => writeStream.end(resolve))
      response.on('error', (err: Error) => {
        writeStream.end()
        reject(err)
      })
    })

    request.on('error', reject)
    request.end()
  })
}
