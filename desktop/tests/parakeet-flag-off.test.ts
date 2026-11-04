import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// index.ts (IPC wiring) and SettingsForm.tsx are excluded from unit coverage, so the flag-off
// contract is pinned at the source level.
const root = join(__dirname, '..', 'src')
const indexSrc = readFileSync(join(root, 'main', 'index.ts'), 'utf8')
const formSrc = readFileSync(join(root, 'renderer', 'components', 'settings', 'SettingsForm.tsx'), 'utf8')

function handlerBody(channel: string): string {
  const start = indexSrc.indexOf(`ipcMain.handle('${channel}'`)
  expect(start).toBeGreaterThan(-1)
  const next = indexSrc.indexOf('ipcMain.handle(', start + 10)
  return indexSrc.slice(start, next)
}

describe('parakeet flag OFF', () => {
  it('parakeet:cancel is not gated by the flag and shuts the worker down', () => {
    const body = handlerBody('parakeet:cancel')
    expect(body).not.toContain('parakeetEnabled')
    expect(body).toContain('cancelParakeetDownload')
    expect(body).toContain('shutdownParakeet')
  })

  it('the work-starting handlers stay gated by the flag', () => {
    expect(handlerBody('parakeet:download')).toContain('parakeetEnabled()')
    expect(handlerBody('parakeet:delete')).toContain('parakeetEnabled()')
  })

  it('turning the flag off cancels before saving experimentalParakeet=false', () => {
    const cancelAt = formSrc.indexOf('window.api.parakeet.cancel()')
    const saveOffAt = formSrc.indexOf('experimentalParakeet: false')
    expect(cancelAt).toBeGreaterThan(-1)
    expect(saveOffAt).toBeGreaterThan(cancelAt)
  })
})
