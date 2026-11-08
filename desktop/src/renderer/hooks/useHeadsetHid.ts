import { useEffect } from 'react'
import { getHid, reportBytes, type HidDeviceLike, type HidInputReportEventLike } from '../audio/webHid'

/**
 * Runs in the always-alive overlay window: when the saved headset-button
 * trigger is a HID report, open the matching (already permitted) HID device(s)
 * and forward their input reports to main, which matches + debounces. Reports
 * are only observed, never consumed.
 */
export function useHeadsetHid(): void {
  useEffect(() => {
    const hid = getHid()
    if (!hid) return undefined
    let cancelled = false
    const opened = new Map<HidDeviceLike, (e: HidInputReportEventLike) => void>()

    function detach(): void {
      for (const [d, l] of opened) d.removeEventListener('inputreport', l)
      opened.clear()
    }

    async function attach(): Promise<void> {
      detach()
      const s = await window.api.settings.load()
      const t = s.buttonTrigger
      if (cancelled || !t || t.kind !== 'hid') return
      for (const d of await hid!.getDevices()) {
        if (d.vendorId !== t.vendorId || d.productId !== t.productId) continue
        try {
          if (!d.opened) await d.open()
        } catch (err) {
          console.warn('[Whisperio] [headset-button] HID open failed:', err)
          continue
        }
        const listener = (e: HidInputReportEventLike): void => {
          window.api.button.hidReport({
            vendorId: d.vendorId,
            productId: d.productId,
            reportId: e.reportId,
            data: reportBytes(e)
          })
        }
        d.addEventListener('inputreport', listener)
        opened.set(d, listener)
      }
    }

    const safeAttach = (): void => void attach().catch((e) => console.warn('[Whisperio] [headset-button] HID attach failed:', e))
    safeAttach()
    const offCfg = window.api.button.onConfigChanged(safeAttach)
    hid.addEventListener('connect', safeAttach)
    return () => {
      cancelled = true
      offCfg()
      hid.removeEventListener('connect', safeAttach)
      detach()
    }
  }, [])
}
