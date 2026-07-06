import type { HttpTransport } from './httpTransport'

// GitHub OAuth device flow — the right grant for a desktop app with no redirect
// server: it needs only a public `client_id` (no client secret) and lets the
// user authorize in their browser. Fully mockable via the injected transport.
//
// See https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'

export interface DeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export type PollResult =
  | { status: 'authorization_pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'expired_token' }
  | { status: 'access_denied' }
  | { status: 'success'; accessToken: string; tokenType: string; scope: string }

function parseJson(body: string): Record<string, unknown> {
  try {
    return JSON.parse(body) as Record<string, unknown>
  } catch {
    throw new Error('GitHub device flow: malformed JSON response')
  }
}

/**
 * Step 1: request a device + user code. The user visits `verificationUri` and
 * types `userCode`; we then poll for the token. `scope` defaults to `repo` so
 * the connected repo can be used as the encrypted secrets store.
 */
export async function requestDeviceCode(
  transport: HttpTransport,
  clientId: string,
  scope = 'repo'
): Promise<DeviceCode> {
  const res = await transport.send({
    method: 'POST',
    url: DEVICE_CODE_URL,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope })
  })
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`GitHub device code request failed (HTTP ${res.status})`)
  }
  const data = parseJson(res.body)
  const deviceCode = data['device_code']
  const userCode = data['user_code']
  const verificationUri = data['verification_uri']
  if (typeof deviceCode !== 'string' || typeof userCode !== 'string' || typeof verificationUri !== 'string') {
    throw new Error('GitHub device code response missing required fields')
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    expiresIn: typeof data['expires_in'] === 'number' ? (data['expires_in'] as number) : 900,
    interval: typeof data['interval'] === 'number' ? (data['interval'] as number) : 5
  }
}

/**
 * Step 2 (called repeatedly on `interval`): poll for the access token. Returns a
 * discriminated result the caller drives its state machine on — pending keeps
 * polling, slow_down bumps the interval, expired/denied stop, success yields the
 * token. Any unexpected `error` code surfaces as a thrown Error.
 */
export async function pollForToken(
  transport: HttpTransport,
  clientId: string,
  deviceCode: string
): Promise<PollResult> {
  const res = await transport.send({
    method: 'POST',
    url: ACCESS_TOKEN_URL,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: DEVICE_GRANT_TYPE
    })
  })
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`GitHub token poll failed (HTTP ${res.status})`)
  }
  const data = parseJson(res.body)

  const accessToken = data['access_token']
  if (typeof accessToken === 'string' && accessToken.length > 0) {
    return {
      status: 'success',
      accessToken,
      tokenType: typeof data['token_type'] === 'string' ? (data['token_type'] as string) : 'bearer',
      scope: typeof data['scope'] === 'string' ? (data['scope'] as string) : ''
    }
  }

  const error = data['error']
  switch (error) {
    case 'authorization_pending':
      return { status: 'authorization_pending' }
    case 'slow_down':
      return {
        status: 'slow_down',
        interval: typeof data['interval'] === 'number' ? (data['interval'] as number) : 10
      }
    case 'expired_token':
      return { status: 'expired_token' }
    case 'access_denied':
      return { status: 'access_denied' }
    default:
      throw new Error(
        `GitHub token poll error: ${typeof error === 'string' ? error : 'unknown response'}`
      )
  }
}
