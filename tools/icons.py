#!/usr/bin/env python3
"""Rasterise assets/favicon.svg into the PNG and ICO sizes browsers ask for.

SVG favicons work in every current browser, but not in older ones, and a
favicon that once 404'd stays cached as "missing" for a long time. Shipping a
real .ico plus PNGs removes both problems.

favicon.svg stays the single source of geometry: this script parses the rect,
the group transform and the two paths out of it rather than repeating the
coordinates here.

    python tools/icons.py
"""

import re
import struct
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "favicon.svg"
OUT = ROOT / "assets"
SS = 8  # supersample factor; PIL polygon fills are aliased


def quad(p0, c, p1, steps=40):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        pts.append((u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
                    u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]))
    return pts


def parse_path(d):
    """Only the subset favicon.svg uses: M, Q, L, H, V, Z."""
    tokens = re.findall(r"[MQLHVZ]|-?\d*\.?\d+", d)
    pts, cur, start, i = [], (0.0, 0.0), (0.0, 0.0), 0
    cmd = None
    while i < len(tokens):
        t = tokens[i]
        if t in "MQLHVZ":
            cmd = t
            i += 1
            if cmd == "Z":
                pts.append(start)
                cur = start
            continue
        if cmd in ("M", "L"):
            cur = (float(tokens[i]), float(tokens[i + 1]))
            if cmd == "M":
                start = cur
            pts.append(cur)
            i += 2
        elif cmd == "Q":
            c = (float(tokens[i]), float(tokens[i + 1]))
            p1 = (float(tokens[i + 2]), float(tokens[i + 3]))
            pts.extend(quad(cur, c, p1))
            cur = p1
            i += 4
        elif cmd == "H":
            cur = (float(t), cur[1])
            pts.append(cur)
            i += 1
        elif cmd == "V":
            cur = (cur[0], float(t))
            pts.append(cur)
            i += 1
    return pts


def load():
    svg = SRC.read_text(encoding="utf-8")
    rect = re.search(r"<rect([^>]*)/>", svg).group(1)
    w = float(re.search(r'width="([\d.]+)"', rect).group(1))
    h = float(re.search(r'height="([\d.]+)"', rect).group(1))
    rx = float(re.search(r'rx="([\d.]+)"', rect).group(1))
    bg = re.search(r'fill="(#[0-9a-fA-F]+)"', rect).group(1)

    g = re.search(r"<g transform=\"translate\(([\d.-]+),([\d.-]+)\) scale\(([\d.]+)\)\">", svg)
    tx, ty, sc = float(g.group(1)), float(g.group(2)), float(g.group(3))

    layers = []
    for m in re.finditer(r'<path d="([^"]+)"\s+fill="(#[0-9a-fA-F]+)"', svg):
        pts = [(x * sc + tx, y * sc + ty) for x, y in parse_path(m.group(1))]
        layers.append((pts, m.group(2)))
    return w, h, rx, bg, layers


def hex2rgb(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def render(size, geom, transparent=False):
    w, h, rx, bg, layers = geom
    n = size * SS
    k = n / w
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if not transparent:
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=rx * k, fill=hex2rgb(bg))
    for pts, fill in layers:
        d.polygon([(x * k, y * k) for x, y in pts], fill=hex2rgb(fill))
    return img.resize((size, size), Image.LANCZOS)


def main():
    geom = load()
    written = []

    # Multi-size .ico at the repo root, where browsers look unprompted.
    # PIL downsamples from the base image, so the base must be the largest.
    ico_sizes = [16, 32, 48]
    base = render(max(ico_sizes), geom)
    ico = ROOT / "favicon.ico"
    base.save(ico, format="ICO", sizes=[(s, s) for s in ico_sizes])
    written.append(ico)

    for s, name in [(16, "favicon-16.png"), (32, "favicon-32.png"), (180, "apple-touch-icon.png"), (512, "icon-512.png")]:
        p = OUT / name
        # the touch icon must be opaque: iOS puts it on its own background
        render(s, geom, transparent=False).save(p)
        written.append(p)

    for p in written:
        print(f"{p.relative_to(ROOT)}  {p.stat().st_size:>6} B")


if __name__ == "__main__":
    main()
