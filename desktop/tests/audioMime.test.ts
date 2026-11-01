import { describe, it, expect } from 'vitest'
import { audioMimeFromFilename, sniffAudioMime } from '../src/main/llm/audioMime'

const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVEfmt ')])
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])

describe('audioMimeFromFilename', () => {
  it.each([
    ['a.wav', 'audio/wav'],
    ['a.WEBM', 'audio/webm'],
    ['a.ogg', 'audio/ogg'],
    ['a.opus', 'audio/ogg'],
    ['a.mp3', 'audio/mpeg'],
    ['a.m4a', 'audio/mp4'],
    ['a.flac', 'audio/flac'],
    ['a.xyz', 'audio/webm'],
    ['noext', 'audio/webm'],
    ['', 'audio/webm']
  ])('maps %s to %s', (name, mime) => {
    expect(audioMimeFromFilename(name)).toBe(mime)
  })

  it('sniffs magic bytes', () => {
    expect(sniffAudioMime(WAV)).toBe('audio/wav')
    expect(sniffAudioMime(EBML)).toBe('audio/webm')
    expect(sniffAudioMime(Buffer.from('OggS....'))).toBe('audio/ogg')
    expect(sniffAudioMime(Buffer.from('fLaC....'))).toBe('audio/flac')
    expect(sniffAudioMime(Buffer.from('ID3\x04....'))).toBe('audio/mpeg')
    expect(sniffAudioMime(Buffer.from('audio-data'))).toBeNull()
    expect(sniffAudioMime(undefined)).toBeNull()
  })

  it('prefers sniffed bytes over a disagreeing filename', () => {
    expect(audioMimeFromFilename('rec.webm', WAV)).toBe('audio/wav')
    expect(audioMimeFromFilename('rec.wav', EBML)).toBe('audio/webm')
  })

  it('falls back to extension when bytes are unrecognised', () => {
    expect(audioMimeFromFilename('rec.wav', Buffer.from('audio-data'))).toBe('audio/wav')
  })
})
