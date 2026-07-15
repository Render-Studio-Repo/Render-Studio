"""Seed private user projects from stable demo templates (robot arm, etc.)."""

from __future__ import annotations

import json
import logging
import shutil
import uuid
from pathlib import Path
from typing import Any

from backend.services import cad_service, project_store, teams_service

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
    for project_id in _user_project_ids(user_id):
        path = cad_service.project_dir(projects_root, project_id)
        if not path.is_dir():
            continue
        meta = project_store.load_meta(path)
        if meta.get("demo_template") != template_id:
            continue
        primary = meta.get("demo_primary_filename") or load_template_meta(template_id).get("primary_filename")
        if primary and not (path / Path(str(primary)).name).is_file():
            # Files missing — treat as stale and recreate.
            continue
        return {
            "project_id": project_id,
            "team_id": next(
                (row.get("team_id") for row in teams_service.user_project_access(user_id) if row.get("project_id") == project_id),
                None,
            ),
            "meta": meta,
            "filename": primary,
            "created": False,
            "url": f"/?project={project_id}",
        }
    return None


def seed_template_project(
    projects_root: Path,
    user: dict[str, Any],
    *,
    template_id: str = ROBOT_ARM_TEMPLATE_ID,
    team_id: str | None = None,
    force_new: bool = False,
) -> dict[str, Any]:
    """Copy a demo template into a private project owned by the user."""
    user_id = str(user.get("id") or "")
    if not user_id:
        raise ValueError("User required")

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

    project_id = str(uuid.uuid4())[:8]
    dest = cad_service.project_dir(projects_root, project_id)
    dest.mkdir(parents=True, exist_ok=True)

    copied: list[str] = []
    for src in files:
        try:
            shutil.copy2(src, dest / src.name)
            copied.append(src.name)
        except Exception as exc:
            logger.warning("Could not copy demo file %s: %s", src.name, exc)

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
) -> dict[str, Any]:
    return seed_template_project(
        projects_root,
        user,
        template_id=ROBOT_ARM_TEMPLATE_ID,
        team_id=team_id,
        force_new=force_new,
    )
