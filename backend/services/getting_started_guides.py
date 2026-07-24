"""Getting Started guides + GIF matching for Render Agent answers."""

from __future__ import annotations

from pathlib import Path
from typing import Any

FRONTEND_MEDIA = Path(__file__).resolve().parents[2] / "frontend" / "docs" / "media"
GIF_CACHE = "v=20260724-unique"

GETTING_STARTED_GUIDES: list[dict[str, Any]] = [
    {
        "id": "ai-generate",
        "category": "ai-cad",
        "title": "Generate CAD with AI",
        "summary": "Describe a part; Generate builds geometry into the open project.",
        "ask": "How do I write a strong first CAD generate prompt?",
        "steps": ["Open or create a project in the left explorer.", "Write size, units, and what the part does.", "Optional: attach images, DXF, or @component refs.", "Pick Render / 2.0 / Fusion and click Generate.", "Revise with follow-ups instead of restarting."],
        "keywords": ["generate", "prompt", "ai generate", "render mode", "2.0", "fusion"],
        "gif": f"/docs/media/ai-generate.gif?{GIF_CACHE}",
    },
    {
        "id": "multi-gen",
        "category": "ai-cad",
        "title": "Parallel generations",
        "summary": "Run up to five CAD prompts at once; stop one or all from the viewport banner.",
        "ask": "How do parallel CAD generations and Stop work?",
        "steps": ["Start a Generate while another is still running.", "Watch skinny progress rows in the viewport banner.", "Use View more for details; Stop opens a picker when several run."],
        "keywords": ["parallel", "multi gen", "stop generating", "multiple prompts"],
        "gif": f"/docs/media/ai-generate.gif?{GIF_CACHE}",
    },
    {
        "id": "picks",
        "category": "ai-cad",
        "title": "Pick faces, edges & paths",
        "summary": "Click geometry into the prompt as @face / @edge / @path chips.",
        "ask": "How do geometry picks and @face references work?",
        "steps": ["Choose Face, Edge, Line/path, or related pick mode.", "Click the model \u2014 a chip appears in the prompt.", "Write the edit, e.g. \u201cfillet @face-1 2 mm\u201d, then Generate."],
        "keywords": ["@face", "@edge", "@path", "pick", "geometry", "robot arm"],
        "gif": f"/docs/media/picks.gif?{GIF_CACHE}",
    },
    {
        "id": "link-to-prompt",
        "category": "ai-cad",
        "title": "Link project items to the prompt",
        "summary": "Shift-select files in the Project browser and drag them into the AI prompt as @component references.",
        "ask": "How do I link project files and geometry into the AI prompt with @component and picks?",
        "steps": ["In the Project browser, click one file, then Shift-click another to select a range.", "Drag the selection into the AI prompt box \u2014 reference chips appear.", "Combine with @face / @edge / @path picks for precise edits."],
        "keywords": ["link to prompt", "drag to prompt", "@component", "project browser", "shift select", "attach files", "reference chips"],
        "gif": f"/docs/media/picks.gif?{GIF_CACHE}",
    },
    {
        "id": "workspaces",
        "category": "projects",
        "title": "Workspaces & teammates",
        "summary": "Shared workspaces keep projects, folders, and invites together.",
        "ask": "How do workspaces and invites work?",
        "steps": ["Create or switch a workspace from the account menu.", "Invite coworkers by email.", "Projects sync live for members who are online."],
        "keywords": ["workspace", "invite", "team", "collaboration"],
        "gif": f"/docs/media/workspaces.gif?{GIF_CACHE}",
    },
    {
        "id": "share-folders",
        "category": "projects",
        "title": "Share a private folder",
        "summary": "Folders stay private until you share them with specific teammates.",
        "ask": "How do I share a private folder?",
        "steps": ["Right-click a folder \u2192 Share.", "Pick a teammate from the dropdown.", "Keep Private checked so only sharees see it."],
        "keywords": ["share folder", "private folder"],
        "gif": f"/docs/media/share-folder.gif?{GIF_CACHE}",
    },
    {
        "id": "reference-markup",
        "category": "projects",
        "title": "Reference files, pen markup & Send to AI",
        "summary": "Open PDFs/images in tabs, mark them up, and push callouts into the CAD prompt.",
        "ask": "How do reference markup and Send to AI work?",
        "steps": ["Drop a PDF or image into the project.", "Open the Docs-style tab and use Pen + notes.", "Save, then Send to AI."],
        "keywords": ["reference", "markup", "pdf", "send to ai"],
        "gif": f"/docs/media/reference-markup.gif?{GIF_CACHE}",
    },
    {
        "id": "solid-tools",
        "category": "modeling",
        "title": "Solid modeling tools",
        "summary": "Ribbon Create/Modify/Pattern plus direct tools: Press-Pull, fillet, transform, color, measure.",
        "ask": "What solid modeling tools are available?",
        "steps": ["Switch to the SOLID design tab.", "Use Ribbon Create for primitives and features.", "Use Tools for Press-Pull, Transform (G), Color, Measure, Split."],
        "keywords": ["solid", "press-pull", "fillet", "extrude", "transform", "gizmo"],
        "gif": f"/docs/media/select-object.gif?{GIF_CACHE}",
    },
    {
        "id": "select-object",
        "category": "modeling",
        "title": "Select object & body",
        "summary": "Click once to select the whole robot arm; double-click a link to select only that body/part.",
        "ask": "How do I select a whole object vs one body/part with click and double-click?",
        "steps": [
            "Open Select in the Pick toolbar (or press V).",
            "Single-click the model to select the whole component (blue highlight).",
            "Double-click a specific link/part to drill into that body (amber highlight).",
            "Drag to move the selection; Cmd/Ctrl+Z undoes.",
        ],
        "keywords": ["select object", "select body", "double click", "part select", "object pick", "robot arm", "body"],
        "gif": f"/docs/media/select-object.gif?{GIF_CACHE}",
    },
    {
        "id": "sketch",
        "category": "sketch-canvas",
        "title": "Constrained Sketch",
        "summary": "2D sketch on a plane with constraints, then extrude to solid.",
        "ask": "How do I create and extrude a constrained sketch?",
        "steps": ["Open SKETCH and create a sketch on XY/XZ/YZ or a face.", "Draw with Line/Rect/Circle and add constraints.", "Finish Sketch, then Extrude (new/add/cut)."],
        "keywords": ["sketch", "constraint", "extrude sketch"],
        "gif": f"/docs/media/canvas.gif?{GIF_CACHE}",
    },
    {
        "id": "canvas",
        "category": "sketch-canvas",
        "title": "Canvas sketch mode",
        "summary": "Freehand concept pad \u2014 attach the sketch to AI Compose.",
        "ask": "How do I use Canvas and attach a sketch to AI?",
        "steps": ["Switch to CANVAS.", "Draw with pen/shapes.", "Attach / Prompt to send into AI Compose, then Generate."],
        "keywords": ["canvas", "attach sketch"],
        "gif": f"/docs/media/canvas.gif?{GIF_CACHE}",
    },
    {
        "id": "rigging-urdf",
        "category": "rigging",
        "title": "URDF / SRDF & Motion",
        "summary": "GLB shows shape; URDF/SRDF drive simulation. Author Jake gen_urdf()/gen_srdf(), then open Motion.",
        "ask": "How do I generate URDF/SRDF and open Motion?",
        "steps": ["In Rigging, switch to URDF / SRDF mode.", "Select the CAD Python source.", "Author with AI (Jake) or Generate URDF/SRDF.", "Inspect the link/joint tree, then Open URDF / SRDF Motion."],
        "keywords": ["urdf", "srdf", "motion", "jake", "gen_urdf", "simulated motion"],
        "gif": f"/docs/media/ai-generate.gif?{GIF_CACHE}",
    },
    {
        "id": "wiring",
        "category": "wiring",
        "title": "Wiring Simulator",
        "summary": "Breadboard circuits from AI, wire pin-to-pin, validate drivers, code & simulate.",
        "ask": "How do I use the Wiring Simulator?",
        "steps": ["Switch to Wiring mode.", "Drag a 3D part into the wiring prompt or board.", "Describe the circuit and Generate.", "Wire pins; open Code & Simulate when ready."],
        "keywords": ["wiring", "breadboard", "circuit", "gpio"],
        "gif": f"/docs/media/wiring.gif?{GIF_CACHE}",
    },
    {
        "id": "cloud-sync",
        "category": "cloud",
        "title": "Fusion 360 & Onshape sync",
        "summary": "Connect cloud libraries to import and push without leaving Studio.",
        "ask": "How do I connect Fusion or Onshape?",
        "steps": ["Connect Fusion or Onshape from Account \u2192 Cloud.", "Browse the left library panel and import into a project.", "Push local changes back when needed."],
        "keywords": ["fusion", "onshape", "cloud"],
        "gif": f"/docs/media/cloud-sync.gif?{GIF_CACHE}",
    },
    {
        "id": "render-agent",
        "category": "help",
        "title": "Render Agent help chat",
        "summary": "Product help (not CAD Generate) \u2014 tools, Fusion, workflows, with demo GIFs.",
        "ask": "What can Render Agent help with?",
        "steps": ["Click Agent in the ribbon (or Ask Agent on Getting Started).", "Ask about tools, folders, Fusion, wiring, prompts.", "Attach screenshots when helpful."],
        "keywords": ["render agent", "ask agent", "help"],
        "gif": f"/docs/media/render-agent.gif?{GIF_CACHE}",
    },
    {
        "id": "preferences",
        "category": "help",
        "title": "Preferences, theme & mouse",
        "summary": "Avatar, mouse presets, dark/light theme, and simulated-motion after generate.",
        "ask": "Where do I change Preferences and simulated-motion defaults?",
        "steps": ["Open Preferences from the account menu.", "Set mouse controls and appearance.", "Choose Simulated motion: ask / always URDF\u00b7SRDF / never."],
        "keywords": ["preferences", "theme", "mouse", "simulated motion"],
        "gif": f"/docs/media/render-agent.gif?{GIF_CACHE}",
    },
    {
        "id": "tips-tricks",
        "category": "help",
        "title": "Tips and tricks",
        "summary": "Shift-select files, drag refs into the prompt, keep prompts focused, share context.",
        "ask": "Give me practical Render3D tips and tricks.",
        "steps": ["Shift-click in the Project browser to select a file range.", "Drag files into the AI prompt as references.", "Prefer @face/@edge/@path chips over vague locations.", "Generate the main object first, then revise selected results."],
        "keywords": ["tips", "tricks", "shift select", "best practices"],
        "gif": f"/docs/media/ai-generate.gif?{GIF_CACHE}",
    },
]

def match_guides(question: str, *, limit: int = 2) -> list[dict[str, Any]]:
    text = (question or "").lower().strip()
    if not text:
        return []
    for src, dst in (("wirign", "wiring"), ("wireing", "wiring"), ("schemtic", "schematic"), ("bredboard", "breadboard")):
        text = text.replace(src, dst)
    scored: list[tuple[float, dict[str, Any]]] = []
    for guide in GETTING_STARTED_GUIDES:
        score = 0.0
        title = str(guide.get("title") or "").lower()
        gid = str(guide.get("id") or "").replace("-", " ")
        if title and title in text:
            score += 8.0
        if gid and gid in text:
            score += 4.0
        for kw in guide.get("keywords") or []:
            k = str(kw).lower().strip()
            if k and k in text:
                score += 3.0 if " " in k else 2.0
        if score >= 2.5:
            scored.append((score, guide))
    scored.sort(key=lambda row: (-row[0], str(row[1].get("title") or "")))
    return [g for _, g in scored[:limit]]


def media_for_guides(guides: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for guide in guides or []:
        gif = guide.get("gif")
        if not gif:
            continue
        out.append({
            "id": guide.get("id"),
            "title": guide.get("title"),
            "url": gif,
            "kind": "gif",
            "summary": guide.get("summary") or "",
        })
    return out


def guide_context_block(guides: list[dict[str, Any]]) -> str:
    if not guides:
        return ""
    parts: list[str] = []
    for g in guides:
        steps = g.get("steps") or []
        step_txt = "\n".join(f"  - {s}" for s in steps)
        parts.append(f"### {g.get('title')}\n{g.get('summary')}\nSteps:\n{step_txt}")
    return "\n\n".join(parts)
