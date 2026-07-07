"""Track in-flight CAD prompt/build jobs so clients can refresh and poll."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

GENERATION_FILE = "generation.json"
MAX_RUNNING_SECONDS = 20 * 60

_RUNNING_TRACES: dict[str, str] = {}
_CANCELED_PROJECTS: set[str] = set()
_CANCELED_TRACES: set[str] = set()


def _path(project_path: Path) -> Path:
    return project_path / GENERATION_FILE


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load(project_path: Path) -> dict[str, Any] | None:
    path = _path(project_path)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    return _normalize_stale(data)


def save(project_path: Path, data: dict[str, Any]) -> dict[str, Any]:
    if (is_canceled(project_path, data.get("trace_id")) and data.get("status") != "canceled") or not project_path.is_dir():
        return {**data, "status": "canceled", "error": data.get("error") or "Generation canceled."}
    data = dict(data)
    data["updated_at"] = _now_iso()
    _path(project_path).write_text(json.dumps(data, indent=2), encoding="utf-8")
    return data


def _normalize_stale(data: dict[str, Any] | None) -> dict[str, Any] | None:
    if not data or data.get("status") != "running":
        return data
    started = data.get("started_at")
    if not started:
        return data
    try:
        t0 = datetime.fromisoformat(str(started).replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - t0).total_seconds()
    except ValueError:
        return data
    if age > MAX_RUNNING_SECONDS:
        return {
            **data,
            "status": "failed",
            "error": "Generation timed out or was interrupted (server restart). Retry the prompt.",
            "updated_at": _now_iso(),
        }
    return data


def is_running(project_path: Path) -> bool:
    data = load(project_path)
    return bool(data and data.get("status") == "running")


def start(
    project_path: Path,
    *,
    kind: str,
    trace_id: str,
    user: dict[str, Any] | None = None,
    prompt: str | None = None,
    label: str | None = None,
    mode: str | None = None,
    request_body: dict[str, Any] | None = None,
    restart_count: int = 0,
    replace_running: bool = False,
) -> dict[str, Any]:
    if is_canceled(project_path):
        if is_running(project_path):
            raise GenerationCanceled("Generation canceled.")
        # Stale cancel flag from a previous run that already finished — clear it so a
        # new generation can start without being rejected.
        _CANCELED_PROJECTS.discard(project_path.name)
    if is_running(project_path) and not replace_running:
        current = load(project_path) or {}
        raise GenerationInProgress(current)
    if replace_running:
        _RUNNING_TRACES.pop(project_path.name, None)
    data: dict[str, Any] = {
        "status": "running",
        "kind": kind,
        "trace_id": trace_id,
        "started_at": _now_iso(),
        "updated_at": _now_iso(),
        "prompt": (prompt or "")[:500] if prompt else None,
        "label": label,
        "mode": (mode or "standard").lower() if mode else "standard",
        "by_user_id": user.get("id") if user else None,
        "by_user_name": user.get("display_name") if user else None,
        "restart_count": restart_count,
    }
    if request_body:
        data["request_body"] = request_body
    _CANCELED_PROJECTS.discard(project_path.name)
    _CANCELED_TRACES.discard(trace_id)
    _RUNNING_TRACES[project_path.name] = trace_id
    return save(project_path, data)


def complete(project_path: Path, result: dict[str, Any]) -> dict[str, Any]:
    if is_canceled(project_path):
        _RUNNING_TRACES.pop(project_path.name, None)
        return {"status": "canceled", "error": "Generation canceled."}
    data = load(project_path) or {}
    data.update(result)
    data["status"] = "complete"
    data["finished_at"] = _now_iso()
    out = save(project_path, data)
    _RUNNING_TRACES.pop(project_path.name, None)
    return out


def fail(project_path: Path, error: str, *, trace_id: str | None = None, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    if is_canceled(project_path, trace_id):
        _RUNNING_TRACES.pop(project_path.name, None)
        return {"status": "canceled", "error": "Generation canceled."}
    data = load(project_path) or {}
    if trace_id:
        data["trace_id"] = trace_id
    data["status"] = "failed"
    data["error"] = error
    data["finished_at"] = _now_iso()
    if extra:
        data.update({k: v for k, v in extra.items() if v is not None and k != "status"})
    out = save(project_path, data)
    _RUNNING_TRACES.pop(project_path.name, None)
    return out


def update_progress(
    project_path: Path,
    progress: dict[str, Any],
    *,
    trace_id: str | None = None,
) -> dict[str, Any] | None:
    """Persist live pipeline progress for client polling."""
    if is_canceled(project_path, trace_id) or not project_path.is_dir():
        return None
    data = load(project_path) or {}
    if data.get("status") != "running":
        return data
    if trace_id and data.get("trace_id") and str(data.get("trace_id")) != str(trace_id):
        return data
    stage = progress.get("stage")
    pct = progress.get("pct")
    label = progress.get("label")
    next_progress: dict[str, Any] = {}
    if stage is not None:
        next_progress["stage"] = stage
    if pct is not None:
        try:
            next_progress["pct"] = max(0, min(100, int(pct)))
        except (TypeError, ValueError):
            pass
    if label is not None:
        next_progress["label"] = str(label)[:240]
    if not next_progress:
        return data
    data["progress"] = next_progress
    if trace_id:
        data["trace_id"] = trace_id
    return save(project_path, data)


def request_cancel(project_path: Path, *, reason: str = "Canceled by user.") -> dict[str, Any]:
    """Mark any in-flight job for this project as canceled.

    BackgroundTasks run in-process and cannot be killed while an OpenAI request is
    blocking, so workers check this token before building/exporting/writing.
    """
    project_id = project_path.name
    _CANCELED_PROJECTS.add(project_id)
    trace_id = _RUNNING_TRACES.pop(project_id, None)
    data = load(project_path) or {}
    trace_id = trace_id or data.get("trace_id")
    if trace_id:
        _CANCELED_TRACES.add(str(trace_id))
    if project_path.is_dir() and data.get("status") == "running":
        data.update(
            {
                "status": "canceled",
                "error": reason,
                "trace_id": trace_id,
                "finished_at": _now_iso(),
            }
        )
        try:
            save(project_path, data)
        except OSError:
            pass
    return {"status": "canceled", "trace_id": trace_id, "error": reason}


def cancel_project(project_path: Path) -> dict[str, Any]:
    """Cancel generation because the project is being deleted."""
    return request_cancel(project_path, reason="Project was deleted.")


def is_canceled(project_path: Path, trace_id: str | None = None) -> bool:
    if project_path.name in _CANCELED_PROJECTS:
        return True
    if trace_id and str(trace_id) in _CANCELED_TRACES:
        return True
    return False


def public_summary(project_path: Path) -> dict[str, Any]:
    data = load(project_path)
    if not data:
        return {"status": "idle"}
    out = {k: data.get(k) for k in (
        "status", "kind", "trace_id", "started_at", "updated_at", "finished_at",
        "prompt", "label", "message", "filename", "url", "error",
        "timeline_index", "prompt_id", "by_user_id", "by_user_name", "mode",
    )}
    if data.get("progress"):
        out["progress"] = data.get("progress")
    if data.get("status") == "complete" and data.get("filename"):
        pid = project_path.name
        out.setdefault("url", f"/api/projects/{pid}/files/{data['filename']}")
    return out


def find_stuck_jobs(projects_root: Path) -> list[dict[str, Any]]:
    """Scan all projects for generations that were running when the server last stopped.

    Returns list of dicts with: project_path, project_id, trace_id, data.
    Only returns jobs that have a saved request_body (so they can be re-queued)
    and have been running for less than MAX_RUNNING_SECONDS (not timed-out yet).
    Capped at 1 restart attempt to avoid infinite loops.
    """
    now = datetime.now(timezone.utc)
    results = []
    if not projects_root.is_dir():
        return results
    for d in projects_root.iterdir():
        if not d.is_dir() or d.name.startswith("."):
            continue
        gen_file = d / GENERATION_FILE
        if not gen_file.is_file():
            continue
        try:
            data = json.loads(gen_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if data.get("status") != "running":
            continue
        if not data.get("request_body"):
            continue
        if data.get("restart_count", 0) >= 2:
            continue
        started = data.get("started_at")
        if not started:
            continue
        try:
            t0 = datetime.fromisoformat(str(started).replace("Z", "+00:00"))
            age = (now - t0).total_seconds()
        except ValueError:
            continue
        if age > MAX_RUNNING_SECONDS:
            continue
        results.append({
            "project_path": d,
            "project_id": d.name,
            "trace_id": data.get("trace_id"),
            "data": data,
        })
    return results


class GenerationInProgress(Exception):
    def __init__(self, current: dict[str, Any]) -> None:
        self.current = current
        super().__init__("Generation already in progress for this project")


class GenerationCanceled(Exception):
    def __init__(self, message: str = "Generation canceled.") -> None:
        self.message = message
        super().__init__(message)
