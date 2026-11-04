import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'

let userData = ''
vi.mock('electron', () => ({
  app: { getPath: () => userData, getAppPath: () => userData },
  net: { request: vi.fn() }
}))

const downloadFileSecure = vi.fn()
vi.mock('../src/main/modelManager', () => ({
  downloadFileSecure: (...a: unknown[]) => downloadFileSecure(...a)
}))
const forgetHash = vi.fn()
vi.mock('../src/main/downloadIntegrity', () => ({
  forgetHash: (...a: unknown[]) => forgetHash(...a)
}))

import {
  PARAKEET_FILES,
  resolveParakeetFile,
  getParakeetDir,
  getParakeetModelStatus,
  downloadParakeetModel,
  cancelParakeetDownload,
  deleteParakeetModel,
  ParakeetDownloadCancelledError
} from '../src/main/stt/parakeetModel'

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const origPins = PARAKEET_FILES.map((f) => f.sha256)
const baseName = (p: string): string => p.split(/[\\/]/).pop() as string

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'pk-dl-'))
  downloadFileSecure.mockReset()
  forgetHash.mockReset()
  // Pins over test content so a download "passes" without the real 650 MB files.
  PARAKEET_FILES.forEach((f) => { f.sha256 = sha(`content-${f.name}`) })
})
afterEach(() => {
  PARAKEET_FILES.forEach((f, i) => { f.sha256 = origPins[i] })
  rmSync(userData, { recursive: true, force: true })
})

function fakeDownload(): void {
  downloadFileSecure.mockImplementation(async (_id: string, _url: string, dest: string) => {
    writeFileSync(dest, `content-${baseName(dest)}`)
    return dest
  })
}

describe('parakeet download: pin, manifest, cancellation', () => {
  it('passes the SHA-256 pin to the shared downloader and records only verified files', async () => {
    fakeDownload()
    const st = await downloadParakeetModel()
    expect(downloadFileSecure).toHaveBeenCalledTimes(4)
    for (const [i, f] of PARAKEET_FILES.entries()) {
      expect(downloadFileSecure.mock.calls[i][3]).toBe(f.sha256)
    }
    expect(st.ready).toBe(true)
    expect(existsSync(join(getParakeetDir(), 'verified.json'))).toBe(true)
  })

  it('a downloader rejection (pin mismatch) records nothing and leaves the model not ready', async () => {
    downloadFileSecure.mockRejectedValue(new Error('SHA-256 mismatch'))
    await expect(downloadParakeetModel()).rejects.toThrow(/mismatch/)
    expect(getParakeetModelStatus().ready).toBe(false)
    expect(existsSync(join(getParakeetDir(), 'verified.json'))).toBe(false)
  })

  it('a leftover file that matches the pin is recorded without re-downloading; a corrupt one is replaced', async () => {
    const [enc, dec] = PARAKEET_FILES
    writeFileSync(resolveParakeetFile(enc.name), `content-${enc.name}`)
    writeFileSync(resolveParakeetFile(dec.name), 'corrupt')
    fakeDownload()
    const st = await downloadParakeetModel()
    expect(st.ready).toBe(true)
    const ids = downloadFileSecure.mock.calls.map((c) => c[0])
    expect(ids).not.toContain(`parakeet:${enc.name}`)
    expect(ids).toContain(`parakeet:${dec.name}`)
    expect(readFileSync(resolveParakeetFile(dec.name), 'utf8')).toBe(`content-${dec.name}`)
  })

  it('Cancel during hashing stops the whole run (no further files downloaded, nothing recorded)', async () => {
    const enc = PARAKEET_FILES[0]
    writeFileSync(resolveParakeetFile(enc.name), `content-${enc.name}`)
    fakeDownload()
    const run = downloadParakeetModel()
    const assertion = expect(run).rejects.toBeInstanceOf(ParakeetDownloadCancelledError)
    cancelParakeetDownload(() => false) // no network request registered: only hashing is in flight
    await assertion
    expect(downloadFileSecure).not.toHaveBeenCalled()
    expect(existsSync(join(getParakeetDir(), 'verified.json'))).toBe(false)
  })

  it('Cancel while a file downloads removes the partial file and throws a cancellation error', async () => {
    const partial = resolveParakeetFile(PARAKEET_FILES[0].name) + '.downloading'
    downloadFileSecure.mockImplementation(async () => {
      writeFileSync(partial, 'half')
      cancelParakeetDownload(() => true)
      throw new Error('aborted')
    })
    await expect(downloadParakeetModel()).rejects.toBeInstanceOf(ParakeetDownloadCancelledError)
    expect(existsSync(partial)).toBe(false)
    expect(downloadFileSecure).toHaveBeenCalledTimes(1)
  })

  it('Cancel after a file finished does not continue to the remaining files', async () => {
    downloadFileSecure.mockImplementation(async (_id: string, _u: string, dest: string) => {
      writeFileSync(dest, `content-${baseName(dest)}`)
      cancelParakeetDownload(() => false)
      return dest
    })
    await expect(downloadParakeetModel()).rejects.toBeInstanceOf(ParakeetDownloadCancelledError)
    expect(downloadFileSecure).toHaveBeenCalledTimes(1)
  })

  it('delete clears the stored integrity records of every Parakeet file', () => {
    deleteParakeetModel()
    expect(forgetHash.mock.calls.map((c) => c[0])).toEqual(PARAKEET_FILES.map((f) => `parakeet:${f.name}`))
  })
})
