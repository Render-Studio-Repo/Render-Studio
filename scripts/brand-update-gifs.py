#!/usr/bin/env python3
"""Brand update GIFs with a bottom-right transparent Render Studio logo + rising electricity.

Usage:
  python scripts/brand-update-gifs.py
  python scripts/brand-update-gifs.py --src frontend/docs/media/picks.gif
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageSequence

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "frontend" / "docs" / "media"
OUT_DIR = MEDIA / "social"
LOGO = ROOT / "frontend" / "media" / "images" / "render-animations" / "VR-Animations" / "render-logo-gear-still.png"

DEFAULT_GIFS = [
    "render-agent.gif",
    "picks.gif",
    "workspaces.gif",
    "select-object.gif",
    "ai-generate.gif",
    "canvas.gif",
    "wiring.gif",
]


def _load_logo(max_w: int, max_h: int) -> Image.Image:
    logo = Image.open(LOGO).convert("RGBA")
    # Keep transparency; slightly boost visibility with a soft glow plate behind.
    tw = max(96, int(max_w * 0.22))
    th = max(48, int(max_h * 0.14))
    logo.thumbnail((tw, th), Image.Resampling.LANCZOS)
    # Soften harsh blacks a touch so it reads as a transparent overlay.
    alpha = logo.split()[-1]
    alpha = ImageEnhance.Brightness(alpha).enhance(0.92)
    logo.putalpha(alpha)
    return logo


def _draw_electricity(layer: Image.Image, *, phase: float, logo_box: tuple[int, int, int, int]) -> None:
    """Draw rising lightning bolts aimed at the logo (intro-page energy vibe)."""
    draw = ImageDraw.Draw(layer, "RGBA")
    x0, y0, x1, y1 = logo_box
    cx = (x0 + x1) // 2
    base_y = layer.size[1] - 8
    top_y = y1 - 4

    bolts = [
        {"spread": -28, "wobble": 11, "color": (88, 166, 255, 210), "width": 2},
        {"spread": 0, "wobble": 8, "color": (125, 211, 252, 230), "width": 3},
        {"spread": 26, "wobble": 12, "color": (251, 146, 60, 200), "width": 2},
    ]
    for i, bolt in enumerate(bolts):
        pts = []
        steps = 7
        local_phase = phase + i * 0.37
        for s in range(steps + 1):
            t = s / steps
            # Rise from bottom toward logo center with zig-zag.
            y = int(base_y + (top_y - base_y) * t)
            zig = math.sin((t * 9.5) + local_phase * 6.2) * bolt["wobble"] * (0.35 + 0.65 * t)
            x = int(cx + bolt["spread"] * (1.0 - t * 0.55) + zig)
            pts.append((x, y))
        if len(pts) >= 2:
            draw.line(pts, fill=bolt["color"], width=bolt["width"], joint="curve")
        # Spark head near logo
        hx, hy = pts[-1]
        r = 3 + (i % 2)
        draw.ellipse([hx - r, hy - r, hx + r, hy + r], fill=(255, 237, 213, 230))

    # Soft vertical energy column under the logo
    glow = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow, "RGBA")
    pulse = 0.45 + 0.55 * (0.5 + 0.5 * math.sin(phase * 5.0))
    gdraw.rectangle(
        [cx - 10, top_y, cx + 10, base_y],
        fill=(88, 166, 255, int(28 * pulse)),
    )
    layer.alpha_composite(glow)


def brand_gif(src: Path, dest: Path) -> dict:
    im = Image.open(src)
    frames_out: list[Image.Image] = []
    durations: list[int] = []
    w, h = im.size
    logo = _load_logo(w, h)
    lw, lh = logo.size
    margin = max(10, int(min(w, h) * 0.025))
    lx = w - lw - margin
    ly = h - lh - margin
    logo_box = (lx, ly, lx + lw, ly + lh)

    frame_list = list(ImageSequence.Iterator(im))
    n = max(1, len(frame_list))
    for idx, frame in enumerate(frame_list):
        base = frame.convert("RGBA")
        overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
        phase = idx / n
        _draw_electricity(overlay, phase=phase * math.tau, logo_box=logo_box)
        # subtle dark plate so logo stays readable on bright frames
        plate = Image.new("RGBA", (lw + 16, lh + 14), (0, 0, 0, 0))
        pdraw = ImageDraw.Draw(plate, "RGBA")
        pdraw.rounded_rectangle([0, 0, lw + 15, lh + 13], radius=10, fill=(1, 4, 9, 110))
        overlay.alpha_composite(plate, (lx - 8, ly - 6))
        overlay.alpha_composite(logo, (lx, ly))
        composed = Image.alpha_composite(base, overlay)
        frames_out.append(composed.convert("P", palette=Image.Palette.ADAPTIVE, colors=192))
        durations.append(int(frame.info.get("duration") or 90))

    dest.parent.mkdir(parents=True, exist_ok=True)
    frames_out[0].save(
        dest,
        save_all=True,
        append_images=frames_out[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
    )
    return {"src": str(src), "dest": str(dest), "frames": n, "bytes": dest.stat().st_size}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src", action="append", default=[], help="Specific GIF path(s)")
    ap.add_argument("--out-dir", default=str(OUT_DIR))
    args = ap.parse_args()
    out_dir = Path(args.out_dir)
    sources = [Path(p) for p in args.src] if args.src else [MEDIA / name for name in DEFAULT_GIFS]
    results = []
    for src in sources:
        if not src.is_file():
            print(f"skip missing {src}")
            continue
        dest = out_dir / f"{src.stem}.social.gif"
        info = brand_gif(src, dest)
        print(f"branded {src.name} -> {dest.relative_to(ROOT)} ({info['bytes']} bytes, {info['frames']} frames)")
        results.append(info)
    print(f"done {len(results)} gif(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
