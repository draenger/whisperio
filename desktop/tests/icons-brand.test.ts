import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { inflateSync } from 'zlib'

// Every desktop icon comes from the teal brand source (iOS AppIcon) via desktop/scripts/make-icons.py.
// Checks: the right sizes in every container, and the dominant colour of every image equals the
// source's (teal), with no purple pixels left from the old icon set.

const REPO = join(__dirname, '..', '..')
const SOURCE = join(REPO, 'mobile/WhisperioApp/Sources/WhisperioApp/Assets.xcassets/AppIcon.appiconset/icon-1024.png')

interface Rgba { w: number; h: number; px: Uint8Array }

/** Minimal PNG decoder: 8-bit RGB/RGBA, non-interlaced (what Pillow writes). */
function decodePng(buf: Buffer): Rgba {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let off = 8
  let w = 0, h = 0, colorType = 0
  const idat: Buffer[] = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG (bit depth / interlace)')
      colorType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (!ch) throw new Error(`unsupported PNG colour type ${colorType}`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * ch
  const out = new Uint8Array(w * h * 4)
  const prev = new Uint8Array(stride)
  const cur = new Uint8Array(stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0
      let v = line[i]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      cur[i] = v & 0xff
    }
    for (let x = 0; x < w; x++) {
      out.set([cur[x * ch], cur[x * ch + 1], cur[x * ch + 2], ch === 4 ? cur[x * ch + 3] : 255], (y * w + x) * 4)
    }
    prev.set(cur)
  }
  return { w, h, px: out }
}

/** ICO entries: declared size + decoded pixels (PNG or 32-bit BMP/DIB). */
function decodeIco(buf: Buffer): Rgba[] {
  const count = buf.readUInt16LE(4)
  const images: Rgba[] = []
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16
    const w = buf[e] || 256, h = buf[e + 1] || 256
    const data = buf.subarray(buf.readUInt32LE(e + 12), buf.readUInt32LE(e + 12) + buf.readUInt32LE(e + 8))
    if (data.readUInt32BE(0) === 0x89504e47) { images.push(decodePng(data)); continue }
    const hdr = data.readUInt32LE(0), bpp = data.readUInt16LE(14)
    if (bpp !== 32) throw new Error(`ICO ${w}px entry is ${bpp}-bit, expected 32`)
    const px = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = hdr + ((h - 1 - y) * w + x) * 4 // bottom-up BGRA
      px.set([data[s + 2], data[s + 1], data[s], data[s + 3]], (y * w + x) * 4)
    }
    images.push({ w, h, px })
  }
  return images
}

/** ICNS: the PNG-encoded frames (ic07..ic14 written by Pillow). */
function decodeIcns(buf: Buffer): Rgba[] {
  if (buf.toString('ascii', 0, 4) !== 'icns') throw new Error('not an icns')
  const frames: Rgba[] = []
  for (let off = 8; off < buf.length;) {
    const len = buf.readUInt32BE(off + 4)
    const data = buf.subarray(off + 8, off + len)
    if (data.length > 8 && data.readUInt32BE(0) === 0x89504e47) frames.push(decodePng(data))
    off += len
  }
  return frames
}

function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let hue = 0
  if (d) hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [(hue * 60 + 360) % 360, max ? d / max : 0, max / 255]
}

/** Hue histogram of the vivid, opaque pixels: dominant 10-degree bucket and purple share. */
function palette(img: Rgba): { dominant: number; purple: number; vivid: number } {
  const buckets = new Array(36).fill(0)
  let purple = 0, vivid = 0
  for (let i = 0; i < img.px.length; i += 4) {
    if (img.px[i + 3] < 200) continue
    const [h, s, v] = hsv(img.px[i], img.px[i + 1], img.px[i + 2])
    if (s < 0.35 || v < 0.3) continue
    vivid++
    buckets[Math.floor(h / 10)]++
    if (h >= 245 && h <= 300) purple++
  }
  return { dominant: buckets.indexOf(Math.max(...buckets)) * 10 + 5, purple: vivid ? purple / vivid : 0, vivid }
}

const source = palette(decodePng(readFileSync(SOURCE)))

function expectBrand(img: Rgba, label: string): void {
  const p = palette(img)
  expect(p.vivid, `${label}: no coloured pixels`).toBeGreaterThan(0)
  expect(Math.abs(p.dominant - source.dominant), `${label}: dominant hue ${p.dominant} vs source ${source.dominant}`).toBeLessThanOrEqual(10)
  expect(p.purple, `${label}: purple share`).toBeLessThan(0.01)
}

describe('desktop icons are the teal brand icon (no purple left)', () => {
  it('the brand source itself is teal', () => {
    expect(source.dominant).toBeGreaterThanOrEqual(160)
    expect(source.dominant).toBeLessThanOrEqual(185)
    expect(source.purple).toBe(0)
  })

  it.each(['desktop/build/icon.ico', 'desktop/icons/whisperio.ico'])('%s has 16-256 px and every size is teal', (f) => {
    const images = decodeIco(readFileSync(join(REPO, f)))
    const sizes = images.map((i) => i.w).sort((a, b) => a - b)
    for (const n of [16, 20, 24, 32, 40, 48, 64, 128, 256]) expect(sizes, `${f} lacks ${n}px`).toContain(n)
    for (const img of images) {
      expect(img.h).toBe(img.w)
      expectBrand(img, `${f} ${img.w}px`)
    }
  })

  it('the tray ghost is teal on a transparent background, 16-64 px in the .ico', () => {
    const png = decodePng(readFileSync(join(REPO, 'desktop/icons/tray.png')))
    expect(png.px[3], 'corner must be transparent').toBe(0)
    expectBrand(png, 'tray.png')
    const ico = decodeIco(readFileSync(join(REPO, 'desktop/icons/tray.ico')))
    for (const n of [16, 20, 24, 32, 48, 64]) expect(ico.map((i) => i.w)).toContain(n)
    for (const img of ico) {
      expect(img.px[3], `tray.ico ${img.w}px corner`).toBe(0)
      expectBrand(img, `tray.ico ${img.w}px`)
    }
  })

  it('the tray loads the ghost files on every platform', () => {
    const tray = readFileSync(join(REPO, 'desktop/src/main/tray.ts'), 'utf8')
    expect(tray).toContain("process.platform === 'darwin' ? 'tray.png' : 'tray.ico'")
  })

  it('desktop/build/icon.icns carries 16-1024 px frames, all teal', () => {
    const frames = decodeIcns(readFileSync(join(REPO, 'desktop/build/icon.icns')))
    const sizes = frames.map((f) => f.w)
    for (const n of [32, 64, 128, 256, 512, 1024]) expect(sizes).toContain(n)
    for (const f of frames) expectBrand(f, `icns ${f.w}px`)
  }, 30000)

  it.each([
    ['desktop/build/icon.png', 1024],
    ['desktop/icons/whisperio.png', 512],
    ['icon.png', 256],
    ['docs/favicon.png', 512]
  ])('%s is %ipx and teal', (f, n) => {
    const img = decodePng(readFileSync(join(REPO, f as string)))
    expect([img.w, img.h]).toEqual([n, n])
    expectBrand(img, f as string)
  }, 30000)

  it('the Linux icon directory has every size, all teal', () => {
    const dir = join(REPO, 'desktop/build/icons')
    const files = readdirSync(dir).filter((f) => f.endsWith('.png'))
    for (const n of [16, 32, 48, 64, 128, 256, 512]) expect(files).toContain(`${n}x${n}.png`)
    for (const f of files) {
      const img = decodePng(readFileSync(join(dir, f)))
      expect(`${img.w}x${img.h}.png`).toBe(f)
      expectBrand(img, f)
    }
  }, 30000)

  it('no other image file in desktop/icons or desktop/build (no leftover purple duplicates)', () => {
    const images = (d: string): string[] => readdirSync(join(REPO, d)).filter((f) => /\.(png|ico|icns|svg)$/.test(f))
    expect(images('desktop/icons').sort()).toEqual(['tray.ico', 'tray.png', 'whisperio.ico', 'whisperio.png'])
    expect(images('desktop/build').sort()).toEqual(['icon.icns', 'icon.ico', 'icon.png'])
  })

  it('electron-builder points every platform and the installer at the generated icons', () => {
    const yml = readFileSync(join(REPO, '.devops/electron-builder.yml'), 'utf8')
    expect(yml).toMatch(/\nwin:\r?\n {2}icon: build\/icon\.ico/)
    expect(yml).toMatch(/\nmac:\r?\n {2}icon: build\/icon\.icns/)
    expect(yml).toMatch(/\nlinux:\r?\n {2}icon: build\/icons/)
    for (const key of ['installerIcon', 'uninstallerIcon', 'installerHeaderIcon']) expect(yml).toContain(`  ${key}: build/icon.ico`)
    for (const r of ['icons/whisperio.ico', 'icons/whisperio.png', 'icons/tray.ico', 'icons/tray.png']) {
      expect(yml, `extraResources ${r}`).toContain(`  - from: ${r}`)
    }
    for (const f of ['build/icon.ico', 'build/icon.icns', 'icons/whisperio.ico', 'icons/whisperio.png', 'icons/tray.ico', 'icons/tray.png']) {
      expect(existsSync(join(REPO, 'desktop', f)), f).toBe(true)
    }
  })
})
