"""Generate the docs/ social card (1200x630): python -I scripts/og/generate.py. Needs Pillow and Segoe UI (Windows)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

DOCS = Path(__file__).resolve().parents[2] / "docs"
SCALE = 2
canvas = Image.new("RGB", (1200 * SCALE, 630 * SCALE), "#0b0a14")
logo = Image.open(DOCS / "og-image.png").convert("RGBA")
logo = logo.crop(logo.getbbox())
logo.thumbnail((320 * SCALE, 300 * SCALE), Image.Resampling.LANCZOS)
canvas.paste(logo, (100 * SCALE, (630 * SCALE - logo.height) // 2), logo)
draw = ImageDraw.Draw(canvas)
title = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 76 * SCALE)
tagline = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 32 * SCALE)
draw.text((460 * SCALE, 235 * SCALE), "Whisperio", font=title, fill="#ECEBF4")
text = "Free dictation with your own AI key"
assert draw.textlength(text, font=tagline) <= 680 * SCALE
draw.text((464 * SCALE, 340 * SCALE), text, font=tagline, fill="#cbd5e1")
canvas = canvas.resize((1200, 630), Image.Resampling.LANCZOS)
output = DOCS / "og-image-1200x630.png"
canvas.quantize(colors=256, method=Image.Quantize.MEDIANCUT).save(output, optimize=True)
with Image.open(output) as result:
    assert result.size == (1200, 630)
size = output.stat().st_size
assert size <= 150_000, size
print(f"{output.name}: 1200x630, {size} bytes")
