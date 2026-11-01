// Per-provider audio format selection (pure, node-env testable).
//
// The recorder produces WebM/Opus. Cloud providers take it directly (and it is
// ~8x smaller than 16 kHz PCM WAV), but whisper.cpp (`selfhosted`) rejects
// WebM. Main has no audio decoder, so the renderer (which has WebAudio) may
// hand over an additional WAV; this picks the right buffer per provider.

export interface AudioPayload {
  buffer: Buffer
  filename: string
}

export const LOCAL_MODEL_NEEDS_WAV_MESSAGE =
  'Re-transcribing with the local model needs WAV audio, which is not stored. ' +
  'Use a cloud provider or re-record.'

/** True when the buffer starts with a RIFF/WAVE header. */
export function isWav(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WAVE'
  )
}

/**
 * Audio to send to `provider`, or null when this provider cannot handle what
 * we have (selfhosted with WebM only) and must be skipped.
 */
export function resolveProviderAudio(
  provider: string,
  original: AudioPayload,
  wav: AudioPayload | null
): AudioPayload | null {
  if (provider !== 'selfhosted') return original
  if (wav) return wav
  if (isWav(original.buffer)) return original
  return null
}
