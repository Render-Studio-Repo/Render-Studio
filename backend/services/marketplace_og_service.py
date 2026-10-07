"""Artistic OG / X share cards for stores and listings (1200×630 PNG)."""

from __future__ import annotations

from backend.services.share_preview import _encode_png_rgba

WIDTH = 1200
HEIGHT = 630

# 5×7 bitmap, bits top-to-bottom then left-to-right columns packed into ints.
_FONT = {
    "A": [0x3E, 0x09, 0x09, 0x09, 0x3E],
    "B": [0x3F, 0x25, 0x25, 0x25, 0x1A],
    "C": [0x1E, 0x21, 0x21, 0x21, 0x12],
    "D": [0x3F, 0x21, 0x21, 0x21, 0x1E],
    "E": [0x3F, 0x25, 0x25, 0x21, 0x21],
    "F": [0x3F, 0x05, 0x05, 0x01, 0x01],
    "G": [0x1E, 0x21, 0x25, 0x25, 0x1A],
    "H": [0x3F, 0x04, 0x04, 0x04, 0x3F],
    "I": [0x21, 0x21, 0x3F, 0x21, 0x21],
    "J": [0x10, 0x20, 0x21, 0x1F, 0x01],
    "K": [0x3F, 0x04, 0x0A, 0x11, 0x20],
    "L": [0x3F, 0x20, 0x20, 0x20, 0x20],
    "M": [0x3F, 0x02, 0x04, 0x02, 0x3F],
    "N": [0x3F, 0x02, 0x04, 0x08, 0x3F],
    "O": [0x1E, 0x21, 0x21, 0x21, 0x1E],
    "P": [0x3F, 0x05, 0x05, 0x05, 0x02],
    "Q": [0x1E, 0x21, 0x29, 0x11, 0x2E],
    "R": [0x3F, 0x05, 0x0D, 0x15, 0x22],
    "S": [0x22, 0x25, 0x25, 0x25, 0x19],
    "T": [0x01, 0x01, 0x3F, 0x01, 0x01],
    "U": [0x1F, 0x20, 0x20, 0x20, 0x1F],
    "V": [0x0F, 0x10, 0x20, 0x10, 0x0F],
    "W": [0x3F, 0x10, 0x0C, 0x10, 0x3F],
    "X": [0x31, 0x0A, 0x04, 0x0A, 0x31],
    "Y": [0x03, 0x04, 0x38, 0x04, 0x03],
    "Z": [0x31, 0x29, 0x25, 0x23, 0x21],
    "0": [0x1E, 0x29, 0x25, 0x23, 0x1E],
    "1": [0x00, 0x22, 0x3F, 0x20, 0x00],
    "2": [0x32, 0x29, 0x25, 0x25, 0x22],
    "3": [0x11, 0x21, 0x25, 0x25, 0x1E],
    "4": [0x0C, 0x0A, 0x09, 0x3F, 0x08],
    "5": [0x17, 0x25, 0x25, 0x25, 0x19],
    "6": [0x1E, 0x25, 0x25, 0x25, 0x18],
    "7": [0x01, 0x31, 0x09, 0x05, 0x03],
    "8": [0x1A, 0x25, 0x25, 0x25, 0x1A],
    "9": [0x06, 0x25, 0x25, 0x25, 0x1E],
    "-": [0x04, 0x04, 0x04, 0x04, 0x04],
    ".": [0x00, 0x20, 0x20, 0x00, 0x00],
    "@": [0x1E, 0x21, 0x2D, 0x29, 0x0E],
    " ": [0x00, 0x00, 0x00, 0x00, 0x00],
    "/": [0x20, 0x10, 0x08, 0x04, 0x02],
    ":": [0x00, 0x0A, 0x0A, 0x00, 0x00],
    "'": [0x00, 0x01, 0x07, 0x00, 0x00],
}


def _pixel(buf: bytearray, x: int, y: int, rgb: tuple[int, int, int], a: int = 255) -> None:
    if x < 0 or y < 0 or x >= WIDTH or y >= HEIGHT:
        return
    i = (y * WIDTH + x) * 4
    buf[i] = rgb[0]
    buf[i + 1] = rgb[1]
    buf[i + 2] = rgb[2]
    buf[i + 3] = a


def _fill_rect(buf: bytearray, x0: int, y0: int, x1: int, y1: int, rgb: tuple[int, int, int]) -> None:
    for y in range(max(0, y0), min(HEIGHT, y1)):
        for x in range(max(0, x0), min(WIDTH, x1)):
            _pixel(buf, x, y, rgb)


def _blend(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, t))
    return (
        int(a[0] + (b[0] - a[0]) * t),
        int(a[1] + (b[1] - a[1]) * t),
        int(a[2] + (b[2] - a[2]) * t),
    )


def _draw_text(buf: bytearray, x: int, y: int, text: str, *, scale: int = 5, rgb: tuple[int, int, int] = (255, 255, 255)) -> None:
    cx = x
    for ch in text.upper():
        glyph = _FONT.get(ch) or _FONT.get(" ")
        for col, bits in enumerate(glyph):
            for row in range(7):
                if bits & (1 << row):
                    for dy in range(scale):
                        for dx in range(scale):
                            _pixel(buf, cx + col * scale + dx, y + row * scale + dy, rgb)
        cx += 6 * scale
        if cx > WIDTH - 20:
            break


def _background() -> bytearray:
    buf = bytearray(WIDTH * HEIGHT * 4)
    top = (13, 17, 23)
    bot = (22, 18, 12)
    accent = (255, 106, 0)
    for y in range(HEIGHT):
        t = y / (HEIGHT - 1)
        row = _blend(top, bot, t)
        for x in range(WIDTH):
            xt = abs(x - 900) / WIDTH
            color = _blend(row, (28, 40, 58), xt * 0.35)
            _pixel(buf, x, y, color)
    _fill_rect(buf, 0, 0, 14, HEIGHT, accent)
    _fill_rect(buf, 0, HEIGHT - 10, WIDTH, HEIGHT, accent)
    return buf


def render_store_card(*, name: str, handle: str, slug: str, tagline: str = "") -> bytes:
    buf = _background()
    _draw_text(buf, 64, 70, "RENDER STUDIO", scale=3, rgb=(255, 138, 51))
    _draw_text(buf, 64, 150, (name or "STORE")[:22], scale=7, rgb=(255, 255, 255))
    _draw_text(buf, 64, 250, f"/{slug}"[:28], scale=4, rgb=(155, 200, 255))
    if handle:
        _draw_text(buf, 64, 330, f"@{handle}"[:24], scale=4, rgb=(201, 209, 217))
    if tagline:
        _draw_text(buf, 64, 430, tagline[:32], scale=3, rgb=(158, 163, 175))
    _draw_text(buf, 64, 540, "MARKETPLACE", scale=3, rgb=(255, 106, 0))
    return _encode_png_rgba(WIDTH, HEIGHT, bytes(buf))


def render_listing_card(*, name: str, price: str, seller: str, kind: str = "MODEL") -> bytes:
    buf = _background()
    _draw_text(buf, 64, 70, str(kind or "MODEL").upper()[:16], scale=3, rgb=(255, 138, 51))
    _draw_text(buf, 64, 160, (name or "LISTING")[:22], scale=6, rgb=(255, 255, 255))
    _draw_text(buf, 64, 300, (price or "FREE")[:16], scale=5, rgb=(125, 230, 160))
    if seller:
        _draw_text(buf, 64, 410, seller[:28], scale=4, rgb=(201, 209, 217))
    _draw_text(buf, 64, 540, "RENDER3D.APP", scale=3, rgb=(255, 106, 0))
    return _encode_png_rgba(WIDTH, HEIGHT, bytes(buf))
