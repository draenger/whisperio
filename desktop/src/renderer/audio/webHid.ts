// Minimal local WebHID typings (the DOM lib bundled with this TS version has none).
export interface HidCollectionLike {
  usagePage?: number
  usage?: number
  inputReports?: { reportId?: number }[]
}

export interface HidDeviceLike {
  vendorId: number
  productId: number
  productName?: string
  opened: boolean
  collections?: HidCollectionLike[]
  open(): Promise<void>
  addEventListener(type: 'inputreport', l: (e: HidInputReportEventLike) => void): void
  removeEventListener(type: 'inputreport', l: (e: HidInputReportEventLike) => void): void
}

export interface HidInputReportEventLike {
  reportId: number
  data: DataView
}

export interface HidLike {
  getDevices(): Promise<HidDeviceLike[]>
  requestDevice(opts: { filters: { vendorId?: number }[] }): Promise<HidDeviceLike[]>
  addEventListener(type: 'connect', l: () => void): void
  removeEventListener(type: 'connect', l: () => void): void
}

export function getHid(): HidLike | null {
  return (navigator as unknown as { hid?: HidLike }).hid ?? null
}

export function reportBytes(e: HidInputReportEventLike): number[] {
  return Array.from(new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength))
}

/** usagePage/usage of the collection that declares this input report id (best effort, for the debug log). */
export function usageForReport(d: HidDeviceLike, reportId: number): { usagePage?: number; usage?: number } {
  for (const c of d.collections ?? []) {
    if ((c.inputReports ?? []).some((r) => (r.reportId ?? 0) === reportId)) {
      return { usagePage: c.usagePage, usage: c.usage }
    }
  }
  const c0 = d.collections?.[0]
  return { usagePage: c0?.usagePage, usage: c0?.usage }
}
