"""Project metadata and listing from the projects/ folder."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.services import cad_service, generation_service, history_service, prompt_history_service

META_FILE = "project.json"


def meta_path(project_path: Path) -> Path:
    return project_path / META_FILE


def load_meta(project_path: Path) -> dict[str, Any]:
    path = meta_path(project_path)
    if path.is_file():
        return json.loads(path.read_text())
    return {
        "id": project_path.name,
        "name": project_path.name,
        "created_at": None,
        "updated_at": None,
    }


def save_meta(project_path: Path, meta: dict[str, Any]) -> None:
    meta_path(project_path).write_text(json.dumps(meta, indent=2))


def is_default_project_name(project_path: Path, meta: dict[str, Any] | None = None) -> bool:
    """True when the project still has its auto-generated display name."""
    meta = meta if meta is not None else load_meta(project_path)
    pid = project_path.name
    current = (meta.get("name") or "").strip()
    if not current:
        return True
    if current == pid:
        return True
    if current == f"Project {pid}":
        return True
    return False


def _ai_may_set_project_name(project_path: Path, meta: dict[str, Any]) -> bool:
    if meta.get("name_user_set"):
        return False
    return is_default_project_name(project_path, meta)


def rename_project(project_path: Path, name: str) -> dict[str, Any]:
    """Set display name in project.json (folder id unchanged)."""
    cleaned = name.strip()
    if not cleaned:
        raise ValueError("Project name cannot be empty")
    if len(cleaned) > 120:
        raise ValueError("Project name must be 120 characters or fewer")
    now = datetime.now(timezone.utc).isoformat()
    meta = load_meta(project_path)
    if not meta.get("created_at"):
        meta["created_at"] = now
    meta["updated_at"] = now
    meta["id"] = project_path.name
    meta["name"] = cleaned
    meta["name_user_set"] = True
    save_meta(project_path, meta)
    return meta


def touch_project(
    project_path: Path,
    *,
    name: str | None = None,
    name_source: str | None = None,
) -> dict[str, Any]:
    """Update project metadata on disk."""
    now = datetime.now(timezone.utc).isoformat()
    meta = load_meta(project_path)
    if not meta.get("created_at"):
        meta["created_at"] = now
    meta["updated_at"] = now
    meta["id"] = project_path.name
    if name:
        if name_source == "user":
            meta["name"] = name
            meta["name_user_set"] = True
        elif _ai_may_set_project_name(project_path, meta):
            meta["name"] = name
    elif not meta.get("name") or meta["name"] == meta["id"]:
        files = cad_service.list_project_files(project_path)
        if files:
            meta["name"] = files[-1]["name"].rsplit(".", 1)[0].replace("_", " ")
    save_meta(project_path, meta)
    return meta


def latest_model_file(project_path: Path) -> str | None:
    """Best file to open when restoring a project."""
    timeline = history_service.load_timeline(project_path)
    entries = timeline.get("entries", [])
    idx = timeline.get("current_index", -1)
    candidate: str | None = None
    if 0 <= idx < len(entries):
        fn = entries[idx].get("filename")
        if fn and (project_path / fn).is_file():
            candidate = fn
    elif entries:
        fn = entries[-1].get("filename")
        if fn and (project_path / fn).is_file():
            candidate = fn
    if candidate:
        return cad_service.resolve_viewport_filename(project_path, candidate)
    files = cad_service.list_project_files(project_path)
    if not files:
        return None
    newest = max(files, key=lambda f: (project_path / f["name"]).stat().st_mtime)["name"]
    return cad_service.resolve_viewport_filename(project_path, newest)


def project_summary(project_path: Path) -> dict[str, Any]:
    files = cad_service.list_project_files(project_path)
    if not meta_path(project_path).is_file() and files:
        touch_project(project_path)
    meta = load_meta(project_path)
    timeline = history_service.timeline_summary(project_path)
    touch = meta.get("updated_at")
    if not touch and files:
        touch = datetime.fromtimestamp(
            (project_path / files[0]["name"]).stat().st_mtime, tz=timezone.utc
        ).isoformat()
    return {
        "id": project_path.name,
        "name": meta.get("name") or project_path.name,
        "created_at": meta.get("created_at"),
        "updated_at": touch or meta.get("updated_at"),
        "file_count": len(files),
        "files": files,
        "browser": cad_service.list_browser_tree(project_path),
        "timeline": timeline,
        "latest_file": latest_model_file(project_path),
        "usage_summary": prompt_history_service.project_usage_summary(project_path),
        "generation": generation_service.public_summary(project_path),
    }


def list_all_projects(projects_root: Path) -> list[dict[str, Any]]:
    items = []
    for d in projects_root.iterdir():
        if not d.is_dir() or d.name.startswith("."):
            continue
        items.append(project_summary(d))

    def sort_key(p: dict[str, Any]) -> str:
        return p.get("updated_at") or p.get("created_at") or ""

    items.sort(key=sort_key, reverse=True)
    return items
