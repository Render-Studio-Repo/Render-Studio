"""Load and compose agent skills for CAD generation.

Skills are synced from https://github.com/earthtojake/text-to-cad into backend/skills/.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"

_RENDER3D_ADAPTER = """\
━━━ RENDER3D ADAPTATION (active skill: {skill_id}) ━━━
You are running inside Render3D Studio, not a standalone text-to-cad agent CLI.
Apply this skill's methodology and defaults, but emit Render3D's JSON Feature Program
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

# Extra reference excerpts injected for common skills (keeps prompts smaller than full tree).
_SKILL_EXTRAS: dict[str, list[str]] = {
    "cad": ["references/cad-brief.md", "references/build123d-modeling.md"],
    "urdf": ["references/urdf-workflow.md"],
    "step-parts": ["references/step-parts-api.md"],
    "blueprint-vision": ["references/vision-pipeline.md", "references/output-schema.md"],
}

_COMPACT_SKILL_MAX_CHARS = 3200
_MAX_REFERENCE_CHARS = 1200


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


def get_skill_dir(skill_id: str) -> Path | None:
    skill_id = (skill_id or "").strip().lower()
    if not skill_id:
        return None
    direct = SKILLS_DIR / skill_id
    if direct.is_dir() and (direct / "SKILL.md").is_file():
        return direct
    return None


def _skill_paths() -> list[Path]:
    if not SKILLS_DIR.is_dir():
        return []
    paths: list[Path] = []
    for child in sorted(SKILLS_DIR.iterdir()):
        if child.name.startswith("."):
            continue
        if child.is_dir():
            skill_md = child / "SKILL.md"
            if skill_md.is_file():
                paths.append(skill_md)
    return paths


def _skill_id_from_path(path: Path) -> str:
    return path.parent.name


def _list_references(skill_dir: Path) -> list[str]:
    ref_dir = skill_dir / "references"
    if not ref_dir.is_dir():
        return []
    return sorted(p.name for p in ref_dir.glob("*.md"))


def _read_reference(skill_dir: Path, name: str, *, max_chars: int = _MAX_REFERENCE_CHARS) -> str | None:
    path = skill_dir / "references" / name
    if not path.is_file():
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


def list_skills() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for path in _skill_paths():
        text = path.read_text(encoding="utf-8")
        meta, body = _parse_frontmatter(text)
        skill_id = _skill_id_from_path(path)
        skill_dir = path.parent
        preview = re.sub(r"\s+", " ", body).strip()[:280]
        tools: list[str] = []
        scripts = skill_dir / "scripts"
        if scripts.is_dir():
            tools = sorted(
                p.name
                for p in scripts.iterdir()
                if (p.is_dir() and (p / "__main__.py").is_file()) or p.is_file()
            )
        out.append(
            {
                "id": skill_id,
                "name": meta.get("name") or skill_id,
                "description": meta.get("description") or preview,
                "preview": preview,
                "references": _list_references(skill_dir),
                "tools": tools,
                "provenance": _provenance(),
            }
        )
    return out


def get_skill(skill_id: str, *, include_references: bool = False) -> dict[str, Any] | None:
    skill_dir = get_skill_dir(skill_id)
    if not skill_dir:
        return None
    text = (skill_dir / "SKILL.md").read_text(encoding="utf-8")
    meta, body = _parse_frontmatter(text)
    skill_id = skill_dir.name
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


def get_reference(skill_id: str, ref_name: str) -> dict[str, Any] | None:
    skill_dir = get_skill_dir(skill_id)
    if not skill_dir:
        return None
    body = _read_reference(skill_dir, ref_name, max_chars=100_000)
    if body is None:
        return None
    return {"skill_id": skill_id, "name": ref_name, "content": body}


def resolve_prompt_skills(skill_ids: list[str] | None, *, has_images: bool = False) -> list[str]:
    """Merge client-selected skills with image-triggered defaults."""
    resolved: list[str] = []
    seen: set[str] = set()
    for raw in skill_ids or []:
        skill_id = (raw or "").strip().lower()
        if not skill_id or skill_id in seen:
            continue
        seen.add(skill_id)
        resolved.append(skill_id)
    if has_images and "blueprint-vision" not in seen and get_skill_dir("blueprint-vision"):
        resolved.append("blueprint-vision")
    return resolved


def build_skills_prompt(skill_ids: list[str] | None, *, compact: bool = True) -> str:
    """Compose skill injections for the design system prompt."""
    if not skill_ids:
        return ""
    parts: list[str] = []
    for raw_id in skill_ids:
        skill_id = (raw_id or "").strip().lower()
        skill = get_skill(skill_id)
        if not skill:
            continue
        skill_dir = get_skill_dir(skill_id)
        parts.append(_RENDER3D_ADAPTER.format(skill_id=skill_id))
        body = skill["content"]
        if compact and len(body) > _COMPACT_SKILL_MAX_CHARS:
            body = (
                body[:_COMPACT_SKILL_MAX_CHARS].rsplit("\n", 1)[0]
                + "\n\n[Skill truncated — full text in Skills Library.]"
            )
        parts.append(body)
        if skill_dir:
            for ref_name in _SKILL_EXTRAS.get(skill_id, []):
                ref = _read_reference(skill_dir, ref_name)
                if ref:
                    parts.append(f"\n### {ref_name}\n{ref}")
        parts.append("")
    return "\n".join(parts).strip()


def skills_manifest() -> dict[str, Any]:
    return {
        "provenance": _provenance(),
        "skills": list_skills(),
    }
