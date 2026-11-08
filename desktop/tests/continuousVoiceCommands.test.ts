import { describe, it, expect } from 'vitest'
import { parseVoiceCommand } from '../src/shared/continuous/voiceCommands'

describe('parseVoiceCommand', () => {
  it('recognises stop commands (case, diacritics, punctuation insensitive)', () => {
    for (const t of [
      'stop nasłuch', 'Stop nasłuchu.', 'stop nasłuchiwanie', 'Pauza!', 'stop słuchanie',
      'Koniec nasłuchu', 'stop listening', 'Pause.', '  PAUZA  ', 'stop, nasluchu'
    ]) {
      expect(parseVoiceCommand(t)).toBe('stop')
    }
  })

  it('recognises cancel commands', () => {
    for (const t of ['anuluj', 'Anuluj to.', 'cancel', 'CANCEL!']) {
      expect(parseVoiceCommand(t)).toBe('cancel')
    }
  })

  it('ignores commands embedded in longer text', () => {
    for (const t of ['dodaj pauzę w kodzie', 'please pause the music', 'anuluj zamówienie', 'stop nasłuchu teraz', 'cancel that order']) {
      expect(parseVoiceCommand(t)).toBeNull()
    }
  })

  it('returns null for empty / junk input', () => {
    expect(parseVoiceCommand('')).toBeNull()
    expect(parseVoiceCommand('...')).toBeNull()
    expect(parseVoiceCommand(undefined as unknown as string)).toBeNull()
  })
})
