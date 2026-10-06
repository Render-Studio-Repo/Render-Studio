#!/usr/bin/env python3
"""Studio-dark looping GIFs for Sept 2026 product features (docs / tips / Getting Started)."""

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
PINK = (240, 136, 62)
BLUE = (88, 166, 255)
PURPLE = (163, 113, 247)
SIDE = (16, 20, 26)


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


F_TITLE = font(16, True)
F_BODY = font(13)
F_SMALL = font(12)
F_TINY = font(11)
F_KEY = font(12, True)


def rounded(draw: ImageDraw.ImageDraw, box, fill, radius=10, outline=None):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline)


def save_gif(name: str, frames: list[Image.Image], duration: int = 850):
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
    return path


def cursor(draw: ImageDraw.ImageDraw, x: int, y: int, click: bool = False):
    scale = 0.82 if click else 1.0
    pts = [
        (x, y),
        (x + int(16 * scale), y + int(12 * scale)),
        (x + int(8 * scale), y + int(14 * scale)),
        (x + int(12 * scale), y + int(28 * scale)),
        (x + int(6 * scale), y + int(16 * scale)),
        (x, y + int(22 * scale)),
    ]
    draw.polygon(pts, fill=ORANGE, outline=(17, 17, 17))
    if click:
        draw.ellipse((x - 10, y - 10, x + 18, y + 18), outline=ORANGE, width=2)


def chrome(caption: str, tab: str = "3D") -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    rounded(d, (10, 10, W - 10, H - 10), PANEL, 14)
    d.rectangle((10, 10, W - 10, 48), fill=(30, 36, 44))
    d.text((22, 20), "Render Studio", fill=TEXT, font=F_TITLE)
    tabs = [("3D", 210), ("Canvas", 268), ("Editor", 348), ("Imagine", 428)]
    x = 210
    for name, _ in tabs:
        w = 72 if name != "Imagine" else 80
        on = name == tab
        rounded(d, (x, 16, x + w, 42), (15, 23, 42) if on else (30, 36, 44), 8, ACCENT if on else LINE)
        d.text((x + 10, 22), name, fill=ACCENT if on else MUTED, font=F_SMALL)
        x += w + 8
    d.rectangle((10, H - 38, W - 10, H - 10), fill=(18, 22, 28))
    d.text((22, H - 32), caption, fill=MUTED, font=F_SMALL)
    return img, d


def sidebar(d: ImageDraw.ImageDraw, pinned=None, rest=None, highlight=None):
    rounded(d, (18, 58, 210, H - 48), SIDE, 10)
    d.text((30, 66), "PROJECTS", fill=MUTED, font=F_TINY)
    y = 88
    if pinned:
        d.text((30, y), "PINNED", fill=ACCENT, font=F_TINY)
        y += 18
        for name in pinned:
            on = highlight == name
            rounded(d, (26, y, 200, y + 28), (15, 23, 42) if on else (28, 34, 42), 6, ACCENT if on else None)
            d.text((34, y + 6), "★  " + name, fill=ACCENT if on else TEXT, font=F_SMALL)
            y += 32
        y += 6
        d.text((30, y), "RECENT", fill=MUTED, font=F_TINY)
        y += 18
    for name in rest or ["Robot Arm", "Wrist bracket", "OpenArm"]:
        on = highlight == name
        rounded(d, (26, y, 200, y + 28), (15, 23, 42) if on else (28, 34, 42), 6, ACCENT if on else None)
        pin = "★" if name in (pinned or []) else "☆"
        d.text((34, y + 6), f"{pin}  {name}", fill=TEXT, font=F_SMALL)
        y += 32


def viewport_finder():
    frames = []
    # 1 empty studio
    img, d = chrome("1. In the 3D viewport press Cmd+F (Mac) or Ctrl+F (Windows)")
    sidebar(d, rest=["Robot Arm", "Wrist bracket", "OpenArm"])
    rounded(d, (222, 58, 700, H - 48), (17, 21, 27), 10)
    d.text((340, 180), "3D viewport", fill=MUTED, font=F_BODY)
    rounded(d, (430, 250, 560, 286), (30, 36, 44), 8, LINE)
    d.text((448, 260), "⌘ F   /   Ctrl F", fill=ACCENT, font=F_KEY)
    cursor(d, 500, 240)
    frames.append(img)

    # 2 overlay
    img, d = chrome("2. Finder searches your projects, prompts, and history")
    sidebar(d)
    rounded(d, (222, 58, 700, H - 48), (10, 14, 20), 10)
    rounded(d, (250, 78, 672, 320), (22, 27, 34), 14, LINE)
    rounded(d, (266, 94, 656, 128), (13, 17, 23), 8, ACCENT)
    d.text((278, 104), "Search projects, prompts, history…", fill=MUTED, font=F_BODY)
    cursor(d, 300, 108)
    frames.append(img)

    # 3 typing
    img, d = chrome("3. Type to filter — hover a prompt to preview cost and people")
    sidebar(d)
    rounded(d, (222, 58, 700, H - 48), (10, 14, 20), 10)
    rounded(d, (250, 78, 672, 330), (22, 27, 34), 14, LINE)
    rounded(d, (266, 94, 656, 128), (13, 17, 23), 8, ACCENT)
    d.text((278, 104), "robot arm", fill=TEXT, font=F_BODY)
    rows = [
        ("Project", "Robot Arm", "2 models · $4.12"),
        ("Prompt", "80 mm wrist bracket, 4× M3", "1.2k tok · $0.18"),
        ("History", "Fillet selected face 2 mm", "yesterday"),
    ]
    y = 140
    for kind, title, meta in rows:
        rounded(d, (266, y, 656, y + 48), (28, 34, 42), 8)
        d.text((278, y + 6), kind, fill=ACCENT, font=F_TINY)
        d.text((278, y + 22), title, fill=TEXT, font=F_SMALL)
        d.text((520, y + 22), meta, fill=MUTED, font=F_TINY)
        y += 54
    cursor(d, 380, 168, click=True)
    frames.append(img)

    # 4 open
    img, d = chrome("4. Enter opens the project. Right-click to pin, share, or details.")
    sidebar(d, highlight="Robot Arm")
    rounded(d, (222, 58, 700, H - 48), (17, 21, 27), 10)
    d.text((300, 170), "Opened Robot Arm", fill=TEXT, font=F_BODY)
    d.text((300, 196), "Finder stays in-memory — no extra network hunt.", fill=MUTED, font=F_SMALL)
    frames.append(img)
    save_gif("viewport-finder.gif", frames)


def pin_projects():
    frames = []
    img, d = chrome("1. Project menu — star a project to pin it (up to 5)")
    sidebar(d, rest=["Robot Arm", "Wrist bracket", "OpenArm", "House layout"])
    cursor(d, 42, 100)
    frames.append(img)

    img, d = chrome("2. Click the pin (or right-click → Pin to projects)")
    sidebar(d, rest=["Robot Arm", "Wrist bracket", "OpenArm", "House layout"], highlight="Robot Arm")
    rounded(d, (220, 110, 430, 210), (22, 27, 34), 10, LINE)
    d.text((236, 122), "Pin to projects", fill=TEXT, font=F_SMALL)
    d.text((236, 144), "Open", fill=MUTED, font=F_SMALL)
    d.text((236, 166), "Share", fill=MUTED, font=F_SMALL)
    d.text((236, 188), "Details", fill=MUTED, font=F_SMALL)
    cursor(d, 250, 128, click=True)
    frames.append(img)

    img, d = chrome("3. Pinned projects stay at the top of the list")
    sidebar(d, pinned=["Robot Arm"], rest=["Wrist bracket", "OpenArm", "House layout"], highlight="Robot Arm")
    cursor(d, 48, 108)
    frames.append(img)

    img, d = chrome("4. Finder results can pin too — same 5-project cap")
    sidebar(d, pinned=["Robot Arm"], rest=["Wrist bracket", "OpenArm"])
    rounded(d, (250, 90, 672, 250), (22, 27, 34), 14, LINE)
    rounded(d, (266, 106, 656, 140), (13, 17, 23), 8, ACCENT)
    d.text((278, 116), "wrist", fill=TEXT, font=F_BODY)
    rounded(d, (266, 154, 656, 202), (28, 34, 42), 8, ACCENT)
    d.text((278, 162), "Project  ·  Wrist bracket", fill=TEXT, font=F_SMALL)
    d.text((278, 182), "Pin to projects", fill=ACCENT, font=F_TINY)
    cursor(d, 300, 186, click=True)
    frames.append(img)
    save_gif("pin-projects.gif", frames)


def clip_video_editor():
    frames = []
    img, d = chrome("1. Record the viewport — clip opens in a Studio editor tab", tab="3D")
    sidebar(d, highlight="Robot Arm")
    rounded(d, (222, 58, 700, H - 48), (17, 21, 27), 10)
    rounded(d, (430, 80, 688, 118), (30, 36, 44), 8, LINE)
    d.text((444, 92), "●  Record    Screenshot", fill=PINK, font=F_SMALL)
    cursor(d, 470, 96, click=True)
    frames.append(img)

    img, d = chrome("2. Timeline: video lane, audio lane, trim handles", tab="Editor")
    rounded(d, (18, 58, 700, 220), (17, 21, 27), 10)
    d.text((32, 70), "PREVIEW", fill=MUTED, font=F_TINY)
    rounded(d, (32, 90, 240, 200), (10, 14, 20), 8, BLUE)
    rounded(d, (48, 118, 96, 160), (31, 63, 115), 4)
    rounded(d, (108, 126, 210, 154), (45, 90, 156), 4)
    d.text((260, 110), "Edit with AI or by hand", fill=TEXT, font=F_BODY)
    d.text((260, 134), "Trim clips, then Generate — or cut on the timeline.", fill=MUTED, font=F_SMALL)
    rounded(d, (500, 96, 588, 126), BLUE, 8)
    d.text((518, 104), "Share", fill=(255, 255, 255), font=F_SMALL)
    rounded(d, (598, 96, 686, 126), (33, 38, 45), 8, ORANGE)
    d.text((624, 104), "GIF", fill=TEXT, font=F_SMALL)
    rounded(d, (18, 228, 700, H - 48), (22, 27, 34), 10)
    d.text((28, 240), "V", fill=MUTED, font=F_TINY)
    rounded(d, (48, 236, 240, 258), (31, 79, 154), 5)
    rounded(d, (248, 236, 390, 258), (42, 92, 168), 5)
    d.text((28, 268), "A", fill=MUTED, font=F_TINY)
    rounded(d, (48, 266, 390, 284), (42, 92, 56), 5)
    d.line([(180, 230), (180, 292)], fill=ACCENT, width=2)
    cursor(d, 180, 248)
    frames.append(img)

    img, d = chrome("3. AI film edit: prompt → Improve prompt → Generate", tab="Editor")
    rounded(d, (18, 58, 700, 210), (17, 21, 27), 10)
    d.text((32, 90), "Preview playing…", fill=MUTED, font=F_SMALL)
    rounded(d, (18, 220, 700, H - 48), (22, 27, 34), 10, BLUE)
    d.text((32, 232), "AI FILM EDIT", fill=ACCENT, font=F_TINY)
    d.text((32, 252), "Cut to the close-up, add captions, keep the CAD orbit", fill=TEXT, font=F_SMALL)
    rounded(d, (430, 268, 548, 294), (33, 38, 45), 6, BLUE)
    d.text((438, 274), "Improve prompt", fill=BLUE, font=F_TINY)
    rounded(d, (556, 268, 644, 294), BLUE, 6)
    d.text((570, 274), "Generate", fill=(255, 255, 255), font=F_TINY)
    cursor(d, 580, 276, click=True)
    frames.append(img)

    img, d = chrome("4. Drop extra clips, stills, or MP3 onto the lanes", tab="Editor")
    rounded(d, (18, 58, 700, H - 48), (22, 27, 34), 10)
    d.text((32, 80), "Drag media here", fill=MUTED, font=F_SMALL)
    rounded(d, (48, 120, 220, 168), (31, 79, 154), 6)
    d.text((62, 138), "orbit.mp4", fill=TEXT, font=F_TINY)
    rounded(d, (248, 120, 400, 168), (42, 92, 56), 6)
    d.text((262, 138), "voiceover.mp3", fill=TEXT, font=F_TINY)
    rounded(d, (420, 120, 560, 168), (80, 60, 40), 6)
    d.text((436, 138), "still.png", fill=TEXT, font=F_TINY)
    cursor(d, 480, 140)
    frames.append(img)
    save_gif("clip-video-editor.gif", frames)


def canvas_workspace():
    frames = []
    img, d = chrome("1. Open Canvas — last board, or create a new one", tab="Canvas")
    rounded(d, (180, 90, 540, 280), (22, 27, 34), 14, LINE)
    d.text((250, 110), "Open Canvas", fill=TEXT, font=F_TITLE)
    d.text((210, 140), "Open last canvas  Wrist layout  or start new.", fill=MUTED, font=F_SMALL)
    rounded(d, (210, 190, 360, 228), (33, 38, 45), 8, LINE)
    d.text((236, 202), "Create new", fill=MUTED, font=F_SMALL)
    rounded(d, (372, 190, 510, 228), BLUE, 8)
    d.text((390, 202), "Open last", fill=(255, 255, 255), font=F_SMALL)
    cursor(d, 430, 206, click=True)
    frames.append(img)

    img, d = chrome("2. Sketch layout, labels, and callouts before 3D", tab="Canvas")
    rounded(d, (18, 58, 700, H - 48), (245, 247, 250), 10)
    d.rectangle((40, 80, 240, 220), outline=(30, 36, 44), width=2)
    d.text((70, 140), "BASE", fill=(30, 36, 44), font=F_SMALL)
    d.ellipse((280, 100, 430, 220), outline=(30, 36, 44), width=2)
    d.text((318, 148), "TURRET", fill=(30, 36, 44), font=F_SMALL)
    d.line([(240, 150), (280, 160)], fill=ORANGE, width=2)
    d.text((250, 88), "80 mm", fill=ORANGE, font=F_TINY)
    rounded(d, (480, 80, 680, 200), (22, 27, 34), 10)
    d.text((494, 92), "Pen  ·  Shape  ·  Text", fill=MUTED, font=F_TINY)
    d.text((494, 118), "Smart Description", fill=ACCENT, font=F_SMALL)
    d.text((494, 142), "Send to Compose", fill=PINK, font=F_SMALL)
    cursor(d, 200, 150)
    frames.append(img)

    img, d = chrome("3. Smart Description interviews the sketch into a CAD prompt", tab="Canvas")
    rounded(d, (160, 70, 560, 310), (22, 27, 34), 14, LINE)
    d.text((210, 88), "Smart Description", fill=TEXT, font=F_TITLE)
    d.text((190, 124), "What is the main job of this layout?", fill=MUTED, font=F_SMALL)
    rounded(d, (190, 150, 530, 186), (13, 17, 23), 8, LINE)
    d.text((202, 160), "Phone stand that holds a 6.1\" phone", fill=TEXT, font=F_SMALL)
    d.text((190, 200), "Target:  ○ Edit selected    ● New object", fill=MUTED, font=F_SMALL)
    rounded(d, (360, 240, 510, 276), BLUE, 8)
    d.text((390, 252), "Fill prompt", fill=(255, 255, 255), font=F_SMALL)
    cursor(d, 430, 256, click=True)
    frames.append(img)

    img, d = chrome("4. Boards save in the project browser — newest first", tab="Canvas")
    sidebar(d, rest=["Robot Arm"])
    rounded(d, (222, 58, 700, H - 48), (245, 247, 250), 10)
    d.text((240, 72), "Wrist layout.canvas", fill=(30, 36, 44), font=F_SMALL)
    d.rectangle((250, 110, 420, 220), outline=(30, 36, 44), width=2)
    rounded(d, (18, 300, 210, H - 48), (15, 23, 42), 6, ACCENT)
    d.text((30, 312), "canvas/Wrist layout", fill=ACCENT, font=F_TINY)
    cursor(d, 80, 318)
    frames.append(img)
    save_gif("canvas-workspace.gif", frames)


def imagine_panel():
    frames = []
    img, d = chrome("1. Imagine is its own tab next to Compose and History", tab="Imagine")
    rounded(d, (430, 58, 700, H - 48), (22, 27, 34), 10)
    d.text((446, 72), "Compose   History   Imagine", fill=ACCENT, font=F_TINY)
    rounded(d, (446, 100, 684, 210), (13, 17, 23), 8, LINE)
    d.text((458, 120), "Product photo of a satin-black", fill=MUTED, font=F_SMALL)
    d.text((458, 140), "wrist bracket on a shop bench", fill=MUTED, font=F_SMALL)
    rounded(d, (560, 250, 684, 286), BLUE, 8)
    d.text((590, 262), "Generate", fill=(255, 255, 255), font=F_SMALL)
    cursor(d, 620, 264, click=True)
    frames.append(img)

    img, d = chrome("2. Images land in project imagine/ — send to CAD or Mesh", tab="Imagine")
    rounded(d, (18, 58, 420, H - 48), (17, 21, 27), 10)
    rounded(d, (36, 80, 200, 220), (40, 44, 52), 8)
    rounded(d, (220, 80, 384, 220), (40, 44, 52), 8)
    d.text((48, 232), "grid  ·  list", fill=MUTED, font=F_TINY)
    rounded(d, (430, 80, 684, 140), (33, 38, 45), 8, LINE)
    d.text((444, 96), "Send to CAD", fill=ACCENT, font=F_SMALL)
    d.text((444, 116), "Send to Mesh", fill=MUTED, font=F_SMALL)
    cursor(d, 460, 102, click=True)
    frames.append(img)

    img, d = chrome("3. Type /fetch for public CAD from a URL or step.parts", tab="Imagine")
    rounded(d, (430, 58, 700, H - 48), (22, 27, 34), 10)
    rounded(d, (446, 80, 684, 128), (13, 17, 23), 8, ACCENT)
    d.text((458, 92), "/fetch", fill=TEXT, font=F_BODY)
    rounded(d, (446, 140, 684, 210), (15, 23, 42), 8, LINE)
    d.text((458, 150), "↓  fetch", fill=ACCENT, font=F_SMALL)
    d.text((458, 172), "Public CAD · step.parts or URL", fill=MUTED, font=F_TINY)
    d.text((458, 190), "Tab to complete", fill=MUTED, font=F_TINY)
    cursor(d, 500, 156)
    frames.append(img)

    img, d = chrome("4. Pick STL / GLB / STEP / 3MF — files save under imagine/fetched/", tab="Imagine")
    rounded(d, (430, 70, 700, 250), (22, 27, 34), 10, LINE)
    d.text((446, 84), "/fetch NEMA 17 stepper", fill=TEXT, font=F_SMALL)
    for i, (name, on) in enumerate([("STL", True), ("GLB", True), ("STEP", True), ("3MF", False)]):
        x = 446 + i * 60
        rounded(d, (x, 130, x + 52, 158), (15, 23, 42) if on else (30, 36, 44), 6, GREEN if on else LINE)
        d.text((x + 10, 138), name, fill=GREEN if on else MUTED, font=F_TINY)
    d.text((446, 180), "Off checkbox = skip that format", fill=MUTED, font=F_TINY)
    frames.append(img)
    save_gif("imagine-panel.gif", frames)


def parts_catalog():
    frames = []
    img, d = chrome("1. Parts Catalog replaces Insert — McMaster + STEP library")
    rounded(d, (18, 58, 700, 100), (30, 36, 44), 8)
    d.text((32, 70), "PARTS CATALOG     McMaster-Carr     STEP files", fill=ACCENT, font=F_SMALL)
    rounded(d, (18, 112, 700, H - 48), SIDE, 10)
    d.text((32, 128), "Search hardware, motors, boards…", fill=MUTED, font=F_SMALL)
    cursor(d, 120, 76, click=True)
    frames.append(img)

    img, d = chrome("2. Search McMaster or the STEP library, then import")
    rounded(d, (18, 58, 700, 100), (30, 36, 44), 8)
    rounded(d, (32, 68, 360, 92), (13, 17, 23), 6, ACCENT)
    d.text((42, 74), "NEMA 17", fill=TEXT, font=F_SMALL)
    cards = [("NEMA 17 stepper", 36), ("SHF8 shaft support", 250), ("Arduino Uno", 464)]
    for title, x in cards:
        rounded(d, (x, 120, x + 196, 280), (28, 34, 42), 10, LINE)
        rounded(d, (x + 16, 136, x + 180, 210), (40, 44, 52), 8)
        d.text((x + 16, 222), title, fill=TEXT, font=F_TINY)
        rounded(d, (x + 16, 244, x + 180, 268), BLUE if title.startswith("NEMA") else (33, 38, 45), 6)
        d.text((x + 56, 250), "Import", fill=(255, 255, 255) if title.startswith("NEMA") else MUTED, font=F_TINY)
    cursor(d, 120, 254, click=True)
    frames.append(img)

    img, d = chrome("3. Send to wiring — pin-aware circuits from the same part")
    rounded(d, (36, 80, 240, 280), (28, 34, 42), 10, ACCENT)
    d.text((52, 100), "NEMA 17 stepper", fill=TEXT, font=F_SMALL)
    rounded(d, (52, 200, 220, 230), BLUE, 6)
    d.text((70, 208), "Send to wiring", fill=(255, 255, 255), font=F_TINY)
    d.text((280, 140), "Wiring prompt gets the sourced", fill=MUTED, font=F_SMALL)
    d.text((280, 164), "part + pins — no re-search.", fill=MUTED, font=F_SMALL)
    cursor(d, 120, 214, click=True)
    frames.append(img)
    save_gif("parts-catalog.gif", frames)


def reference_folders():
    frames = []
    img, d = chrome("1. Reference Files nest into folders so captures stay organized")
    rounded(d, (18, 58, 280, H - 48), SIDE, 10)
    d.text((32, 70), "REFERENCE FILES", fill=MUTED, font=F_TINY)
    rows = [
        ("📁  McMaster", False),
        ("📁  Screenshots", False),
        ("📁  Screen Recordings", True),
        ("📁  AR captures", False),
        ("📁  Improve Lab", False),
    ]
    y = 96
    for name, on in rows:
        rounded(d, (28, y, 268, y + 28), (15, 23, 42) if on else (28, 34, 42), 6, ACCENT if on else None)
        d.text((40, y + 6), name, fill=ACCENT if on else TEXT, font=F_SMALL)
        y += 34
    cursor(d, 60, 178, click=True)
    rounded(d, (300, 80, 700, 300), (17, 21, 27), 10)
    d.text((320, 120), "orbit-pass.webm", fill=TEXT, font=F_SMALL)
    d.text((320, 148), "Open in the clip editor tab", fill=MUTED, font=F_SMALL)
    frames.append(img)

    img, d = chrome("2. Screenshots, recordings, and Quest AR captures land here")
    rounded(d, (18, 58, 280, H - 48), SIDE, 10)
    d.text((32, 70), "REFERENCE FILES", fill=MUTED, font=F_TINY)
    d.text((40, 100), "📁  Screenshots", fill=TEXT, font=F_SMALL)
    d.text((52, 128), "viewport-front.png", fill=ACCENT, font=F_TINY)
    d.text((40, 160), "📁  AR captures", fill=TEXT, font=F_SMALL)
    d.text((52, 188), "quest-pass.webm", fill=MUTED, font=F_TINY)
    rounded(d, (300, 80, 700, 300), (17, 21, 27), 10)
    d.text((320, 110), "Markup → Send to AI still works", fill=TEXT, font=F_SMALL)
    d.text((320, 140), "from any image or PDF tab.", fill=MUTED, font=F_SMALL)
    frames.append(img)
    save_gif("reference-folders.gif", frames, 1000)


def wiring_send():
    frames = []
    img, d = chrome("1. Compact Wiring chrome — parts row, History stamp, Links chips")
    rounded(d, (18, 58, 700, 130), (22, 27, 34), 10)
    d.text((32, 70), "WIRING    Mode Quality    KEY  OpenAI", fill=TEXT, font=F_SMALL)
    d.text((32, 96), "Project parts   ◎ knowledge   🎙 voice", fill=MUTED, font=F_TINY)
    rounded(d, (18, 140, 700, H - 48), SIDE, 10)
    d.text((32, 160), "Describe the circuit…", fill=MUTED, font=F_SMALL)
    frames.append(img)

    img, d = chrome("2. Generate stamps History immediately — succeeded or failed")
    rounded(d, (430, 58, 700, H - 48), (22, 27, 34), 10)
    d.text((446, 72), "History", fill=ACCENT, font=F_TINY)
    rounded(d, (446, 96, 684, 150), (15, 23, 42), 8, GREEN)
    d.text((458, 106), "NEMA 17 + DRV8825", fill=TEXT, font=F_SMALL)
    d.text((458, 126), "succeeded  ·  just now", fill=GREEN, font=F_TINY)
    rounded(d, (446, 164, 684, 210), (28, 34, 42), 8)
    d.text((458, 176), "amazon.com/dp/B0… stepper", fill=MUTED, font=F_TINY)
    d.text((458, 194), "Links chip + favicon", fill=ACCENT, font=F_TINY)
    frames.append(img)

    img, d = chrome("3. Drafts persist per project — switch projects, prompt stays put")
    sidebar(d, rest=["Robot Arm", "Wrist bracket"], highlight="Wrist bracket")
    rounded(d, (222, 80, 700, 240), (22, 27, 34), 10, LINE)
    d.text((240, 100), "Compose draft restored for Wrist bracket", fill=TEXT, font=F_SMALL)
    d.text((240, 130), "Previous project’s wiring prompt was saved,", fill=MUTED, font=F_SMALL)
    d.text((240, 152), "not copied into this one.", fill=MUTED, font=F_SMALL)
    frames.append(img)
    save_gif("wiring-compose.gif", frames)


def prompt_persist():
    frames = []
    img, d = chrome("1. Write a CAD prompt — it is stored on this project id")
    sidebar(d, highlight="Robot Arm")
    rounded(d, (430, 70, 700, 250), (22, 27, 34), 10)
    d.text((446, 88), "Compose", fill=ACCENT, font=F_TINY)
    rounded(d, (446, 110, 684, 190), (13, 17, 23), 8, LINE)
    d.text((458, 128), "80×40×12 mm bracket,", fill=TEXT, font=F_SMALL)
    d.text((458, 148), "2× M4 on 50 mm centers", fill=TEXT, font=F_SMALL)
    frames.append(img)

    img, d = chrome("2. Switch projects — live box wipes, then restores that id")
    sidebar(d, highlight="Wrist bracket")
    rounded(d, (430, 70, 700, 250), (22, 27, 34), 10)
    d.text((446, 88), "Compose", fill=ACCENT, font=F_TINY)
    rounded(d, (446, 110, 684, 190), (13, 17, 23), 8, LINE)
    d.text((458, 128), "", fill=TEXT, font=F_SMALL)
    d.text((458, 148), "(empty — this project has no draft)", fill=MUTED, font=F_TINY)
    frames.append(img)

    img, d = chrome("3. CAD, Wiring, and Imagine each keep their own per-project map")
    sidebar(d, highlight="Robot Arm")
    rounded(d, (430, 70, 700, 250), (22, 27, 34), 10)
    d.text((446, 88), "Compose  restored", fill=GREEN, font=F_TINY)
    rounded(d, (446, 110, 684, 190), (13, 17, 23), 8, ACCENT)
    d.text((458, 128), "80×40×12 mm bracket,", fill=TEXT, font=F_SMALL)
    d.text((458, 148), "2× M4 on 50 mm centers", fill=TEXT, font=F_SMALL)
    frames.append(img)
    save_gif("prompt-persist.gif", frames, 1000)


def main():
    viewport_finder()
    pin_projects()
    clip_video_editor()
    canvas_workspace()
    imagine_panel()
    parts_catalog()
    reference_folders()
    wiring_send()
    prompt_persist()
    print("done")


if __name__ == "__main__":
    main()
