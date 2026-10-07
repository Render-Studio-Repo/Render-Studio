"""Seed private user projects from stable demo templates (robot arm, etc.)."""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path
from typing import Any

from backend.services import project_store, teams_service
from backend.services.project_lifecycle import (
    clear_demo_template_suppressed,
    is_demo_template_suppressed,
    is_project_deleted,
    mint_project_id,
)

logger = logging.getLogger("render3d.demo_templates")

TEMPLATES_ROOT = Path(__file__).resolve().parents[1] / "demo_templates"
ROBOT_ARM_TEMPLATE_ID = "robot-arm"
ROBOT_ARM_SOURCE_PROJECT_ID = "505279e3"


def template_dir(template_id: str) -> Path:
    return TEMPLATES_ROOT / template_id


def load_template_meta(template_id: str) -> dict[str, Any]:
    path = template_dir(template_id) / "template.json"
    if not path.is_file():
        raise FileNotFoundError(f"Demo template not found: {template_id}")
    return json.loads(path.read_text(encoding="utf-8"))


def _template_files(template_id: str) -> list[Path]:
    root = template_dir(template_id)
    if not root.is_dir():
        return []
    skip = {"template.json", "preview.png", "README.md", "README.txt"}
    out: list[Path] = []
    for path in sorted(root.iterdir()):
        if not path.is_file():
            continue
        if path.name in skip or path.name.startswith("."):
            continue
        out.append(path)
    return out


def _user_project_ids(user_id: str) -> list[str]:
    access = teams_service.user_project_access(user_id)
    return [str(row.get("project_id") or "") for row in access if row.get("project_id")]


def find_existing_template_project(
    projects_root: Path,
    user_id: str,
    template_id: str,
) -> dict[str, Any] | None:
    tmpl = load_template_meta(template_id)
    primary_name = Path(str(tmpl.get("primary_filename") or "")).name
    for project_id in _user_project_ids(user_id):
        if is_project_deleted(project_id):
            continue
        path = Path(projects_root) / project_id
        if not path.is_dir():
            continue
        meta = project_store.load_meta(path)
        if meta.get("demo_template") != template_id:
            continue
        primary = meta.get("demo_primary_filename") or primary_name
        has_primary = bool(primary) and (path / Path(str(primary)).name).is_file()
        has_any_demo_file = any(
            child.is_file() and child.suffix.lower() in {".glb", ".gltf", ".step", ".stp", ".urdf", ".srdf"}
            for child in path.iterdir()
            if not child.name.startswith(".")
        )
        # The bundled robot-arm template historically omitted the GLB; still treat
        # URDF/SRDF copies as the existing demo so delete stays deleted.
        if not has_primary and not has_any_demo_file:
            continue
        return {
            "project_id": project_id,
            "team_id": next(
                (row.get("team_id") for row in teams_service.user_project_access(user_id) if row.get("project_id") == project_id),
                None,
            ),
            "meta": meta,
            "filename": primary if has_primary else meta.get("demo_primary_filename"),
            "created": False,
            "url": f"/?project={project_id}",
        }
    return None


def _copy_source_primary(dest: Path, tmpl: dict[str, Any]) -> Path | None:
    """Pull the authored GLB from the source project when the template bundle omits it."""
    from backend.config import settings

    primary = Path(str(tmpl.get("primary_filename") or "")).name
    if not primary:
        return None
    if (dest / primary).is_file():
        return dest / primary
    source_id = str(tmpl.get("source_project_id") or ROBOT_ARM_SOURCE_PROJECT_ID)
    src = Path(settings.projects_dir) / source_id / primary
    if not src.is_file():
        return None
    try:
        shutil.copy2(src, dest / primary)
        return dest / primary
    except Exception as exc:
        logger.warning("Could not copy demo primary %s: %s", primary, exc)
        return None


def seed_template_project(
    projects_root: Path,
    user: dict[str, Any],
    *,
    template_id: str = ROBOT_ARM_TEMPLATE_ID,
    team_id: str | None = None,
    force_new: bool = False,
    recreate: bool = False,
) -> dict[str, Any]:
    """Copy a demo template into a private project owned by the user."""
    user_id = str(user.get("id") or "")
    if not user_id:
        raise ValueError("User required")

    if force_new or recreate:
        clear_demo_template_suppressed(user_id, template_id)
    elif is_demo_template_suppressed(user_id, template_id):
        existing = find_existing_template_project(projects_root, user_id, template_id)
        if existing:
            return existing
        return {
            "project_id": None,
            "created": False,
            "suppressed": True,
            "template_id": template_id,
            "url": None,
        }

    if not force_new:
        existing = find_existing_template_project(projects_root, user_id, template_id)
        if existing:
            return existing

    tmpl = load_template_meta(template_id)
    files = _template_files(template_id)
    if not files:
        raise FileNotFoundError(f"Demo template has no files: {template_id}")

    teams = teams_service.list_teams(user_id)
    if not teams:
        raise RuntimeError("No workspace available")
    tid = team_id or teams[0]["id"]
    if tid not in {t["id"] for t in teams}:
        raise PermissionError("Not a member of that workspace")

    project_id = mint_project_id(projects_root)
    dest = Path(projects_root) / project_id
    dest.mkdir(parents=True, exist_ok=True)

    copied: list[str] = []
    for src in files:
        try:
            shutil.copy2(src, dest / src.name)
            copied.append(src.name)
        except Exception as exc:
            logger.warning("Could not copy demo file %s: %s", src.name, exc)
    primary_copy = _copy_source_primary(dest, tmpl)
    if primary_copy and primary_copy.name not in copied:
        copied.append(primary_copy.name)

    if not copied:
        raise RuntimeError("Could not copy demo template files")

    name = str(tmpl.get("name") or "Demo")
    meta = project_store.touch_project(dest, name=name, name_source="user")
    meta["demo_template"] = template_id
    meta["demo_source_project_id"] = tmpl.get("source_project_id") or ROBOT_ARM_SOURCE_PROJECT_ID
    meta["demo_primary_filename"] = tmpl.get("primary_filename") or copied[0]
    project_store.save_meta(dest, meta)
    teams_service.register_project_access(project_id, tid, user_id)

    return {
        "project_id": project_id,
        "team_id": tid,
        "meta": meta,
        "filename": meta.get("demo_primary_filename"),
        "copied_files": copied,
        "created": True,
        "template_id": template_id,
        "source_project_id": meta.get("demo_source_project_id"),
        "url": f"/?project={project_id}",
    }


def seed_robot_arm_project(
    projects_root: Path,
    user: dict[str, Any],
    *,
    team_id: str | None = None,
    force_new: bool = False,
    recreate: bool = False,
) -> dict[str, Any]:
    return seed_template_project(
        projects_root,
        user,
        template_id=ROBOT_ARM_TEMPLATE_ID,
        team_id=team_id,
        force_new=force_new,
        recreate=recreate,
    )
