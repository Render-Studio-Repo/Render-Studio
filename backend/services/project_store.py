"""Project metadata and listing from the projects/ folder."""

from __future__ import annotations

import json
import re
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
    # Hex-ish bare ids (8–12 chars) that slipped in as the display name.
    if re.fullmatch(r"[0-9a-fA-F]{6,12}", current) and current.lower() == pid.lower():
        return True
    return False


def title_from_prompt(prompt: str, *, max_len: int = 64) -> str:
    """Human project/file title from a prompt: Capitalization And Spaces."""
    text = (prompt or "").strip()
    if not text:
        return "New Model"
    # First sentence / clause only.
    text = re.split(r"[.!?\n]", text, maxsplit=1)[0]
    text = re.split(
        r",\s+(?:it|and|because|with|that|which|so|then|for|where|when)\b",
        text,
        maxsplit=1,
        flags=re.I,
    )[0]
    text = re.sub(
        r"^(?:i\s+(?:need|want|would like)\s+to\s+)?"
        r"(?:please\s+)?"
        r"(?:make|create|generate|design|build|model|draw)\s+"
        r"(?:me\s+)?"
        r"(?:an|a|the)?\s*",
        "",
        text,
        flags=re.I,
    ).strip()
    text = re.sub(r"^(?:an|a|the)\s+", "", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip(" -_")
    if not text:
        return "New Model"
    words = text.split()
    # Drop trailing filler like "than is on the ground..."
    stop_at = None
    for i, word in enumerate(words):
        lower = word.lower()
        if lower in {"than", "that", "which", "because"} and i >= 1:
            stop_at = i
            break
        if lower == "with" and i >= 2:
            stop_at = i
            break
    if stop_at is not None:
        words = words[:stop_at]
    if len(words) > 8:
        words = words[:8]
    title = " ".join(words).strip(" -_")
    if not title:
        return "New Model"
    # Title case; keep short all-caps tokens (FANUC, CNC, PET).
    parts: list[str] = []
    for word in title.split():
        if word.isupper() and 2 <= len(word) <= 6:
            parts.append(word)
        else:
            parts.append(word[:1].upper() + word[1:].lower() if word else word)
    titled = " ".join(parts)
    if len(titled) > max_len:
        titled = titled[:max_len].rsplit(" ", 1)[0].strip() or titled[:max_len].strip()
    return titled or "New Model"


def file_stem_from_prompt(prompt: str, *, max_len: int = 80) -> str:
    """Filesystem stem with spaces + capitalization (illegal path chars stripped)."""
    title = title_from_prompt(prompt, max_len=max_len)
    stem = re.sub(r'[\\/:*?"<>|]+', "", title).strip(" .")
    return (stem or "New Model")[:max_len]


def apply_prompt_project_name(project_path: Path, prompt: str, *, fallback: str | None = None) -> dict[str, Any]:
    """Rename a default-id project from the prompt (Capitalization And Spaces)."""
    meta = load_meta(project_path)
    if not _ai_may_set_project_name(project_path, meta):
        return meta
    title = title_from_prompt(prompt)
    if (not title or title == "New Model") and fallback:
        fb = str(fallback).strip()
        if " " in fb and not fb.islower():
            title = fb
        else:
            pretty = re.sub(r"_+", " ", fb).strip()
            title = " ".join(
                (p.upper() if p.isupper() and 2 <= len(p) <= 6 else p[:1].upper() + p[1:].lower())
                for p in pretty.split()
                if p
            ) or "New Model"
    return touch_project(project_path, name=title or "New Model")


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
    files = cad_service.list_project_files(project_path)
    meta["file_count"] = len(files)
    if name:
        if name_source == "user":
            meta["name"] = name
            meta["name_user_set"] = True
        elif _ai_may_set_project_name(project_path, meta):
            meta["name"] = name
    elif not meta.get("name") or meta["name"] == meta["id"]:
        if files:
            meta["name"] = files[-1]["name"].rsplit(".", 1)[0].replace("_", " ")
    save_meta(project_path, meta)
    return meta


def latest_model_file(project_path: Path) -> str | None:
    """Best file to open when restoring a project."""
    timeline = history_service.load_timeline(project_path)
    entries = timeline.get("entries", [])
    idx = timeline.get("current_index", -1)

    def _usable(entry: dict[str, Any] | None) -> str | None:
        if not entry:
            return None
        meta = entry.get("meta") or {}
        status = str(meta.get("status") or entry.get("status") or "").lower()
        label = str(entry.get("label") or "").lower()
        # Skip canceled/failed timeline rows — they often point at the edit target
        # (base_filename) rather than a new artifact.
        if status in {"stopped", "canceled", "cancelled", "failed"} or label.startswith("stopped"):
            if meta.get("success") is not True:
                return None
        if meta.get("success") is False:
            return None
        fn = entry.get("filename")
        if fn and Path(str(fn)).suffix.lower() != ".dxf" and (project_path / fn).is_file():
            return str(fn)
        return None

    candidate: str | None = None
    if 0 <= idx < len(entries):
        candidate = _usable(entries[idx])
    if not candidate:
        # Walk backward for the newest successful model artifact.
        for entry in reversed(entries):
            candidate = _usable(entry)
            if candidate:
                break
    if candidate:
        return cad_service.resolve_viewport_filename(project_path, candidate)
    files = [
        f for f in cad_service.list_project_files(project_path)
        if Path(str(f.get("name") or "")).suffix.lower() != ".dxf"
    ]
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


def project_list_summary(project_path: Path) -> dict[str, Any]:
    """Fast sidebar summary; full browser/timeline data loads when opening a project."""
    meta = load_meta(project_path)
    touch = meta.get("updated_at")
    if not touch:
        try:
            touch = datetime.fromtimestamp(project_path.stat().st_mtime, tz=timezone.utc).isoformat()
        except OSError:
            touch = meta.get("created_at")
    try:
        file_count = len(cad_service.list_project_files(project_path))
    except OSError:
        file_count = int(meta.get("file_count") or 0)
    # Keep meta cache in sync so future reads stay cheap/accurate.
    if meta.get("file_count") != file_count:
        meta["file_count"] = file_count
        try:
            save_meta(project_path, meta)
        except OSError:
            pass
    timeline_entries = 0
    try:
        timeline_entries = len((history_service.load_timeline(project_path) or {}).get("entries") or [])
    except Exception:
        timeline_entries = 0
    return {
        "id": project_path.name,
        "name": meta.get("name") or project_path.name,
        "created_at": meta.get("created_at"),
        "updated_at": touch or meta.get("updated_at"),
        "file_count": file_count,
        "files": [],
        "browser": {"components": [], "sketches": [], "wiring": [], "drawings": [], "references": [], "renders": []},
        "timeline": {"entries": [{} for _ in range(timeline_entries)]},
        "latest_file": None,
        "usage_summary": None,
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
