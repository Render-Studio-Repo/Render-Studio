"""AI-assisted 2D sketch generation for the Sketch editor."""

from __future__ import annotations

import json
import math
from typing import Any

from backend.services.ai_service import AIService

SKETCH_SYSTEM_PROMPT = """You are Render3D's 2D sketch engine (Fusion 360 style).

Given a user brief (and optional reference photo), produce sketch entities on a work plane
that form a closed profile suitable for extrusion.

Reply with ONE JSON object only — no markdown, no prose outside JSON.

Schema:
{
  "name": "Mounting plate",
  "plane": "XY",
  "entities": [
    { "id": "e1", "type": "line", "data": { "a": { "u": 0, "v": 0 }, "b": { "u": 40, "v": 0 } } },
    { "id": "e2", "type": "line", "data": { "a": { "u": 40, "v": 0 }, "b": { "u": 40, "v": 30 } } },
    { "id": "e3", "type": "rect", "data": { "corners": [
      { "u": 0, "v": 0 }, { "u": 40, "v": 0 }, { "u": 40, "v": 30 }, { "u": 0, "v": 30 }
    ] } },
    { "id": "e4", "type": "circle", "data": { "c": { "u": 20, "v": 15 }, "r": 5 } }
  ],
  "constraints": [
    { "id": "c1", "type": "horizontal", "entityId": "e1" },
    { "id": "c2", "type": "dimension", "entityId": "e1", "value": 40 }
  ],
  "notes": ["tip for the user"]
}

Entity types: line, rect, circle, arc, point, spline.
- Coordinates u,v are millimeters on the sketch plane (origin at world center).
- plane is one of: XY, XZ, YZ.
- Prefer rect for rectangles, circle for holes, connected lines for custom outlines.
- Endpoints of line chains must meet to form a closed loop when extruding a profile.
- Include useful constraints: horizontal, vertical, dimension (mm), angle (degrees between two lines).
- Angle constraint: { "type": "angle", "a": "<lineId>", "b": "<lineId>", "value": 90 }
- Dimension on lines sets length in mm; on circles sets radius in mm.
- If editing an existing sketch, preserve entity ids when possible.
- Keep sketches practical for CAD — typical sizes 5–200 mm unless specified.
"""


def _normalize_point(raw: Any) -> dict[str, float]:
    if isinstance(raw, dict):
        return {"u": float(raw.get("u", 0)), "v": float(raw.get("v", 0))}
    if isinstance(raw, (list, tuple)) and len(raw) >= 2:
        return {"u": float(raw[0]), "v": float(raw[1])}
    return {"u": 0.0, "v": 0.0}


def _normalize_entity(raw: dict[str, Any], idx: int) -> dict[str, Any] | None:
    etype = raw.get("type")
    data = raw.get("data") or {}
    if etype == "line":
        return {
            "id": raw.get("id") or f"e{idx}",
            "type": "line",
            "data": {"a": _normalize_point(data.get("a")), "b": _normalize_point(data.get("b"))},
        }
    if etype == "rect":
        corners = [_normalize_point(c) for c in (data.get("corners") or [])]
        if len(corners) < 3:
            return None
        return {"id": raw.get("id") or f"e{idx}", "type": "rect", "data": {"corners": corners}}
    if etype == "circle":
        r = float(data.get("r") or 1)
        if r <= 0:
            return None
        return {
            "id": raw.get("id") or f"e{idx}",
            "type": "circle",
            "data": {"c": _normalize_point(data.get("c")), "r": r},
        }
    if etype == "point":
        return {"id": raw.get("id") or f"e{idx}", "type": "point", "data": {"p": _normalize_point(data.get("p"))}}
    if etype == "arc":
        pts = [_normalize_point(p) for p in (data.get("points") or [])]
        if len(pts) < 2:
            return None
        return {"id": raw.get("id") or f"e{idx}", "type": "arc", "data": {"points": pts}}
    if etype == "spline":
        pts = [_normalize_point(p) for p in (data.get("points") or [])]
        if len(pts) < 2:
            return None
        return {"id": raw.get("id") or f"e{idx}", "type": "spline", "data": {"points": pts}}
    return None


def _profile_from_entities(entities: list[dict[str, Any]]) -> list[list[float]] | None:
    for ent in entities:
        if ent["type"] == "rect":
            return [[p["u"], p["v"]] for p in ent["data"]["corners"]]
    for ent in entities:
        if ent["type"] == "circle":
            c = ent["data"]["c"]
            r = ent["data"]["r"]
            return [
                [c["u"] + math.cos(t) * r, c["v"] + math.sin(t) * r]
                for t in [i / 32 * 2 * math.pi for i in range(32)]
            ]
    lines = [e for e in entities if e["type"] == "line"]
    if len(lines) >= 3:
        tol = 0.05

        def eq(a: dict[str, float], b: dict[str, float]) -> bool:
            return abs(a["u"] - b["u"]) <= tol and abs(a["v"] - b["v"]) <= tol

        unused = {ln["id"] for ln in lines}
        current = lines[0]
        unused.discard(current["id"])
        start = dict(current["data"]["a"])
        end = dict(current["data"]["b"])
        ordered = [[start["u"], start["v"]], [end["u"], end["v"]]]
        while unused:
            nxt = None
            flip = False
            for lid in list(unused):
                ln = next(x for x in lines if x["id"] == lid)
                if eq(ln["data"]["a"], end):
                    nxt, flip = ln, False
                    break
                if eq(ln["data"]["b"], end):
                    nxt, flip = ln, True
                    break
            if not nxt:
                break
            unused.discard(nxt["id"])
            end = dict(nxt["data"]["a"] if flip else nxt["data"]["b"])
            if not eq(end, start):
                ordered.append([end["u"], end["v"]])
        if len(ordered) >= 4 and eq({"u": ordered[0][0], "v": ordered[0][1]}, {"u": ordered[-1][0], "v": ordered[-1][1]}):
            ordered.pop()
            return ordered
    return None


def _normalize_plane_ref(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    origin = raw.get("origin")
    if not isinstance(origin, (list, tuple)) or len(origin) < 3:
        return None
    try:
        o = [float(origin[0]), float(origin[1]), float(origin[2])]
        u = [float(x) for x in (raw.get("u_axis") or [1, 0, 0])[:3]]
        v = [float(x) for x in (raw.get("v_axis") or [0, 1, 0])[:3]]
        n = [float(x) for x in (raw.get("normal") or [0, 0, 1])[:3]]
    except (TypeError, ValueError):
        return None
    face = raw.get("face") if isinstance(raw.get("face"), dict) else None
    return {
        "kind": raw.get("kind") or "face",
        "label": raw.get("label") or "Face",
        "origin": o,
        "u_axis": u,
        "v_axis": v,
        "normal": n,
        "face": face,
    }


def _normalize_sketch(raw: dict[str, Any]) -> dict[str, Any]:
    plane_ref = _normalize_plane_ref(raw.get("plane_ref"))
    if plane_ref:
        plane = "Face"
    else:
        plane = raw.get("plane") or "XY"
        if plane not in ("XY", "XZ", "YZ", "Face"):
            plane = "XY"
        if plane == "Face":
            plane = "XY"
    entities = []
    for i, ent in enumerate(raw.get("entities") or []):
        if isinstance(ent, dict):
            norm = _normalize_entity(ent, i + 1)
            if norm:
                entities.append(norm)
    constraints = []
    for i, c in enumerate(raw.get("constraints") or []):
        if not isinstance(c, dict) or not c.get("type"):
            continue
        constraints.append({**c, "id": c.get("id") or f"c{i + 1}"})
    profile = raw.get("profile")
    if not profile:
        profile = _profile_from_entities(entities)
    return {
        "name": raw.get("name") or "Sketch",
        "plane": plane,
        "plane_ref": plane_ref,
        "entities": entities,
        "constraints": constraints,
        "profile": profile or [],
        "notes": raw.get("notes") if isinstance(raw.get("notes"), list) else [],
    }


def generate_sketch(
    ai: AIService,
    prompt: str,
    *,
    current: dict[str, Any] | None = None,
    images: list[dict[str, Any]] | None = None,
    trace_id: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any], str]:
    """Return (sketch_data, ai_trace, assistant_message)."""
    parts = [prompt.strip()]
    if current and (current.get("entities") or current.get("profile")):
        slim = {
            "name": current.get("name"),
            "plane": current.get("plane"),
            "entities": current.get("entities"),
            "constraints": current.get("constraints"),
        }
        parts.append(f"\nCurrent sketch JSON:\n{json.dumps(slim, indent=2)}")
    user_text = "\n".join(parts)
    raw, ai_trace = ai.chat_json(
        SKETCH_SYSTEM_PROMPT,
        user_text,
        images=images or [],
        trace_id=trace_id,
    )
    sketch = _normalize_sketch(raw if isinstance(raw, dict) else {})
    if not sketch["entities"]:
        raise ValueError("AI returned no sketch entities")
    msg = sketch.get("notes", [""])[0] if sketch.get("notes") else f"Generated sketch “{sketch['name']}” with {len(sketch['entities'])} entities."
    return sketch, ai_trace, msg
