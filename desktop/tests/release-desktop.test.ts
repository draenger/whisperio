import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
// @ts-expect-error plain .mjs script, no types
import * as rel from '../scripts/release-desktop.mjs'

const dirs: string[] = []
afterEach(() => {
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }))
})

describe('parseArgs', () => {
  it('defaults to dry run', () => {
    const r = rel.parseArgs([])
    expect(r.ok).toBe(true)
    expect(r.opts.execute).toBe(false)
    expect(r.opts.publish).toBe(false)
  })
  it('accepts --execute --publish', () => {
    expect(rel.parseArgs(['--execute', '--publish']).opts).toMatchObject({ execute: true, publish: true })
  })
  it('rejects --publish without --execute', () => {
    expect(rel.parseArgs(['--publish']).ok).toBe(false)
  })
  it('rejects --skip-build without --execute', () => {
    expect(rel.parseArgs(['--skip-build']).ok).toBe(false)
  })
  it('rejects unknown args', () => {
    expect(rel.parseArgs(['--yes']).ok).toBe(false)
    expect(rel.parseArgs(['foo']).ok).toBe(false)
  })
})

describe('sha512Base64', () => {
  it('matches the crypto base64 digest', async () => {
    const d = mkdtempSync(join(tmpdir(), 'rel-'))
    dirs.push(d)
    const f = join(d, 'a.bin')
    writeFileSync(f, 'hello whisperio')
    expect(await rel.sha512Base64(f)).toBe(createHash('sha512').update('hello whisperio').digest('base64'))
  })
})

const yml = (v: string, sha: string) => `version: ${v}
files:
  - url: Whisperio-Setup-${v}.exe
    sha512: ${sha}
    size: 123
path: Whisperio-Setup-${v}.exe
sha512: ${sha}
releaseDate: '2026-10-18T00:00:00.000Z'
`

describe('latest.yml', () => {
  const args = { version: '1.5.0', installerName: 'Whisperio-Setup-1.5.0.exe', sha512: 'AAA=' }
  it('parses fields', () => {
    const p = rel.parseLatestYml(yml('1.5.0', 'AAA='))
    expect(p).toMatchObject({ version: '1.5.0', path: 'Whisperio-Setup-1.5.0.exe', sha512: 'AAA=' })
    expect(p.files).toEqual([{ url: 'Whisperio-Setup-1.5.0.exe', sha512: 'AAA=' }])
  })
  it('matches', () => {
    expect(rel.compareLatestYml(rel.parseLatestYml(yml('1.5.0', 'AAA=')), args)).toEqual([])
  })
  it('flags sha, version and path mismatches', () => {
    expect(rel.compareLatestYml(rel.parseLatestYml(yml('1.5.0', 'BBB=')), args).length).toBeGreaterThanOrEqual(2)
    expect(rel.compareLatestYml(rel.parseLatestYml(yml('1.4.0', 'AAA=')), args).length).toBeGreaterThanOrEqual(2)
    expect(rel.compareLatestYml(rel.parseLatestYml(''), args).length).toBeGreaterThanOrEqual(3)
  })
})

describe('plan', () => {
  const steps = (opts: object) =>
    rel.buildPlan('1.5.0', opts).filter((r: { run: boolean }) => r.run).map((r: { step: string }) => r.step)
  it('dry run only runs preflight', () => {
    expect(steps({ execute: false, publish: false, 'skip-build': false })).toEqual(['preflight'])
  })
  it('execute stops before publish', () => {
    expect(steps({ execute: true, publish: false, 'skip-build': false })).toEqual(['preflight', 'build', 'verify', 'upload'])
  })
  it('publish adds the edit; skip-build drops build', () => {
    const o = { execute: true, publish: true, 'skip-build': true }
    expect(steps(o)).toEqual(['preflight', 'verify', 'upload', 'publish'])
    const rows = rel.buildPlan('1.5.0', o)
    expect(rows.at(-1).command).toBe('gh release edit v1.5.0 --draft=false')
    expect(rel.formatPlan(rows, o)).toContain('EXECUTE')
    expect(rel.publishHint('1.5.0')).toBe('gh release edit v1.5.0 --draft=false')
  })
})

describe('preflight (mocked child_process)', () => {
  const mk = (over: Record<string, unknown> = {}) =>
    vi.fn((cmd: string, args: string[]) => {
      const key = `${cmd} ${args.join(' ')}`
      for (const [k, v] of Object.entries(over)) if (key.startsWith(k)) return v
      if (key.startsWith('git status')) return { status: 0, stdout: '' }
      if (key.startsWith('git rev-parse --abbrev-ref')) return { status: 0, stdout: 'main\n' }
      if (key.startsWith('git rev-parse -q')) return { status: 1, stdout: '' }
      if (key.startsWith('git rev-parse')) return { status: 0, stdout: 'abc\n' }
      if (key.startsWith('powershell')) return { status: 0, stdout: 'FOUND\n' }
      if (key.startsWith('gh release view')) return { status: 0, stdout: JSON.stringify({ isDraft: true, assets: [{ name: 'a.zip' }] }) }
      return { status: 0, stdout: '' }
    })
  const base = { version: '1.5.0', platform: 'win32', findSigntool: () => 'C:\\signtool.exe' }
  const dry = { execute: false }
  const exec = { execute: true }
  const st = (cs: { name: string; status: string }[], n: string) => cs.find((c) => c.name === n)!.status

  it('all green', () => {
    expect(rel.preflight(dry, { ...base, run: mk() }).every((c: { status: string }) => c.status === 'ok')).toBe(true)
  })
  it('dirty tree and wrong branch fail', () => {
    const cs = rel.preflight(dry, {
      ...base,
      run: mk({ 'git status': { status: 0, stdout: ' M x' }, 'git rev-parse --abbrev-ref': { status: 0, stdout: 'feat\n' } })
    })
    expect(st(cs, 'git clean tree')).toBe('fail')
    expect(st(cs, 'git branch')).toBe('fail')
  })
  it('branch behind origin fails', () => {
    const run = vi.fn((cmd: string, args: string[]) => {
      const key = `${cmd} ${args.join(' ')}`
      if (key === 'git rev-parse HEAD') return { status: 0, stdout: 'aaa' }
      if (key === 'git rev-parse origin/main') return { status: 0, stdout: 'bbb' }
      if (key.startsWith('git rev-parse --abbrev-ref')) return { status: 0, stdout: 'main' }
      return { status: 0, stdout: '' }
    })
    expect(st(rel.preflight(dry, { ...base, run }), 'git branch')).toBe('fail')
  })
  it('missing draft is a warning in dry run and a failure in execute', () => {
    const run = mk({ 'gh release view': { status: 1, stdout: '' } })
    expect(st(rel.preflight(dry, { ...base, run }), 'draft release')).toBe('warn')
    expect(st(rel.preflight(exec, { ...base, run }), 'draft release')).toBe('fail')
  })
  it('already published release is rejected for upload', () => {
    const run = mk({ 'gh release view': { status: 0, stdout: JSON.stringify({ isDraft: false, assets: [] }) } })
    const cs = rel.preflight(exec, { ...base, run })
    expect(st(cs, 'draft release')).toBe('fail')
    expect(st(cs, 'CI assets')).toBe('fail')
  })
  it('missing cert and signtool fail; non-windows says so', () => {
    const cs = rel.preflight(dry, { ...base, findSigntool: () => undefined, run: mk({ powershell: { status: 0, stdout: 'MISSING' } }) })
    expect(st(cs, 'signing cert')).toBe('fail')
    expect(st(cs, 'signtool')).toBe('fail')
    const mac = rel.preflight(dry, { ...base, platform: 'darwin', run: mk() })
    expect(mac.find((c: { name: string }) => c.name === 'signing cert').detail).toMatch(/Windows/)
  })
  it('cert query is read-only (no export)', () => {
    const run = mk()
    rel.preflight(dry, { ...base, run })
    const ps = run.mock.calls.find((c) => c[0] === 'powershell')![1].join(' ')
    expect(ps).toContain('Get-ChildItem')
    expect(ps).not.toMatch(/Export|pfx/i)
  })
  it('invalid version fails', () => {
    expect(st(rel.preflight(dry, { ...base, version: 'x', run: mk() }), 'version')).toBe('fail')
  })
  it('formatChecks prints a tag per check', () => {
    const out = rel.formatChecks([{ name: 'a', status: 'ok', detail: 'd' }, { name: 'b', status: 'warn', detail: 'e' }])
    expect(out).toContain('[PASS] a')
    expect(out).toContain('[WARN] b')
  })
})

describe('findSigntool', () => {
  it('picks the newest SDK signtool', () => {
    const p = rel.findSigntool({
      env: { 'ProgramFiles(x86)': 'C:\\PF', LOCALAPPDATA: 'C:\\L' },
      exists: (x: string) => x.endsWith('bin') || x.endsWith('signtool.exe'),
      list: () => ['10.0.19041.0', '10.0.22621.0']
    })
    expect(p).toContain('10.0.22621.0')
  })
  it('returns undefined when absent', () => {
    expect(rel.findSigntool({ env: {}, exists: () => false, list: () => [] })).toBeUndefined()
  })
})

describe('main', () => {
  it('usage error returns 2', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await rel.main(['--bogus'])).toBe(2)
    spy.mockRestore()
  })
  it('--help returns 0', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await rel.main(['--help'])).toBe(0)
    spy.mockRestore()
  })
  it('preflight failure returns 1 without building', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const run = vi.fn(() => ({ status: 1, stdout: '' }))
    expect(await rel.main(['--execute'], { run, platform: 'win32', findSigntool: () => undefined })).toBe(1)
    expect(run.mock.calls.some((c) => (c as unknown[])[0] === 'npm')).toBe(false)
    log.mockRestore()
    err.mockRestore()
  })
})
