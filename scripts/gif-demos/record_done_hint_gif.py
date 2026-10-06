#!/usr/bin/env python3
"""Render frontend/assets/studio/record-done-hint.gif (timeline playhead loop)."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 720, 300
FRAMES = 24
DURATION_MS = 90
OUT = Path(__file__).resolve().parents[2] / "frontend" / "assets" / "studio" / "record-done-hint.gif"


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/SFNSText.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def _draw_static(draw: ImageDraw.ImageDraw, fonts: dict[str, ImageFont.ImageFont]) -> None:
    draw.rounded_rectangle((0, 0, W - 1, H - 1), radius=12, fill="#0d1117")
    draw.rounded_rectangle((16, 14, 704, 132), radius=10, fill="#161b22", outline="#30363d")
    draw.text((32, 22), "PREVIEW", font=fonts["kicker"], fill="#8b949e")
    draw.rounded_rectangle((32, 46, 232, 116), radius=8, fill="#0d1117", outline="#388bfd")
    draw.rounded_rectangle((44, 58, 96, 90), radius=4, fill="#1f3f73")
    draw.rounded_rectangle((102, 62, 142, 86), radius=4, fill="#2d5f9e")
    draw.rounded_rectangle((148, 70, 212, 86), radius=4, fill="#3d6f9c")
    draw.text((248, 58), "Edit with AI or by hand", font=fonts["title"], fill="#e6edf3")
    draw.text((248, 78), "Trim clips, then Generate — or cut on the timeline.", font=fonts["body"], fill="#8b949e")

    draw.rounded_rectangle((508, 48, 596, 80), radius=8, fill="#1f6feb", outline="#79c0ff")
    draw.line([(522, 56), (522, 64)], fill="#ffffff", width=2)
    draw.line([(519, 59), (522, 56), (525, 59)], fill="#ffffff", width=2)
    draw.line([(518, 66), (518, 70), (531, 70), (531, 66)], fill="#ffffff", width=2)
    draw.text((548, 56), "Share", font=fonts["btn"], fill="#ffffff")

    draw.rounded_rectangle((604, 48, 692, 80), radius=8, fill="#21262d", outline="#f0883e")
    draw.rounded_rectangle((616, 56, 630, 66), radius=2, outline="#f0f3f6")
    draw.line([(620, 56), (620, 66)], fill="#f0f3f6", width=1)
    draw.line([(626, 56), (626, 66)], fill="#f0f3f6", width=1)
    draw.text((644, 56), "GIF", font=fonts["btn"], fill="#f0f3f6")

    draw.rounded_rectangle((16, 142, 704, 228), radius=10, fill="#161b22", outline="#30363d")
    draw.text((26, 158), "V", font=fonts["lane"], fill="#8b949e")
    draw.rounded_rectangle((48, 154, 216, 176), radius=5, fill="#1f4f9a")
    draw.rounded_rectangle((224, 154, 356, 176), radius=5, fill="#2a5ca8")
    draw.rounded_rectangle((364, 154, 460, 176), radius=5, fill="#3a6cb0")
    draw.text((26, 194), "A", font=fonts["lane"], fill="#8b949e")
    draw.rounded_rectangle((48, 190, 460, 208), radius=5, fill="#2a5c38")

    draw.rounded_rectangle((16, 238, 704, 286), radius=10, fill="#161b22", outline="#388bfd")
    draw.text((32, 246), "AI film edit", font=fonts["kicker"], fill="#79c0ff")
    draw.text((32, 264), "Type a prompt  →  Improve prompt  →  Generate", font=fonts["body"], fill="#c9d1d9")
    draw.rounded_rectangle((430, 250, 548, 274), radius=6, fill="#21262d", outline="#58a6ff")
    draw.text((444, 254), "Improve prompt", font=fonts["small"], fill="#79c0ff")
    draw.rounded_rectangle((556, 250, 644, 274), radius=6, fill="#1f6feb")
    draw.text((572, 254), "Generate", font=fonts["btn"], fill="#ffffff")


def render() -> Path:
    fonts = {
        "kicker": _font(11, bold=True),
        "title": _font(13, bold=True),
        "body": _font(12),
        "btn": _font(12, bold=True),
        "lane": _font(12, bold=True),
        "small": _font(11, bold=True),
    }
    frames: list[Image.Image] = []
    for i in range(FRAMES):
        t = i / (FRAMES - 1)
        # Ease out-and-back so the playhead reads as editing, not a 1px glitch.
        ping = t * 2 if t < 0.5 else 2 - t * 2
        x = int(80 + ping * 350)
        img = Image.new("RGB", (W, H), "#0d1117")
        draw = ImageDraw.Draw(img)
        _draw_static(draw, fonts)
        draw.rectangle((x, 148, x + 3, 214), fill="#f0f3f6")
        frames.append(img)

    palette_src = frames[0].quantize(colors=96, method=Image.Quantize.MEDIANCUT)
    paletted = [frame.quantize(palette=palette_src, dither=Image.Dither.NONE) for frame in frames]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    paletted[0].save(
        OUT,
        save_all=True,
        append_images=paletted[1:],
        loop=0,
        duration=DURATION_MS,
        optimize=True,
        disposal=2,
    )
    return OUT


if __name__ == "__main__":
    path = render()
    data = path.read_bytes()
    width = int.from_bytes(data[6:8], "little")
    height = int.from_bytes(data[8:10], "little")
    print(f"wrote {path} bytes={len(data)} {width}x{height} header={data[:6]!r}")
