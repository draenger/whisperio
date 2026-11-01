/**
 * Resolve the real audio MIME type for multipart STT uploads. Magic bytes win
 * over the filename (a WAV converted for whisper.cpp can still reach a cloud
 * fallback under a stale name); the extension is the fallback; default webm.
 */
export function sniffAudioMime(buf?: Buffer | Uint8Array | null): string | null {
  if (!buf || buf.length < 4) return null
  const ascii = (s: number, e: number): string => Buffer.from(buf.subarray(s, e)).toString('latin1')
  if (buf.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav'
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'audio/webm'
  if (ascii(0, 4) === 'OggS') return 'audio/ogg'
  if (ascii(0, 4) === 'fLaC') return 'audio/flac'
  if (ascii(0, 3) === 'ID3') return 'audio/mpeg'
  if (buf.length >= 12 && ascii(4, 8) === 'ftyp') return 'audio/mp4'
  return null
}

const EXT_MIME: Record<string, string> = {
  wav: 'audio/wav',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  flac: 'audio/flac'
}

export function audioMimeFromFilename(name: string, buf?: Buffer | Uint8Array | null): string {
  const sniffed = sniffAudioMime(buf)
  if (sniffed) return sniffed
  const ext = /\.([A-Za-z0-9]+)$/.exec(name || '')?.[1]?.toLowerCase()
  return (ext && EXT_MIME[ext]) || 'audio/webm'
}
