// EXPERIMENTAL (spike, behind settings.experimentalParakeet): model resolver +
// downloader for the multi-file Parakeet TDT 0.6B V3 int8 ONNX set.
// modelManager.resolveModelFile only accepts plain `*.bin` basenames, so this
// is a separate, directory-confined resolver over a closed file list.
import { app } from 'electron'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { join, resolve, sep } from 'path'
import { downloadFileSecure } from '../modelManager'
import { forgetHash } from '../downloadIntegrity'

export const PARAKEET_MODEL_ID = 'parakeet-tdt-0.6b-v3-int8'
export const PARAKEET_DIR_NAME = 'parakeet-tdt-0.6b-v3-int8'

export interface ParakeetFileSpec {
  name: string
  url: string
  /** Size in bytes at the pinned HF revision (progress / disk checks). */
  approxBytes: number
  /**
   * SHA-256 pin (HF LFS oid at HF_REVISION; tokens.txt hashed from a download).
   * A null pin means the model is NEVER reported as `verified` (it can still be `ready`).
   */
  sha256: string | null
}

// Upstream sherpa-onnx release tarball (spec 3.1):
//   github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2
// To avoid a bz2 extraction dependency the spike downloads the files one by one.
// Per-file HuggingFace mirror the sherpa-onnx docs point at, pinned to a revision so an
// upstream re-upload cannot turn into an integrity error for users. Pins checked
// 2026-11-04: HF API LFS oids + a full download, load and transcription on the Mac (#47).
const HF_REVISION = '2bda32ec70b097a55adaa07d9a7173915b43cc78'
const HF_BASE = `https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/${HF_REVISION}`

export const PARAKEET_FILES: ParakeetFileSpec[] = [
  {
    name: 'encoder.int8.onnx',
    url: `${HF_BASE}/encoder.int8.onnx`,
    approxBytes: 652_184_281,
    sha256: 'acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247'
  },
  {
    name: 'decoder.int8.onnx',
    url: `${HF_BASE}/decoder.int8.onnx`,
    approxBytes: 11_845_275,
    sha256: '179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e'
  },
  {
    name: 'joiner.int8.onnx',
    url: `${HF_BASE}/joiner.int8.onnx`,
    approxBytes: 6_355_277,
    sha256: '3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3'
  },
  {
    name: 'tokens.txt',
    url: `${HF_BASE}/tokens.txt`,
    approxBytes: 93_939,
    sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d'
  }
]

export function getParakeetDir(): string {
  const dir = join(app.getPath('userData'), 'models', PARAKEET_DIR_NAME)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Resolve a catalog file name to an absolute path confined to the model dir. */
export function resolveParakeetFile(name: string): string {
  if (!PARAKEET_FILES.some((f) => f.name === name)) {
    throw new Error(`Invalid Parakeet model file: ${name}`)
  }
  const dir = resolve(getParakeetDir())
  const filepath = resolve(dir, name)
  if (!filepath.startsWith(dir + sep)) {
    throw new Error(`Parakeet path escapes model directory: ${name}`)
  }
  return filepath
}

export interface ParakeetModelStatus {
  ready: boolean
  /** All files present AND every file has a pinned SHA-256 that was checked. */
  verified: boolean
  dir: string
  missing: string[]
}

const MANIFEST_NAME = 'verified.json'

interface VerifiedRecord {
  size: number
  sha256: string
}

function manifestPath(): string {
  return join(getParakeetDir(), MANIFEST_NAME)
}

function readManifest(): Record<string, VerifiedRecord> {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath(), 'utf8'))
    return parsed && typeof parsed === 'object' && parsed.files && typeof parsed.files === 'object' ? parsed.files : {}
  } catch {
    return {}
  }
}

/** Record a file as verified. Call only after it passed its SHA-256 pin. */
function recordVerified(name: string, path: string, sha256: string): void {
  const files = readManifest()
  files[name] = { size: statSync(path).size, sha256: sha256.toLowerCase() }
  writeFileSync(manifestPath(), JSON.stringify({ files }, null, 2))
}

/** Usable only if present, with a manifest record matching its pin, and still the recorded size. */
function isVerified(spec: ParakeetFileSpec, records: Record<string, VerifiedRecord>): boolean {
  if (!spec.sha256) return false
  const rec = records[spec.name]
  if (!rec || typeof rec.sha256 !== 'string' || rec.sha256.toLowerCase() !== spec.sha256.toLowerCase()) return false
  try {
    const path = resolveParakeetFile(spec.name)
    return existsSync(path) && statSync(path).size > 0 && statSync(path).size === rec.size
  } catch {
    return false
  }
}

function nonEmpty(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).size > 0
  } catch {
    return false
  }
}

export function getParakeetModelStatus(): ParakeetModelStatus {
  const records = readManifest()
  // `missing` = not usable: absent, or present without a verified record (never fed to the recognizer).
  const missing = PARAKEET_FILES.filter((f) => !isVerified(f, records)).map((f) => f.name)
  const ready = missing.length === 0
  return { ready, verified: ready, dir: getParakeetDir(), missing }
}

export function isParakeetModelReady(): boolean {
  try {
    return getParakeetModelStatus().ready
  } catch {
    return false
  }
}

function sha256File(path: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash('sha256')
    const s = createReadStream(path)
    s.on('data', (c) => h.update(c))
    s.on('error', rej)
    s.on('end', () => res(h.digest('hex')))
  })
}

/** Absolute paths of the recognizer files, or throws if the model is incomplete. */
export function getParakeetModelPaths(): { encoder: string; decoder: string; joiner: string; tokens: string } {
  const status = getParakeetModelStatus()
  if (!status.ready) throw new Error(`Parakeet model is incomplete (missing: ${status.missing.join(', ')}).`)
  return {
    encoder: resolveParakeetFile('encoder.int8.onnx'),
    decoder: resolveParakeetFile('decoder.int8.onnx'),
    joiner: resolveParakeetFile('joiner.int8.onnx'),
    tokens: resolveParakeetFile('tokens.txt')
  }
}

export class ParakeetDownloadCancelledError extends Error {
  constructor() {
    super('Parakeet download cancelled.')
    this.name = 'ParakeetDownloadCancelledError'
  }
}

// One token per download operation; Cancel flips it so hashing / between-file gaps are covered too.
let currentRun: { cancelled: boolean } | null = null

/** Download every missing/unverified file sequentially; rejects on any failure or cancellation. */
export async function downloadParakeetModel(): Promise<ParakeetModelStatus> {
  if (currentRun) throw new Error('A Parakeet download is already running.')
  const run = { cancelled: false }
  currentRun = run
  const check = (partial?: string): void => {
    if (!run.cancelled) return
    if (partial) {
      try { unlinkSync(partial) } catch { /* ignore */ }
    }
    throw new ParakeetDownloadCancelledError()
  }
  try {
    for (const spec of PARAKEET_FILES) {
      check()
      if (!spec.sha256) throw new Error(`No SHA-256 pin for ${spec.name}; refusing to use it.`)
      const dest = resolveParakeetFile(spec.name)
      const partial = dest + '.downloading'
      if (isVerified(spec, readManifest())) continue
      if (nonEmpty(dest)) {
        // Left over (e.g. interrupted before it was recorded): accept only if it matches the pin.
        const actual = await sha256File(dest)
        check(partial)
        if (actual.toLowerCase() === spec.sha256.toLowerCase()) {
          recordVerified(spec.name, dest, spec.sha256)
          continue
        }
        try { unlinkSync(dest) } catch { /* ignore */ }
      }
      try {
        // The pin is checked by the shared downloader before promotion and before any hash is stored.
        await downloadFileSecure(`parakeet:${spec.name}`, spec.url, dest, spec.sha256)
      } catch (err) {
        check(partial)
        throw err
      }
      check(partial)
      recordVerified(spec.name, dest, spec.sha256)
    }
    return getParakeetModelStatus()
  } finally {
    if (currentRun === run) currentRun = null
  }
}

export function cancelParakeetDownload(cancel: (id: string) => boolean): void {
  if (currentRun) currentRun.cancelled = true
  for (const f of PARAKEET_FILES) cancel(`parakeet:${f.name}`)
}

export function deleteParakeetModel(): void {
  for (const f of PARAKEET_FILES) {
    try { unlinkSync(resolveParakeetFile(f.name)) } catch { /* ignore */ }
    try { unlinkSync(resolveParakeetFile(f.name) + '.downloading') } catch { /* ignore */ }
    forgetHash(`parakeet:${f.name}`)
  }
  try { unlinkSync(manifestPath()) } catch { /* ignore */ }
}
