"""Load and compose agent skills for CAD generation.

Skills are synced from https://github.com/earthtojake/text-to-cad into backend/skills/.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from backend.config import settings
from backend.database import get_conn

SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"
INSTALL_REQUIRED_SKILLS = {
    "silicone-mold-generation": "silicone-mold-generation",
}

_RENDER3D_ADAPTER = """\
━━━ RENDER3D ADAPTATION (active skill: {skill_id}) ━━━
You are running inside Render Studio, not a standalone text-to-cad agent CLI.
Apply this skill's methodology and defaults, but emit Render Studio's JSON Feature Program
(see the main system prompt) unless the user explicitly asks for Python build123d source.
The kernel uses build123d internally and auto-exports STEP, STL, GLB, URDF, and MJCF.
- THINK FIRST: fill the required `design_plan` (8 ForgeCAD-style steps) before `program`/`generator`.
- Convert natural-language briefs into ordered features with combine ops (mm, Z-up).
- Prefer deterministic generators when available: pet_soda_bottle, benchy_boat, enclosure.
- Ignore CLI-only handoffs ($cad-viewer, $dxf, etc.) unless that skill is also enabled.
- Python tools: backend/skills/{skill_id}/scripts/<tool>
- Run CLIs from the project directory; pass cwd-relative paths like STEP/part.step
- Server auto-runs CAD step+inspect on exported STEP when the cad skill is enabled.
"""

_VIBECAD_ADAPTER = """\
━━━ RENDER3D VIBECAD SKILL (active: {skill_id}) ━━━
You are authoring through the VibeCAD engine (build123d sidecar), NOT Jake Mode 2.0.
Do not emit a Feature Program JSON. Do not call cadpy `scripts/step`, `gen_step()`,
or `$cad-viewer`. One-shot authoring returns top-level JSON with keys model_name,
source, parameters, expected_outputs, and optional input_objects.
`source` is complete build123d Python that assigns result = {{...}} (named single-solid Shapes).
Do not wrap that payload as a tool-call object (tool/args) unless vibecad_agent is on.
Codex is the host for every model. Millimetres. Z-up. Align.MIN for stacked primitives.
"""

# Extra reference excerpts injected for common skills (keeps prompts smaller than full tree).
_SKILL_EXTRAS: dict[str, list[str]] = {
    "cad": ["references/cad-brief.md", "references/build123d-modeling.md"],
    "vibecad": ["references/build123d-primitives.md"],
    "urdf": ["references/urdf-workflow.md"],
    "step-parts": ["references/step-parts-api.md"],
    "blueprint-vision": ["references/vision-pipeline.md", "references/output-schema.md"],
}

_JAKE_ONLY_SKILLS = frozenset({"cad", "cad-viewer"})
_VIBECAD_COMPAT_SKILLS = frozenset(
    {"vibecad", "dxf", "blueprint-vision", "step-parts", "bambu-labs", "gcode"}
)

_COMPACT_SKILL_MAX_CHARS = 3200
_MAX_REFERENCE_CHARS = 1200

_BUNDLED_SKILL_MD = {
    "vibecad": """---
name: vibecad
description: Author parametric mechanical CAD through Render Studio's VibeCAD engine (build123d sidecar and optional FreeCAD). Use for Mode 2.0 VibeCAD, named solids, STEP/GLB publish, DXF/image-driven parts, and mating to linked hardware.
---

# VibeCAD (Render Studio)

Provenance: Render Studio skill pack, adapted from [10-X-eng/vibecad](https://github.com/10-X-eng/vibecad).
This file is required for generation. Jake Mode 2.0 (`cad` skill / Feature Program JSON) is a different engine — do not emit Jake Feature Programs here.

## Purpose

Author millimetre, Z-up mechanical parts as complete build123d (or FreeCAD) Python that assigns an ordered `result` dict of named single-solid Shapes. The worker publishes STEP → GLB into the viewport.

## Use this skill when

The user selected the **VibeCAD** CAD engine, or the request is `mode=vibecad`. Also use it when they attach photos, DXF drawings, or @-linked STEP hardware to mate against.

Do not use Jake `cad` Feature Program JSON, `cadpy`/`cadgen` `scripts/step`, `gen_step()`, or `$cad-viewer`.

## Authoring contract

- Units: millimetres. Z-up. Prefer `Align.MIN` for stacked primitives.
- Driving dimensions arrive as `params`. Optional STEP imports arrive as `inputs`.
- Assign `result: dict[str, Shape]` whose keys exactly match `expected_outputs` (same order).
- Each value is one independently editable solid.
- Do not import exporters, write files, or call the network.
- Linked McMaster / @component STEP files: load via `inputs[alias]` and mate — do not reprint fasteners.
- CAD brief McMaster parts list is required hardware for this engine, same as Jake/MAC. Import fetched STEPs; do not skip screws, bearings, standoffs, or electronics mounts.
- Photos / canvas: read attached files WITH the prompt. `canvas-sketch` and line drawings explain layout (arrows, hanging off, beside, offset) — they are not the finished part. Photos of extrusion, rail, or hardware are mate targets. Product photos of the thing to make: match silhouette of THAT object. Do not sit a new motor/bracket on top of an extrusion unless the prompt and sketch say on-top.
- DXF: `dxf_filename` is in the worker cwd. Reconstruct 3D from layers/polylines. `import_dxf()+make_face()+extrude()` only for an explicit flat plate.

Hopper / funnel / vessel: one outer silhouette, then revolve or loft (`Pos(0, 0, z) * Circle(r)` stations), then cut the bore. Do not fuse centered Cylinder/Cone with `.translate((0, 0, z))`. If stacking primitives, every one needs `align=(Align.CENTER, Align.CENTER, Align.MIN)` and `z` is the BOTTOM of that solid.

## Colour coding

Colour every named solid with realistic shop materials from the prompt's `colors:` / materials clause
(`srgb("#c0c6cc")` aluminum, `#8a939d` steel, `#3a3f44` black oxide, `#c4a574` brass, `#d9d3c7` POM,
`#4a5560` rubber, `#c6d0da` fasteners). Required for from-scratch, Target Edit, Generate another, and
imported STEP/GLB (white/grey tessellation is unauthored — not a finish to keep). The worker still
injects `fill_color(i)` and `srgb("#hex")`.
Do not cycle pastel CAD Viewer fills unless the user asked for workbench colours. Use a semantic/material
colour whenever the prompt names that material. The worker paints leftover grey solids in `expected_outputs`
order using shop swatches, not rainbow pastels.

```python
housing.color = srgb("#c0c6cc")
lid.color = srgb("#3a3f44")
```

## Tools

- `scripts/build123d_worker.py` — isolated build123d 0.11 sidecar (Render keeps this; upstream VibeCAD no longer vendors it).
- FreeCADCmd when available (`backend/services/freecad_engine.py`).

ChatGPT / OpenAI / Claude / Gemini: Codex is the host (one session). Debug only: inspect → one review → create/edit → repair → finish (`vibecad_agent` / `backend/services/vibecad_agent.py`). One-shot JSON is `vibecad_oneshot` only.

""",
}


def _parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    block = text[3:end].strip()
    body = text[end + 4 :].lstrip("\n")
    meta: dict[str, str] = {}
    for line in block.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip()
    return meta, body


def _ensure_skill_markdown(skill_dir: Path, skill_id: str) -> None:
    """Write bundled SKILL.md if a skill sync wiped it (VibeCAD is Render-local).

    macOS iCloud placeholders can look like files (`is_file()` True) but raise
    FileNotFoundError on read — treat that as missing and rewrite.
    """
    body = _BUNDLED_SKILL_MD.get(skill_id)
    if not body:
        return
    dest = skill_dir / "SKILL.md"
    if dest.is_file():
        try:
            current = dest.read_text(encoding="utf-8")
            # A Jake skill rsync + patch-skills used to append gen_step() notes
            # onto VibeCAD. That contract is wrong for this engine.
            if skill_id == "vibecad" and "<!-- render3d-studio -->" in current:
                dest.write_text(body, encoding="utf-8")
            return
        except OSError:
            pass
    try:
        dest.write_text(body, encoding="utf-8")
    except OSError:
        pass


def bundled_skill_markdown(skill_id: str) -> str:
    """In-memory SKILL.md for local packs that rsync can wipe."""
    return _BUNDLED_SKILL_MD.get((skill_id or "").strip().lower()) or ""


def get_skill_dir(skill_id: str) -> Path | None:
    skill_id = (skill_id or "").strip().lower()
    if not skill_id or ".backup-" in skill_id:
        return None
    direct = SKILLS_DIR / skill_id
    if not direct.is_dir():
        return None
    _ensure_skill_markdown(direct, skill_id)
    # Prefer canonical skill bundles that include SKILL.md, but accept
    # runtime-only bundles during sync windows so CAD v2 doesn't hard-fail.
    if (direct / "SKILL.md").is_file():
        return direct
    scripts = direct / "scripts"
    if scripts.is_dir():
        return direct
    return None


def _skill_paths() -> list[Path]:
    if not SKILLS_DIR.is_dir():
        return []
    paths: list[Path] = []
    for child in sorted(SKILLS_DIR.iterdir()):
        if child.name.startswith("."):
            continue
        if ".backup-" in child.name:
            continue
        if not child.is_dir():
            continue
        skill_md = child / "SKILL.md"
        if skill_md.is_file():
            paths.append(skill_md)
            continue
        # Runtime-only packs (scripts/ or README) still list in the catalog.
        if (child / "scripts").is_dir() or (child / "README.md").is_file():
            paths.append(child / "SKILL.md")
    return paths


def _skill_id_from_path(path: Path) -> str:
    return path.parent.name


def _list_references(skill_dir: Path) -> list[str]:
    ref_dir = skill_dir / "references"
    if not ref_dir.is_dir():
        return []
    return sorted(p.name for p in ref_dir.glob("*.md"))


def _read_reference(skill_dir: Path, name: str, *, max_chars: int = _MAX_REFERENCE_CHARS) -> str | None:
    raw = str(name or "").lstrip("/")
    candidates = (
        skill_dir / "references" / Path(raw).name,
        skill_dir / raw,
    )
    path = next((p for p in candidates if p.is_file()), None)
    if path is None:
        return None
    text = path.read_text(encoding="utf-8").strip()
    if len(text) > max_chars:
        return text[:max_chars].rsplit("\n", 1)[0] + "\n\n[…truncated…]"
    return text


def _provenance() -> dict[str, str]:
    out: dict[str, str] = {
        "source": "https://github.com/earthtojake/text-to-cad",
    }
    rev = SKILLS_DIR / ".source_rev"
    synced = SKILLS_DIR / ".synced_at"
    if rev.is_file():
        out["revision"] = rev.read_text(encoding="utf-8").strip()
    if synced.is_file():
        out["synced_at"] = synced.read_text(encoding="utf-8").strip()
    return out


def _installed_skill_set(user_id: str | None) -> set[str]:
    return set(_installed_marketplace_skill_ids(user_id))


def list_skills(*, user_id: str | None = None) -> list[dict[str, Any]]:
    installed = _installed_skill_set(user_id)
    out: list[dict[str, Any]] = []
    for path in _skill_paths():
        skill_dir = path.parent if path.name == "SKILL.md" else path
        skill_id = skill_dir.name
        _ensure_skill_markdown(skill_dir, skill_id)
        skill_md = skill_dir / "SKILL.md"
        if skill_md.is_file():
            text = skill_md.read_text(encoding="utf-8")
        elif skill_id in _BUNDLED_SKILL_MD:
            text = _BUNDLED_SKILL_MD[skill_id]
        elif (skill_dir / "README.md").is_file():
            text = (skill_dir / "README.md").read_text(encoding="utf-8")
        else:
            text = f"---\nname: {skill_id}\ndescription: {skill_id}\n---\n"
        meta, body = _parse_frontmatter(text)
        preview = re.sub(r"\s+", " ", body).strip()[:280]
        tools: list[str] = []
        scripts = skill_dir / "scripts"
        if scripts.is_dir():
            tools = sorted(
                p.name
                for p in scripts.iterdir()
                if (p.is_dir() and (p / "__main__.py").is_file()) or p.is_file()
            )
        install_slug = INSTALL_REQUIRED_SKILLS.get(skill_id)
        item = {
                "id": skill_id,
                "name": meta.get("name") or skill_id,
                "description": meta.get("description") or preview,
                "preview": preview,
                "references": _list_references(skill_dir),
                "tools": tools,
                "provenance": _provenance(),
                "install_required": bool(install_slug),
                "installed": not install_slug or skill_id in installed,
                "install_slug": install_slug,
                "assets": list_skill_assets(user_id, skill_id) if user_id and install_slug else [],
            }
        out.append(item)
    return out


def get_skill(skill_id: str, *, include_references: bool = False) -> dict[str, Any] | None:
    skill_dir = get_skill_dir(skill_id)
    if not skill_dir:
        return None
    skill_id = skill_dir.name
    skill_md = skill_dir / "SKILL.md"
    readme = skill_dir / "README.md"
    text = ""
    try:
        if skill_md.is_file():
            text = skill_md.read_text(encoding="utf-8")
        elif skill_id in _BUNDLED_SKILL_MD:
            text = _BUNDLED_SKILL_MD[skill_id]
        elif readme.is_file():
            text = readme.read_text(encoding="utf-8")
        else:
            text = f"---\nname: {skill_id}\ndescription: {skill_id}\n---\n"
    except OSError:
        text = _BUNDLED_SKILL_MD.get(skill_id) or f"---\nname: {skill_id}\ndescription: {skill_id}\n---\n"
    meta, body = _parse_frontmatter(text)
    data: dict[str, Any] = {
        "id": skill_id,
        "name": meta.get("name") or skill_id,
        "description": meta.get("description") or "",
        "content": body.strip(),
        "references": _list_references(skill_dir),
        "provenance": _provenance(),
    }
    scripts = skill_dir / "scripts"
    if scripts.is_dir():
        data["tools"] = sorted(
            p.name
            for p in scripts.iterdir()
            if (p.is_dir() and (p / "__main__.py").is_file()) or p.is_file()
        )
    if include_references:
        data["reference_bodies"] = {
            name: _read_reference(skill_dir, name, max_chars=8000)
            for name in data["references"]
        }
    return data


def _asset_root(user_id: str, skill_id: str) -> Path:
    safe_user = re.sub(r"[^A-Za-z0-9_-]", "_", str(user_id or "user"))[:120] or "user"
    safe_skill = re.sub(r"[^a-z0-9_-]", "_", str(skill_id or "skill").lower())[:120] or "skill"
    root = Path(settings.data_dir) / "skill_assets" / safe_user / safe_skill
    root.mkdir(parents=True, exist_ok=True)
    return root


def list_skill_assets(user_id: str | None, skill_id: str) -> list[dict[str, Any]]:
    if not user_id:
        return []
    root = _asset_root(user_id, skill_id)
    assets: list[dict[str, Any]] = []
    for path in sorted(root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not path.is_file():
            continue
        kind = "image" if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"} else "document"
        assets.append(
            {
                "name": path.name,
                "kind": kind,
                "size": path.stat().st_size,
            }
        )
    return assets


def save_skill_asset(user_id: str, skill_id: str, filename: str, data: bytes) -> dict[str, Any]:
    clean = re.sub(r"[^A-Za-z0-9._-]", "_", Path(filename or "asset").name)[:160] or "asset"
    suffix = Path(clean).suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".txt", ".md", ".pdf", ".doc", ".docx"}:
        raise ValueError("Upload images, markdown/text, PDF, or Word docs.")
    if len(data) > 8 * 1024 * 1024:
        raise ValueError("Skill assets must be under 8 MB.")
    root = _asset_root(user_id, skill_id)
    target = root / clean
    if target.exists():
        stem = target.stem
        for i in range(2, 100):
            candidate = root / f"{stem}_{i}{suffix}"
            if not candidate.exists():
                target = candidate
                break
    target.write_bytes(data)
    return list_skill_assets(user_id, skill_id)[0]


def get_reference(skill_id: str, ref_name: str) -> dict[str, Any] | None:
    skill_dir = get_skill_dir(skill_id)
    if not skill_dir:
        return None
    body = _read_reference(skill_dir, ref_name, max_chars=100_000)
    if body is None:
        return None
    return {"skill_id": skill_id, "name": ref_name, "content": body}


def _installed_marketplace_skill_ids(user_id: str | None) -> list[str]:
    if not user_id:
        return []
    try:
        with get_conn() as conn:
            rows = conn.execute(
                """
                SELECT l.manifest_json
                  FROM agent_app_installs i
                  JOIN agent_app_listings l ON l.id = i.app_id
                 WHERE i.user_id = ? AND i.status = 'installed' AND l.status = 'approved'
                """,
                (user_id,),
            ).fetchall()
    except Exception:
        return []
    out: list[str] = []
    for row in rows:
        try:
            manifest = json.loads(row["manifest_json"] or "{}")
        except Exception:
            continue
        skill_id = str(manifest.get("skill_id") or "").strip().lower()
        if skill_id and get_skill_dir(skill_id):
            out.append(skill_id)
    return out


def _available_skill_ids(skill_ids: list[str] | None, *, user_id: str | None = None) -> list[str]:
    requested = [
        (raw or "").strip().lower()
        for raw in (skill_ids or [])
        if (raw or "").strip()
    ]
    if not requested:
        requested = [item["id"] for item in list_skills()]
    installed = _installed_skill_set(user_id)
    requested.extend(installed)
    seen: set[str] = set()
    out: list[str] = []
    for skill_id in requested:
        if skill_id in seen or not get_skill_dir(skill_id):
            continue
        if skill_id in INSTALL_REQUIRED_SKILLS and skill_id not in installed:
            continue
        seen.add(skill_id)
        out.append(skill_id)
    return out


def _prompt_matches(prompt: str, *needles: str) -> bool:
    lowered = prompt.lower()
    return any(needle in lowered for needle in needles)


def _is_vibecad_mode(mode: str | None) -> bool:
    return (mode or "").strip().lower() in {"vibecad", "vibe", "vibecade"}


def resolve_prompt_skills(
    skill_ids: list[str] | None,
    *,
    has_images: bool = False,
    prompt: str = "",
    user_id: str | None = None,
    mode: str | None = None,
    ref_types: list[str] | None = None,
    filenames: list[str] | None = None,
) -> list[str]:
    """Select relevant skills from the user's available skill/app catalog."""
    requested = list(skill_ids or [])
    vibecad_mode = _is_vibecad_mode(mode)
    if vibecad_mode:
        requested = [s for s in requested if str(s).strip().lower() not in _JAKE_ONLY_SKILLS]
        requested.append("vibecad")
    # Empty requested would otherwise collapse VibeCAD to only "vibecad" and drop
    # auto skills (blueprint-vision, dxf) needed for PDF/DXF reference files.
    available = _available_skill_ids([], user_id=user_id)
    available_set = set(available)
    resolved: list[str] = []

    def add(skill_id: str) -> None:
        if skill_id in available_set and skill_id not in resolved:
            resolved.append(skill_id)

    for skill_id in requested:
        add(str(skill_id).strip().lower())

    types = {str(t or "").strip().lower() for t in (ref_types or [])}
    names = " ".join(str(n or "") for n in (filenames or [])).lower()
    has_pdf = "pdf" in types or ".pdf" in names
    has_dxf = "dxf" in types or ".dxf" in names
    has_drawing = (
        has_images
        or has_pdf
        or has_dxf
        or _prompt_matches(prompt, "blueprint", "schematic", "image", "photo", "drawing", "diagram", "pdf")
    )

    # Engine-owned base skill. Jake 2.0 → cad. VibeCAD → vibecad (never Jake's cad).
    if vibecad_mode:
        add("vibecad")
    else:
        add("cad")

    if has_drawing:
        add("blueprint-vision")
    if has_dxf or _prompt_matches(prompt, "dxf", "laser", "waterjet", "2d profile", "flat pattern", "sheet"):
        add("dxf")

    if _prompt_matches(prompt, "mold", "mould", "silicone", "casting", "negative cavity", "parting plane", "sprue", "vent"):
        add("silicone-mold-generation")

    if _prompt_matches(prompt, "robot", "urdf", "ros", "joint", "linkage", "kinematic", "rigging", "animate", "simulation"):
        add("urdf")
    if _prompt_matches(prompt, "architect", "architecture", "house", "room", "wall panel", "window", "door", "roof", "floor plan", "modular home", "building kit"):
        add("architect")
    if _prompt_matches(prompt, "sdf", "gazebo", "physics simulation", "simulate", "mjcf"):
        add("sdf")
    if _prompt_matches(prompt, "srdf", "moveit", "planning group", "collision matrix"):
        add("srdf")

    if _prompt_matches(prompt, "sendcutsend", "send cut send", "sheet metal", "bend allowance"):
        add("sendcutsend")

    if _prompt_matches(
        prompt,
        "printability", "printable", "overhang", "wall thickness", "support material",
        "build orientation", "dfam", "design for additive",
    ):
        add("dfam-check")
    if _prompt_matches(
        prompt,
        "engineering drawing", "shop drawing", "manufacturing drawing", "dimensioned sheet",
        "orthographic views", "title block", "hole callout",
    ):
        add("engineering-drawing")

    if _prompt_matches(prompt, "g-code", "gcode", "toolpath", "cnc", "milling", "3d print", "slicer"):
        add("gcode")
    if _prompt_matches(prompt, "bambu", "ams", "bambu lab", "bambu-labs"):
        add("bambu-labs")

    if _prompt_matches(prompt, "step part", "part number", "supplier", "mcmaster", "download step", "component lookup"):
        add("step-parts")
    if _prompt_matches(prompt, "implicit", "signed distance", "sdf model", "metaball"):
        add("implicit-cad")
    if _prompt_matches(prompt, "viewer", "snapshot", "inspect", "measure", "selector", "topology"):
        add("cad-viewer")
    if _prompt_matches(prompt, "wire", "wiring", "circuit", "arduino", "motor driver", "electronics"):
        add("wiring")

    if not resolved:
        add("vibecad" if vibecad_mode else "cad")
    if vibecad_mode:
        resolved = [s for s in resolved if s in _VIBECAD_COMPAT_SKILLS or s == "vibecad"]
        if "vibecad" not in resolved:
            resolved.insert(0, "vibecad")
    return resolved


def build_skills_prompt(
    skill_ids: list[str] | None,
    *,
    compact: bool = True,
    dialect: str = "jake",
) -> str:
    """Compose skill injections for the design system prompt."""
    if not skill_ids:
        return ""
    vibe_dialect = str(dialect or "jake").strip().lower() in {"vibecad", "vibe", "vibecade"}
    parts: list[str] = []
    for raw_id in skill_ids:
        skill_id = (raw_id or "").strip().lower()
        if vibe_dialect and skill_id in _JAKE_ONLY_SKILLS:
            continue
        if not vibe_dialect and skill_id == "vibecad":
            continue
        skill = get_skill(skill_id)
        if not skill:
            continue
        skill_dir = get_skill_dir(skill_id)
        adapter = _VIBECAD_ADAPTER if (vibe_dialect or skill_id == "vibecad") else _RENDER3D_ADAPTER
        parts.append(adapter.format(skill_id=skill_id))
        body = skill["content"]
        if compact and len(body) > _COMPACT_SKILL_MAX_CHARS:
            body = (
                body[:_COMPACT_SKILL_MAX_CHARS].rsplit("\n", 1)[0]
                + "\n\n[Skill truncated — full text in Skills Library.]"
            )
        parts.append(body)
        if skill_dir:
            for ref_name in _SKILL_EXTRAS.get(skill_id, []):
                ref_max = 8000 if vibe_dialect or skill_id == "vibecad" else _MAX_REFERENCE_CHARS
                ref = _read_reference(skill_dir, ref_name, max_chars=ref_max)
                if ref:
                    parts.append(f"\n### {ref_name}\n{ref}")
        parts.append("")
    return "\n".join(parts).strip()


def skills_manifest(*, user_id: str | None = None) -> dict[str, Any]:
    return {
        "provenance": _provenance(),
        "skills": list_skills(user_id=user_id),
    }
