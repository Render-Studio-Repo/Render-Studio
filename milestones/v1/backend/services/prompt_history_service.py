"""Per-project AI prompt history (separate from mesh timeline)."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.services import history_service

HISTORY_FILE = "prompt_history.json"
MAX_ENTRIES = 200


def _path(project_path: Path) -> Path:
    return project_path / HISTORY_FILE


def load(project_path: Path) -> dict[str, Any]:
    path = _path(project_path)
    if not path.is_file():
        return {"entries": []}
    return json.loads(path.read_text())


def save(project_path: Path, data: dict[str, Any]) -> None:
    _path(project_path).write_text(json.dumps(data, indent=2))


def append_entry(
    project_path: Path,
    *,
    prompt: str,
    success: bool,
    message: str | None = None,
    filename: str | None = None,
    speed: str = "fast",
    error: str | None = None,
    references: list[dict[str, Any]] | None = None,
    trace_id: str | None = None,
    user_id: str | None = None,
    user_name: str | None = None,
) -> dict[str, Any]:
    data = load(project_path)
    entries: list[dict[str, Any]] = data.get("entries", [])
    entry = {
        "id": str(uuid.uuid4())[:10],
        "prompt": prompt,
        "success": success,
        "message": message,
        "filename": filename,
        "speed": speed,
        "error": error,
        "reference_count": len(references or []),
        "trace_id": trace_id,
        "user_id": user_id,
        "user_name": user_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    entries.append(entry)
    data["entries"] = entries[-MAX_ENTRIES:]
    save(project_path, data)
    return entry


def list_entries(project_path: Path, *, limit: int = 80) -> list[dict[str, Any]]:
    _backfill_from_timeline(project_path)
    data = load(project_path)
    entries = data.get("entries", [])
    return list(reversed(entries[-limit:]))


def _backfill_from_timeline(project_path: Path) -> None:
    """Import legacy prompt steps from timeline.json once."""
    data = load(project_path)
    if data.get("entries"):
        return
    timeline = history_service.load_timeline(project_path)
    imported: list[dict[str, Any]] = []
    for e in timeline.get("entries", []):
        if e.get("kind") != "prompt":
            continue
        meta = e.get("meta") or {}
        prompt = meta.get("prompt") or ""
        if not prompt and e.get("label", "").startswith("AI: "):
            prompt = e["label"][4:].rstrip("…")
        if not prompt:
            continue
        imported.append(
            {
                "id": e.get("id", str(uuid.uuid4())[:10]),
                "prompt": prompt,
                "success": True,
                "message": meta.get("message"),
                "filename": e.get("filename"),
                "speed": meta.get("speed", "fast"),
                "error": None,
                "reference_count": len(meta.get("references") or []),
                "trace_id": None,
                "user_id": e.get("user_id"),
                "user_name": e.get("user_name"),
                "created_at": e.get("created_at")
                or datetime.now(timezone.utc).isoformat(),
            }
        )
    if imported:
        save(project_path, {"entries": imported[-MAX_ENTRIES:]})
