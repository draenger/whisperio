import { net } from 'electron'

/**
 * Injectable HTTP transport seam. The GitHub client + device-flow logic build
 * their requests against this interface, so unit tests can supply a mock that
 * captures the request and returns a canned response — no network, no Electron
 * runtime. Mirrors the mobile `GitHubTransport` protocol.
 */
export interface HttpRequest {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string | Buffer
}

export interface HttpResponse {
  status: number
  body: string
}

export interface HttpTransport {
  send(req: HttpRequest): Promise<HttpResponse>
}

// Same 45s hard cap the transcription helpers use (see transcribe.ts). A hung
// endpoint (slow proxy, flaky GitHub) can't leave a promise/socket dangling.
const REQUEST_TIMEOUT_MS = 45_000

/**
 * Default transport backed by Electron `net.request`. THIN by design — no
 * branching logic beyond the timeout+abort guard — so it stays coverage-excluded
 * while the request-building lives in the pure client.
 */
export class NetHttpTransport implements HttpTransport {
  send(req: HttpRequest): Promise<HttpResponse> {
    return new Promise<HttpResponse>((resolve, reject) => {
      let settled = false
      const request = net.request({ method: req.method, url: req.url })

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          request.abort()
          reject(new Error('GitHub request timed out after 45s'))
        }
      }, REQUEST_TIMEOUT_MS)

      const settle = <T>(fn: (val: T) => void) => (val: T): void => {
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          fn(val)
        }
      }

      if (req.headers) {
        for (const [key, value] of Object.entries(req.headers)) {
          request.setHeader(key, value)
        }
      }

      const chunks: Buffer[] = []
      request.on('response', (response) => {
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8')
          settle(resolve)({ status: response.statusCode ?? 0, body })
        })
        response.on('error', (err: Error) => settle(reject)(err))
      })
      request.on('error', (err: Error) => settle(reject)(err))

      if (req.body !== undefined) request.write(req.body)
      request.end()
    })
  }
}
