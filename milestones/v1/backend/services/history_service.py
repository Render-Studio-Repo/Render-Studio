"""Fusion-style edit timeline: snapshots per step, scrub to restore."""

from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _timeline_path(project_path: Path) -> Path:
    return project_path / "timeline.json"


def _history_dir(project_path: Path) -> Path:
    d = project_path / "history"
    d.mkdir(parents=True, exist_ok=True)
    return d


def load_timeline(project_path: Path) -> dict[str, Any]:
    path = _timeline_path(project_path)
    if not path.is_file():
        return {"current_index": -1, "entries": []}
    return json.loads(path.read_text())


def save_timeline(project_path: Path, data: dict[str, Any]) -> None:
    _timeline_path(project_path).write_text(json.dumps(data, indent=2))


def append_entry(
    project_path: Path,
    *,
    kind: str,
    label: str,
    filename: str,
    meta: dict[str, Any] | None = None,
    user_id: str | None = None,
    user_name: str | None = None,
) -> dict[str, Any]:
    """Record a timeline step and snapshot the model file."""
    src = project_path / filename
    if not src.is_file():
        raise FileNotFoundError(f"Cannot snapshot missing file: {filename}")

    data = load_timeline(project_path)
    entries: list[dict[str, Any]] = data.get("entries", [])
    current = data.get("current_index", -1)

    # Truncate redo branch when editing from an earlier step
    if current >= 0 and current < len(entries) - 1:
        for old in entries[current + 1 :]:
            snap = project_path / "history" / old.get("snapshot", "")
            if snap and (project_path / "history" / snap).is_file():
                (project_path / "history" / snap).unlink()
        entries = entries[: current + 1]

    index = len(entries)
    hist = _history_dir(project_path)
    snapshot_name = f"{index:04d}_{src.stem}.glb"
    shutil.copy2(src, hist / snapshot_name)

    entry = {
        "index": index,
        "id": str(uuid.uuid4())[:8],
        "kind": kind,
        "label": label,
        "filename": filename,
        "snapshot": snapshot_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "meta": meta or {},
        "user_id": user_id,
        "user_name": user_name,
    }
    entries.append(entry)
    data["entries"] = entries
    data["current_index"] = index
    save_timeline(project_path, data)
    return entry


def go_to_index(project_path: Path, index: int) -> dict[str, Any]:
    """Restore viewer state to a timeline index (Fusion-style scrub)."""
    data = load_timeline(project_path)
    entries = data.get("entries", [])
    if index < 0 or index >= len(entries):
        raise IndexError(f"Timeline index out of range: {index}")

    entry = entries[index]
    snap_path = _history_dir(project_path) / entry["snapshot"]
    if not snap_path.is_file():
        raise FileNotFoundError(f"Snapshot missing: {entry['snapshot']}")

    dest = project_path / entry["filename"]
    shutil.copy2(snap_path, dest)

    data["current_index"] = index
    save_timeline(project_path, data)

    return {
        "index": index,
        "entry": entry,
        "filename": entry["filename"],
        "url": f"/api/projects/{project_path.name}/files/{entry['filename']}",
    }


def _entry_summary(entry: dict[str, Any]) -> str | None:
    kind = entry.get("kind")
    meta = entry.get("meta") or {}
    if kind == "prompt":
        p = meta.get("prompt") or ""
        if not p and entry.get("label", "").startswith("AI: "):
            p = entry["label"][4:].rstrip("…")
        return (p[:160] + "…") if len(p) > 160 else (p or None)
    if kind == "build":
        prog = meta.get("program") or {}
        return prog.get("name") or prog.get("description")
    if kind == "upload":
        return entry.get("filename")
    if kind == "transform":
        return "Move / rotate / scale"
    if kind == "extrude":
        d = meta.get("distance_mm")
        return f"Extrude {d:g} mm" if d is not None else entry.get("label")
    return None


def _entry_public(e: dict[str, Any]) -> dict[str, Any]:
    return {
        "index": e["index"],
        "id": e["id"],
        "kind": e["kind"],
        "label": e["label"],
        "filename": e["filename"],
        "created_at": e.get("created_at"),
        "user_id": e.get("user_id"),
        "user_name": e.get("user_name"),
        "summary": _entry_summary(e),
    }


def timeline_summary(project_path: Path) -> dict[str, Any]:
    data = load_timeline(project_path)
    return {
        "current_index": data.get("current_index", -1),
        "entries": [_entry_public(e) for e in data.get("entries", [])],
    }


def object_history_list(project_path: Path, *, limit: int = 100) -> list[dict[str, Any]]:
    """Newest-first audit log of model changes (same store as timeline)."""
    data = load_timeline(project_path)
    entries = data.get("entries", [])
    return [_entry_public(e) for e in reversed(entries[-limit:])]
