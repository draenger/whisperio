#!/usr/bin/env python3
"""Generate every desktop icon from the one brand source: the iOS AppIcon (teal ghost).

    python desktop/scripts/make-icons.py        (needs Pillow: pip install pillow)

Writes (paths relative to the repo root):
  desktop/build/icon.png           1024 px   electron-builder default / macOS source
  desktop/build/icon.ico           16-256 px Windows app, NSIS installer / uninstaller / header
  desktop/build/icon.icns          16-1024   macOS app
  desktop/build/icons/NxN.png      16-1024   Linux (electron-builder icon directory)
  desktop/icons/whisperio.ico      = build/icon.ico   window / taskbar icon (settings, recordings)
  desktop/icons/whisperio.png      512 px    README / docs
  desktop/icons/tray.ico, tray.png the ghost on transparent: tray (Windows/Linux) and menubar (macOS)
  icon.png                         256 px    repo thumbnail
  docs/favicon.png                 512 px    website favicon / apple-touch-icon

Checked by desktop/tests/icons-brand.test.ts (sizes, and no purple anywhere).
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "mobile/WhisperioApp/Sources/WhisperioApp/Assets.xcassets/AppIcon.appiconset/icon-1024.png"
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 72, 96, 128, 256]
LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]


def sized(src: Image.Image, n: int) -> Image.Image:
    return src if src.size == (n, n) else src.resize((n, n), Image.Resampling.LANCZOS)


def ghost_cutout(src: Image.Image) -> Image.Image:
    """The teal ghost on a transparent background (tray / menubar), cut from the same source.

    Every pixel gets alpha from how far its colour sits between the dark backdrop and the ghost
    teal; the eyes and mouth (dark, but enclosed by the ghost) are kept opaque by filling every
    region the outside cannot reach. Cropped to the ghost with a small margin, square.
    """
    w, h = src.size
    px = src.load()
    bg = (12, 28, 33)
    teal = (28, 200, 180)
    span = sum((t - b) ** 2 for t, b in zip(teal, bg))
    alpha = [[0.0] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            t = ((r - bg[0]) * (teal[0] - bg[0]) + (g - bg[1]) * (teal[1] - bg[1]) + (b - bg[2]) * (teal[2] - bg[2])) / span
            alpha[y][x] = min(1.0, max(0.0, (t - 0.25) / 0.6))
    # outside = background reachable from the border through non-ghost pixels
    outside = [[False] * w for _ in range(h)]
    stack = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
    while stack:
        x, y = stack.pop()
        if outside[y][x] or alpha[y][x] >= 0.5:
            continue
        outside[y][x] = True
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not outside[ny][nx]:
                stack.append((nx, ny))
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    o = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            if not outside[y][x]:
                o[x, y] = (r, g, b, 255) if alpha[y][x] < 0.98 else (*teal, 255)
            elif alpha[y][x] > 0:
                o[x, y] = (*teal, round(alpha[y][x] * 255))
    box = out.getbbox()
    assert box, "no ghost found in the brand source"
    side = max(box[2] - box[0], box[3] - box[1])
    side += side // 16
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(out.crop(box), ((side - (box[2] - box[0])) // 2, (side - (box[3] - box[1])) // 2))
    return canvas.resize((512, 512), Image.Resampling.LANCZOS)


def main() -> None:
    src = Image.open(SOURCE).convert("RGBA")
    assert src.size == (1024, 1024), f"brand source must be 1024x1024, got {src.size}"

    build = ROOT / "desktop/build"
    src.save(build / "icon.png", optimize=True)
    # Pillow scales the largest frame down for each size; pass the 256 px frame for crisp results.
    sized(src, 256).save(build / "icon.ico", sizes=[(n, n) for n in ICO_SIZES])
    src.save(build / "icon.icns")

    linux = build / "icons"
    linux.mkdir(exist_ok=True)
    for n in LINUX_SIZES:
        sized(src, n).save(linux / f"{n}x{n}.png", optimize=True)

    icons = ROOT / "desktop/icons"
    (icons / "whisperio.ico").write_bytes((build / "icon.ico").read_bytes())
    sized(src, 512).save(icons / "whisperio.png", optimize=True)
    ghost = ghost_cutout(src)
    ghost.save(icons / "tray.png", optimize=True)
    sized(ghost, 256).save(icons / "tray.ico", sizes=[(n, n) for n in [16, 20, 24, 32, 40, 48, 64]])

    sized(src, 256).save(ROOT / "icon.png", optimize=True)
    sized(src, 512).save(ROOT / "docs/favicon.png", optimize=True)
    print("icons written from", SOURCE.relative_to(ROOT))


if __name__ == "__main__":
    main()
