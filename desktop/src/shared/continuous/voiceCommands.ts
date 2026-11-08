/** Spoken control commands; only recognised when they are the WHOLE utterance. */

export type VoiceCommand = 'stop' | 'cancel' | null

const STOP = new Set([
  'stop nasluch', 'stop nasluchu', 'stop nasluchiwanie', 'pauza', 'stop sluchanie',
  'koniec nasluchu', 'stop listening', 'pause'
])
const CANCEL = new Set(['anuluj', 'anuluj to', 'cancel'])

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function parseVoiceCommand(text: string): VoiceCommand {
  const n = normalize(text ?? '')
  if (STOP.has(n)) return 'stop'
  if (CANCEL.has(n)) return 'cancel'
  return null
}
