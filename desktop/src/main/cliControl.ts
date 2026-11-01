/**
 * Command-line control of dictation (Stream Deck / scripts):
 *   Whisperio --toggle | --start | --stop | --cancel | --send
 *
 * Pure parsing + dispatch; the running instance receives the second
 * instance's argv via app.on('second-instance') and acts on it.
 */
export type CliCommand = 'toggle' | 'start' | 'stop' | 'cancel' | 'send'

const FLAGS: Record<string, CliCommand> = {
  '--toggle': 'toggle',
  '--start': 'start',
  '--stop': 'stop',
  '--cancel': 'cancel',
  '--send': 'send'
}

/** First recognized flag wins. Exact (case-insensitive) match only, so
 *  Chromium switches such as `--enable-features=x` and paths are ignored. */
export function parseCliCommand(argv: readonly string[]): CliCommand | null {
  for (const arg of argv) {
    if (typeof arg !== 'string') continue
    const key = arg.trim().toLowerCase()
    // hasOwn: a bare word like "constructor" must not resolve to an inherited member.
    if (Object.prototype.hasOwnProperty.call(FLAGS, key)) return FLAGS[key]
  }
  return null
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
