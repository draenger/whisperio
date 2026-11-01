import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

interface Call {
  opts: { method: string; url: string; redirect?: string }
  headers: Record<string, string>
  written: string[]
  aborted: boolean
}
type Reply =
  | { status: number; body?: unknown; raw?: string }
  | { error: Error }
  | { hang: true }

const calls: Call[] = []
let replies: Reply[] = []

vi.mock('electron', () => ({
  net: {
    request: vi.fn((opts: Call['opts']) => {
      const call: Call = { opts, headers: {}, written: [], aborted: false }
      calls.push(call)
      const handlers: Record<string, (arg?: unknown) => void> = {}
      return {
        setHeader: (k: string, v: string) => {
          call.headers[k] = v
        },
        write: (s: string) => call.written.push(s),
        abort: () => {
          call.aborted = true
        },
        on: (ev: string, cb: (arg?: unknown) => void) => {
          handlers[ev] = cb
        },
        end: () => {
          const reply = replies.shift() ?? { status: 500 }
          if ('hang' in reply) return
          queueMicrotask(() => {
            if ('error' in reply) return handlers['error']?.(reply.error)
            const rh: Record<string, (arg?: unknown) => void> = {}
            handlers['response']?.({
              statusCode: reply.status,
              on: (e: string, cb: (arg?: unknown) => void) => {
                rh[e] = cb
              }
            })
            const text = reply.raw ?? (reply.body === undefined ? '' : JSON.stringify(reply.body))
            if (text) rh['data']?.(Buffer.from(text))
            rh['end']?.()
          })
        }
      }
    })
  }
}))

const TOKEN = 'gho_SUPERSECRETTOKEN123'

async function load(clientId = 'cid-123') {
  vi.resetModules()
  if (clientId) process.env['WHISPERIO_GITHUB_CLIENT_ID'] = clientId
  else delete process.env['WHISPERIO_GITHUB_CLIENT_ID']
  return import('../src/main/githubStore')
}

beforeEach(() => {
  calls.length = 0
  replies = []
})
afterEach(() => {
  vi.useRealTimers()
  delete process.env['WHISPERIO_GITHUB_CLIENT_ID']
})

describe('isClientConfigured / startDeviceFlow', () => {
  it('is false without a client id and startDeviceFlow throws without any network call', async () => {
    const m = await load('')
    expect(m.isClientConfigured()).toBe(false)
    await expect(m.startDeviceFlow()).rejects.toThrow(/not configured/)
    expect(calls).toHaveLength(0)
  })

  it('posts form-encoded client_id + repo scope and maps the response', async () => {
    const m = await load()
    replies.push({
      status: 200,
      body: { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 600, interval: 7 }
    })
    const r = await m.startDeviceFlow()
    expect(r).toEqual({ deviceCode: 'dc', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', expiresIn: 600, interval: 7 })
    const c = calls[0]
    expect(c.opts.method).toBe('POST')
    expect(c.opts.url).toBe('https://github.com/login/device/code')
    expect(c.opts.redirect).toBe('error')
    expect(c.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(c.headers['User-Agent']).toBe('Whisperio')
    const form = new URLSearchParams(c.written.join(''))
    expect(form.get('client_id')).toBe('cid-123')
    expect(form.get('scope')).toBe('repo')
  })

  it('defaults expires_in=900 and interval=5 when absent', async () => {
    const m = await load()
    replies.push({ status: 200, body: { device_code: 'dc', user_code: 'u', verification_uri: 'v' } })
    const r = await m.startDeviceFlow()
    expect(r.expiresIn).toBe(900)
    expect(r.interval).toBe(5)
  })

  it('throws with HTTP status when the response lacks device_code', async () => {
    const m = await load()
    replies.push({ status: 404, body: { error: 'x' } })
    await expect(m.startDeviceFlow()).rejects.toThrow('Failed to start GitHub device flow (HTTP 404)')
  })
})

describe('pollForToken', () => {
  it('sends device code grant and returns the token when authorized', async () => {
    const m = await load()
    replies.push({ status: 200, body: { access_token: TOKEN } })
    expect(await m.pollForToken('dc9')).toEqual({ status: 'authorized', token: TOKEN })
    const form = new URLSearchParams(calls[0].written.join(''))
    expect(form.get('device_code')).toBe('dc9')
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code')
    expect(form.get('client_id')).toBe('cid-123')
    expect(calls[0].opts.url).toBe('https://github.com/login/oauth/access_token')
  })

  it.each([
    [{ error: 'authorization_pending' }, { status: 'pending' }],
    [{ error: 'slow_down', interval: 15 }, { status: 'slow_down', interval: 15 }],
    [{ error: 'slow_down' }, { status: 'slow_down', interval: 10 }],
    [{ error: 'expired_token' }, { status: 'expired' }],
    [{ error: 'access_denied' }, { status: 'denied' }],
    [{ error: 'bad', error_description: 'Nope' }, { status: 'error', message: 'Nope' }],
    [{ error: 'bad' }, { status: 'error', message: 'bad' }],
    [{}, { status: 'error', message: 'Unknown error' }]
  ])('maps %j', async (body, expected) => {
    const m = await load()
    replies.push({ status: 200, body })
    expect(await m.pollForToken('x')).toEqual(expected)
  })
})

describe('authenticated API request shapes', () => {
  it('getAuthenticatedUser: GET /user with bearer + api-version headers', async () => {
    const m = await load()
    replies.push({ status: 200, body: { login: 'octo', avatar_url: 'http://a' } })
    expect(await m.getAuthenticatedUser(TOKEN)).toEqual({ login: 'octo', avatarUrl: 'http://a' })
    expect(calls[0].opts.method).toBe('GET')
    expect(calls[0].opts.url).toBe('https://api.github.com/user')
    expect(calls[0].headers['Authorization']).toBe(`Bearer ${TOKEN}`)
    expect(calls[0].headers['Accept']).toBe('application/vnd.github+json')
    expect(calls[0].headers['X-GitHub-Api-Version']).toBe('2022-11-28')
    expect(calls[0].written).toEqual([])
  })

  it('getAuthenticatedUser: 401 throws an error that does not leak the token', async () => {
    const m = await load()
    replies.push({ status: 401, body: { message: 'Bad credentials' } })
    const err = (await m.getAuthenticatedUser(TOKEN).catch((e: Error) => e)) as Error
    expect(err.message).toBe('GitHub /user failed (HTTP 401)')
    expect(err.message).not.toContain(TOKEN)
  })

  it('listRepos: maps fields, defaults branch, stops after a short page', async () => {
    const m = await load()
    replies.push({
      status: 200,
      body: [
        { full_name: 'a/b', private: true, default_branch: 'dev' },
        { full_name: 'a/c', private: false }
      ]
    })
    expect(await m.listRepos(TOKEN)).toEqual([
      { fullName: 'a/b', private: true, defaultBranch: 'dev' },
      { fullName: 'a/c', private: false, defaultBranch: 'main' }
    ])
    expect(calls).toHaveLength(1)
    expect(calls[0].opts.url).toContain('/user/repos?per_page=100&sort=updated')
    expect(calls[0].opts.url).toContain('page=1')
  })

  it('listRepos: paginates up to 3 pages of 100', async () => {
    const m = await load()
    const page = Array.from({ length: 100 }, (_, i) => ({ full_name: `o/r${i}`, private: false, default_branch: 'main' }))
    replies.push({ status: 200, body: page }, { status: 200, body: page }, { status: 200, body: page }, { status: 200, body: page })
    const repos = await m.listRepos(TOKEN)
    expect(repos).toHaveLength(300)
    expect(calls).toHaveLength(3)
    expect(calls[2].opts.url).toContain('page=3')
  })

  it('listRepos: later-page failure keeps earlier results; first-page failure (rate limit) throws', async () => {
    let m = await load()
    const page = Array.from({ length: 100 }, (_, i) => ({ full_name: `o/r${i}`, private: false }))
    replies.push({ status: 200, body: page }, { status: 403, body: { message: 'rate limit' } })
    expect(await m.listRepos(TOKEN)).toHaveLength(100)

    m = await load()
    replies.push({ status: 403, body: { message: 'API rate limit exceeded' } })
    await expect(m.listRepos(TOKEN)).rejects.toThrow('GitHub repo list failed (HTTP 403)')
  })
})

describe('readRemoteBlob', () => {
  it('GETs the contents API with encoded path and optional ?ref=, strips newlines from base64', async () => {
    const m = await load()
    replies.push({ status: 200, body: { content: 'aGVs\nbG8=\n', sha: 'abc' } })
    const r = await m.readRemoteBlob(TOKEN, 'o/r', 'whisperio/secrets.enc.json', 'feat/x y')
    expect(r).toEqual({ contentBase64: 'aGVsbG8=', sha: 'abc' })
    expect(calls[0].opts.method).toBe('GET')
    expect(calls[0].opts.url).toBe(
      'https://api.github.com/repos/o/r/contents/whisperio%2Fsecrets.enc.json?ref=feat%2Fx%20y'
    )
  })

  it('omits ref when no branch is given', async () => {
    const m = await load()
    replies.push({ status: 200, body: { content: 'eA==', sha: 's' } })
    await m.readRemoteBlob(TOKEN, 'o/r', 'f.json')
    expect(calls[0].opts.url).toBe('https://api.github.com/repos/o/r/contents/f.json')
  })

  it('sanitises path traversal / query injection characters via encoding', async () => {
    const m = await load()
    replies.push({ status: 404 })
    await m.readRemoteBlob(TOKEN, 'o/r', '../x?y=1#z')
    const url = calls[0].opts.url
    expect(url).toBe('https://api.github.com/repos/o/r/contents/..%2Fx%3Fy%3D1%23z')
    expect(url.includes('?')).toBe(false)
  })

  it('returns null on 404 (first sync)', async () => {
    const m = await load()
    replies.push({ status: 404, body: { message: 'Not Found' } })
    expect(await m.readRemoteBlob(TOKEN, 'o/r', 'p')).toBeNull()
  })

  it.each([401, 403, 500])('throws on HTTP %i without leaking token', async (status) => {
    const m = await load()
    replies.push({ status, body: { message: 'x' } })
    const err = (await m.readRemoteBlob(TOKEN, 'o/r', 'p').catch((e: Error) => e)) as Error
    expect(err.message).toBe(`GitHub read failed (HTTP ${status})`)
    expect(err.message).not.toContain(TOKEN)
  })

  it('throws when a 200 body is non-JSON / has no content', async () => {
    const m = await load()
    replies.push({ status: 200, raw: '<html>not json</html>' })
    await expect(m.readRemoteBlob(TOKEN, 'o/r', 'p')).rejects.toThrow('GitHub read failed (HTTP 200)')
  })
})

describe('writeRemoteBlob', () => {
  it('PUTs JSON with message/content, includes sha and branch when given', async () => {
    const m = await load()
    replies.push({ status: 200, body: { content: { sha: 'new' } } })
    const r = await m.writeRemoteBlob(TOKEN, 'o/r', 'a/b.json', 'Y29udGVudA==', 'msg', 'oldsha', 'dev')
    expect(r).toEqual({ sha: 'new' })
    const c = calls[0]
    expect(c.opts.method).toBe('PUT')
    expect(c.opts.url).toBe('https://api.github.com/repos/o/r/contents/a%2Fb.json')
    expect(c.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(c.written.join(''))).toEqual({ message: 'msg', content: 'Y29udGVudA==', sha: 'oldsha', branch: 'dev' })
  })

  it('create (201) has no sha/branch keys in the payload', async () => {
    const m = await load()
    replies.push({ status: 201, body: { content: { sha: 'n1' } } })
    await m.writeRemoteBlob(TOKEN, 'o/r', 'p', 'eA==', 'm')
    const payload = JSON.parse(calls[0].written.join(''))
    expect(payload).toEqual({ message: 'm', content: 'eA==' })
    expect('sha' in payload).toBe(false)
  })

  it('returns empty sha if response lacks content.sha', async () => {
    const m = await load()
    replies.push({ status: 200, body: {} })
    expect(await m.writeRemoteBlob(TOKEN, 'o/r', 'p', 'eA==', 'm')).toEqual({ sha: '' })
  })

  it.each([409, 422, 401, 403])('throws on conflict/auth/rate-limit HTTP %i with a token-free message', async (status) => {
    const m = await load()
    replies.push({ status, body: { message: 'conflict' } })
    const err = (await m.writeRemoteBlob(TOKEN, 'o/r', 'p', 'eA==', 'm', 'stale').catch((e: Error) => e)) as Error
    expect(err.message).toBe(`GitHub write failed (HTTP ${status})`)
    expect(err.message).not.toContain(TOKEN)
  })

  it('never puts the token in the URL or body', async () => {
    const m = await load()
    replies.push({ status: 200, body: { content: { sha: 's' } } })
    await m.writeRemoteBlob(TOKEN, 'o/r', 'p', 'eA==', 'm')
    expect(calls[0].opts.url).not.toContain(TOKEN)
    expect(calls[0].written.join('')).not.toContain(TOKEN)
  })
})

describe('offline / transport failures', () => {
  it('network error rejects with the transport error only', async () => {
    const m = await load()
    replies.push({ error: new Error('net::ERR_INTERNET_DISCONNECTED') })
    const err = (await m.readRemoteBlob(TOKEN, 'o/r', 'p').catch((e: Error) => e)) as Error
    expect(err.message).toBe('net::ERR_INTERNET_DISCONNECTED')
  })

  it('times out after 30s, aborts the request and rejects', async () => {
    vi.useFakeTimers()
    const m = await load()
    replies.push({ hang: true })
    const p = m.getAuthenticatedUser(TOKEN)
    const assertion = expect(p).rejects.toThrow('GitHub request timed out after 30s')
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
    expect(calls[0].aborted).toBe(true)
  })
})
