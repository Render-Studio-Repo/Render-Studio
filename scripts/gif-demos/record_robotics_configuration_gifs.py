#!/usr/bin/env python3
"""Studio-dark looping GIFs for Robotics Configuration docs."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[2] / "frontend" / "docs" / "media"
W, H = 720, 400
BG = (13, 17, 23)
PANEL = (22, 27, 34)
LINE = (48, 54, 61)
TEXT = (201, 209, 217)
MUTED = (139, 148, 158)
ACCENT = (56, 189, 248)
GREEN = (34, 197, 94)
ORANGE = (249, 115, 22)


def font(size: int, bold: bool = False):
    names = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
    ]
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


F_TITLE = font(18, True)
F_BODY = font(14)
F_SMALL = font(12)
F_TINY = font(11)


def rounded(draw: ImageDraw.ImageDraw, box, fill, radius=10):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def frame_base(caption: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    rounded(d, (16, 16, W - 16, H - 16), PANEL, 16)
    d.rectangle((16, 16, W - 16, 58), fill=(30, 36, 44))
    d.text((28, 28), "Render Studio  ·  ROBOTICS", fill=TEXT, font=F_TITLE)
    d.text((28, H - 42), caption, fill=MUTED, font=F_SMALL)
    return img, d


def tab_strip(d: ImageDraw.ImageDraw, active: str):
    tabs = [("Viser", 28), ("Teleop", 128), ("Cloud", 248), ("Cameras", 338)]
    x = 28
    y = 72
    for name, _ in tabs:
        w = 86 if name != "Cameras" else 96
        fill = (15, 23, 42) if name == active else (30, 36, 44)
        outline = ACCENT if name == active else LINE
        d.rounded_rectangle((x, y, x + w, y + 32), 8, fill=fill, outline=outline)
        d.text((x + 14, y + 8), name, fill=ACCENT if name == active else MUTED, font=F_SMALL)
        x += w + 10


def url_row(d: ImageDraw.ImageDraw, label: str, value: str, proxy: str, connect_on: bool):
    d.text((28, 118), label, fill=MUTED, font=F_TINY)
    rounded(d, (28, 138, 520, 176), (13, 17, 23), 8)
    d.rounded_rectangle((28, 138, 520, 176), 8, outline=LINE)
    d.text((40, 150), value, fill=TEXT, font=F_BODY)
    fill = GREEN if connect_on else ACCENT
    d.rounded_rectangle((536, 138, 692, 176), 8, fill=fill)
    d.text((560, 150), "Connect", fill=(7, 12, 18), font=F_BODY)
    d.text((28, 190), proxy, fill=ACCENT, font=F_TINY)


def save_gif(name: str, frames: list[Image.Image], duration: int = 900):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    frames[0].save(
        path,
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=0,
        optimize=True,
    )
    print(f"wrote {path} ({path.stat().st_size} bytes)")


def robotics_configuration():
    frames = []
    steps = [
        ("Viser", "http://YOUR_LAN_IP:8095", "/api/viser/p/YOUR_LAN_IP/8095/", False, "1. ROBOTICS → Viser (HTTP on the Pi)"),
        ("Teleop", "https://YOUR_LAN_IP:8443/teleop", "/api/teleop/p/YOUR_LAN_IP/8443/teleop", False, "2. Teleop tab next to Viser (HTTPS)"),
        ("Teleop", "https://YOUR_LAN_IP:8443/teleop", "/api/teleop/p/YOUR_LAN_IP/8443/teleop", True, "3. Studio proxies so Quest never sees the Pi cert"),
        ("Cameras", "YOUR_CAM_IP", "VR Settings stays in sync with desktop", True, "4. Cameras + Cloud/server sync to VR Settings"),
    ]
    for active, value, proxy, on, caption in steps:
        img, d = frame_base(caption)
        tab_strip(d, active)
        label = "Teleop URL" if active == "Teleop" else ("Cam IP" if active == "Cameras" else "Viser URL")
        url_row(d, label, value, proxy, on)
        if active == "Teleop" and on:
            d.rounded_rectangle((28, 220, 692, 300), 10, fill=(8, 47, 27), outline=GREEN)
            d.text((44, 236), "Quest Browser — auto-clicking Connect", fill=GREEN, font=F_BODY)
            d.text((44, 262), "Desktop Connect may stay grey (DIMOS WebXR).", fill=MUTED, font=F_SMALL)
        frames.append(img)
    save_gif("robotics-configuration.gif", frames)


def robotics_viser():
    frames = []
    captions = [
        ("Viser", "127.0.0.1:8080", False, "Laptop: 127.0.0.1 is this computer, not the Pi"),
        ("Viser", "http://YOUR_LAN_IP:8095", False, "Paste the Pi LAN HTTP URL — bind 0.0.0.0:8095"),
        ("Viser", "http://YOUR_LAN_IP:8095", True, "Studio iframes /api/viser/p/YOUR_LAN_IP/8095/"),
    ]
    for active, value, on, caption in captions:
        img, d = frame_base(caption)
        tab_strip(d, active)
        url_row(d, "Viser URL", value, "/api/viser/p/YOUR_LAN_IP/8095/", on)
        frames.append(img)
    save_gif("robotics-viser.gif", frames, 1000)


def robotics_teleop():
    frames = []
    steps = [
        ("Teleop", "https://YOUR_LAN_IP:8443/teleop", False, "Paste https://YOUR_LAN_IP:8443 — DIMOS is HTTPS"),
        ("Teleop", "https://YOUR_LAN_IP:8443/teleop", True, "Same-origin /api/teleop/p/YOUR_LAN_IP/8443/teleop"),
        ("Teleop", "https://YOUR_LAN_IP:8443/teleop", True, "Quest auto-clicks Connect after the iframe loads"),
    ]
    for i, (active, value, on, caption) in enumerate(steps):
        img, d = frame_base(caption)
        tab_strip(d, active)
        url_row(d, "Teleop URL", value, "/api/teleop/p/YOUR_LAN_IP/8443/teleop", on)
        d.rounded_rectangle((28, 220, 692, 318), 10, fill=(15, 23, 42), outline=ACCENT)
        d.text((44, 236), "OpenArm Quest Teleop", fill=TEXT, font=F_BODY)
        if i == 0:
            d.rounded_rectangle((44, 270, 200, 302), 8, fill=(30, 41, 59), outline=LINE)
            d.text((68, 278), "Connect", fill=MUTED, font=F_SMALL)
            d.text((220, 278), "grey on desktop", fill=MUTED, font=F_TINY)
        else:
            d.rounded_rectangle((44, 270, 200, 302), 8, fill=GREEN)
            d.text((68, 278), "Connect", fill=(7, 12, 18), font=F_SMALL)
            d.text((220, 278), "auto-clicked in Quest Browser", fill=GREEN, font=F_TINY)
        frames.append(img)
    save_gif("robotics-teleop.gif", frames, 1100)


if __name__ == "__main__":
    robotics_configuration()
    robotics_viser()
    robotics_teleop()
