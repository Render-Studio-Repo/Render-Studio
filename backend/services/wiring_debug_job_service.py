"""Track in-flight circuit photo diagnoses so clients can refresh and poll."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEBUG_JOB_FILE = "wiring-debug-job.json"
MAX_RUNNING_SECONDS = 5 * 60
STALE_RUNNING_SECONDS = 3 * 60


def _path(project_path: Path) -> Path:
    return project_path / DEBUG_JOB_FILE


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
    normalized = _normalize_stale(data)
    if (
        normalized
        and data
        and data.get("status") == "running"
        and normalized.get("status") == "failed"
    ):
        save(project_path, normalized)
    return normalized


def _running_age_seconds(data: dict[str, Any]) -> float | None:
    started = data.get("started_at")
    if not started:
        return None
    try:
        t0 = datetime.fromisoformat(str(started).replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - t0).total_seconds()
    except ValueError:
        return None


def fail_stale_running(project_path: Path) -> dict[str, Any] | None:
    """Fail a running job that exceeded the stale window (orphaned after restart)."""
    raw_path = _path(project_path)
    if not raw_path.is_file():
        return None
    try:
        data = json.loads(raw_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if data.get("status") != "running":
        return data
    age = _running_age_seconds(data)
    if age is None or age <= STALE_RUNNING_SECONDS:
        return data
    return fail(
        project_path,
        "Diagnosis was interrupted or timed out. Please try again — use a clear photo and the fast model.",
        trace_id=data.get("trace_id"),
    )


def fail_orphaned_on_startup(projects_root: Path) -> int:
    """Mark every in-flight debug job as failed after a server restart."""
    count = 0
    if not projects_root.is_dir():
        return count
    for project_dir in projects_root.iterdir():
        if not project_dir.is_dir() or project_dir.name.startswith("."):
            continue
        job_path = project_dir / DEBUG_JOB_FILE
        if not job_path.is_file():
            continue
        try:
            data = json.loads(job_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if data.get("status") != "running":
            continue
        fail(
            project_dir,
            "Diagnosis interrupted by server restart. Please run it again.",
            trace_id=data.get("trace_id"),
        )
        count += 1
    return count


def request_cancel(project_path: Path, *, reason: str = "Canceled by user.") -> dict[str, Any]:
    data = load(project_path) or {}
    if data.get("status") != "running":
        return public_summary(project_path)
    trace_id = data.get("trace_id")
    fail(project_path, reason, trace_id=trace_id)
    return public_summary(project_path)


def save(project_path: Path, data: dict[str, Any]) -> dict[str, Any]:
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
            "error": "Diagnosis timed out or was interrupted (server restart). Retry with a clearer photo.",
            "updated_at": _now_iso(),
        }
    return data


def is_running(project_path: Path) -> bool:
    data = load(project_path)
    return bool(data and data.get("status") == "running")


def start(
    project_path: Path,
    *,
    trace_id: str,
    user: dict[str, Any] | None = None,
) -> dict[str, Any]:
    fail_stale_running(project_path)
    if is_running(project_path):
        current = load(project_path) or {}
        raise DebugJobInProgress(current)
    data: dict[str, Any] = {
        "status": "running",
        "kind": "wiring-debug",
        "trace_id": trace_id,
        "started_at": _now_iso(),
        "updated_at": _now_iso(),
        "by_user_id": user.get("id") if user else None,
        "by_user_name": user.get("display_name") if user else None,
    }
    return save(project_path, data)


def complete(project_path: Path, result: dict[str, Any]) -> dict[str, Any]:
    data = load(project_path) or {}
    data.update(result)
    data["status"] = "complete"
    data["finished_at"] = _now_iso()
    return save(project_path, data)


def fail(project_path: Path, error: str, *, trace_id: str | None = None) -> dict[str, Any]:
    data = load(project_path) or {}
    if trace_id:
        data["trace_id"] = trace_id
    data["status"] = "failed"
    data["error"] = error
    data["finished_at"] = _now_iso()
    return save(project_path, data)


def public_summary(project_path: Path) -> dict[str, Any]:
    fail_stale_running(project_path)
    data = load(project_path)
    if not data:
        return {"status": "idle"}
    out = {k: data.get(k) for k in (
        "status",
        "kind",
        "trace_id",
        "started_at",
        "updated_at",
        "finished_at",
        "error",
        "diagnosis",
        "trace",
        "by_user_id",
        "by_user_name",
    )}
    return out


class DebugJobInProgress(Exception):
    def __init__(self, current: dict[str, Any]) -> None:
        self.current = current
        super().__init__("Circuit diagnosis already in progress for this project")
