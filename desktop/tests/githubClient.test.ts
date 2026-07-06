import { describe, it, expect } from 'vitest'
import { GitHubClient, GitHubApiError } from '../src/main/github/githubClient'
import type { HttpTransport, HttpRequest, HttpResponse } from '../src/main/github/httpTransport'

class MockTransport implements HttpTransport {
  public requests: HttpRequest[] = []
  constructor(private readonly responder: (req: HttpRequest) => HttpResponse) {}
  async send(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req)
    return this.responder(req)
  }
}

const json = (status: number, body: unknown): HttpResponse => ({
  status,
  body: typeof body === 'string' ? body : JSON.stringify(body)
})

describe('GitHubClient headers', () => {
  it('stamps Authorization / Accept / X-GitHub-Api-Version on every request', async () => {
    const transport = new MockTransport(() => json(200, []))
    await new GitHubClient(transport, 'tok-123').listRepos()
    const h = transport.requests[0].headers!
    expect(h.Authorization).toBe('Bearer tok-123')
    expect(h.Accept).toBe('application/vnd.github+json')
    expect(h['X-GitHub-Api-Version']).toBe('2022-11-28')
  })
})

describe('GitHubClient.listRepos', () => {
  it('GETs the sorted/paginated URL and maps repos', async () => {
    const transport = new MockTransport(() =>
      json(200, [
        { full_name: 'me/one', name: 'one', owner: { login: 'me' }, default_branch: 'main', private: true }
      ])
    )
    const repos = await new GitHubClient(transport, 't').listRepos()
    expect(transport.requests[0].url).toBe('https://api.github.com/user/repos?per_page=100&sort=updated')
    expect(repos).toEqual([
      { fullName: 'me/one', name: 'one', owner: 'me', defaultBranch: 'main', private: true }
    ])
  })

  it('throws GitHubApiError(401) on unauthorized', async () => {
    const transport = new MockTransport(() => json(401, { message: 'Bad credentials' }))
    await expect(new GitHubClient(transport, 't').listRepos()).rejects.toBeInstanceOf(GitHubApiError)
  })
})

describe('GitHubClient.getFile', () => {
  it('returns content (newlines stripped) + sha and encodes the ref', async () => {
    const transport = new MockTransport(() => json(200, { content: 'aGVs\nbG8=', sha: 'sha-1' }))
    const file = await new GitHubClient(transport, 't').getFile('o', 'r', '.whisperio/secrets.json.enc', 'main')
    expect(file).toEqual({ contentBase64: 'aGVsbG8=', sha: 'sha-1' })
    expect(transport.requests[0].url).toBe(
      'https://api.github.com/repos/o/r/contents/.whisperio/secrets.json.enc?ref=main'
    )
  })

  it('returns null on 404', async () => {
    const transport = new MockTransport(() => json(404, { message: 'Not Found' }))
    expect(await new GitHubClient(transport, 't').getFile('o', 'r', 'p')).toBeNull()
  })

  it('throws on 401', async () => {
    const transport = new MockTransport(() => json(401, {}))
    await expect(new GitHubClient(transport, 't').getFile('o', 'r', 'p')).rejects.toThrow(/unauthorized/)
  })
})

describe('GitHubClient.putFile', () => {
  it('PUTs content + message and passes sha through for a safe update', async () => {
    const transport = new MockTransport(() => json(200, { content: { sha: 'new-sha' }, commit: { sha: 'commit-1' } }))
    const res = await new GitHubClient(transport, 't').putFile({
      owner: 'o',
      repo: 'r',
      path: 'dir/file.enc',
      contentBase64: 'Y29udGVudA==',
      message: 'msg',
      branch: 'main',
      sha: 'old-sha'
    })
    expect(res).toEqual({ sha: 'new-sha', commitSha: 'commit-1' })

    const req = transport.requests[0]
    expect(req.method).toBe('PUT')
    expect(req.url).toBe('https://api.github.com/repos/o/r/contents/dir/file.enc')
    const body = JSON.parse(String(req.body))
    expect(body).toEqual({ message: 'msg', content: 'Y29udGVudA==', branch: 'main', sha: 'old-sha' })
  })

  it('omits sha on first write', async () => {
    const transport = new MockTransport(() => json(201, { content: { sha: 's' }, commit: { sha: 'c' } }))
    await new GitHubClient(transport, 't').putFile({
      owner: 'o',
      repo: 'r',
      path: 'p',
      contentBase64: 'eA==',
      message: 'm'
    })
    const body = JSON.parse(String(transport.requests[0].body))
    expect('sha' in body).toBe(false)
  })

  it('throws on non-2xx', async () => {
    const transport = new MockTransport(() => json(422, { message: 'sha mismatch' }))
    await expect(
      new GitHubClient(transport, 't').putFile({ owner: 'o', repo: 'r', path: 'p', contentBase64: 'x', message: 'm' })
    ).rejects.toBeInstanceOf(GitHubApiError)
  })
})

describe('GitHubClient.checkAccess', () => {
  it('returns full_name on success', async () => {
    const transport = new MockTransport(() => json(200, { full_name: 'o/r' }))
    expect(await new GitHubClient(transport, 't').checkAccess('o', 'r')).toBe('o/r')
    expect(transport.requests[0].url).toBe('https://api.github.com/repos/o/r')
  })

  it('throws 404 when repo not found / no access', async () => {
    const transport = new MockTransport(() => json(404, {}))
    await expect(new GitHubClient(transport, 't').checkAccess('o', 'r')).rejects.toThrow(/not found or no access/)
  })
})
