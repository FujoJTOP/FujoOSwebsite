#!/usr/bin/env python3
"""Build the 1200x630 social card from the same geometry as the mark.

A square app icon gets cropped to a thumbnail in link previews; a 1200x630
card is what Slack, X, Discord and WeChat actually render. The geometry is
reused from assets/favicon.svg via tools/icons.py so the mark cannot drift.

    python tools/og.py
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from icons import load, hex2rgb  # noqa: E402

ROOT = HERE.parent
OUT = ROOT / "assets" / "og-card.png"

W, H = 1200, 630
BG = "#0c1420"
GRID = "#7fc4dc"
FG = "#e3e9f1"
FG2 = "#a3b1c3"
FG3 = "#6b7c91"

MONO = "C:/Windows/Fonts/CascadiaMono.ttf"
SANS = "C:/Windows/Fonts/segoeui.ttf"


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def centered(d, text, f, y, fill):
    box = d.textbbox((0, 0), text, font=f)
    d.text(((W - (box[2] - box[0])) / 2 - box[0], y), text, font=f, fill=fill)


def main():
    img = Image.new("RGB", (W, H), hex2rgb(BG))
    d = ImageDraw.Draw(img, "RGBA")

    # the same faint blueprint grid the home page uses
    for x in range(0, W, 44):
        d.line([(x, 0), (x, H)], fill=hex2rgb(GRID) + (10,))
    for y in range(0, H, 44):
        d.line([(0, y), (W, y)], fill=hex2rgb(GRID) + (10,))

    # the mark, scaled to fit the card
    _w, _h, _rx, _bg, layers = load()
    size, mx, my = 150, (W - 150) / 2, 96
    k = size / 64
    for pts, fill in layers:
        d.polygon([(x * k + mx, y * k + my) for x, y in pts], fill=hex2rgb(fill))

    centered(d, "FujoOS", font(MONO, 104), 300, hex2rgb(FG))
    centered(d, "The model offers hints. The kernel decides what runs.", font(SANS, 34), 452, hex2rgb(FG2))
    centered(d, "x86_64  ·  no third-party dependencies  ·  MIT", font(MONO, 22), 530, hex2rgb(FG3))

    img.save(OUT)
    print(f"{OUT.relative_to(ROOT)}  {OUT.stat().st_size} B  {img.size[0]}x{img.size[1]}")


if __name__ == "__main__":
    main()
