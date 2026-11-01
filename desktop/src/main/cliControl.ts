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

/** First recognized flag or whisperio:// link wins. Exact (case-insensitive)
 *  flag match only, so Chromium switches such as `--enable-features=x` and
 *  paths are ignored. */
export function parseControlArgv(argv: readonly string[]): ControlCommand | null {
  for (const arg of argv) {
    if (typeof arg !== 'string') continue
    const key = arg.trim().toLowerCase()
    if (Object.prototype.hasOwnProperty.call(FLAGS, key)) return { cmd: FLAGS[key], viaUrl: false }
    const urlCmd = parseUrlCommand(arg)
    if (urlCmd) return { cmd: urlCmd, viaUrl: true }
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

export interface OpenUrlDeps {
  /** false before app 'ready' = cold start via URL: ignored (never auto-record on launch) */
  isReady(): boolean
  /** settings.allowUrlControl */
  isAllowed(): boolean
  api: CliControlApi
  log?(msg: string): void
}

/** macOS app.on('open-url') handler. Logs only the command name, never the URL. */
export function createOpenUrlHandler(deps: OpenUrlDeps) {
  return (event: { preventDefault(): void }, url: string): void => {
    event.preventDefault()
    const cmd = parseUrlCommand(url)
    if (!cmd) return
    if (!deps.isReady()) { deps.log?.(`URL command "${cmd}" ignored on cold start`); return }
    if (!deps.isAllowed()) { deps.log?.(`URL command "${cmd}" ignored (URL control disabled)`); return }
    dispatchCliCommand(cmd, deps.api)
  }
}
