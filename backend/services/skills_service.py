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
    if not skill_id or ".backup-" in skill_id:
        return None
    direct = SKILLS_DIR / skill_id
    if not direct.is_dir():
        return None
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


def _installed_skill_set(user_id: str | None) -> set[str]:
    return set(_installed_marketplace_skill_ids(user_id))


def list_skills(*, user_id: str | None = None) -> list[dict[str, Any]]:
    installed = _installed_skill_set(user_id)
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


def resolve_prompt_skills(
    skill_ids: list[str] | None,
    *,
    has_images: bool = False,
    prompt: str = "",
    user_id: str | None = None,
) -> list[str]:
    """Select relevant skills from the user's available skill/app catalog."""
    available = _available_skill_ids(skill_ids, user_id=user_id)
    available_set = set(available)
    resolved: list[str] = []

    def add(skill_id: str) -> None:
        if skill_id in available_set and skill_id not in resolved:
            resolved.append(skill_id)

    # CAD is the base skill for Render Studio geometry generation.
    add("cad")

    if has_images or _prompt_matches(prompt, "blueprint", "schematic", "image", "photo", "drawing", "diagram"):
        add("blueprint-vision")

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

    if _prompt_matches(prompt, "dxf", "laser", "waterjet", "2d profile", "flat pattern", "sheet"):
        add("dxf")
    if _prompt_matches(prompt, "sendcutsend", "send cut send", "sheet metal", "bend allowance"):
        add("sendcutsend")

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
        add("cad")
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


def skills_manifest(*, user_id: str | None = None) -> dict[str, Any]:
    return {
        "provenance": _provenance(),
        "skills": list_skills(user_id=user_id),
    }
