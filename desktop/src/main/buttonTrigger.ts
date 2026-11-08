// Headset-button trigger model: pure data + validation + matching (no electron,
// no I/O) so it is unit-testable and importable from settingsManager.

export type ButtonAction = 'dictate-and-send' | 'continuous-toggle'

export type ButtonTrigger =
  | { kind: 'accelerator'; accelerator: string }
  | {
      kind: 'hid'
      vendorId: number
      productId: number
      reportId: number
      /** Expected report bytes (after the report id). */
      pattern: number[]
      /** Same length as pattern; only masked bits are compared. At least one non-zero bit in pattern&mask. */
      mask: number[]
    }
  | { kind: 'appcommand'; id: number }

export interface HidReport {
  vendorId: number
  productId: number
  reportId: number
  data: number[]
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
}

function byteArray(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > 64) return null
  return v.every((b) => isInt(b, 0, 255)) ? (v as number[]) : null
}

/** Validate an untrusted (settings.json / IPC) value; null when not a usable trigger. */
export function sanitizeButtonTrigger(raw: unknown): ButtonTrigger | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.kind === 'accelerator') {
    if (typeof r.accelerator !== 'string') return null
    const accelerator = r.accelerator.trim()
    if (!accelerator || accelerator.length > 64) return null
    return { kind: 'accelerator', accelerator }
  }
  if (r.kind === 'appcommand') {
    return isInt(r.id, 1, 255) ? { kind: 'appcommand', id: r.id } : null
  }
  if (r.kind === 'hid') {
    if (!isInt(r.vendorId, 0, 0xffff) || !isInt(r.productId, 0, 0xffff) || !isInt(r.reportId, 0, 255)) return null
    const pattern = byteArray(r.pattern)
    const mask = byteArray(r.mask)
    if (!pattern || !mask || pattern.length !== mask.length) return null
    // A mask selecting no set bit would match every report (incl. releases).
    if (!pattern.some((b, i) => (b & mask[i]) !== 0)) return null
    return { kind: 'hid', vendorId: r.vendorId, productId: r.productId, reportId: r.reportId, pattern: [...pattern], mask: [...mask] }
  }
  return null
}

export function sanitizeButtonAction(v: unknown): ButtonAction {
  return v === 'continuous-toggle' ? 'continuous-toggle' : 'dictate-and-send'
}

export function matchesHidReport(trigger: ButtonTrigger | null, report: HidReport): boolean {
  if (!trigger || trigger.kind !== 'hid') return false
  if (trigger.vendorId !== report.vendorId || trigger.productId !== report.productId) return false
  if (trigger.reportId !== report.reportId) return false
  if (report.data.length < trigger.pattern.length) return false
  for (let i = 0; i < trigger.pattern.length; i++) {
    if (((report.data[i] ?? 0) & trigger.mask[i]) !== (trigger.pattern[i] & trigger.mask[i])) return false
  }
  return true
}

/** Raw event captured while learning. */
export type LearnEvent =
  | { source: 'keyboard'; key?: string; code?: string; keyCode?: number; accelerator?: string }
  | { source: 'globalShortcut'; accelerator: string }
  | { source: 'hid'; vendorId: number; productId: number; usagePage?: number; usage?: number; reportId: number; data: number[] }
  | { source: 'appcommand'; id: number; name?: string }

/** True when a HID report carries no pressed bit (a button release / idle report). */
export function isIdleHidData(data: number[]): boolean {
  return data.every((b) => b === 0)
}

/** Turn a captured event into a trigger; null = event unusable (e.g. HID release). */
export function triggerFromLearnEvent(ev: LearnEvent): ButtonTrigger | null {
  switch (ev.source) {
    case 'globalShortcut':
      return sanitizeButtonTrigger({ kind: 'accelerator', accelerator: ev.accelerator })
    case 'keyboard': {
      const accel = ev.accelerator ?? keyToAccelerator(ev.code, ev.key)
      return accel ? sanitizeButtonTrigger({ kind: 'accelerator', accelerator: accel }) : null
    }
    case 'appcommand':
      return sanitizeButtonTrigger({ kind: 'appcommand', id: ev.id })
    case 'hid': {
      if (!Array.isArray(ev.data) || isIdleHidData(ev.data)) return null
      const bytes = ev.data.slice(0, 64)
      return sanitizeButtonTrigger({
        kind: 'hid',
        vendorId: ev.vendorId,
        productId: ev.productId,
        reportId: ev.reportId,
        pattern: bytes,
        mask: bytes.map((b) => (b !== 0 ? 0xff : 0))
      })
    }
  }
}

const KEY_MAP: Record<string, string> = {
  MediaPlayPause: 'MediaPlayPause',
  MediaTrackNext: 'MediaNextTrack',
  MediaNextTrack: 'MediaNextTrack',
  MediaTrackPrevious: 'MediaPreviousTrack',
  MediaPrevTrack: 'MediaPreviousTrack',
  MediaStop: 'MediaStop',
  AudioVolumeMute: 'VolumeMute',
  VolumeMute: 'VolumeMute',
  AudioVolumeUp: 'VolumeUp',
  AudioVolumeDown: 'VolumeDown'
}

/** DOM KeyboardEvent code/key -> Electron accelerator (no modifiers; those are handled by the caller). */
export function keyToAccelerator(code?: string, key?: string): string | null {
  for (const k of [code, key]) {
    if (!k) continue
    if (KEY_MAP[k]) return KEY_MAP[k]
    if (/^F([1-9]|1\d|2[0-4])$/.test(k)) return k
  }
  return null
}

export function describeTrigger(t: ButtonTrigger | null): string {
  if (!t) return 'brak'
  if (t.kind === 'accelerator') return `klawisz ${t.accelerator}`
  if (t.kind === 'appcommand') return `APPCOMMAND ${t.id}`
  const hex = (n: number): string => '0x' + n.toString(16).padStart(4, '0')
  return `HID ${hex(t.vendorId)}:${hex(t.productId)} raport ${t.reportId} [${t.pattern.map((b) => b.toString(16).padStart(2, '0')).join(' ')}]`
}

/** WM_APPCOMMAND lParam (LPARAM buffer) -> APPCOMMAND_* id. cmd = HIWORD(lParam) & ~FAPPCOMMAND_MASK(0xF000). */
export function appCommandFromLParam(lParam: Buffer): number | null {
  if (!lParam || lParam.length < 4) return null
  const hi = (lParam.readUInt32LE(0) >>> 16) & 0xffff
  const id = hi & ~0xf000
  return id > 0 ? id : null
}
