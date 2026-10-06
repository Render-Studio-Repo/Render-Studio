#!/usr/bin/env python3
"""Studio-dark looping GIFs for Aug–Sep 2026 user-facing features.

New files only (does not overwrite Sept 16 newfeats1 GIFs).
Writes frontend/docs/media/*.gif and frontend/docs/media/GIF-CATALOG.md.
"""

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
BLUE = (88, 166, 255)
PURPLE = (163, 113, 247)
PINK = (240, 136, 62)
SIDE = (16, 20, 26)
V = "20260916-gifs40"


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
    x = 200
    for name in ("3D", "Canvas", "Editor", "Code", "Imagine"):
        w = 62 if name != "Imagine" else 74
        on = name == tab
        rounded(d, (x, 16, x + w, 42), (15, 23, 42) if on else (30, 36, 44), 8, ACCENT if on else LINE)
        d.text((x + 8, 22), name, fill=ACCENT if on else MUTED, font=F_TINY)
        x += w + 6
    d.rectangle((10, H - 38, W - 10, H - 10), fill=(18, 22, 28))
    d.text((22, H - 32), caption, fill=MUTED, font=F_SMALL)
    return img, d


def cards(d: ImageDraw.ImageDraw, items: list[tuple[str, str]], highlight: int = 0):
    x = 40
    for i, (title, meta) in enumerate(items):
        on = i == highlight
        rounded(d, (x, 80, x + 200, 250), (15, 23, 42) if on else (28, 34, 42), 10, ACCENT if on else LINE)
        rounded(d, (x + 16, 96, x + 184, 170), (40, 44, 52), 8)
        d.text((x + 16, 182), title, fill=TEXT, font=F_SMALL)
        d.text((x + 16, 206), meta, fill=MUTED, font=F_TINY)
        x += 220


def bullets(d: ImageDraw.ImageDraw, lines: list[str], y0: int = 90, x0: int = 40):
    y = y0
    for line in lines:
        d.text((x0, y), line, fill=TEXT if not line.startswith("·") else MUTED, font=F_SMALL)
        y += 26


# file, category, title, description, frames: list[(caption, drawer)]
# drawer is a callable(d, img) or None — we use scene tags instead.

DEMOS: list[dict] = []


def add(file: str, category: str, title: str, description: str, frames: list[tuple[str, str, dict]]):
    DEMOS.append(
        {
            "file": file,
            "category": category,
            "title": title,
            "description": description,
            "frames": frames,
        }
    )


def paint(d: ImageDraw.ImageDraw, kind: str, extra: dict):
    if kind == "split":
        rounded(d, (18, 58, 350, H - 48), (17, 21, 27), 10, BLUE)
        d.text((36, 80), extra.get("left", "Viewport"), fill=ACCENT, font=F_SMALL)
        rounded(d, (90, 120, 280, 240), (31, 63, 115), 8)
        rounded(d, (368, 58, 700, H - 48), (17, 21, 27), 10, GREEN)
        d.text((386, 80), extra.get("right", "Wiring"), fill=GREEN, font=F_SMALL)
        rounded(d, (420, 140, 640, 220), (42, 92, 56), 8)
        if extra.get("btn"):
            rounded(d, (560, 64, 688, 96), BLUE, 8)
            d.text((580, 72), extra["btn"], fill=(255, 255, 255), font=F_TINY)
            cursor(d, 620, 76, click=bool(extra.get("click")))
    elif kind == "modal":
        rounded(d, (150, 70, 570, 310), (22, 27, 34), 14, LINE)
        d.text((180, 90), extra.get("title", "Dialog"), fill=TEXT, font=F_TITLE)
        bullets(d, extra.get("lines") or [], 130, 180)
        if extra.get("btn"):
            rounded(d, (360, 250, 520, 286), BLUE, 8)
            d.text((390, 260), extra["btn"], fill=(255, 255, 255), font=F_SMALL)
            cursor(d, 430, 264, click=True)
    elif kind == "list":
        rounded(d, (18, 58, 280, H - 48), SIDE, 10)
        d.text((32, 70), extra.get("head", "LIST"), fill=MUTED, font=F_TINY)
        y = 96
        for i, name in enumerate(extra.get("rows") or []):
            on = i == extra.get("hi", -1)
            rounded(d, (28, y, 268, y + 28), (15, 23, 42) if on else (28, 34, 42), 6, ACCENT if on else None)
            d.text((40, y + 6), name, fill=ACCENT if on else TEXT, font=F_SMALL)
            y += 34
        rounded(d, (300, 70, 700, 300), (17, 21, 27), 10)
        bullets(d, extra.get("detail") or [], 100, 320)
        if extra.get("cx"):
            cursor(d, extra["cx"], extra.get("cy", 110), click=bool(extra.get("click")))
    elif kind == "search":
        rounded(d, (80, 80, 640, 300), (22, 27, 34), 14, LINE)
        rounded(d, (100, 100, 620, 136), (13, 17, 23), 8, ACCENT)
        d.text((114, 110), extra.get("q", "Search…"), fill=TEXT if extra.get("q") else MUTED, font=F_BODY)
        y = 156
        for name, meta in extra.get("hits") or []:
            rounded(d, (100, y, 620, y + 36), (28, 34, 42), 6)
            d.text((114, y + 8), name, fill=TEXT, font=F_SMALL)
            d.text((420, y + 10), meta, fill=MUTED, font=F_TINY)
            y += 44
        cursor(d, extra.get("cx", 140), extra.get("cy", 112), click=bool(extra.get("click")))
    elif kind == "vr":
        d.ellipse((80, 70, 640, 320), outline=LINE, width=2)
        d.text((300, 90), extra.get("title", "VR"), fill=ACCENT, font=F_TITLE)
        bullets(d, extra.get("lines") or [], 140, 180)
        if extra.get("hand"):
            rounded(d, (80, 220, 220, 300), (15, 23, 42), 10, ACCENT)
            d.text((100, 248), extra["hand"], fill=ACCENT, font=F_SMALL)
        cursor(d, extra.get("cx", 400), extra.get("cy", 180), click=bool(extra.get("click")))
    elif kind == "editor":
        rounded(d, (18, 58, 700, 210), (17, 21, 27), 10)
        d.text((32, 70), extra.get("preview", "PREVIEW"), fill=MUTED, font=F_TINY)
        rounded(d, (32, 90, 240, 190), (10, 14, 20), 8, BLUE)
        rounded(d, (18, 220, 700, H - 48), (22, 27, 34), 10, extra.get("outline", BLUE))
        bullets(d, extra.get("lines") or [], 232, 32)
        if extra.get("btn"):
            rounded(d, (560, 268, 680, 298), BLUE, 6)
            d.text((580, 274), extra["btn"], fill=(255, 255, 255), font=F_TINY)
            cursor(d, 600, 276, click=True)
    elif kind == "form":
        rounded(d, (40, 70, 680, 320), (22, 27, 34), 12, LINE)
        d.text((60, 88), extra.get("title", "Form"), fill=TEXT, font=F_TITLE)
        y = 130
        for label, value in extra.get("fields") or []:
            d.text((60, y), label, fill=MUTED, font=F_TINY)
            rounded(d, (200, y - 4, 640, y + 24), (13, 17, 23), 6, LINE)
            d.text((212, y), value, fill=TEXT, font=F_SMALL)
            y += 42
        if extra.get("btn"):
            rounded(d, (480, 270, 640, 306), BLUE, 8)
            d.text((510, 280), extra["btn"], fill=(255, 255, 255), font=F_SMALL)
            cursor(d, 560, 284, click=True)
    elif kind == "phone":
        rounded(d, (250, 58, 470, H - 48), (10, 14, 20), 18, LINE)
        d.text((300, 72), extra.get("title", "Mobile"), fill=ACCENT, font=F_TINY)
        bullets(d, extra.get("lines") or [], 110, 270)
        cursor(d, extra.get("cx", 360), extra.get("cy", 200), click=bool(extra.get("click")))
    elif kind == "cards":
        cards(d, extra.get("items") or [("A", ""), ("B", ""), ("C", "")], extra.get("hi", 0))
        if extra.get("cx"):
            cursor(d, extra["cx"], extra.get("cy", 250), click=bool(extra.get("click")))
    else:
        bullets(d, extra.get("lines") or [kind], 90, 40)


def render_demo(demo: dict):
    frames = []
    for caption, kind, extra in demo["frames"]:
        img, d = chrome(caption, extra.get("tab", "3D"))
        paint(d, kind, extra)
        frames.append(img)
    save_gif(demo["file"], frames, extra.get("duration", 900) if extra else 900)


# ── 42 new GIFs ─────────────────────────────────────────────
add(
    "viewport-split-layouts.gif",
    "modeling",
    "Saved viewport split layouts",
    "Save a named mosaic of Viewport / Wiring / Parts List, then share or import the layout like any other preview.",
    [
        ("1. Layouts is last on the viewport tab strip", "split", {"left": "Viewport", "right": "Wiring", "btn": "Layouts"}),
        ("2. Name the save — mosaic thumbnail of the live tree", "modal", {"title": "Save split layout", "lines": ["Name  Dual CAD + wiring", "Optional description", "Thumbnail from the live split"], "btn": "Save"}),
        ("3. Copy share link or import JSON / URL", "modal", {"title": "Saved layouts", "lines": ["Dual CAD + wiring", "Copy link  ·  Public profile", "Import URL / JSON", "Account → Viewport settings"], "btn": "Share"}),
        ("4. Marketplace has a free Viewport layouts section", "cards", {"items": [("Dual CAD", "free"), ("Quad inspect", "free"), ("Wiring side", "Install")], "hi": 2, "cx": 560, "cy": 250, "click": True}),
    ],
)
add(
    "public-pin.gif",
    "projects",
    "Pin to public profile",
    "Public projects can be pinned on your public profile so visitors see the featured models first.",
    [
        ("1. Open a public project — Pin to public is on the row", "list", {"head": "PUBLIC", "rows": ["★  Wrist bracket", "OpenArm vis", "House layout"], "hi": 0, "detail": ["Pin to public profile", "Visitors see this first", "Separate from personal pins"], "cx": 70, "cy": 108, "click": True}),
        ("2. Confirm — cap is independent of the 5 personal pins", "modal", {"title": "Pin to public", "lines": ["Show Wrist bracket on your public page", "Personal pins stay in the project menu"], "btn": "Pin"}),
        ("3. Your public page lists pinned models first", "cards", {"items": [("Wrist bracket", "pinned"), ("OpenArm", "public"), ("House", "public")], "hi": 0, "cx": 120, "cy": 200}),
    ],
)
add(
    "film-edit.gif",
    "projects",
    "AI film-edit on the clip timeline",
    "Under the clip editor, prompt a cut, Improve prompt, then Generate a film edit without leaving Studio.",
    [
        ("1. Open a viewport recording in the Editor tab", "editor", {"tab": "Editor", "preview": "orbit.mp4", "lines": ["Video lane  ·  audio lane  ·  trim"], "btn": ""}),
        ("2. Type a film-edit cut under the timeline", "editor", {"tab": "Editor", "lines": ["AI FILM EDIT", "Cut to the close-up, keep the CAD orbit"], "btn": "Improve"}),
        ("3. Improve prompt, then Generate", "editor", {"tab": "Editor", "lines": ["Improved: close-up at 0:04, captions on", "Model: your connected key"], "btn": "Generate"}),
        ("4. Job runs in the background — safe to refresh", "editor", {"tab": "Editor", "lines": ["Generating film edit…  42%", "Output lands next to the original clip"], "btn": ""}),
    ],
)
add(
    "native-joints.gif",
    "rigging",
    "Native FreeCAD assembly joints",
    "Author the 13 FreeCAD Assembly joint types, save Joints / FCStd, and export STEP + joints for Fusion.",
    [
        ("1. Open Assembly — joints live next to the part tree", "list", {"head": "JOINTS", "rows": ["Revolute  base→turret", "Slider  rail", "Fixed  plate"], "hi": 0, "detail": ["13 native FreeCAD types", "Pose controls + reset", "Advanced limits"], "cx": 80, "cy": 110, "click": True}),
        ("2. Set axis, limits, and drive the live pose", "form", {"title": "Revolute · base → turret", "fields": [("Axis", "Z  ·  0,0,1"), ("Limits", "−90°  …  90°"), ("Pose", "32°")], "btn": "Apply"}),
        ("3. Export STEP + joints package for Fusion", "modal", {"title": "Export assembly", "lines": ["STEP geometry + joints JSON", "Fusion script creates native joints", "Onshape/SW mates still manual"], "btn": "Download"}),
    ],
)
add(
    "code-workspace.gif",
    "projects",
    "Code workspace",
    "Nested explorer with syntax tabs, JSON/CSV/XLSX/PDF previews, and revision-checked saves that survive project switches.",
    [
        ("1. Open a code folder — explorer + file tabs", "list", {"tab": "Code", "head": "firmware/", "rows": ["main.py", "pins.json", "log.csv", "sheet.xlsx"], "hi": 0, "detail": ["Syntax coloring", "Current-file search", "JSON tree / CSV table"], "cx": 60, "cy": 110, "click": True}),
        ("2. JSON tree or raw; CSV as a table", "list", {"tab": "Code", "head": "pins.json", "rows": ["stepper.en", "stepper.step", "servo.pwm"], "hi": 1, "detail": ["Tree  ·  Raw toggle", "XLSX sheets in tabs", "PDF.js preview"], "cx": 80, "cy": 140}),
        ("3. Save is revision-checked — drafts park per session", "modal", {"tab": "Code", "title": "Save main.py", "lines": ["Remote changed — review diff", "Parked drafts survive project switch", "Uploaded code is never executed"], "btn": "Save"}),
    ],
)
add(
    "wrist-cameras.gif",
    "robotics",
    "Wrist USB cameras",
    "Plug Arducam-style wrist cams into the Mac. Wrist Cam publishes JPEGs on :8001 — no curl on the happy path.",
    [
        ("1. Plug the USB cam into the Mac running Studio", "form", {"title": "ROBOTICS  ·  Wrist Cam", "fields": [("Cam IP", "this Mac’s LAN host"), ("Port", "8001 implied"), ("Device", "Arducam  ·  USB 3")], "btn": "Wrist Cam"}),
        ("2. Allow camera if macOS never lists the device", "modal", {"title": "Allow camera", "lines": ["Runs Python/ffmpeg so Camera sees USB", "Approve Python and/or ffmpeg prompts", "No FaceTime"], "btn": "Allow"}),
        ("3. Left overlay; second cam fills Right", "split", {"left": "Left.jpg", "right": "Right.jpg", "btn": "Copy log"}),
    ],
)
add(
    "settings-search.gif",
    "help",
    "Settings search",
    "Type in Preferences or Management to jump to a setting instead of hunting sections.",
    [
        ("1. Open Preferences — search is at the top", "search", {"q": "", "hits": [], "cx": 120, "cy": 112}),
        ("2. Type a setting — results jump the panel", "search", {"q": "mouse", "hits": [("Mouse preset", "General"), ("Orbit button", "Viewport"), ("VR remap", "Controllers")], "click": True, "cy": 168}),
        ("3. Management dashboard has the same search", "search", {"q": "email", "hits": [("Email inbox", "Ops"), ("Slack notify", "Ops"), ("Feature requests", "Toggles")]}),
    ],
)
add(
    "mobile-studio.gif",
    "help",
    "Mobile studio chrome",
    "Phone layout: hamburger menu, profile top-right, tools FAB, locked viewport so orbit does not fight chrome.",
    [
        ("1. Open Studio on a phone — app chrome, not a shrunk desktop", "phone", {"title": "☰   Robot Arm      ☺", "lines": ["Locked viewport", "Tools FAB lower-right", "AI corner tap"]}),
        ("2. Hamburger opens Projects / Workspaces", "phone", {"title": "MENU", "lines": ["Projects", "Workspaces", "Account", "Docs"], "cx": 280, "cy": 140, "click": True}),
        ("3. Tools FAB: Record, screenshot, fit", "phone", {"title": "TOOLS", "lines": ["● Record", "Screenshot", "Fit  ·  Section"], "cx": 400, "cy": 280, "click": True}),
    ],
)
add(
    "share-remix.gif",
    "projects",
    "Share link & remix",
    "Copy a share link; signed-in visitors remix into a new project or an existing shared workspace.",
    [
        ("1. Export → Copy share link (pinned at the top)", "modal", {"title": "Share", "lines": ["Copy share link", "Orbit · section · downloads", "Sign-in required to remix"], "btn": "Copy link"}),
        ("2. Remix → Create project & open editor", "modal", {"title": "Remix model", "lines": ["Create project & open editor", "Or add to an existing workspace", "Opens /?project=…#viewport"], "btn": "Remix"}),
        ("3. Shared workspace: add to existing or create new", "list", {"head": "WORKSPACES", "rows": ["Team CAD", "+ New workspace"], "hi": 0, "detail": ["Auth gate resumes after login", "Profile icon on the share page"], "cx": 80, "cy": 110, "click": True}),
    ],
)
add(
    "freecad-kernel.gif",
    "modeling",
    "FreeCAD kernel move / delete / extrude",
    "Move, delete, and Extrude/Pad/Pocket persist on the FreeCAD/OCC STEP document, not a mesh-only preview.",
    [
        ("1. Select a body — Move writes the STEP document", "list", {"head": "BODIES", "rows": ["Base plate", "Boss", "Pocket"], "hi": 0, "detail": ["Move  ·  kernel, not mesh", "Delete removes the feature", "Parts stay put after refresh"], "cx": 80, "cy": 110, "click": True}),
        ("2. Extrude / Pad / Pocket match FreeCAD Tasks", "form", {"title": "Pad", "fields": [("Type", "Pad  ·  dimension"), ("Length", "8 mm"), ("Direction", "normal to face")], "btn": "OK"}),
        ("3. Refresh — geometry is still on the STEP", "split", {"left": "Before", "right": "After refresh", "btn": ""}),
    ],
)
add(
    "vr-menu.gif",
    "rigging",
    "VR world menu & laser",
    "Quest menu-aim uses the posed controller ray. Trigger clicks HUD; DimOS does not steal picks while the menu is hit.",
    [
        ("1. Enter VR — left monitor sits beside CAD", "vr", {"title": "World menu", "lines": ["Laser stops at the HUD", "Trigger clicks Enable / Record", "Grip on chrome rotates windows"], "hand": "Left dock", "cx": 420, "cy": 160}),
        ("2. Aim at a menu — short beam + tip, not a void laser", "vr", {"title": "Menu-aim tip", "lines": ["Cube / cylinder / sphere at the hit", "Wrist yields to world menus"], "hand": "Right tip", "click": True, "cx": 400, "cy": 170}),
        ("3. Hold B — dismiss tool, world-lock AI, laser on", "vr", {"title": "Hold B", "lines": ["Tool wheel hides immediately", "AI panel stays where it opened"], "hand": "B", "cx": 380, "cy": 200}),
    ],
)
add(
    "public-room.gif",
    "projects",
    "Public room — drop a project",
    "In a public VR room, drop a project both people can pick up and inspect together.",
    [
        ("1. Join a public room from VR Studio tabs", "vr", {"title": "Public room", "lines": ["Presence dots for peers", "Your nametag faces the other person"], "hand": "Drop", "cx": 360, "cy": 180}),
        ("2. Drop a project into the shared floor", "vr", {"title": "Drop Wrist bracket", "lines": ["Both people can pick it up", "Grab uses cheap AABB, not CAD triangles"], "hand": "Grip", "click": True, "cx": 400, "cy": 200}),
        ("3. Peer sees the same GLB — live, not a screenshot", "vr", {"title": "Shared pick", "lines": ["ICE / collab board stay on", "Hide-from-others is per window"], "hand": "Peer", "cx": 420, "cy": 190}),
    ],
)
add(
    "document-tabs.gif",
    "modeling",
    "Viewport document tab strip",
    "Image, PDF, McMaster, and DXF open as parked tabs. 3D stays in the DOM — no close-to-return.",
    [
        ("1. Open a PDF — strip lists Viewport + the doc", "list", {"head": "TABS", "rows": ["Viewport", "drawing.pdf", "part.png"], "hi": 1, "detail": ["Canvas stays mounted", "data-shell-tab is source of truth"], "cx": 80, "cy": 144, "click": True}),
        ("2. Click Viewport to return without closing the PDF", "list", {"head": "TABS", "rows": ["Viewport", "drawing.pdf", "part.png"], "hi": 0, "detail": ["Strip hides Viewport chip on 3D", "BROWSER sits under the strip"], "cx": 80, "cy": 110, "click": True}),
        ("3. Recordings and Canvas join the same strip", "list", {"head": "TABS", "rows": ["3D", "Editor", "Canvas", "Wiring"], "hi": 2, "detail": ["Layouts is last after these", "Clip editor is an Editor tab"], "cx": 80, "cy": 178}),
    ],
)
add(
    "remix-workspace.gif",
    "projects",
    "Remix into a shared workspace",
    "Remix can add to an existing shared workspace or create a new one — not create-only.",
    [
        ("1. On a share page, Remix asks where to land", "modal", {"title": "Remix", "lines": ["New project in my workspace", "Add to Team CAD", "Create a new shared workspace"], "btn": "Add to Team CAD"}),
        ("2. Confirm — Create project & open editor", "modal", {"title": "Team CAD", "lines": ["Opens 3D viewport", "Closes the remix modal", "Pending action resumes after login"], "btn": "Open editor"}),
        ("3. Workspace members see the remixed project live", "list", {"head": "TEAM CAD", "rows": ["Wrist remix", "Robot Arm"], "hi": 0, "detail": ["Live for online members", "Original share stays public"], "cx": 80, "cy": 110}),
    ],
)
add(
    "dimos-enable.gif",
    "robotics",
    "DIMOS stays gated until Enable",
    "Quest robotics and teleop stay off until Enable Robotics or Activate. Cloud never exposes :8443.",
    [
        ("1. Robot tab — Enable is off until you tap it", "form", {"title": "Robotics", "fields": [("Status", "gated"), ("Coordinator", "not started"), ("Cloud", "refuses LAN pipe")], "btn": "Enable"}),
        ("2. Enable mounts the DimOS viewer (not a stub)", "form", {"title": "DimOS viewer", "fields": [("JPEG", "incoming /api/dimos/ws"), ("Connect", "robot PC LAN"), ("Spawn", "background teleop-*")], "btn": "Activate"}),
        ("3. Cloud origin closes the pipe — LAN only", "modal", {"title": "render3d.app", "lines": ["Cannot reach 192.168.x.x", "Never points at a public :8443", "Mac Studio proxies the robot PC"], "btn": "OK"}),
    ],
)
add(
    "workspace-invite.gif",
    "projects",
    "Workspace invite by email",
    "Invite teammates from the workspace popup with typeahead profiles — no retyping the full address.",
    [
        ("1. Workspace row → Invite", "list", {"head": "WORKSPACES", "rows": ["Team CAD  ⋮", "Personal"], "hi": 0, "detail": ["Invite by email", "Typeahead + avatars"], "cx": 200, "cy": 108, "click": True}),
        ("2. Type a name or email — pick from the dropdown", "search", {"q": "sam", "hits": [("Sam  ·  you", "owner"), ("Samira  ·  samira@…", "member")], "click": True, "cy": 168}),
        ("3. They appear in members without a refresh", "list", {"head": "MEMBERS", "rows": ["You  owner", "Samira  editor"], "hi": 1, "detail": ["Live folder sync", "Shared workspaces group"], "cx": 80, "cy": 144}),
    ],
)
add(
    "context-lab.gif",
    "help",
    "Context Lab — machines & customers",
    "Context Lab stores machines and customers so Improve and Generate can reuse shop context.",
    [
        ("1. Open Context Lab from the right rail", "list", {"head": "CONTEXT LAB", "rows": ["Machines", "Customers"], "hi": 0, "detail": ["Printers, CNCs, robot cells", "Used by Improve / Generate"], "cx": 80, "cy": 110, "click": True}),
        ("2. Add a machine — build volume and nozzle", "form", {"title": "Bambu X1C", "fields": [("Volume", "256 × 256 × 256 mm"), ("Nozzle", "0.4 mm"), ("Notes", "Engineering PLA only")], "btn": "Save"}),
        ("3. Customer card is available as prompt context", "form", {"title": "Acme Robotics", "fields": [("Fit", "NEMA 17 face"), ("Finish", "bead blast"), ("Units", "mm")], "btn": "Use in prompt"}),
    ],
)
add(
    "improve-lab.gif",
    "ai-cad",
    "Improve Lab",
    "Improve Lab keeps facing-locked Render wraps and CAD Improve experiments next to the project.",
    [
        ("1. Improve Lab sits under Reference Files", "list", {"head": "IMPROVE LAB", "rows": ["wrap-pass-3.png", "cad-improve.json"], "hi": 0, "detail": ["Object-only materials", "Facing locked from viewport"], "cx": 80, "cy": 110, "click": True}),
        ("2. CAD Improve reads canvas as layout vs mate photos", "modal", {"title": "Improve", "lines": ["Layout sketch vs mate photo", "Realistic part colours", "Complete-model scope"], "btn": "Improve"}),
        ("3. Results land back in the lab folder", "list", {"head": "IMPROVE LAB", "rows": ["wrap-pass-4.png", "cad-improve.json"], "hi": 0, "detail": ["Newest first", "Send to CAD still works"], "cx": 80, "cy": 110}),
    ],
)
add(
    "calendar-meetings.gif",
    "help",
    "Calendars and meeting requests",
    "Profile calendars plus meeting requests so a teammate can book time without leaving Studio.",
    [
        ("1. Account → Calendar", "form", {"title": "Calendar", "fields": [("Week of", "Sep 14"), ("Busy", "Tue 10:00–12:00"), ("Open", "Wed 14:00–16:00")], "btn": "Request"}),
        ("2. Send a meeting request with a note", "modal", {"title": "Meeting request", "lines": ["With  Samira", "Wed 14:00  ·  30 min", "Review wrist bracket STEP"], "btn": "Send"}),
        ("3. They accept from the profile / inbox", "list", {"head": "REQUESTS", "rows": ["Accepted  Wed 14:00", "Pending  Fri 9:00"], "hi": 0, "detail": ["Same calendar on profile", "No extra app"], "cx": 80, "cy": 110}),
    ],
)
add(
    "receive-money.gif",
    "help",
    "Receive money — Stripe, PayPal, X, wallets",
    "Creators connect Stripe / PayPal / X / wallets from account so Marketplace payouts have a destination.",
    [
        ("1. Account → Receive money", "form", {"title": "Payouts", "fields": [("Stripe", "Connect"), ("PayPal", "email@…"), ("X / wallets", "optional")], "btn": "Connect Stripe"}),
        ("2. Status shows connected vs missing", "list", {"head": "STATUS", "rows": ["Stripe  connected", "PayPal  —", "Wallet  —"], "hi": 0, "detail": ["Marketplace uses this", "Secrets stay on the server"], "cx": 80, "cy": 110}),
        ("3. Premium Agent Store apps can settle later", "modal", {"title": "Ready", "lines": ["Free listings install now", "Premium waits on billing"], "btn": "Done"}),
    ],
)
add(
    "suggestions.gif",
    "help",
    "Suggestions overlay",
    "After boot, send a suggestion with attachments. Sent closes the overlay; email + inbox notify ops.",
    [
        ("1. Boot may show Suggestions — or open it from Account", "modal", {"title": "Suggestions", "lines": ["What should we add?", "Attach a screenshot or clip", "Sent + close"], "btn": "Attach"}),
        ("2. Drop a capture, then Send", "modal", {"title": "New suggestion", "lines": ["viewport-lag.png", "Notify inbox + email"], "btn": "Send"}),
        ("3. Overlay closes — no leftover modal on the viewport", "split", {"left": "Viewport", "right": "Inbox  ✓", "btn": ""}),
    ],
)
add(
    "exploded-view.gif",
    "modeling",
    "Exploded view",
    "Explode an assembly to inspect mates. Turning it off reloads the assembled parent — rotate does not collapse it.",
    [
        ("1. Select the assembly → Exploded view", "split", {"left": "Assembled", "right": "Explode", "btn": "Explode"}),
        ("2. Parts separate along their axes", "split", {"left": "Base", "right": "Turret offset", "btn": ""}),
        ("3. Off reloads the assembled parent; rotate keeps explode", "modal", {"title": "Exploded view off", "lines": ["Reloads assembled parent", "Starting rotate does not collapse"], "btn": "OK"}),
    ],
)
add(
    "kernel-measure.gif",
    "modeling",
    "Kernel measure",
    "Measure prefers FreeCAD/OCC vertex/edge/face distance from the STEP, with mesh centroid as fallback.",
    [
        ("1. Tools → Measure (or first Hold-A VR page)", "form", {"title": "Measure", "fields": [("A", "@vertex-1"), ("B", "@edge-4"), ("Result", "…")], "btn": "Pick B"}),
        ("2. Kernel returns live topo numbers", "form", {"title": "Measure", "fields": [("A", "vertex  ·  STEP"), ("B", "edge  ·  STEP"), ("Distance", "42.00 mm")], "btn": "Refine"}),
        ("3. Share links expose Measure after Transparent", "modal", {"title": "Share viewer", "lines": ["Guests use kernel when STEP exists", "Else GLB preview picks"], "btn": "OK"}),
    ],
)
add(
    "vr-spatial-draw.gif",
    "sketch-canvas",
    "Spatial AI Draw with live voice",
    "In VR Draw, lasso a surface, talk with live voice, Smart Description, then Generate only when you press it.",
    [
        ("1. Enter VR → Draw → AI Prompt", "vr", {"title": "AI Prompt", "lines": ["Add references  ·  Move default", "Lasso a face or draw in space"], "hand": "Draw", "cx": 400, "cy": 180}),
        ("2. Live voice describes the selected region", "vr", {"title": "Live voice", "lines": ["Follow-ups stay on that region", "Region notes + Link A→B"], "hand": "Talk", "click": True, "cx": 420, "cy": 190}),
        ("3. Smart Description, then press Generate", "vr", {"title": "Review", "lines": ["Does not generate while talking", "Undo/Redo on this board"], "hand": "Generate", "cx": 430, "cy": 200, "click": True}),
    ],
)
add(
    "dxf-convert.gif",
    "cloud",
    "DXF convert preferences",
    "Choose ask / auto / always DXF / always image so line drawings become CAD instead of a photo.",
    [
        ("1. Drop a DXF or 2D drawing", "modal", {"title": "Convert this drawing?", "lines": ["Line drawing / logo / floorplan", "Don’t ask again"], "btn": "Convert"}),
        ("2. Preferences → DXF convert", "form", {"title": "DXF convert", "fields": [("Mode", "ask  ·  auto  ·  always_dxf"), ("Auto", "profiles & floorplans"), ("Keep image", "product photos / Imagine")], "btn": "Save"}),
        ("3. Auto converts profiles; Imagine shots stay images", "cards", {"items": [("bracket.dxf", "CAD"), ("hero.png", "image"), ("plan.dxf", "CAD")], "hi": 0, "cx": 120, "cy": 200}),
    ],
)
add(
    "send-to-wiring.gif",
    "wiring",
    "Send catalog parts to wiring",
    "From Parts Catalog, Send to wiring so the sourced part and pins land in the Wiring prompt — no re-search.",
    [
        ("1. Parts Catalog — import or Send to wiring", "cards", {"items": [("NEMA 17", "Import"), ("DRV8825", "Send"), ("Uno", "Import")], "hi": 1, "cx": 340, "cy": 250, "click": True}),
        ("2. Wiring prompt gets the part + pins", "form", {"title": "Wiring compose", "fields": [("Parts", "NEMA 17  ·  DRV8825"), ("Pins", "step, dir, en"), ("Draft", "per project")], "btn": "Generate"}),
        ("3. History stamps immediately", "list", {"head": "HISTORY", "rows": ["NEMA 17 + DRV8825  ✓", "running…"], "hi": 0, "detail": ["succeeded / failed", "Links chips + favicon"], "cx": 80, "cy": 110}),
    ],
)
add(
    "wiring-3d-ar.gif",
    "wiring",
    "Wiring 3D / AR",
    "Bottom-left AR/3D controls, isolated wiring rendering, and contact-only 1:1 AR placement.",
    [
        ("1. Wiring workspace — AR / 3D toggle bottom-left", "split", {"left": "Breadboard", "right": "3D wires", "btn": "AR"}),
        ("2. Inspect a sourced component — pins preserved", "form", {"title": "NEMA 17", "fields": [("Pins", "A+, A−, B+, B−"), ("Driver", "DRV8825"), ("Scale", "1:1 contact")], "btn": "Place"}),
        ("3. Headset: contact-only placement, not a floating sketch", "vr", {"title": "AR wiring", "lines": ["Metadata preserved", "Manual alignment", "Not passthrough frames"], "hand": "Place", "cx": 400, "cy": 180}),
    ],
)
add(
    "vr-voice-companion.gif",
    "rigging",
    "Reviewed VR voice companion",
    "Right-wrist agent with audio-reactive avatar. Spoken edits require review; throw dismisses the panel.",
    [
        ("1. Right wrist — agent button", "vr", {"title": "Voice companion", "lines": ["Audio-reactive avatar", "Native searchable keyboard"], "hand": "Wrist", "cx": 200, "cy": 250, "click": True}),
        ("2. Speak an edit — it queues for review, not silent generate", "vr", {"title": "Review", "lines": ["One/all generation tracks", "Partial-batch results kept"], "hand": "Review", "cx": 400, "cy": 180}),
        ("3. Throw the panel to dismiss; guest audio is opt-in", "vr", {"title": "Dismiss", "lines": ["Throw to close", "Room assistant volume / mute"], "hand": "Throw", "cx": 480, "cy": 140, "click": True}),
    ],
)
add(
    "plus-new-project.gif",
    "projects",
    "Plus starts a new project immediately",
    "The + next to Projects creates a project right away — blank viewport, no extra wizard.",
    [
        ("1. Explorer — click + next to Projects", "list", {"head": "PROJECTS", "rows": ["+  New", "Robot Arm", "Wrist bracket"], "hi": 0, "detail": ["Immediate create", "Blank viewport"], "cx": 48, "cy": 108, "click": True}),
        ("2. New project is selected — empty 3D", "list", {"head": "PROJECTS", "rows": ["Untitled", "Robot Arm"], "hi": 0, "detail": ["Units from toolbar", "Drop STEP when ready"], "cx": 80, "cy": 110}),
        ("3. Name it from the row or details", "form", {"title": "Rename", "fields": [("Name", "Wrist v2"), ("Units", "mm")], "btn": "Save"}),
    ],
)
add(
    "public-projects-live.gif",
    "projects",
    "Public projects appear live",
    "Pushing a project to Public shows it for other people without a refresh, including Discord announcements when enabled.",
    [
        ("1. Project menu → Public", "list", {"head": "VISIBILITY", "rows": ["Private", "Public"], "hi": 1, "detail": ["Live for other people", "Optional Discord post"], "cx": 80, "cy": 144, "click": True}),
        ("2. Public feed updates without a reload", "cards", {"items": [("Wrist v2", "just now"), ("OpenArm", "2h"), ("House", "yesterday")], "hi": 0, "cx": 120, "cy": 200}),
        ("3. Discord can announce title, thumb, view link", "modal", {"title": "Posted to Discord", "lines": ["Title + creator", "Thumbnail + public view"], "btn": "OK"}),
    ],
)
add(
    "chatgpt-team-share.gif",
    "ai-cad",
    "Share ChatGPT CAD with a team",
    "ChatGPT / Codex sessions live on workspaces. Manage AI keys and subscriptions; trial is 3 ChatGPT renders.",
    [
        ("1. KEY pill — ChatGPT is a Codex host session", "form", {"title": "KEY  ·  OpenAI", "fields": [("Host", "Codex  ·  ChatGPT"), ("Workspace", "Team CAD"), ("Trial", "3 ChatGPT renders")], "btn": "Manage"}),
        ("2. Share the workspace so the team uses the same key path", "list", {"head": "KEYS", "rows": ["Team ChatGPT", "Personal Grok"], "hi": 0, "detail": ["Subscriptions in the picker", "No refresh to see the new key"], "cx": 80, "cy": 110, "click": True}),
        ("3. New users get 3 ChatGPT renders, not a $10 credit", "modal", {"title": "Trial", "lines": ["3 ChatGPT renders", "Then connect a key or plan"], "btn": "Got it"}),
    ],
)
add(
    "capture-fullscreen.gif",
    "projects",
    "Fullscreen capture + mini browser",
    "Screenshots and recordings open fullscreen with a mini browser for images and PDFs.",
    [
        ("1. Capture the viewport — lands in Screenshots", "list", {"head": "SCREENSHOTS", "rows": ["viewport-front.png", "orbit.webm"], "hi": 0, "detail": ["Newest first", "Icon actions on the row"], "cx": 80, "cy": 110, "click": True}),
        ("2. Fullscreen viewer + mini browser", "split", {"left": "Image", "right": "Files", "btn": "Markup"}),
        ("3. Markup → Send to AI still works from the tab", "modal", {"title": "Send to AI", "lines": ["Callouts in the CAD prompt", "PDF notes too"], "btn": "Send"}),
    ],
)
add(
    "texture-to-model.gif",
    "modeling",
    "Texture wrap on the model",
    "Texture to model wraps the image on the object. Timeline undo; files mini-browser. Render Improve is object-only.",
    [
        ("1. Drop a photo → Texture to model", "modal", {"title": "Texture", "lines": ["Wraps the image on the mesh", "Not a background plane"], "btn": "Wrap"}),
        ("2. Render Improve locks facing + object-only wrap", "form", {"title": "Render Improve", "fields": [("Facing", "locked"), ("Wrap", "object only"), ("Wear", "local, named parts")], "btn": "Improve"}),
        ("3. Timeline undo restores the previous wrap", "editor", {"preview": "timeline", "lines": ["Scrub wrap steps", "Files mini-browser"], "btn": "Undo"}),
    ],
)
add(
    "share-to-x.gif",
    "projects",
    "Share captures to X",
    "Mobile and VR POV Screenshot / Record, then markup and Share to X without leaving the capture flow.",
    [
        ("1. POV Screenshot or Record on mobile / VR", "phone", {"title": "POV", "lines": ["Screenshot", "Record"], "cx": 360, "cy": 160, "click": True}),
        ("2. Markup the still, then Share to X", "modal", {"title": "Share to X", "lines": ["Caption", "Attach the capture"], "btn": "Post"}),
        ("3. Headset clips use the same share sheet", "vr", {"title": "Share", "lines": ["Spectator FOV matches headset", "Explorer + AI windows included"], "hand": "Post", "cx": 400, "cy": 180}),
    ],
)
add(
    "recording-hud.gif",
    "projects",
    "Recording HUD",
    "Recording HUD docks, drags, and can hide from the clip so the overlay is not burned into the video.",
    [
        ("1. Click Record — HUD docks on the viewport", "split", {"left": "● REC  00:12", "right": "Viewport", "btn": "Hide"}),
        ("2. Drag the HUD; Hide from clip omits it from the file", "modal", {"title": "Recording", "lines": ["Dock  ·  drag", "Hide from clip", "Stop → Editor tab"], "btn": "Stop"}),
        ("3. Clip opens in the editor without the HUD burned in", "editor", {"tab": "Editor", "preview": "clean take", "lines": ["HUD not in pixels", "Trim / Share / GIF"], "btn": "Share"}),
    ],
)
add(
    "edit-selected.gif",
    "ai-cad",
    "Edit Selected — scale and attachment",
    "Edits keep source-to-assembly placement and scale. Failed results do not clobber the live body.",
    [
        ("1. Select a body → Edit selected in Compose", "list", {"head": "SELECTION", "rows": ["Cradle  ·  face-3", "Base plate"], "hi": 0, "detail": ["Source bounds captured", "Attachment frame kept"], "cx": 80, "cy": 110, "click": True}),
        ("2. Generate — replacement sits on the same mate", "form", {"title": "Edit selected", "fields": [("Scale", "1.0  ·  source units"), ("Attach", "same frame"), ("Scope", "complete model")], "btn": "Generate"}),
        ("3. Failed run keeps the old body — no false success", "modal", {"title": "Edit failed", "lines": ["Stale preview rejected", "Old object stays", "Retry with context"], "btn": "OK"}),
    ],
)
add(
    "database-setup.gif",
    "help",
    "Database configuration",
    "Docs page /database.html: point this clone at your Supabase, or Store locally for sqlite.",
    [
        ("1. Open /database.html (Docs → Database configuration)", "form", {"title": "Database", "fields": [("SUPABASE_URL", "https://….supabase.co"), ("service_role", "server only"), ("SQL", "install_users.sql")], "btn": "Connect"}),
        ("2. Or Store it locally — sqlite users / keys", "modal", {"title": "Store locally", "lines": ["Old sqlite method", "No service_role in JS"], "btn": "Store locally"}),
        ("3. Getting Started links Open database setup", "list", {"head": "DOCS", "rows": ["Getting Started", "Database configuration", "Updates"], "hi": 1, "detail": ["/setup.html still works", "Harness prompt unchanged"], "cx": 80, "cy": 144}),
    ],
)
add(
    "agent-tabs.gif",
    "help",
    "Agent panel — four tabs on one row",
    "Render Agent uses four tabs on a single row so help, skills, history, and settings stay in reach.",
    [
        ("1. Open Agent — four tabs, one row", "list", {"head": "AGENT", "rows": ["Help", "Skills", "History", "Settings"], "hi": 0, "detail": ["Product help, not Generate", "GIFs + Show me"], "cx": 80, "cy": 110, "click": True}),
        ("2. Skills enable CAD / DXF / URDF for the next prompt", "list", {"head": "SKILLS", "rows": ["CAD", "DXF", "URDF", "Molds"], "hi": 1, "detail": ["Attach a knowledge base"], "cx": 80, "cy": 144}),
        ("3. History + Settings stay on the same strip", "list", {"head": "AGENT", "rows": ["Help", "Skills", "History", "Settings"], "hi": 2, "detail": ["No stacked panels"], "cx": 80, "cy": 178}),
    ],
)
add(
    "marketplace-layouts.gif",
    "modeling",
    "Marketplace viewport layouts",
    "Browse free Viewport layouts, Install into the general layout store, then apply on any project.",
    [
        ("1. Marketplace → Viewport layouts", "cards", {"items": [("Dual CAD", "free"), ("Quad inspect", "free"), ("Wiring side", "free")], "hi": 0, "cx": 120, "cy": 250, "click": True}),
        ("2. Install writes /api/me/viewport-layouts", "modal", {"title": "Install Dual CAD", "lines": ["General Studio setting", "Not per-project", "Import to your workspace"], "btn": "Install"}),
        ("3. Account → Viewport lists the save; apply on any file", "list", {"head": "LAYOUTS", "rows": ["Dual CAD", "My mosaic"], "hi": 0, "detail": ["Share URL /share/{token}", "Right-click: copy / public / shop"], "cx": 80, "cy": 110}),
    ],
)
add(
    "solidworks-import.gif",
    "cloud",
    "SolidWorks library import / export",
    "Import and export SolidWorks library parts alongside Fusion / Onshape cloud libraries.",
    [
        ("1. Cloud libraries — Fusion, Onshape, SolidWorks", "list", {"head": "LIBRARIES", "rows": ["Fusion 360", "Onshape", "SolidWorks"], "hi": 2, "detail": ["Connect from Account → Cloud"], "cx": 80, "cy": 178, "click": True}),
        ("2. Browse and import into the open project", "cards", {"items": [("Bracket.sldprt", "Import"), ("Boss.sldprt", "Import"), ("Asm.sldasm", "—")], "hi": 0, "cx": 120, "cy": 250, "click": True}),
        ("3. Export writes SolidWorks-friendly files", "modal", {"title": "Export", "lines": ["Library part out", "Assembly when visible"], "btn": "Export"}),
    ],
)
add(
    "fritzing-skins.gif",
    "wiring",
    "Fritzing pictorial skins",
    "Every wiring part can show a Fritzing pictorial skin so the breadboard matches the real component.",
    [
        ("1. Wiring board — parts use pictorial skins", "split", {"left": "NEMA 17 skin", "right": "Uno skin", "btn": ""}),
        ("2. Toggle schematic vs pictorial", "form", {"title": "View", "fields": [("Skin", "Fritzing pictorial"), ("Fallback", "box + pins")], "btn": "Pictorial"}),
        ("3. Sourced catalog parts keep their skin in History", "list", {"head": "HISTORY", "rows": ["NEMA 17 + Uno  ✓"], "hi": 0, "detail": ["Pin-aware still", "Send to wiring carries the part"], "cx": 80, "cy": 110}),
    ],
)
add(
    "cad-mode-chips.gif",
    "ai-cad",
    "Even CAD mode chips",
    "Compose toolbar chips (Render / CAD / Mesh / Parts / Speed-Quality / Improve) share equal width on one row.",
    [
        ("1. Compose toolbar — equal minmax tracks", "form", {"title": "Compose", "fields": [("Modes", "Render  CAD  Mesh  Parts"), ("Speed", "compact 28px chip"), ("Improve", "on by default")], "btn": "CAD"}),
        ("2. Narrow sidebar wraps 3×2 without ragged gaps", "modal", {"title": "Narrow compose", "lines": ["3 × 2 grid", "Same 6px gutters"], "btn": "OK"}),
        ("3. Mode Quality is a compact chip, not a full-width pill", "form", {"title": "Mode Quality", "fields": [("Speed", "drafts"), ("Quality", "hard geometry"), ("GPT-5.5 Pro", "defaults Speed")], "btn": "Speed"}),
    ],
)


def write_catalog():
    lines = [
        "# GIF catalog — Aug–Sep 2026 features",
        "",
        "Studio-dark looping PIL GIFs (`720×400`, `#0d1117`) recorded by",
        "`scripts/gif-demos/record_aug_sep_feature_gifs.py`.",
        "Served at `/docs/media/<file>` with cache-bust `?v=20260916-gifs40`.",
        "",
        "These **42 new files** are in addition to the Sept 16 `newfeats1` GIFs",
        "(finder, pin, clip editor, canvas, Imagine, catalog, reference folders,",
        "wiring compose, prompt persist) and the older Getting Started recordings.",
        "",
        "| File | Path | URL | Title | What the loop shows | Docs category |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for demo in DEMOS:
        rel = f"frontend/docs/media/{demo['file']}"
        url = f"/docs/media/{demo['file']}?v={V}"
        desc = demo["description"].replace("|", "/")
        lines.append(
            f"| `{demo['file']}` | `{rel}` | `{url}` | {demo['title']} | {desc} | `{demo['category']}` |"
        )
    lines.extend(
        [
            "",
            "## Per GIF",
            "",
        ]
    )
    for demo in DEMOS:
        lines.append(f"### {demo['title']}")
        lines.append("")
        lines.append(f"- **File:** `{demo['file']}`")
        lines.append(f"- **Repo path:** `frontend/docs/media/{demo['file']}`")
        lines.append(f"- **URL:** `/docs/media/{demo['file']}?v={V}`")
        lines.append(f"- **Docs category:** `{demo['category']}`")
        lines.append(f"- **Loop:** {demo['description']}")
        lines.append("- **Frames:**")
        for caption, _kind, _extra in demo["frames"]:
            lines.append(f"  - {caption}")
        lines.append("")
    path = OUT / "GIF-CATALOG.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {path}")


def main():
    for demo in DEMOS:
        render_demo(demo)
    write_catalog()
    print(f"done — {len(DEMOS)} GIFs")


if __name__ == "__main__":
    main()
