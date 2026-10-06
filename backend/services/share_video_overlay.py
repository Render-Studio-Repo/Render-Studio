"""Burn share-video markup onto a transparent PNG for ffmpeg overlay."""

from __future__ import annotations

from typing import Any

MARKUP_DURATION_SEC = 3.2
LINE_TOOLS = {"line", "arrow", "edge-mark"}


def parse_markup_flag(value: Any, default: bool = False) -> bool:
    if value is None:
        return bool(default)
    if isinstance(value, bool):
        return value
    raw = str(value).strip().lower()
    if raw in {"", "0", "false", "no", "off", "none", "plain", "original"}:
        return False
    if raw in {"1", "true", "yes", "on", "markup", "markups", "with", "with-markup", "with_markups"}:
        return True
    return bool(default)


def markup_window(row: dict[str, Any] | None) -> tuple[float, float]:
    item = row if isinstance(row, dict) else {}
    start = max(0.0, float(item.get("t") or item.get("time") or 0))
    try:
        duration = float(item.get("duration") or MARKUP_DURATION_SEC)
    except (TypeError, ValueError):
        duration = MARKUP_DURATION_SEC
    duration = max(0.4, min(12.0, duration))
    return start, start + duration


def _hex_rgba(value: Any, alpha: int = 255) -> tuple[int, int, int, int]:
    raw = str(value or "#f0883e").strip().lstrip("#")
    if len(raw) == 3:
        raw = "".join(ch * 2 for ch in raw)
    if len(raw) < 6:
        raw = "f0883e"
    try:
        r = int(raw[0:2], 16)
        g = int(raw[2:4], 16)
        b = int(raw[4:6], 16)
    except ValueError:
        return (240, 136, 62, alpha)
    return (r, g, b, alpha)


def _px(norm: Any, size: int) -> int:
    try:
        value = float(norm)
    except (TypeError, ValueError):
        value = 0.0
    return int(max(0.0, min(1.0, value)) * max(1, size - 1))


def overlayable_comments(comments: list[Any] | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in comments or []:
        if not isinstance(row, dict):
            continue
        kind = str(row.get("kind") or "comment").lower()
        tool = str(row.get("tool") or "").strip().lower()
        if kind in {"markup", "pin"} or tool:
            out.append(row)
    return out


def render_markup_overlay(row: dict[str, Any], width: int, height: int):
    from PIL import Image, ImageDraw, ImageFont

    w = max(2, int(width))
    h = max(2, int(height))
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    tool = str(row.get("tool") or "").strip().lower()
    geom = row.get("geometry") if isinstance(row.get("geometry"), dict) else {}
    color = _hex_rgba(row.get("color") or geom.get("color"))
    width_px = max(3, int(round(min(w, h) * 0.006)))

    def xy(x: Any, y: Any) -> tuple[int, int]:
        return _px(x, w), _px(y, h)

    if tool == "pen":
        points = geom.get("points") if isinstance(geom.get("points"), list) else row.get("points")
        pts = []
        if isinstance(points, list):
            for point in points[:400]:
                if isinstance(point, dict):
                    pts.append(xy(point.get("x"), point.get("y")))
        if len(pts) >= 2:
            draw.line(pts, fill=color, width=width_px, joint="curve")
    elif tool in LINE_TOOLS:
        x1, y1 = xy(geom.get("x1", row.get("x1", row.get("x"))), geom.get("y1", row.get("y1", row.get("y"))))
        x2, y2 = xy(geom.get("x2", row.get("x2")), geom.get("y2", row.get("y2")))
        draw.line([(x1, y1), (x2, y2)], fill=color, width=width_px)
        if tool in {"arrow", "edge-mark"}:
            import math
            angle = math.atan2(y2 - y1, x2 - x1)
            head = max(12, width_px * 4)
            left = (
                int(x2 - math.cos(angle - math.pi / 6) * head),
                int(y2 - math.sin(angle - math.pi / 6) * head),
            )
            right = (
                int(x2 - math.cos(angle + math.pi / 6) * head),
                int(y2 - math.sin(angle + math.pi / 6) * head),
            )
            draw.line([(x2, y2), left], fill=color, width=width_px)
            draw.line([(x2, y2), right], fill=color, width=width_px)
    elif tool == "note":
        x, y = xy(row.get("x", geom.get("x")), row.get("y", geom.get("y")))
        text = str(row.get("text") or "Note")[:80]
        box = (max(0, x - 8), max(0, y - 28), min(w - 1, x + 140), min(h - 1, y + 8))
        draw.rounded_rectangle(box, radius=8, fill=(13, 17, 23, 230), outline=color, width=2)
        try:
            font = ImageFont.load_default()
        except OSError:
            font = None
        draw.text((box[0] + 8, box[1] + 6), text, fill=(230, 237, 243, 255), font=font)
    else:
        x = float(geom.get("x", row.get("x") or 0))
        y = float(geom.get("y", row.get("y") or 0))
        bw = max(0.012, float(geom.get("w", row.get("w") or 0.08)))
        bh = max(0.012, float(geom.get("h", row.get("h") or 0.08)))
        box = [_px(x, w), _px(y, h), _px(x + bw, w), _px(y + bh, h)]
        if tool in {"circle", "oval"} or not tool:
            draw.ellipse(box, outline=color, width=width_px)
        else:
            draw.rounded_rectangle(box, radius=max(4, width_px), outline=color, width=width_px)

    name = str(row.get("author_name") or row.get("user_name") or "Guest").strip() or "Guest"
    initial = name[:1].upper()
    ax, ay = xy(row.get("x", geom.get("x", 0.5)), row.get("y", geom.get("y", 0.12)))
    if tool in {"circle", "oval", "rect", "view-mark", "face-mark", "split-mark"}:
        ax = _px(float(geom.get("x", row.get("x") or 0)) + float(geom.get("w", row.get("w") or 0)), w)
        ay = _px(geom.get("y", row.get("y")), h)
    r = max(10, int(round(min(w, h) * 0.018)))
    draw.ellipse((ax - r, ay - r, ax + r, ay + r), fill=(31, 111, 235, 255), outline=(13, 17, 23, 255), width=2)
    try:
        font = ImageFont.load_default()
    except OSError:
        font = None
    draw.text((ax - 4, ay - 6), initial, fill=(230, 237, 243, 255), font=font)
    return img


def overlay_jobs(comments: list[Any] | None, width: int, height: int) -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    for row in overlayable_comments(comments):
        start, end = markup_window(row)
        jobs.append({
            "image": render_markup_overlay(row, width, height),
            "start": start,
            "end": end,
            "id": str(row.get("id") or f"{start:.2f}"),
        })
    return jobs


def probe_video_size(src) -> tuple[int, int]:
    from backend.services.video_ffmpeg import ffprobe_bin
    import json
    import subprocess
    from pathlib import Path

    path = Path(src)
    cmd = [
        ffprobe_bin(),
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "json",
        str(path),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        payload = json.loads(proc.stdout or "{}")
        stream = (payload.get("streams") or [{}])[0]
        width = int(stream.get("width") or 1280)
        height = int(stream.get("height") or 720)
        return max(2, width), max(2, height)
    except (OSError, subprocess.SubprocessError, ValueError, json.JSONDecodeError, TypeError, IndexError):
        return 1280, 720
