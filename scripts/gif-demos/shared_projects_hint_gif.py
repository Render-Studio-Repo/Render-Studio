#!/usr/bin/env python3
"""Render frontend/assets/studio/shared-projects-hint.gif (left Shared projects + minimize)."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 720, 300
FRAMES = 20
DURATION_MS = 110
OUT = Path(__file__).resolve().parents[2] / "frontend" / "assets" / "studio" / "shared-projects-hint.gif"


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/SFNSText.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def render() -> Path:
    fonts = {
        "kicker": _font(11, bold=True),
        "title": _font(14, bold=True),
        "body": _font(12),
        "small": _font(11, bold=True),
    }
    frames = []
    for i in range(FRAMES):
        img = Image.new("RGB", (W, H), "#0d1117")
        draw = ImageDraw.Draw(img)
        rail_w = 168 if i < 10 else max(36, int(168 - (i - 9) * 18))
        draw.rounded_rectangle((12, 12, 12 + rail_w, 288), radius=10, fill="#161b22", outline="#30363d")
        if rail_w > 90:
            draw.text((24, 22), "SHARED PROJECTS", font=fonts["kicker"], fill="#8b949e")
            draw.rounded_rectangle((22, 46, 12 + rail_w - 10, 86), radius=6, fill="#1f3f73", outline="#58a6ff")
            draw.text((30, 52), "Viewport clip", font=fonts["small"], fill="#e6edf3")
            draw.text((30, 68), "Most recent open", font=fonts["body"], fill="#79c0ff")
            draw.rounded_rectangle((22, 96, 12 + rail_w - 10, 128), radius=6, fill="#21262d")
            draw.text((30, 106), "View more", font=fonts["small"], fill="#58a6ff")
        else:
            draw.text((20, 24), "«", font=fonts["title"], fill="#58a6ff")
        draw.rounded_rectangle((12 + rail_w + 16, 12, 708, 288), radius=10, fill="#0d1117", outline="#30363d")
        draw.text((12 + rail_w + 32, 28), "Minimize the left rail", font=fonts["title"], fill="#e6edf3")
        draw.text(
            (12 + rail_w + 32, 56),
            "Shared projects stay here. View more opens the full grid.",
            font=fonts["body"],
            fill="#8b949e",
        )
        pulse = 18 + int((i % 6) * 1.4)
        draw.ellipse((36, 200, 36 + pulse, 200 + pulse), outline="#f0883e", width=2)
        frames.append(img)
    frames[0].save(OUT, save_all=True, append_images=frames[1:], duration=DURATION_MS, loop=0, optimize=True)
    return OUT


if __name__ == "__main__":
    path = render()
    print(path)