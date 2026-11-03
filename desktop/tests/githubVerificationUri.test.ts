import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '.') },
  shell: { openExternal: vi.fn() },
  net: { request: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false }
}))

import { isGithubVerificationUri } from '../src/main/githubSync'

describe('isGithubVerificationUri', () => {
  it('accepts the GitHub device page over https', () => {
    expect(isGithubVerificationUri('https://github.com/login/device')).toBe(true)
  })

  it.each([
    'http://github.com/login/device',
    'https://github.com.evil.com/login/device',
    'https://evil.com/github.com',
    'https://user:pw@github.com/login/device',
    'https://github.com:8443/login/device',
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'ms-settings:',
    '',
    'not a url',
    42,
    null
  ])('rejects %s', (uri) => {
    expect(isGithubVerificationUri(uri)).toBe(false)
  })
})
