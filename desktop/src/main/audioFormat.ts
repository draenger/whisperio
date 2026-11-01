// Per-provider audio format selection (pure, node-env testable).
//
// The recorder produces WebM/Opus. Cloud providers take it directly (and it is
// ~8x smaller than 16 kHz PCM WAV), but whisper.cpp (`selfhosted`) rejects
// WebM. Main has no audio decoder, so the renderer (which has WebAudio) may
// hand over an additional WAV; this picks the right buffer per provider.

import { providerNeedsWav } from '../shared/providerFormat'

export interface AudioPayload {
  buffer: Buffer
  filename: string
}

export const LOCAL_MODEL_NEEDS_WAV_MESSAGE =
  'The local model needs WAV audio, which is not available for this clip ' +
  '(for example a re-transcribe of a saved recording, or the WAV conversion failed). ' +
  'Use a cloud provider or re-record.'

export { providerNeedsWav }

/** True when the bytes start with a RIFF/WAVE header. */
export function isWav(buf: Uint8Array): boolean {
  if (!buf || buf.length < 12) return false
  const tag = (o: number): string => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3])
  return tag(0) === 'RIFF' && tag(8) === 'WAVE'
}

/**
 * Validate the optional WAV IPC argument. Electron structured-clones Buffers
 * to Uint8Array, so require that and re-wrap WITHOUT copying and honouring
 * byteOffset/byteLength (the view may sit inside a larger pooled ArrayBuffer).
 * null/undefined/empty -> null; any other type -> TypeError.
 */
export function coerceWavArg(arg: unknown): Buffer | null {
  if (arg === null || arg === undefined) return null
  if (!(arg instanceof Uint8Array)) throw new TypeError('dictation:transcribe: wav argument must be a Uint8Array')
  if (arg.byteLength === 0) return null
  return Buffer.from(arg.buffer, arg.byteOffset, arg.byteLength)
}

/**
 * Audio to send to `provider`, or null when this provider cannot handle what
 * we have (a WAV-only provider with WebM only) and must be skipped.
 */
export function resolveProviderAudio(
  provider: string,
  original: AudioPayload,
  wav: AudioPayload | null
): AudioPayload | null {
  if (!providerNeedsWav(provider)) return original
  if (wav) return wav
  if (isWav(original.buffer)) return original
  return null
}
