"""Getting Started guides + GIF matching for Render Agent answers."""

from __future__ import annotations

from pathlib import Path
from typing import Any

FRONTEND_MEDIA = Path(__file__).resolve().parents[2] / "frontend" / "docs" / "media"
GIF_CACHE = "v=20260715-real"

GETTING_STARTED_GUIDES: list[dict[str, Any]] = [
    {
        "id": "ai-generate",
        "title": "Generate CAD with AI",
        "gif": f"/docs/media/ai-generate.gif?{GIF_CACHE}",
        "summary": "Describe a part in the prompt panel and Generate creates geometry in your project.",
        "ask": "How do I write a strong first CAD generate prompt in Render3D, and when should I use Render vs 2.0 vs Fusion mode?",
        "steps": [
            "Open a project (or create one) in the left explorer.",
            "Write a clear prompt: size, units, and what the part does.",
            "Optional: attach images, DXF, or @component references.",
            "Choose a mode (Render / 2.0 / Fusion) and click Generate.",
            "Revise with follow-ups instead of restarting from scratch.",
        ],
        "keywords": [
            "generate", "prompt", "cad generate", "ai generate", "first prompt",
            "render mode", "2.0", "fusion mode", "modify with ai", "quality", "speed",
            "phone stand", "make an",
        ],
    },
    {
        "id": "workspaces",
        "title": "Workspaces & teammates",
        "gif": f"/docs/media/workspaces.gif?{GIF_CACHE}",
        "summary": "Shared workspaces keep projects, folders, and invites in one place for your team.",
        "ask": "How do workspaces, invites, and live collaboration work in Render3D?",
        "steps": [
            "Open the account / workspace menu and pick or create a workspace.",
            "Invite coworkers by email — they need an account (or get an invite).",
            "Projects in that workspace sync live for members who are online.",
            "Switch workspaces anytime from the same menu.",
        ],
        "keywords": [
            "workspace", "workspaces", "teammate", "invite", "collaboration", "team",
            "shared workspace", "coworkers",
        ],
    },
    {
        "id": "share-folders",
        "title": "Share a private folder",
        "gif": f"/docs/media/share-folder.gif?{GIF_CACHE}",
        "summary": "Keep folders private, then share with specific teammates so they appear instantly in their explorer.",
        "ask": "How do I share a private folder with a teammate, and what do they see on their side?",
        "steps": [
            "Right-click a folder → Share.",
            "Pick a team member from the dropdown (no need to retype their email).",
            "Leave Private checked so only people you share with can see it.",
            "They see the folder live — no refresh required.",
        ],
        "keywords": [
            "share folder", "private folder", "folder share", "share with", "explorer folder",
            "share a private",
        ],
    },
    {
        "id": "reference-markup",
        "title": "Reference files, pen markup & Send to AI",
        "gif": f"/docs/media/reference-markup.gif?{GIF_CACHE}",
        "summary": "Drop PDFs or images into a project, draw on them, add notes, then send markups into the AI prompt.",
        "ask": "How do reference file tabs, pen markup on PDFs/images, notes, and Send to AI work together?",
        "steps": [
            "Drag a PDF or image into the project (or upload under Reference Files).",
            "It opens in a Docs-style tab beside the 3D viewport.",
            "Click Pen to draw callouts; write notes in the right panel.",
            "Click Save, then Send to AI — marked image + notes go into the prompt.",
            "Or use the AI button on the file in the project browser.",
        ],
        "keywords": [
            "reference", "markup", "pen", "pdf", "send to ai", "annotate", "drawing on",
            "reference file", "notes",
        ],
    },
    {
        "id": "canvas",
        "title": "Canvas sketch mode",
        "gif": f"/docs/media/canvas.gif?{GIF_CACHE}",
        "summary": "Sketch freely on the Canvas design tab, then attach the sketch to your AI prompt.",
        "ask": "How do I use Canvas mode and attach a sketch to the AI CAD prompt?",
        "steps": [
            "In Design, switch to the CANVAS tab.",
            "Draw your concept with the canvas tools.",
            "Use Attach / Prompt to drop the sketch into the AI compose panel.",
            "Generate a 3D model that follows the sketch.",
        ],
        "keywords": ["canvas", "sketch", "canvas mode", "attach sketch", "design tab canvas"],
    },
    {
        "id": "picks",
        "title": "Pick faces, edges & paths",
        "gif": f"/docs/media/picks.gif?{GIF_CACHE}",
        "summary": "Click geometry into the prompt as @face / @edge / @path so edits land on the right feature.",
        "ask": "How do geometry picks and @face / @path references work in the AI prompt?",
        "steps": [
            "Select a pick mode (face, edge, line path, etc.) in the toolbar.",
            "Click the geometry on the model.",
            "A chip like @face-1 appears in the prompt.",
            "Write the edit: fillet @face-1 2 mm and Generate.",
        ],
        "keywords": ["@face", "@edge", "@path", "pick", "geometry pick", "face pick", "edge pick", "fillet"],
    },
    {
        "id": "wiring",
        "title": "Wiring Simulator",
        "gif": f"/docs/media/wiring.gif?{GIF_CACHE}",
        "summary": "Switch to Wiring mode to breadboard circuits, drag parts, and validate drivers.",
        "ask": "How do I use the Wiring Simulator, including AI generate and validation?",
        "steps": [
            "Change workspace mode to Wiring Simulator.",
            "Drag components onto the board or use Wiring AI to generate a circuit.",
            "Wire pin-to-pin; run validation for motors/drivers.",
            "Optional: attach a breadboard photo for matching.",
        ],
        "keywords": ["wiring", "circuit", "breadboard", "wiring simulator", "gpio", "schematic", "arduino"],
    },
    {
        "id": "cloud-sync",
        "title": "Fusion 360 & Onshape sync",
        "gif": f"/docs/media/cloud-sync.gif?{GIF_CACHE}",
        "summary": "Connect cloud CAD libraries so you can import and push models without leaving Studio.",
        "ask": "How do I connect Fusion 360 or Onshape and import or push models in Render3D?",
        "steps": [
            "Open the Fusion or Onshape library panel in the left sidebar.",
            "Sign in / connect when prompted.",
            "Browse, import into a project, or push local changes back.",
            "Use Fusion prompt mode when you want Fusion-oriented generation.",
        ],
        "keywords": ["fusion", "onshape", "cloud sync", "import fusion", "push to fusion", "autodesk"],
    },
    {
        "id": "render-agent",
        "title": "Render Agent help chat",
        "gif": f"/docs/media/render-agent.gif?{GIF_CACHE}",
        "summary": "The ribbon Agent button opens a chat for tooling, workflows, and project questions — separate from CAD Generate.",
        "ask": "What can Render Agent help with, and how is it different from the CAD Generate prompt?",
        "steps": [
            "Click Agent in the ribbon (or use Ask Render Agent from Getting Started).",
            "Ask about tools, folders, Fusion, wiring, prompts, etc.",
            "Attach screenshots or files when helpful.",
            "Invite teammates into a thread for shared troubleshooting.",
        ],
        "keywords": ["render agent", "help chat", "ask agent", "assistant", "agent button"],
    },
]

TOUR_HINTS = (
    "tour",
    "getting started",
    "new user",
    "how do i start",
    "onboarding",
    "for a new user",
)


def _gif_exists(gif_url: str) -> bool:
    name = Path(str(gif_url or "").split("?", 1)[0]).name
    if not name or ".." in name:
        return False
    return (FRONTEND_MEDIA / name).is_file()


def match_guides(question: str, *, limit: int = 2) -> list[dict[str, Any]]:
    text = str(question or "").lower().strip()
    if not text:
        return []

    # Exact / near-exact Getting Started "Ask about this" prompts
    for guide in GETTING_STARTED_GUIDES:
        ask = str(guide.get("ask") or "").lower().strip()
        if not ask:
            continue
        if text == ask:
            return [guide]
        if len(text) > 28 and len(ask) > 28 and (ask[:56] in text or text[:56] in ask):
            return [guide]

    scored: list[tuple[float, dict[str, Any]]] = []
    tour = any(hint in text for hint in TOUR_HINTS)
    for guide in GETTING_STARTED_GUIDES:
        score = 0.0
        title = str(guide.get("title") or "").lower()
        if title and title in text:
            score += 8
        gid = str(guide.get("id") or "").replace("-", " ")
        if gid and gid in text:
            score += 4
        for raw in guide.get("keywords") or []:
            kw = str(raw or "").lower().strip()
            if not kw:
                continue
            if kw in text:
                score += 3.0 if " " in kw else 2.0
        for step in guide.get("steps") or []:
            for word in [w for w in str(step).lower().split() if len(w) > 5][:6]:
                if word in text:
                    score += 0.35
        if tour and guide.get("id") in {"ai-generate", "workspaces", "share-folders", "render-agent"}:
            score += 3.0
        if score >= 2.5:
            scored.append((score, guide))
    scored.sort(key=lambda row: (-row[0], str(row[1].get("title") or "")))
    return [guide for _, guide in scored[:limit]]


def media_for_guides(guides: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for guide in guides:
        gif = str(guide.get("gif") or "")
        if not gif or not _gif_exists(gif):
            continue
        out.append(
            {
                "id": guide.get("id"),
                "title": guide.get("title"),
                "url": gif,
                "kind": "gif",
                "summary": guide.get("summary") or "",
            }
        )
    return out


def guide_context_block(guides: list[dict[str, Any]]) -> str:
    if not guides:
        return ""
    chunks: list[str] = []
    for guide in guides:
        steps = "\n".join(f"- {step}" for step in (guide.get("steps") or [])[:6])
        gif = guide.get("gif") if _gif_exists(str(guide.get("gif") or "")) else None
        chunks.append(
            f"Guide: {guide.get('title')}\n"
            f"Summary: {guide.get('summary')}\n"
            f"Steps:\n{steps}\n"
            f"Demo GIF URL (already shown to the user when available): {gif or 'none'}"
        )
    return (
        "Matched Getting Started documentation. Use these official steps. "
        "If a demo GIF URL is present, briefly tell the user the looping demo is attached "
        "and walk them through the same steps — do not invent alternate UI paths.\n\n"
        + "\n\n".join(chunks)
    )
