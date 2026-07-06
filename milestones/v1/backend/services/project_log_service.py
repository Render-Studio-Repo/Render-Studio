"""Full project activity log (model + metadata events) with timeline links."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.services import history_service

LOG_FILE = "project_log.json"
MAX_ENTRIES = 500


def _path(project_path: Path) -> Path:
    return project_path / LOG_FILE


def load(project_path: Path) -> dict[str, Any]:
    path = _path(project_path)
    if not path.is_file():
        return {"entries": []}
    return json.loads(path.read_text())


def save(project_path: Path, data: dict[str, Any]) -> None:
    _path(project_path).write_text(json.dumps(data, indent=2))


def _summary(kind: str, label: str, meta: dict[str, Any]) -> str | None:
    if kind == "prompt":
        p = meta.get("prompt") or ""
        if not p and label.startswith("AI: "):
            p = label[4:].rstrip("…")
        return (p[:160] + "…") if len(p) > 160 else (p or None)
    if kind == "build":
        prog = meta.get("program") or {}
        return prog.get("name") or prog.get("description")
    if kind == "extrude":
        d = meta.get("distance_mm")
        return f"Extrude {d:g} mm" if d is not None else label
    if kind == "transform":
        return "Move / rotate / scale"
    if kind == "upload":
        return label
    if kind == "project_moved":
        return meta.get("folder_name") or label
    if kind == "project_renamed":
        return meta.get("new_name") or label
    return label


def append_event(
    project_path: Path,
    *,
    kind: str,
    label: str,
    user_id: str | None = None,
    user_name: str | None = None,
    timeline_index: int | None = None,
    filename: str | None = None,
    meta: dict[str, Any] | None = None,
    restorable: bool = False,
    entry_id: str | None = None,
) -> dict[str, Any]:
    data = load(project_path)
    entries: list[dict[str, Any]] = data.get("entries", [])
    meta = meta or {}
    entry = {
        "id": entry_id or str(uuid.uuid4())[:10],
        "kind": kind,
        "label": label,
        "summary": _summary(kind, label, meta),
        "user_id": user_id,
        "user_name": user_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "timeline_index": timeline_index,
        "filename": filename,
        "restorable": restorable,
        "meta": meta,
    }
    entries.append(entry)
    data["entries"] = entries[-MAX_ENTRIES:]
    save(project_path, data)
    return entry


def log_timeline_entry(project_path: Path, timeline_entry: dict[str, Any]) -> dict[str, Any]:
    """Record a mesh timeline step in the project log."""
    tid = timeline_entry.get("index")
    data = load(project_path)
    if any(e.get("timeline_index") == tid for e in data.get("entries", [])):
        return timeline_entry
    return append_event(
        project_path,
        kind=timeline_entry.get("kind", "change"),
        label=timeline_entry.get("label", "Change"),
        user_id=timeline_entry.get("user_id"),
        user_name=timeline_entry.get("user_name"),
        timeline_index=tid,
        filename=timeline_entry.get("filename"),
        meta=timeline_entry.get("meta") or {},
        restorable=True,
        entry_id=timeline_entry.get("id"),
    )


def _backfill_from_timeline(project_path: Path) -> None:
    data = load(project_path)
    if data.get("entries"):
        return
    timeline = history_service.load_timeline(project_path)
    imported: list[dict[str, Any]] = []
    for e in timeline.get("entries", []):
        imported.append(
            {
                "id": e.get("id", str(uuid.uuid4())[:10]),
                "kind": e.get("kind", "change"),
                "label": e.get("label", "Change"),
                "summary": history_service._entry_summary(e),
                "user_id": e.get("user_id"),
                "user_name": e.get("user_name"),
                "created_at": e.get("created_at") or datetime.now(timezone.utc).isoformat(),
                "timeline_index": e.get("index"),
                "filename": e.get("filename"),
                "restorable": True,
                "meta": e.get("meta") or {},
            }
        )
    if imported:
        save(project_path, {"entries": imported[-MAX_ENTRIES:]})


def list_events(project_path: Path, *, limit: int = 150) -> list[dict[str, Any]]:
    _backfill_from_timeline(project_path)
    data = load(project_path)
    entries = data.get("entries", [])
    return list(reversed(entries[-limit:]))
