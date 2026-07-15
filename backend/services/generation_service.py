"""Track in-flight CAD prompt/build jobs so clients can refresh and poll."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

GENERATION_FILE = "generation.json"
MAX_RUNNING_SECONDS = 20 * 60

_RUNNING_TRACES: dict[str, str] = {}
_CANCELED_PROJECTS: set[str] = set()
_CANCELED_TRACES: set[str] = set()
_listeners: list[Any] = []


def register_listener(fn: Any) -> None:
    _listeners.append(fn)


def _emit(project_path: Path, data: dict[str, Any]) -> None:
    for fn in _listeners:
        try:
            fn(project_path, data)
        except Exception as exc:
            logger.debug("generation listener failed: %s", exc)


def _user_avatar_url(user: dict[str, Any] | None) -> str | None:
    if not user:
        return None
    existing = str(user.get("avatar_url") or user.get("by_avatar_url") or "").strip()
    if existing.startswith("/api/users/"):
        return existing.split("?", 1)[0]
    uid = user.get("id")
    if not uid:
        return None
    safe_id = "".join(ch for ch in str(uid) if ch.isalnum() or ch in {"-", "_"})[:80]
    return f"/api/users/{safe_id}/avatar" if safe_id else None


def _path(project_path: Path) -> Path:
    return project_path / GENERATION_FILE


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _process_is_alive(pid: Any) -> bool:
    try:
        value = int(pid)
    except (TypeError, ValueError):
        return False
    if value <= 0:
        return False
    try:
        os.kill(value, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _normalize_stale(data: dict[str, Any] | None, *, project_path: Path | None = None) -> dict[str, Any] | None:
    """Fail only truly abandoned jobs — never timeout a live worker mid-CAD/AI."""
    if not data or data.get("status") != "running":
        return data
    # Live uvicorn/worker process still owns this job — keep it running even past
    # 20 minutes so long DXF/CAD prompts are not false-failed into the UI.
    if _process_is_alive(data.get("worker_pid")):
        return data

    heartbeat = data.get("updated_at") or data.get("started_at")
    if not heartbeat:
        return data
    try:
        t0 = datetime.fromisoformat(str(heartbeat).replace("Z", "+00:00"))
        idle = (datetime.now(timezone.utc) - t0).total_seconds()
    except ValueError:
        return data
    # Worker is dead. Give a short grace for restarts, then persist failure once.
    if idle <= 90:
        return data

    error = (
        f"Generation timed out after {int(MAX_RUNNING_SECONDS / 60)} minutes "
        "(still waiting on AI/CAD). Cancel and retry, or simplify the prompt."
    )
    failed = {
        **data,
        "status": "failed",
        "error": error,
        "finished_at": data.get("finished_at") or _now_iso(),
        "updated_at": _now_iso(),
    }
    _RUNNING_TRACES.pop(str(Path(project_path).name if project_path else data.get("project_id") or ""), None)
    if project_path is not None and project_path.is_dir():
        try:
            # Persist so the UI doesn't keep re-popping this on every poll/Generate.
            path = _path(project_path)
            tmp_path = path.with_name(f"{path.name}.tmp")
            tmp_path.write_text(json.dumps(failed, indent=2), encoding="utf-8")
            tmp_path.replace(path)
            _emit(project_path, failed)
        except OSError:
            logger.debug("Could not persist stale generation failure for %s", project_path.name, exc_info=True)
    return failed


def load(project_path: Path) -> dict[str, Any] | None:
    path = _path(project_path)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    return _normalize_stale(data, project_path=project_path)


def save(project_path: Path, data: dict[str, Any]) -> dict[str, Any]:
    if (is_canceled(project_path, data.get("trace_id")) and data.get("status") != "canceled") or not project_path.is_dir():
        return {**data, "status": "canceled", "error": data.get("error") or "Generation canceled."}
    data = dict(data)
    data["updated_at"] = _now_iso()
    path = _path(project_path)
    tmp_path = path.with_name(f"{path.name}.tmp")
    tmp_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp_path.replace(path)
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
        "by_avatar_url": _user_avatar_url(user),
        "restart_count": restart_count,
        "worker_pid": os.getpid(),
    }
    if request_body:
        data["request_body"] = request_body
    _CANCELED_PROJECTS.discard(project_path.name)
    _CANCELED_TRACES.discard(trace_id)
    _RUNNING_TRACES[project_path.name] = trace_id
    out = save(project_path, data)
    _emit(project_path, out)
    return out


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
    _emit(project_path, out)
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
    _emit(project_path, out)
    return out


PIPELINE_CHECKLIST = (
    {"id": "analyze", "label": "Analyze prompt & references"},
    {"id": "brief", "label": "Write CAD brief"},
    {"id": "ai_source", "label": "Write / edit build123d source"},
    {"id": "step", "label": "Run scripts/step (STEP / GLB)"},
    {"id": "inspect", "label": "Inspect geometry (facts / planes)"},
    {"id": "snapshot", "label": "Render multi-view snapshot"},
    {"id": "snapshot_review", "label": "Visual review (fail-closed)"},
    {"id": "finalize", "label": "Finalize artifacts"},
)

_STAGE_ALIASES = {
    "analyze": "analyze",
    "plan": "analyze",
    "build": "step",
    "brief": "brief",
    "ai_source": "ai_source",
    "step": "step",
    "inspect": "inspect",
    "inspect-quality": "inspect",
    "snapshot": "snapshot",
    "snapshot_review": "snapshot_review",
    "finalize": "finalize",
}


def _checklist_for_stage(stage: str | None, *, current_label: str | None = None) -> list[dict[str, Any]]:
    """Jake-style pipeline checklist derived from the active progress stage."""
    normalized = _STAGE_ALIASES.get(str(stage or "").strip().lower(), "")
    ids = [item["id"] for item in PIPELINE_CHECKLIST]
    active_idx = ids.index(normalized) if normalized in ids else -1
    out: list[dict[str, Any]] = []
    for i, item in enumerate(PIPELINE_CHECKLIST):
        if active_idx < 0:
            status = "pending"
        elif i < active_idx:
            status = "done"
        elif i == active_idx:
            status = "active"
        else:
            status = "pending"
        entry = {"id": item["id"], "label": item["label"], "status": status}
        if status == "active" and current_label:
            entry["detail"] = str(current_label)[:240]
        out.append(entry)
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
    detail = progress.get("detail") or progress.get("thinking")
    prev = data.get("progress") if isinstance(data.get("progress"), dict) else {}
    next_progress: dict[str, Any] = dict(prev or {})
    if stage is not None:
        next_progress["stage"] = stage
    if pct is not None:
        try:
            next_progress["pct"] = max(0, min(100, int(pct)))
        except (TypeError, ValueError):
            pass
    if label is not None:
        next_progress["label"] = str(label)[:240]
    if detail is not None:
        next_progress["thinking"] = str(detail)[:500]
    elif label is not None:
        next_progress["thinking"] = str(label)[:500]

    # Prefer caller-supplied checklist; otherwise derive Jake pipeline checklist.
    if isinstance(progress.get("checklist"), list) and progress.get("checklist"):
        next_progress["checklist"] = progress["checklist"][:16]
    else:
        next_progress["checklist"] = _checklist_for_stage(
            next_progress.get("stage"),
            current_label=next_progress.get("label"),
        )

    # Rolling activity log (what the agent is doing).
    activity = list(next_progress.get("activity") or [])
    incoming = progress.get("activity")
    if isinstance(incoming, list):
        for item in incoming:
            if isinstance(item, dict) and item.get("text"):
                activity.append({
                    "ts": item.get("ts") or _now_iso(),
                    "text": str(item.get("text"))[:300],
                    "stage": item.get("stage") or next_progress.get("stage"),
                })
            elif isinstance(item, str) and item.strip():
                activity.append({"ts": _now_iso(), "text": item.strip()[:300], "stage": next_progress.get("stage")})
    elif label is not None:
        last = activity[-1]["text"] if activity and isinstance(activity[-1], dict) else None
        if last != str(label)[:300]:
            activity.append({
                "ts": _now_iso(),
                "text": str(label)[:300],
                "stage": next_progress.get("stage"),
            })
    next_progress["activity"] = activity[-40:]

    if not next_progress:
        return data
    data["progress"] = next_progress
    if trace_id:
        data["trace_id"] = trace_id
    return save(project_path, data)


def request_cancel(project_path: Path, *, reason: str = "Canceled by user.") -> dict[str, Any]:
    """Mark any in-flight job for this project as canceled and kill CAD subprocesses.

    BackgroundTasks run in-process, so we cannot kill the uvicorn worker itself.
    We do kill scripts/step (and other skill tools) immediately, and AI calls
    poll the cancel flag so they abort within ~1s.
    """
    project_id = project_path.name
    _CANCELED_PROJECTS.add(project_id)
    trace_id = _RUNNING_TRACES.pop(project_id, None)
    data = load(project_path) or {}
    trace_id = trace_id or data.get("trace_id")
    if trace_id:
        _CANCELED_TRACES.add(str(trace_id))

    killed = 0
    try:
        from backend.services import skill_runner

        killed = skill_runner.kill_active_for_project(project_path, reason=reason)
    except Exception as exc:
        logger.warning("Failed to kill skill tools on cancel for %s: %s", project_id, exc)

    if project_path.is_dir() and data.get("status") == "running":
        data.update(
            {
                "status": "canceled",
                "error": reason,
                "trace_id": trace_id,
                "finished_at": _now_iso(),
                "killed_subprocesses": killed,
            }
        )
        try:
            # Bypass is_canceled rewrite in save() by writing directly once marked.
            path = _path(project_path)
            data["updated_at"] = _now_iso()
            tmp_path = path.with_name(f"{path.name}.tmp")
            tmp_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
            tmp_path.replace(path)
            _emit(project_path, data)
        except OSError:
            pass
    return {
        "status": "canceled",
        "trace_id": trace_id,
        "error": reason,
        "killed_subprocesses": killed,
    }


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
        "timeline_index", "prompt_id", "by_user_id", "by_user_name", "by_avatar_url", "mode",
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
        if _process_is_alive(data.get("worker_pid")):
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
