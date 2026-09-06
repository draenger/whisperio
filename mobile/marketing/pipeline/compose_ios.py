#!/usr/bin/env python3
"""Compose the App Store marketing set from raw simulator captures.

    python3 compose_ios.py [--raw DIR] [--only iphone|ipad]

For every shot in SHOTS it emits an HTML overlay (headline + subcopy + the raw capture as a
floating device) into ./html/ and screenshots it with Playwright (the desktop app's
node_modules already carry playwright + chromium) at the exact ASC pixel size:
  iPhone 6.9"  1320x2868  -> ../screenshots/iphone/en/NN-key.png
  iPad 13"     2064x2752  -> ../screenshots/ipad/en/NN-key.png
Fonts come from the app bundle (Space Grotesk / IBM Plex Sans / JetBrains Mono) via file://.
"""
import argparse, os, pathlib, subprocess, sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent.parent
FONTS = ROOT / "mobile/WhisperioApp/Sources/WhisperioApp/Fonts"
# Playwright CLI: the Zryw checkout carries playwright + a downloaded chromium (the desktop
# app's playwright is a newer version whose browser build isn't installed). Override with
# PLAYWRIGHT_BIN=/path/to/playwright.
PLAYWRIGHT = os.environ.get("PLAYWRIGHT_BIN") or next(
    (p for p in (os.path.expanduser("~/Projects/husar/node_modules/.bin/playwright"),
                 str(ROOT / "desktop/node_modules/.bin/playwright")) if os.path.exists(p)), "playwright")
OUT_HTML = HERE / "html"; OUT_HTML.mkdir(exist_ok=True)
SHOTS_DIR = HERE.parent / "screenshots"

DEVICES = {
    "iphone": dict(w=1320, h=2868, h1=104, sub=42, pad=96, top=430, dev_w=1064, dev_top=880, radius=118,
                   raw="iphone-{key}.png"),
    "ipad":   dict(w=2064, h=2752, h1=118, sub=48, pad=120, top=330, dev_w=1720, dev_top=760, radius=64,
                   raw="{key}.png"),
}

# key -> (headline with <em>accent</em>, subcopy, glow)
COPY = {
    "home":      ("Speak it. <em>It's typed.</em>",
                  "Every note lands in one searchable library — categorised, with the engine that made it.", "hero"),
    "keyboard":  ("Dictate into <em>any app.</em>",
                  "The Whisperio keyboard, Action Button, Back Tap or Apple Watch — your words land where you're typing.", "side"),
    "models":    ("Your engines. <em>Your keys.</em>",
                  "Apple on-device speech by default. Add OpenAI, ElevenLabs or a downloadable Whisper model — no account, no markup.", "calm"),
    "journal":   ("A journal that <em>binds itself.</em>",
                  "Notes bound into books by week, month and topic — with an optional AI digest of your day.", "calm"),
    "recap":     ("See your <em>week in words.</em>",
                  "Words spoken, minutes saved and what each engine cost you — all tracked on your device.", "bottom"),
    "onboarding":("Private <em>by design.</em>",
                  "No Whisperio server. Audio goes to the engine you chose — or never leaves your device.", "hero"),
    "ipad-library":  ("Speak it. <em>It's typed.</em>",
                  "Your whole library beside the transcript — search, categories and the engine behind every note.", "hero"),
    "ipad-journal":  ("A journal that <em>binds itself.</em>",
                  "Books by week, month and topic, with an optional AI digest — on iPad and Mac too.", "calm"),
    "ipad-settings": ("Your engines. <em>Your keys.</em>",
                  "Apple on-device speech by default. Bring your own keys or download a local model.", "calm"),
}
SHOTS = {
    "iphone": ["home", "keyboard", "models", "journal", "recap", "onboarding"],
    "ipad":   ["ipad-library", "ipad-journal", "onboarding"],
}
# Shots whose payload sits at the BOTTOM of the screen (the keyboard rows): anchor the device to
# the canvas bottom and scale it down so it clears the copy block instead of bleeding off the top.
BOTTOM_ANCHORED = {"keyboard"}
GLOW = {
    "hero":   "radial-gradient(ellipse 95% 55% at 50% -6%, rgba(28,200,180,.42), transparent 70%)",
    "side":   "radial-gradient(ellipse 70% 45% at 8% 100%, rgba(28,200,180,.26), transparent 70%), radial-gradient(ellipse 80% 40% at 50% -6%, rgba(28,200,180,.20), transparent 70%)",
    "calm":   "radial-gradient(ellipse 75% 40% at 50% -6%, rgba(28,200,180,.18), transparent 70%)",
    "bottom": "radial-gradient(ellipse 85% 60% at 50% 110%, rgba(74,140,247,.28), transparent 72%), radial-gradient(ellipse 70% 35% at 50% -6%, rgba(28,200,180,.16), transparent 70%)",
}

PAGE = """<!doctype html><meta charset="utf-8">
<style>
@font-face {{ font-family:'SG'; src:url('file://{fonts}/SpaceGrotesk-Bold.ttf'); font-weight:700; }}
@font-face {{ font-family:'Plex'; src:url('file://{fonts}/IBMPlexSans-Regular.ttf'); font-weight:400; }}
* {{ margin:0; padding:0; box-sizing:border-box; }}
html, body {{ width:{w}px; height:{h}px; background:#0a1017; overflow:hidden; }}
#canvas {{ position:relative; width:{w}px; height:{h}px; overflow:hidden; background:#0a1017; }}
#glow {{ position:absolute; inset:0; background:{glow}; }}
#copy {{ position:absolute; top:{top}px; left:{pad}px; right:{pad}px; text-align:center; z-index:3; }}
h1 {{ font-family:'SG'; font-weight:700; font-size:{h1}px; line-height:1.04; color:#f3f6f8; letter-spacing:-0.02em; }}
h1 em {{ font-style:normal; color:#1cc8b4; }}
p {{ font-family:'Plex'; font-size:{sub}px; line-height:1.4; color:#8a99a6; margin-top:{gap}px; }}
#device {{ position:absolute; left:50%; {dev_pos} width:{dev_w}px; transform:translateX(-50%);
  border-radius:{radius}px; overflow:hidden; box-shadow:0 60px 140px rgba(0,0,0,.65), 0 0 0 3px rgba(255,255,255,.08); }}
#device img {{ display:block; width:100%; height:auto; }}
</style>
<div id="canvas"><div id="glow"></div>
<div id="copy"><h1>{h1text}</h1><p>{sub_text}</p></div>
<div id="device"><img src="file://{img}"></div></div>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=os.path.join(os.environ.get("TMPDIR", "/tmp"), "whisperio-ios-raw"))
    ap.add_argument("--only", choices=["iphone", "ipad"])
    args = ap.parse_args()
    raw = pathlib.Path(args.raw)
    for device, keys in SHOTS.items():
        if args.only and device != args.only:
            continue
        d = DEVICES[device]
        out_dir = SHOTS_DIR / device / "en"; out_dir.mkdir(parents=True, exist_ok=True)
        for i, key in enumerate(keys, 1):
            img = raw / d["raw"].format(key=key)
            if not img.exists():
                print(f"  ! missing raw {img}", file=sys.stderr); continue
            h1text, sub_text, glow = COPY[key]
            html = OUT_HTML / f"{device}-{i:02d}-{key}.html"
            if key in BOTTOM_ANCHORED:
                dev_w = int(d["dev_w"] * 0.9); dev_pos = "bottom:-6px;"; radius = int(d["radius"] * 0.9)
            else:
                dev_w = d["dev_w"]; dev_pos = f"top:{d['dev_top']}px;"; radius = d["radius"]
            html.write_text(PAGE.format(fonts=FONTS, w=d["w"], h=d["h"], glow=GLOW[glow], top=d["top"], pad=d["pad"],
                                        h1=d["h1"], sub=d["sub"], gap=int(d["sub"] * 0.9), dev_pos=dev_pos,
                                        dev_w=dev_w, radius=radius, h1text=h1text, sub_text=sub_text, img=img))
            out = out_dir / f"{i:02d}-{key.replace('ipad-', '')}.png"
            subprocess.run([PLAYWRIGHT, "screenshot", f"--viewport-size={d['w']},{d['h']}",
                            "--wait-for-timeout=800", f"file://{html}", str(out)], check=True,
                           stdout=subprocess.DEVNULL)
            print("wrote", out)


if __name__ == "__main__":
    main()
