import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// Regression guard: no BrowserWindow in the main process may opt out of the
// renderer sandbox or turn on Node integration (security check 1101 #1).
const MAIN = join(__dirname, '..', 'src', 'main')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return sources(p)
    return /\.(ts|tsx)$/.test(name) ? [p] : []
  })
}

describe('BrowserWindow webPreferences', () => {
  const files = sources(MAIN)

  it('finds the main-process sources', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('never disables the sandbox or enables nodeIntegration', () => {
    const offenders = files.flatMap((f) => {
      const src = readFileSync(f, 'utf-8')
      return [/sandbox\s*:\s*false/, /nodeIntegration\s*:\s*true/, /webSecurity\s*:\s*false/]
        .filter((re) => re.test(src))
        .map((re) => `${f.slice(MAIN.length + 1)} ${re.source}`)
    })
    expect(offenders).toEqual([])
  })

  it('overlay window explicitly runs sandboxed with context isolation', () => {
    const src = readFileSync(join(MAIN, 'dictation', 'overlayWindow.ts'), 'utf-8')
    expect(src).toMatch(/sandbox\s*:\s*true/)
    expect(src).toMatch(/contextIsolation\s*:\s*true/)
  })
})
