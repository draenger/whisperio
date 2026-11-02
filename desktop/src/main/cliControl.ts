/**
 * Command-line control of dictation (Stream Deck / scripts):
 *   Whisperio --toggle | --start | --stop | --cancel | --send
 *
 * Also whisperio://toggle|start|stop|cancel|send links (Raycast / Alfred /
 * Shortcuts / Stream Deck "open URL"): Windows/Linux deliver the URL in the
 * second instance's argv, macOS via app.on('open-url').
 *
 * Pure parsing + dispatch; the running instance receives the second
 * instance's argv via app.on('second-instance') and acts on it.
 * URL input is untrusted: only the five command names are accepted, no params.
 */
export type CliCommand = 'toggle' | 'start' | 'stop' | 'cancel' | 'send'

const FLAGS: Record<string, CliCommand> = {
  '--toggle': 'toggle',
  '--start': 'start',
  '--stop': 'stop',
  '--cancel': 'cancel',
  '--send': 'send'
}

function isCommand(key: string): key is CliCommand {
  // hasOwn: a bare word like "constructor" must not resolve to an inherited member.
  return Object.prototype.hasOwnProperty.call(FLAGS, `--${key}`)
}

// whisperio://<cmd> with an optional single trailing slash and an optional
// ?query / #fragment (ignored). Anything else (extra path, userinfo, port,
// other scheme) is rejected.
const URL_RE = /^whisperio:\/\/([a-z]+)\/?(?:[?#].*)?$/i

/** Strict whisperio:// parser. Returns the command or null. Never throws. */
export function parseUrlCommand(url: unknown): CliCommand | null {
  if (typeof url !== 'string') return null
  const m = URL_RE.exec(url.trim())
  if (!m) return null
  const key = m[1].toLowerCase()
  return isCommand(key) ? key : null
}

export interface ControlCommand {
  cmd: CliCommand
  /** true when the command came from a whisperio:// link (gated by allowUrlControl) */
  viaUrl: boolean
}

/** Any argv entry that looks like a whisperio: link. */
export function hasUrlArg(argv: readonly string[]): boolean {
  return argv.some((a) => typeof a === 'string' && a.trim().toLowerCase().startsWith('whisperio:'))
}

/** If ANY entry is a whisperio: link the whole call is URL-originated: flags are
 *  never honoured, exactly one link is allowed and it must be the LAST entry
 *  (that is where the OS appends it). Otherwise the first CLI flag wins. Exact
 *  (case-insensitive) flag match only, so Chromium switches such as
 *  `--enable-features=x` and paths are ignored. */
export function parseControlArgv(argv: readonly string[]): ControlCommand | null {
  if (hasUrlArg(argv)) {
    const urls = argv.filter((a) => typeof a === 'string' && a.trim().toLowerCase().startsWith('whisperio:'))
    if (urls.length !== 1 || argv[argv.length - 1] !== urls[0]) return null
    const cmd = parseUrlCommand(urls[0])
    return cmd ? { cmd, viaUrl: true } : null
  }
  for (const arg of argv) {
    if (typeof arg !== 'string') continue
    const key = arg.trim().toLowerCase()
    if (Object.prototype.hasOwnProperty.call(FLAGS, key)) return { cmd: FLAGS[key], viaUrl: false }
  }
  return null
}

export function parseCliCommand(argv: readonly string[]): CliCommand | null {
  return parseControlArgv(argv)?.cmd ?? null
}

export interface CliControlApi {
  toggle(): unknown
  start(): unknown
  stop(): unknown
  cancel(): unknown
  send(): unknown
}

export function dispatchCliCommand(cmd: CliCommand, api: CliControlApi): void {
  switch (cmd) {
    case 'toggle': void api.toggle(); break
    case 'start': void api.start(); break
    case 'stop': void api.stop(); break
    case 'cancel': void api.cancel(); break
    case 'send': void api.send(); break
  }
}

/** Only stop/cancel are allowed by URL unless allowUrlStart; `send` never. */
export function isUrlCommandAllowed(cmd: CliCommand, allowStart: boolean): boolean {
  if (cmd === 'stop' || cmd === 'cancel') return true
  if (cmd === 'send') return false
  return allowStart // toggle / start can begin recording
}

/** Protocol is registered only when URL control is on AND (packaged OR explicit dev opt-in). */
export function shouldRegisterProtocol(o: { isPackaged: boolean; devEnv?: string; allowUrlControl: boolean }): boolean {
  return o.allowUrlControl === true && (o.isPackaged || o.devEnv === '1')
}

export const URL_RATE_LIMIT_MS = 1000

export interface UrlGateDeps {
  /** cached settings.allowUrlControl (fail closed: only true allows) */
  isAllowed(): boolean
  /** cached settings.allowUrlStart */
  isStartAllowed(): boolean
  /** screen locked (powerMonitor) */
  isLocked(): boolean
  now?(): number
  api: CliControlApi
  log?(msg: string): void
}

/** Single choke point for every URL-originated command (argv and open-url).
 *  Logs only the command name. Returns true if dispatched. */
export function createUrlDispatcher(deps: UrlGateDeps) {
  let last = -Infinity
  const now = deps.now ?? Date.now
  return (cmd: CliCommand): boolean => {
    if (deps.isAllowed() !== true) { deps.log?.(`URL command "${cmd}" ignored (URL control disabled)`); return false }
    if (!isUrlCommandAllowed(cmd, deps.isStartAllowed() === true)) { deps.log?.(`URL command "${cmd}" not permitted via URL`); return false }
    const startClass = cmd === 'toggle' || cmd === 'start'
    if (startClass && deps.isLocked()) { deps.log?.(`URL command "${cmd}" ignored (screen locked)`); return false }
    const t = now()
    const safe = cmd === 'stop' || cmd === 'cancel'
    if (!safe && t - last < URL_RATE_LIMIT_MS) { deps.log?.(`URL command "${cmd}" rate-limited`); return false }
    if (!safe) last = t
    dispatchCliCommand(cmd, deps.api)
    return true
  }
}

export interface OpenUrlDeps {
  /** false before app 'ready' = cold start via URL: ignored (never auto-record on launch) */
  isReady(): boolean
  dispatch(cmd: CliCommand): unknown
  log?(msg: string): void
}

/** macOS app.on('open-url') handler. Logs only the command name, never the URL. */
export function createOpenUrlHandler(deps: OpenUrlDeps) {
  return (event: { preventDefault(): void }, url: string): void => {
    event.preventDefault()
    const cmd = parseUrlCommand(url)
    if (!cmd) return
    if (!deps.isReady()) { deps.log?.(`URL command "${cmd}" ignored on cold start`); return }
    deps.dispatch(cmd)
  }
}
