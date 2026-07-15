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
    user_avatar_url: str | None = None,
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
        "user_avatar_url": user_avatar_url,
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
        user_avatar_url=timeline_entry.get("user_avatar_url"),
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
                "user_avatar_url": e.get("user_avatar_url"),
                "created_at": e.get("created_at") or datetime.now(timezone.utc).isoformat(),
                "timeline_index": e.get("index"),
                "filename": e.get("filename"),
                "restorable": True,
                "meta": e.get("meta") or {},
            }
        )
    if imported:
        save(project_path, {"entries": imported[-MAX_ENTRIES:]})


def _prompt_log_key(entry: dict[str, Any]) -> str | None:
    prompt_id = str(entry.get("id") or "").strip()
    if prompt_id:
        return f"id:{prompt_id}"
    prompt = str(entry.get("prompt") or entry.get("original_prompt") or "").strip()
    created = str(entry.get("created_at") or "").strip()
    if prompt and created:
        return f"prompt:{created}:{prompt[:120]}"
    return None


def _prompt_text_key(text: str | None, filename: str | None = None) -> str | None:
    prompt = " ".join(str(text or "").split()).strip().lower()
    if not prompt:
        return None
    file_key = Path(str(filename or "")).stem.lstrip(".").lower()
    return f"text:{file_key}:{prompt[:160]}"


def _sync_missing_prompt_history(project_path: Path) -> bool:
    """Import AI prompt rows into the project log when timeline logging was skipped/trimmed."""
    try:
        from backend.services import prompt_history_service
    except Exception:
        return False

    try:
        prompt_entries = prompt_history_service.list_entries(project_path, limit=200, kind="cad")
    except Exception:
        return False
    if not prompt_entries:
        return False

    data = load(project_path)
    entries: list[dict[str, Any]] = data.get("entries", [])
    existing_ids = {str(e.get("id") or "") for e in entries if e.get("id")}
    existing_prompt_keys = set()
    existing_text_keys = set()
    for e in entries:
        if e.get("kind") != "prompt":
            continue
        meta = e.get("meta") or {}
        key = _prompt_log_key(
            {
                "id": meta.get("prompt_id") or e.get("id"),
                "prompt": meta.get("prompt") or e.get("summary") or e.get("label"),
                "created_at": e.get("created_at"),
            }
        )
        if key:
            existing_prompt_keys.add(key)
        text_key = _prompt_text_key(
            meta.get("prompt") or e.get("summary") or e.get("label"),
            e.get("filename"),
        )
        if text_key:
            existing_text_keys.add(text_key)

    changed = False
    for pe in prompt_entries:
        prompt_text = str(pe.get("prompt") or pe.get("original_prompt") or "").strip()
        if not prompt_text:
            continue
        key = _prompt_log_key(pe)
        text_key = _prompt_text_key(prompt_text, pe.get("filename") or pe.get("base_filename"))
        pid = str(pe.get("id") or "").strip()
        if pid and pid in existing_ids:
            continue
        if key and key in existing_prompt_keys:
            continue
        if text_key and text_key in existing_text_keys:
            continue
        label_src = prompt_text[:48] + ("…" if len(prompt_text) > 48 else "")
        entry = {
            "id": pid or str(uuid.uuid4())[:10],
            "kind": "prompt",
            "label": f"AI: {label_src}",
            "summary": (prompt_text[:160] + "…") if len(prompt_text) > 160 else prompt_text,
            "user_id": pe.get("user_id"),
            "user_name": pe.get("user_name"),
            "user_avatar_url": pe.get("user_avatar_url"),
            "created_at": pe.get("created_at") or datetime.now(timezone.utc).isoformat(),
            "timeline_index": None,
            "filename": pe.get("filename") or pe.get("base_filename"),
            "restorable": False,
            "meta": {
                "prompt": prompt_text,
                "prompt_id": pid or None,
                "model": pe.get("model"),
                "provider": pe.get("provider"),
                "prompt_mode": pe.get("prompt_mode"),
                "speed": pe.get("speed"),
                "success": pe.get("success"),
                "source": "prompt_history",
            },
        }
        entries.append(entry)
        if pid:
            existing_ids.add(pid)
        if key:
            existing_prompt_keys.add(key)
        if text_key:
            existing_text_keys.add(text_key)
        changed = True

    if not changed:
        return False

    entries.sort(key=lambda e: str(e.get("created_at") or ""))
    data["entries"] = entries[-MAX_ENTRIES:]
    save(project_path, data)
    return True


def _sync_missing_timeline_entries(project_path: Path) -> bool:
    """Append timeline steps that never made it into project_log.json."""
    data = load(project_path)
    entries: list[dict[str, Any]] = data.get("entries", [])
    existing_tids = {
        int(e["timeline_index"])
        for e in entries
        if e.get("timeline_index") is not None
    }
    timeline = history_service.load_timeline(project_path)
    changed = False
    for e in timeline.get("entries", []):
        tid = e.get("index")
        if tid is None or int(tid) in existing_tids:
            continue
        entries.append(
            {
                "id": e.get("id", str(uuid.uuid4())[:10]),
                "kind": e.get("kind", "change"),
                "label": e.get("label", "Change"),
                "summary": history_service._entry_summary(e),
                "user_id": e.get("user_id"),
                "user_name": e.get("user_name"),
                "user_avatar_url": e.get("user_avatar_url"),
                "created_at": e.get("created_at") or datetime.now(timezone.utc).isoformat(),
                "timeline_index": tid,
                "filename": e.get("filename"),
                "restorable": True,
                "meta": e.get("meta") or {},
            }
        )
        existing_tids.add(int(tid))
        changed = True
    if not changed:
        return False
    entries.sort(key=lambda e: str(e.get("created_at") or ""))
    data["entries"] = entries[-MAX_ENTRIES:]
    save(project_path, data)
    return True


def list_events(project_path: Path, *, limit: int = 150) -> list[dict[str, Any]]:
    _backfill_from_timeline(project_path)
    _sync_missing_timeline_entries(project_path)
    _sync_missing_prompt_history(project_path)
    data = load(project_path)
    entries = data.get("entries", [])
    return list(reversed(entries[-limit:]))
