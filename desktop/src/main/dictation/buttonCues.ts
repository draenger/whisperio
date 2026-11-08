import { sendToPrimaryOverlay } from './overlayWindow'
import { loadSettings } from '../settingsManager'

export type CueKind = 'start' | 'sent' | 'error' | 'held'

/** Ask the always-alive overlay renderer to play a short WebAudio tone. */
export function playCue(kind: CueKind): void {
  try {
    if (loadSettings().soundCues === false) return
    sendToPrimaryOverlay('cue:play', kind)
  } catch (err) {
    console.warn('[Whisperio] cue failed:', (err as Error)?.message)
  }
}
