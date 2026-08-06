#!/usr/bin/env python3
"""
Generate the PWA launcher icons.

Written as a pure-stdlib PNG encoder rather than pulling in a graphics library:
the icons are two flat shapes, and a build step that needs no dependencies is
one fewer thing to install on a machine that just wants to ship the app.

Shapes are supersampled 4x and box-filtered down, which is what keeps the
triangle's edges from stair-stepping at 192px.
"""

import struct
import zlib
from pathlib import Path

BG = (0x0F, 0x13, 0x19)      # --bg-panel
ACCENT = (0x22, 0xE3, 0xC3)  # --accent
SS = 4                       # supersampling factor


def write_png(path: Path, width: int, height: int, pixels: list) -> None:
    """pixels is a flat list of (r, g, b) tuples, row-major."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type 0 (None) for each scanline
        for x in range(width):
            raw.extend(pixels[y * width + x])

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack('>I', len(data))
            + tag
            + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    path.write_bytes(png)


def in_rounded_rect(x, y, size, radius, inset=0.0):
    lo = inset
    hi = size - inset
    if not (lo <= x <= hi and lo <= y <= hi):
        return False
    # Only the corner quadrants need the distance test.
    cx = min(max(x, lo + radius), hi - radius)
    cy = min(max(y, lo + radius), hi - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def in_triangle(x, y, pts):
    (x1, y1), (x2, y2), (x3, y3) = pts

    def sign(ax, ay, bx, by, cx, cy):
        return (ax - cx) * (by - cy) - (bx - cx) * (ay - cy)

    d1 = sign(x, y, x1, y1, x2, y2)
    d2 = sign(x, y, x2, y2, x3, y3)
    d3 = sign(x, y, x3, y3, x1, y1)
    has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (has_neg and has_pos)


def render(size: int, maskable: bool) -> list:
    """A play triangle on a dark tile. Maskable variants inset the glyph into
    the 80% safe zone so a circular mask cannot clip it."""
    big = size * SS
    # Maskable icons are full-bleed; standard ones get a rounded tile.
    radius = 0 if maskable else big * 0.22
    glyph_scale = 0.44 if maskable else 0.55

    cx = cy = big / 2
    h = big * glyph_scale
    w = h * 0.87
    tri = [
        (cx - w / 2.6, cy - h / 2),
        (cx - w / 2.6, cy + h / 2),
        (cx + w / 1.7, cy),
    ]

    out = []
    for y in range(size):
        for x in range(size):
            r = g = b = 0
            for sy in range(SS):
                for sx in range(SS):
                    px = x * SS + sx + 0.5
                    py = y * SS + sy + 0.5
                    if maskable or in_rounded_rect(px, py, big, radius):
                        c = ACCENT if in_triangle(px, py, tri) else BG
                    else:
                        c = BG  # outside the tile; PNG has no alpha here
                    r += c[0]
                    g += c[1]
                    b += c[2]
            n = SS * SS
            out.append((r // n, g // n, b // n))
    return out


def main() -> None:
    target = Path(__file__).resolve().parent.parent / 'public' / 'icons'
    target.mkdir(parents=True, exist_ok=True)

    for size in (192, 512):
        write_png(target / f'icon-{size}.png', size, size, render(size, maskable=False))
        print(f'wrote icon-{size}.png')

    write_png(target / 'icon-maskable-512.png', 512, 512, render(512, maskable=True))
    print('wrote icon-maskable-512.png')


if __name__ == '__main__':
    main()
