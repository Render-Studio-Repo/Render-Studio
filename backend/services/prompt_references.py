"""Classify prompt images so CAD Improve / generation treat canvas vs photos correctly."""

from __future__ import annotations

import re
import json
from typing import Any
from backend.services.drawing_context import CANVAS_EDIT_RULES, sanitize_drawing_metadata

_CANVAS_NAME_RE = re.compile(
    r"canvas[-_\s]?sketch|canvas[-_\s]?draw|whiteboard|layout[-_\s]?sketch|(?:^|[/\\])Canvas[/\\]|^Canvas(?:[ -]|$)",
    re.I,
)
_VIEWPORT_NAME_RE = re.compile(r"viewport[-_]?capture", re.I)
_LAYOUT_PROMPT_RE = re.compile(
    r"\b(hang(?:ing)?\s+off|off\s+the\s+side|beside|cantilever|offset\s+(?:from|to)|"
    r"next\s+to|alongside|overhang|side\s+mount)\b",
    re.I,
)


def image_name(img: Any) -> str:
    if isinstance(img, dict):
        return str(img.get("name") or img.get("id") or img.get("source_filename") or "image")
    return str(getattr(img, "name", None) or getattr(img, "id", None) or "image")


def image_role(name: str) -> str:
    """layout_sketch | viewport | photo"""
    n = str(name or "")
    if _CANVAS_NAME_RE.search(n):
        return "layout_sketch"
    if _VIEWPORT_NAME_RE.search(n):
        return "viewport"
    return "photo"


def prompt_image_role(img: Any) -> str:
    row = img if isinstance(img, dict) else (img.model_dump() if hasattr(img, "model_dump") else {})
    if row.get("role") == "canvas" or (row.get("drawing_metadata") or {}).get("kind") == "canvas":
        return "layout_sketch"
    for name in (row.get("source_filename"), row.get("url"), image_name(img)):
        role = image_role(name or "")
        if role != "photo":
            return role
    return "photo"


def has_layout_sketch(images: list[Any] | None) -> bool:
    return bool(classify_prompt_images(images)["layout_sketch"])


def classify_prompt_images(images: list[Any] | None) -> dict[str, list[str]]:
    sketches: list[str] = []
    photos: list[str] = []
    viewports: list[str] = []
    for img in images or []:
        name = image_name(img)
        role = prompt_image_role(img)
        if role == "layout_sketch":
            sketches.append(name)
        elif role == "viewport":
            viewports.append(name)
        else:
            photos.append(name)
    return {"layout_sketch": sketches, "photo": photos, "viewport": viewports}


def image_caption(image: Any) -> str:
    name = image if isinstance(image, str) else image_name(image)
    role = image_role(name) if isinstance(image, str) else prompt_image_role(image)
    row = image if isinstance(image, dict) else {}
    metadata = sanitize_drawing_metadata(row.get("drawing_metadata"))
    if role == "layout_sketch":
        return (
            f"[{name}] CANVAS / LAYOUT SKETCH — this drawing EXPLAINS the prompt. "
            "Read arrows, gaps, beside/hanging-off/offset. It is not a photo of the finished part. "
            "Place new geometry the way the sketch shows relative to other photos (often off to the side, "
            "not stacked on top of the mate target)."
        ) + "\n" + CANVAS_EDIT_RULES + ("\nCanvas drawing metadata:\n" + json.dumps(metadata, ensure_ascii=False) if metadata else "")
    if role == "viewport":
        return f"[{name}] Live viewport capture of the current 3D model (pose and silhouette source of truth)."
    return (
        f"[{name}] Reference PHOTO of an existing object, extrusion, hardware, or environment. "
        "If the prompt says mount / mate / hang off this, it is the TARGET to connect to — "
        "not the new part, and not an instruction to sit the new part on top of it unless the prompt says so."
    )


def cad_reference_improve_hint(images: list[Any] | None, prompt: str = "") -> str:
    """User-content block for CAD Improve when vision files are attached."""
    classified = classify_prompt_images(images)
    sketches = classified["layout_sketch"]
    photos = classified["photo"]
    names = [image_name(img) for img in (images or [])]
    layout_words = bool(_LAYOUT_PROMPT_RE.search(prompt or ""))
    lines = [
        "Attached reference files (read them TOGETHER with the user prompt — do not treat every image as the part to copy):",
    ]
    if names:
        lines.append("Files in order: " + ", ".join(names))
    if sketches:
        lines.append(CANVAS_EDIT_RULES)
        for img in images or []:
            row = img if isinstance(img, dict) else (img.model_dump() if hasattr(img, "model_dump") else {})
            metadata = sanitize_drawing_metadata(row.get("drawing_metadata"))
            if metadata:
                lines.append("Canvas metadata for " + image_name(img) + ": " + json.dumps(metadata, ensure_ascii=False))
        lines.append(
            "CANVAS / LAYOUT SKETCH ("
            + ", ".join(sketches)
            + "): a drawing that explains spatial intent — arrows, hanging off, beside, "
            "offset, which face mounts. Translate those relations into explicit CAD placement. "
            "Do not model the new part sitting on the mate target just because a photo shows that object."
        )
    if photos:
        lines.append(
            "PHOTO ("
            + ", ".join(photos)
            + "): existing hardware / extrusion / environment to mate against or take dimensions from. "
            "Honor callouts (e.g. 150 mm). The new printed part connects as the prompt + canvas show."
        )
    if layout_words or sketches:
        lines.append(
            "If the prompt or canvas shows hanging off / off the side / beside / cantilever, "
            "the improved_prompt MUST say that offset in plain CAD language (side-hanging mount, "
            "shaft clear of the rail, gusseted cantilever) so generation cannot collapse to "
            "“bracket sitting on top of the extrusion.”"
        )
    if not sketches and not layout_words:
        lines.append(
            "If an image is a product to reproduce, match its silhouette. If it is a mate target, "
            "keep that object and design the new part relative to it."
        )
    return "\n".join(lines) + "\n\n"


PHOTO_AND_DXF_INSTRUCTIONS = """Photos, canvas sketches, and drawings are authoritative when read WITH the prompt:
- canvas-sketch.png / line drawings: LAYOUT EXPLANATION (arrows, hanging-off, beside, offset). Not the finished part.
- Photos of extrusion, rail, frame, motor, or hardware: mate/mount TARGETS. Connect the new part as the prompt + canvas show.
- Product photos of the thing to make: match silhouette, proportions, hole patterns of THAT object.
- Do not sit a new motor/bracket on top of an extrusion photo unless the prompt and canvas say on-top.
- “Hanging off” / “off the side” / a sketched gap+arrow means a cantilever or side mount — shaft clear of the rail.
- PDF / technical-drawing pages are a dimensioned contract (cad-brief.md): extract views and callouts.
  Do not flatten a multi-view sheet into one extruded profile.
- DXF files listed below are in the worker cwd. Set dxf_filename to the listed name.
- Reconstruct 3D from layers and polylines. Whole-file import_dxf()+make_face()+extrude() only for an explicit flat plate.
- Do not invent a box that only resembles one photo while ignoring the canvas layout.
"""

DRAWING_PACKAGE_MIXED_REF_RULE = """
Mixed reference files (read WITH the user prompt):
- canvas-sketch / line drawings / whiteboards: LAYOUT EXPLANATION (arrows, hanging off, beside, offset).
  Not a photo of the finished part and not a 2D outline to extrude as the new solid.
- Photos of extrusion, rail, frame, motor, or hardware: mate/mount TARGETS. Honor callouts (e.g. 150 mm).
  Do not treat the extrusion photo as the part to copy, and do not sit the new motor on top of it
  unless the prompt and canvas say on-top.
- Product photos of the thing to make: those are the silhouettes for DXF outlines.
- If a canvas layout AND a mate-target photo are both attached, DRAWING_PROMPT must state the offset
  in CAD language (cantilever / side-hanging / shaft clear of the rail).
"""
