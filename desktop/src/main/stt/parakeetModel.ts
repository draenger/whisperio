// EXPERIMENTAL (spike, behind settings.experimentalParakeet): model resolver +
// downloader for the multi-file Parakeet TDT 0.6B V3 int8 ONNX set.
// modelManager.resolveModelFile only accepts plain `*.bin` basenames, so this
// is a separate, directory-confined resolver over a closed file list.
import { app } from 'electron'
import { createReadStream, existsSync, mkdirSync, statSync, unlinkSync } from 'fs'
import { createHash } from 'crypto'
import { join, resolve, sep } from 'path'
import { downloadFileSecure } from '../modelManager'

export const PARAKEET_MODEL_ID = 'parakeet-tdt-0.6b-v3-int8'
export const PARAKEET_DIR_NAME = 'parakeet-tdt-0.6b-v3-int8'

export interface ParakeetFileSpec {
  name: string
  url: string
  /** Approximate size from the sherpa-onnx docs page (spec section 3.1). */
  approxBytes: number
  /**
   * SHA-256 pin. TODO: the spec lists no hashes. Until every entry is filled
   * the model is NEVER reported as `verified` (it can still be `ready`).
   */
  sha256: string | null
}

// Upstream sherpa-onnx release tarball (spec 3.1):
//   github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2
// To avoid a bz2 extraction dependency the spike downloads the files one by one.
// TODO(unverified): the per-file HuggingFace mirror below is the repo the
// sherpa-onnx docs point at for these models, but its URLs were not fetched for
// this spike (no downloads allowed). Confirm before enabling for users.
const HF_BASE =
  'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/main'

export const PARAKEET_FILES: ParakeetFileSpec[] = [
  { name: 'encoder.int8.onnx', url: `${HF_BASE}/encoder.int8.onnx`, approxBytes: 622_000_000, sha256: null },
  { name: 'decoder.int8.onnx', url: `${HF_BASE}/decoder.int8.onnx`, approxBytes: 12_000_000, sha256: null },
  { name: 'joiner.int8.onnx', url: `${HF_BASE}/joiner.int8.onnx`, approxBytes: 6_100_000, sha256: null },
  { name: 'tokens.txt', url: `${HF_BASE}/tokens.txt`, approxBytes: 92_000, sha256: null }
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

const verifiedFiles = new Set<string>()

function nonEmpty(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).size > 0
  } catch {
    return false
  }
}

export function getParakeetModelStatus(): ParakeetModelStatus {
  const missing = PARAKEET_FILES.filter((f) => !nonEmpty(resolveParakeetFile(f.name))).map((f) => f.name)
  const ready = missing.length === 0
  const verified = ready && PARAKEET_FILES.every((f) => f.sha256 !== null && verifiedFiles.has(f.name))
  return { ready, verified, dir: getParakeetDir(), missing }
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

/** Download every missing file sequentially; rejects on any failure. */
export async function downloadParakeetModel(): Promise<ParakeetModelStatus> {
  for (const spec of PARAKEET_FILES) {
    const dest = resolveParakeetFile(spec.name)
    if (!nonEmpty(dest)) {
      await downloadFileSecure(`parakeet:${spec.name}`, spec.url, dest)
    }
    if (spec.sha256) {
      const actual = await sha256File(dest)
      if (actual.toLowerCase() !== spec.sha256.toLowerCase()) {
        try { unlinkSync(dest) } catch { /* ignore */ }
        throw new Error(`SHA-256 mismatch for ${spec.name}; the file was discarded.`)
      }
      verifiedFiles.add(spec.name)
    }
  }
  return getParakeetModelStatus()
}

export function cancelParakeetDownload(cancel: (id: string) => boolean): void {
  for (const f of PARAKEET_FILES) cancel(`parakeet:${f.name}`)
}

export function deleteParakeetModel(): void {
  for (const f of PARAKEET_FILES) {
    try { unlinkSync(resolveParakeetFile(f.name)) } catch { /* ignore */ }
    verifiedFiles.delete(f.name)
  }
}
