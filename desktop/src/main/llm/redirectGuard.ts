import { isLocalHost, assertSecureBaseUrl } from './provider'

/**
 * Decide whether following a redirect from `fromUrl` to `toUrl` is safe for a request that carries
 * credentials and/or audio. Allowed only when the target passes the same connection-security
 * policy as a configured base URL (https, or http for loopback/private hosts) AND stays on the
 * same hostname (an API key must never be re-sent to a different host). Returns null when OK,
 * otherwise a human-readable reason.
 */
export function checkRedirect(fromUrl: string, toUrl: string): string | null {
  let from: URL
  let to: URL
  try {
    from = new URL(fromUrl)
    to = new URL(toUrl)
  } catch {
    return `invalid redirect target '${toUrl}'`
  }
  try {
    assertSecureBaseUrl(to.toString(), 'redirect')
  } catch {
    return `redirect to insecure URL ${to.protocol}//${to.hostname} refused`
  }
  if (to.protocol === 'http:' && from.protocol === 'https:' && !isLocalHost(to.hostname)) {
    return `redirect downgrades https to http for ${to.hostname}`
  }
  if (to.hostname.toLowerCase() !== from.hostname.toLowerCase()) {
    return `redirect to a different host (${from.hostname} -> ${to.hostname}) refused`
  }
  return null
}

interface RedirectableRequest {
  on(event: 'redirect', listener: (statusCode: number, method: string, redirectUrl: string) => void): unknown
  abort(): void
  followRedirect(): void
}

/**
 * Electron `net.request` follows redirects by default WITHOUT emitting 'redirect', re-sending the
 * body and headers (Authorization / x-api-key). Callers must therefore create the request with
 * `redirect: 'manual'` (use `GUARDED_REDIRECT`); Electron then emits 'redirect' per hop and waits
 * for `followRedirect()`. We follow only when `checkRedirect` approves, else abort and report the
 * reason through `onBlocked` so the caller can reject its promise.
 */
export function guardRedirects(
  request: RedirectableRequest,
  requestUrl: string,
  onBlocked: (err: Error) => void
): void {
  let current = requestUrl
  request.on('redirect', (_status, _method, redirectUrl) => {
    const reason = checkRedirect(current, redirectUrl)
    if (reason) {
      request.abort()
      onBlocked(new Error(`Blocked redirect: ${reason}`))
      return
    }
    current = redirectUrl
    request.followRedirect()
  })
}

/** Value for the `redirect` option of net.request when the request is passed to guardRedirects. */
export const GUARDED_REDIRECT = 'manual' as const
