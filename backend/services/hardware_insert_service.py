"""Catalog hardware (screws, nuts, washers, bearings) as insertable CAD in a project.

Mirrors VibeCAD / Fusion McMaster insert: pick a standard part, land it in the
assembly as STL/GLB (and STEP when export works), and record it on the McMaster
library so Generate can mate to it instead of modeling fasteners from scratch.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import trimesh

from backend.services import cad_service

CATALOG: list[dict[str, Any]] = [
    {
        "id": "91251A194",
        "number": "91251A194",
        "title": "Socket Head Screw",
        "subtitle": "M5 × 16 mm",
        "kind": "bolt",
        "page_url": "https://www.mcmaster.com/91251A194/",
        "dims": {"radius": 2.5, "height": 16.0, "head_radius": 4.2, "head_height": 5.0},
    },
    {
        "id": "91251A102",
        "number": "91251A102",
        "title": "Socket Head Screw",
        "subtitle": "M3 × 12 mm",
        "kind": "bolt",
        "page_url": "https://www.mcmaster.com/91251A102/",
        "dims": {"radius": 1.5, "height": 12.0, "head_radius": 2.7, "head_height": 3.0},
    },
    {
        "id": "91251A268",
        "number": "91251A268",
        "title": "Socket Head Screw",
        "subtitle": "M6 × 20 mm",
        "kind": "bolt",
        "page_url": "https://www.mcmaster.com/91251A268/",
        "dims": {"radius": 3.0, "height": 20.0, "head_radius": 5.0, "head_height": 6.0},
    },
    {
        "id": "90592A015",
        "number": "90592A015",
        "title": "Hex Nut",
        "subtitle": "M5 × 0.8 mm",
        "kind": "nut",
        "page_url": "https://www.mcmaster.com/90592A015/",
        "dims": {"radius": 4.5, "height": 4.0, "bore": 2.5},
    },
    {
        "id": "90592A085",
        "number": "90592A085",
        "title": "Hex Nut",
        "subtitle": "M3",
        "kind": "nut",
        "page_url": "https://www.mcmaster.com/90592A085/",
        "dims": {"radius": 3.1, "height": 2.4, "bore": 1.5},
    },
    {
        "id": "92141A011",
        "number": "92141A011",
        "title": "Flat Washer",
        "subtitle": "For M5",
        "kind": "washer",
        "page_url": "https://www.mcmaster.com/92141A011/",
        "dims": {"outer": 5.0, "inner": 2.65, "height": 1.0},
    },
    {
        "id": "7804K55",
        "number": "7804K55",
        "title": "Ball Bearing",
        "subtitle": "608 · 8×22 mm",
        "kind": "bearing",
        "page_url": "https://www.mcmaster.com/7804K55/",
        "dims": {"outer": 11.0, "inner": 4.0, "height": 7.0},
    },
]


def list_catalog() -> list[dict[str, Any]]:
    return [
        {
            "id": row["id"],
            "number": row["number"],
            "title": row["title"],
            "subtitle": row["subtitle"],
            "kind": row["kind"],
            "page_url": row["page_url"],
        }
        for row in CATALOG
    ]


# Typeahead-only PNs (mcmtype1). Not insertable as procedural solids — Fetch STEP downloads CAD.
_SUGGEST_EXTRA: list[dict[str, Any]] = [
    {"number": "91251A100", "title": "Socket Head Screw", "subtitle": "M3 × 8 mm", "kind": "screw", "keywords": "metric m3 3mm screw"},
    {"number": "91251A106", "title": "Socket Head Screw", "subtitle": "M3 × 16 mm", "kind": "screw", "keywords": "metric m3 3mm screw"},
    {"number": "91251A146", "title": "Socket Head Screw", "subtitle": "M4 × 10 mm", "kind": "screw", "keywords": "metric m4 4mm 4 mm screw"},
    {"number": "91251A148", "title": "Socket Head Screw", "subtitle": "M4 × 12 mm", "kind": "screw", "keywords": "metric m4 4mm 4 mm screw"},
    {"number": "91251A152", "title": "Socket Head Screw", "subtitle": "M4 × 16 mm", "kind": "screw", "keywords": "metric m4 4mm 4 mm screw"},
    {"number": "91251A154", "title": "Socket Head Screw", "subtitle": "M4 × 20 mm", "kind": "screw", "keywords": "metric m4 4mm 4 mm screw"},
    {"number": "91251A196", "title": "Socket Head Screw", "subtitle": "M5 × 20 mm", "kind": "screw", "keywords": "metric m5 5mm screw"},
    {"number": "91251A270", "title": "Socket Head Screw", "subtitle": "M6 × 25 mm", "kind": "screw", "keywords": "metric m6 6mm screw"},
    {"number": "91292A126", "title": "Socket Head Screw", "subtitle": "#6-32 × 3/8 in", "kind": "screw", "keywords": "imperial #6 6-32 screw"},
    {"number": "91292A144", "title": "Socket Head Screw", "subtitle": "#8-32 × 1/2 in", "kind": "screw", "keywords": "imperial #8 8-32 screw"},
    {"number": "90592A013", "title": "Hex Nut", "subtitle": "M4", "kind": "nut", "keywords": "metric m4 4mm 4 mm hex nut"},
    {"number": "90592A031", "title": "Hex Nut", "subtitle": "M6", "kind": "nut", "keywords": "metric m6 6mm hex nut"},
    {"number": "92141A007", "title": "Flat Washer", "subtitle": "For M3", "kind": "washer", "keywords": "metric m3 washer"},
    {"number": "92141A009", "title": "Flat Washer", "subtitle": "For M4", "kind": "washer", "keywords": "metric m4 4mm 4 mm washer"},
    {"number": "92141A013", "title": "Flat Washer", "subtitle": "For M6", "kind": "washer", "keywords": "metric m6 washer"},
    {"number": "93475A250", "title": "Flat Washer", "subtitle": "#6 screw", "kind": "washer", "keywords": "imperial #6 washer"},
    {"number": "5972K91", "title": "Ball Bearing", "subtitle": "624 · 4×13 mm", "kind": "bearing", "keywords": "624 4mm bearing"},
    {"number": "6384K33", "title": "Ball Bearing", "subtitle": "625 · 5×16 mm", "kind": "bearing", "keywords": "625 5mm bearing"},
]

_SUGGEST_ALIAS = (("scrw", "screw"), ("skt", "socket"), ("shcs", "socket head"), ("wshr", "washer"))


def _normalize_suggest_query(raw: str) -> str:
    text = re.sub(r"[^a-z0-9#.\-x/ ]+", " ", str(raw or "").lower())
    for src, dst in _SUGGEST_ALIAS:
        text = re.sub(rf"\b{re.escape(src)}\b", dst, text)
    return re.sub(r"\s+", " ", text).strip()


def suggest_parts(query: str, *, limit: int = 8) -> list[dict[str, Any]]:
    """Prefix/fuzzy McMaster PN suggestions from the in-repo catalog (no HTML scrape)."""
    q = _normalize_suggest_query(query)
    if len(q) < 2:
        return []
    seen: set[str] = set()
    scored: list[dict[str, Any]] = []
    compact = q.replace(" ", "").upper()
    for row in [*CATALOG, *_SUGGEST_EXTRA]:
        pn = str(row.get("number") or "").upper()
        if not pn or pn in seen:
            continue
        seen.add(pn)
        blob = " ".join(
            str(row.get(k) or "")
            for k in ("number", "title", "subtitle", "kind", "keywords")
        ).lower()
        score = 0
        if compact and pn.startswith(compact) and len(compact) >= 3:
            score = 200 + len(compact)
        else:
            for tok in q.split():
                if tok and tok in blob:
                    score += 12 if len(tok) >= 3 else 6
            if re.search(r"\b4\b", q) and ("m4" in blob or "4 mm" in blob or "4mm" in blob):
                score += 10
        if score <= 0:
            continue
        scored.append(
            {
                "number": pn,
                "title": row.get("title") or "",
                "subtitle": row.get("subtitle") or "",
                "kind": row.get("kind") or "",
                "page_url": row.get("page_url") or f"https://www.mcmaster.com/{pn}/",
                "thumb_url": f"https://images.mcmaster.com/{pn}.png",
                "score": score,
            }
        )
    scored.sort(key=lambda item: (-int(item["score"]), str(item["number"])))
    return [{k: v for k, v in item.items() if k != "score"} for item in scored[: max(1, min(int(limit or 8), 16))]]


def get_catalog_part(part_id: str) -> dict[str, Any] | None:
    key = str(part_id or "").strip().upper()
    for row in CATALOG:
        if str(row["id"]).upper() == key or str(row["number"]).upper() == key:
            return row
    return None


def _union(parts: list[trimesh.Trimesh]) -> trimesh.Trimesh:
    if not parts:
        raise ValueError("No hardware solids")
    if len(parts) == 1:
        return cad_service.repair_mesh(parts[0])
    try:
        merged = trimesh.util.concatenate(parts)
    except Exception:
        merged = parts[0]
        for extra in parts[1:]:
            merged = merged.union(extra)
    return cad_service.repair_mesh(merged)


def _cylinder(radius: float, height: float, *, sections: int = 32, z0: float = 0.0) -> trimesh.Trimesh:
    mesh = trimesh.creation.cylinder(radius=float(radius), height=float(height), sections=sections)
    mesh.apply_translation([0, 0, float(z0) + float(height) / 2.0])
    return mesh


def _annulus(outer: float, inner: float, height: float, *, sections: int = 36) -> trimesh.Trimesh:
    outer_m = _cylinder(outer, height, sections=sections)
    if inner <= 0:
        return outer_m
    bore = _cylinder(inner, height + 0.4, sections=max(16, sections // 2), z0=-0.2)
    try:
        return cad_service.repair_mesh(outer_m.difference(bore))
    except Exception:
        return cad_service.repair_mesh(outer_m)


def mesh_for_part(part: dict[str, Any]) -> trimesh.Trimesh:
    kind = str(part.get("kind") or "bolt").lower()
    d = part.get("dims") or {}
    if kind == "bolt":
        shank = _cylinder(float(d.get("radius") or 2.5), float(d.get("height") or 16.0))
        head = _cylinder(
            float(d.get("head_radius") or 4.2),
            float(d.get("head_height") or 5.0),
            z0=float(d.get("height") or 16.0),
        )
        return _union([shank, head])
    if kind == "nut":
        hex_nut = trimesh.creation.cylinder(
            radius=float(d.get("radius") or 4.5),
            height=float(d.get("height") or 4.0),
            sections=6,
        )
        hex_nut.apply_translation([0, 0, float(d.get("height") or 4.0) / 2.0])
        bore = _cylinder(float(d.get("bore") or 2.5), float(d.get("height") or 4.0) + 0.4, sections=24, z0=-0.2)
        try:
            return cad_service.repair_mesh(hex_nut.difference(bore))
        except Exception:
            return cad_service.repair_mesh(hex_nut)
    if kind == "washer":
        return _annulus(float(d.get("outer") or 5.0), float(d.get("inner") or 2.65), float(d.get("height") or 1.0))
    if kind == "bearing":
        return _annulus(float(d.get("outer") or 11.0), float(d.get("inner") or 4.0), float(d.get("height") or 7.0))
    return _cylinder(3.0, 10.0)


def _unique_stem(project_path: Path, stem: str) -> str:
    safe = cad_service.safe_stem(stem) if hasattr(cad_service, "safe_stem") else stem
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in str(safe))[:48] or "hardware"
    n = 0
    while True:
        name = safe if n == 0 else f"{safe}_{n}"
        if not (project_path / f"{name}.stl").exists() and not (project_path / f"{name}.glb").exists():
            return name
        n += 1


def insert_catalog_part(project_path: Path, part_id: str) -> dict[str, Any]:
    part = get_catalog_part(part_id)
    if not part:
        raise ValueError(f"Unknown hardware catalog id: {part_id}")
    project_path = Path(project_path)
    mesh = mesh_for_part(part)
    stem = _unique_stem(project_path, f"{part['number']}_{part['kind']}")
    stl_path = project_path / f"{stem}.stl"
    glb_path = project_path / f"{stem}.glb"
    cad_service.export_mesh(mesh, stl_path)
    cad_service.export_mesh(mesh, glb_path)
    step_name = ""
    try:
        # export_mesh_step redirects non-__faceted names; write that name explicitly.
        written = cad_service.export_mesh_step(mesh, project_path / f"{stem}__faceted.step")
        step_name = Path(written).name if written else ""
        if step_name and not (project_path / step_name).is_file():
            step_name = ""
    except Exception:
        step_name = ""
    cad_name = step_name or stl_path.name
    cad_service.record_mcmaster_library_entries(
        project_path,
        [cad_name],
        source="mcmaster-catalog",
        page_urls={cad_name: part.get("page_url") or ""},
        part_numbers={cad_name: part["number"]},
        titles={cad_name: part["title"]},
    )
    return {
        "filename": cad_name,
        "viewer_filename": glb_path.name,
        "stl": stl_path.name,
        "step": step_name or None,
        "part_number": part["number"],
        "title": part["title"],
        "subtitle": part["subtitle"],
        "page_url": part.get("page_url") or "",
        "kind": part["kind"],
        "inserted_at": datetime.now(timezone.utc).isoformat(),
    }


def mcmaster_context_lines(project_path: Path) -> list[str]:
    """Lines for the CAD harness packet so Generate mates to inserted hardware."""
    entries = cad_service.list_mcmaster_library(project_path) or []
    if not entries:
        return []
    lines = [
        "McMaster-Carr / inserted hardware (DO NOT remodel these as printed solids).",
        "Load each STEP/STL via input_objects / inputs[] and mate holes to their shanks:",
    ]
    for entry in entries[:24]:
        name = entry.get("project_filename") or entry.get("filename") or entry.get("name")
        pn = entry.get("part_number") or ""
        title = entry.get("title") or ""
        bit = f"- {name}"
        if pn:
            bit += f"  PN {pn}"
        if title:
            bit += f"  {title}"
        lines.append(bit)
    lines.append(
        "For additional screws/nuts/washers/bearings, name a McMaster PN — the server "
        "crawler downloads STEP into this project. Do not ask the user to save CAD to Downloads. "
        "Buy URLs are https://www.mcmaster.com/{PN}/."
    )
    return lines


def hardware_component_refs(project_path: Path) -> list[dict[str, Any]]:
    """Assembly refs so Generate / VibeCAD can mate to inserted hardware."""
    refs: list[dict[str, Any]] = []
    root = Path(project_path)
    for entry in cad_service.list_mcmaster_library(root) or []:
        name = str(entry.get("project_filename") or entry.get("filename") or entry.get("name") or "").strip()
        if not name:
            continue
        cad_name = Path(name).name
        stem = Path(cad_name).stem.replace("__faceted", "")
        viewer = ""
        for candidate in (f"{stem}.glb", f"{Path(cad_name).stem}.glb"):
            if (root / candidate).is_file():
                viewer = candidate
                break
        refs.append(
            {
                "filename": cad_name,
                "stem": Path(cad_name).stem,
                "label": entry.get("title") or entry.get("part_number") or stem,
                "format": Path(cad_name).suffix.lstrip(".").lower() or "step",
                "viewer_filename": viewer or None,
                "mcmaster_part_number": entry.get("part_number") or "",
                "hardware": True,
            }
        )
        if len(refs) >= 16:
            break
    return refs
