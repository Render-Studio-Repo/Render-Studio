"""Track in-flight CAD prompt/build jobs so clients can refresh and poll.

Supports multiple concurrent prompt jobs per project. ``generation.json`` keeps a
``jobs`` array; top-level fields mirror the primary (newest running) job for
backward-compatible clients.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

GENERATION_FILE = "generation.json"
MAX_RUNNING_SECONDS = 20 * 60
MAX_PARALLEL_PROMPT_JOBS = 5

_RUNNING_TRACES: dict[str, set[str]] = {}
_CANCELED_PROJECTS: set[str] = set()
_CANCELED_TRACES: set[str] = set()
_listeners: list[Any] = []
_FILE_LOCKS: dict[str, threading.RLock] = {}
_FILE_LOCKS_GUARD = threading.Lock()

_JOB_PUBLIC_KEYS = (
    "id",
    "status",
    "kind",
    "trace_id",
    "started_at",
    "updated_at",
    "finished_at",
    "prompt",
    "label",
    "message",
    "filename",
    "url",
    "error",
    "timeline_index",
    "prompt_id",
    "by_user_id",
    "by_user_name",
    "by_avatar_url",
    "mode",
    "benign_interrupt",
    "model",
    "provider",
    "speed",
    "progress",
    "target_mode",
    "codex_agent",
)


def register_listener(fn: Any) -> None:
    _listeners.append(fn)


def _emit(project_path: Path, data: dict[str, Any]) -> None:
    for fn in _listeners:
        try:
            fn(project_path, data)
        except Exception as exc:
            logger.warning("generation listener failed: %s", exc, exc_info=True)


def _file_lock(project_path: Path) -> threading.RLock:
    key = project_path.name
    with _FILE_LOCKS_GUARD:
        lock = _FILE_LOCKS.get(key)
        if lock is None:
            lock = threading.RLock()
            _FILE_LOCKS[key] = lock
        return lock


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


def _running_set(project_id: str) -> set[str]:
    return _RUNNING_TRACES.setdefault(project_id, set())


def _track_running(project_id: str, trace_id: str | None) -> None:
    if not trace_id:
        return
    _running_set(project_id).add(str(trace_id))


def _untrack_running(project_id: str, trace_id: str | None = None) -> None:
    if trace_id is None:
        _RUNNING_TRACES.pop(project_id, None)
        return
    traces = _RUNNING_TRACES.get(project_id)
    if not traces:
        return
    traces.discard(str(trace_id))
    if not traces:
        _RUNNING_TRACES.pop(project_id, None)


def _job_id(job: dict[str, Any]) -> str:
    return str(job.get("id") or job.get("trace_id") or "")


def _jobs_from_data(data: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not data:
        return []
    jobs = data.get("jobs")
    if isinstance(jobs, list) and jobs:
        out: list[dict[str, Any]] = []
        for raw in jobs:
            if not isinstance(raw, dict):
                continue
            job = dict(raw)
            if not job.get("id") and job.get("trace_id"):
                job["id"] = str(job["trace_id"])
            out.append(job)
        return out
    # Legacy single-job file → synthesize jobs array.
    if data.get("status") or data.get("trace_id") or data.get("prompt"):
        job = {k: data[k] for k in data.keys() if k not in {"jobs", "running_count", "version", "request_body"}}
        if data.get("request_body") is not None:
            job["request_body"] = data.get("request_body")
        if not job.get("id") and job.get("trace_id"):
            job["id"] = str(job["trace_id"])
        if not job.get("status"):
            job["status"] = data.get("status") or "idle"
        return [job]
    return []


def _sort_jobs(jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def key(job: dict[str, Any]) -> tuple[int, str]:
        running = 0 if job.get("status") == "running" else 1
        started = str(job.get("started_at") or job.get("updated_at") or "")
        return (running, started)

    return sorted(jobs, key=key)


def _primary_job(jobs: list[dict[str, Any]]) -> dict[str, Any] | None:
    running = [j for j in jobs if j.get("status") == "running"]
    if running:
        return sorted(running, key=lambda j: str(j.get("started_at") or ""), reverse=True)[0]
    if not jobs:
        return None
    return sorted(jobs, key=lambda j: str(j.get("finished_at") or j.get("updated_at") or ""), reverse=True)[0]


def _aggregate_status(jobs: list[dict[str, Any]]) -> str:
    if any(j.get("status") == "running" for j in jobs):
        return "running"
    if not jobs:
        return "idle"
    primary = _primary_job(jobs) or {}
    return str(primary.get("status") or "idle")


def _compose_document(jobs: list[dict[str, Any]]) -> dict[str, Any]:
    jobs = _sort_jobs([dict(j) for j in jobs])
    # Keep finished jobs bounded so the file does not grow forever.
    running = [j for j in jobs if j.get("status") == "running"]
    finished = [j for j in jobs if j.get("status") != "running"][-12:]
    jobs = _sort_jobs(running + finished)
    primary = _primary_job(jobs) or {}
    data: dict[str, Any] = {
        "version": 2,
        "status": _aggregate_status(jobs),
        "jobs": jobs,
        "running_count": sum(1 for j in jobs if j.get("status") == "running"),
    }
    # Mirror primary job at top level for older clients.
    for key in (
        "kind",
        "trace_id",
        "started_at",
        "updated_at",
        "finished_at",
        "prompt",
        "label",
        "message",
        "filename",
        "url",
        "error",
        "timeline_index",
        "prompt_id",
        "by_user_id",
        "by_user_name",
        "by_avatar_url",
        "mode",
        "benign_interrupt",
        "model",
        "provider",
        "speed",
        "progress",
        "restart_count",
        "worker_pid",
        "request_body",
        "target_mode",
        "codex_agent",
    ):
        if key in primary and primary.get(key) is not None:
            data[key] = primary.get(key)
    return data


def _write_unlocked(project_path: Path, data: dict[str, Any]) -> dict[str, Any]:
    data = dict(data)
    data["updated_at"] = _now_iso()
    path = _path(project_path)
    tmp_path = path.with_name(f"{path.name}.tmp")
    tmp_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp_path.replace(path)
    return data


def _normalize_job_stale(job: dict[str, Any], *, project_path: Path | None = None) -> dict[str, Any]:
    if job.get("status") != "running":
        return job
    if _process_is_alive(job.get("worker_pid")):
        return job
    heartbeat = job.get("updated_at") or job.get("started_at")
    if not heartbeat:
        return job
    try:
        t0 = datetime.fromisoformat(str(heartbeat).replace("Z", "+00:00"))
        idle = (datetime.now(timezone.utc) - t0).total_seconds()
    except ValueError:
        return job
    if idle <= 90:
        return job
    error = (
        f"Generation timed out after {int(MAX_RUNNING_SECONDS / 60)} minutes "
        "(still waiting on AI/CAD). Cancel and retry, or simplify the prompt."
    )
    failed = {
        **job,
        "status": "failed",
        "error": error,
        "finished_at": job.get("finished_at") or _now_iso(),
        "updated_at": _now_iso(),
    }
    _untrack_running(project_path.name if project_path else "", job.get("trace_id"))
    return failed


def _normalize_stale(data: dict[str, Any] | None, *, project_path: Path | None = None) -> dict[str, Any] | None:
    """Fail only truly abandoned jobs — never timeout a live worker mid-CAD/AI."""
    if not data:
        return data
    jobs = _jobs_from_data(data)
    if not jobs:
        return data
    changed = False
    normalized: list[dict[str, Any]] = []
    for job in jobs:
        next_job = _normalize_job_stale(job, project_path=project_path)
        if next_job is not job and next_job.get("status") != job.get("status"):
            changed = True
        normalized.append(next_job)
    composed = _compose_document(normalized)
    if changed and project_path is not None and project_path.is_dir():
        try:
            with _file_lock(project_path):
                _write_unlocked(project_path, composed)
            _emit(project_path, composed)
        except OSError:
            logger.debug("Could not persist stale generation failure for %s", project_path.name, exc_info=True)
    return composed


def load(project_path: Path) -> dict[str, Any] | None:
    path = _path(project_path)
    if not path.is_file():
        return None
    try:
        with _file_lock(project_path):
            data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    return _normalize_stale(data, project_path=project_path)


def save(project_path: Path, data: dict[str, Any]) -> dict[str, Any]:
    """Persist a full document. Prefer job helpers (start/complete/…) for multi-job safety."""
    with _file_lock(project_path):
        jobs = _jobs_from_data(data)
        # If caller passed a legacy single-job dict, recompose.
        if data.get("jobs") is None and (data.get("status") or data.get("trace_id")):
            jobs = _jobs_from_data(data)
        composed = _compose_document(jobs) if jobs else dict(data)
        # Honor cancel flags for the primary / all running jobs.
        for job in _jobs_from_data(composed):
            if job.get("status") == "running" and is_canceled(project_path, job.get("trace_id")):
                job["status"] = "canceled"
                job["error"] = job.get("error") or "Generation canceled."
                job["finished_at"] = job.get("finished_at") or _now_iso()
        composed = _compose_document(_jobs_from_data(composed) or jobs)
        if not project_path.is_dir():
            return {**composed, "status": "canceled", "error": composed.get("error") or "Generation canceled."}
        out = _write_unlocked(project_path, composed)
    return out


def list_running_jobs(project_path: Path) -> list[dict[str, Any]]:
    data = load(project_path) or {}
    return [j for j in _jobs_from_data(data) if j.get("status") == "running"]


def is_running(project_path: Path) -> bool:
    data = load(project_path)
    return bool(data and data.get("status") == "running")


def running_count(project_path: Path) -> int:
    data = load(project_path) or {}
    return int(data.get("running_count") or len(list_running_jobs(project_path)))


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
    model: str | None = None,
    provider: str | None = None,
    speed: str | None = None,
    allow_parallel: bool | None = None,
) -> dict[str, Any]:
    """Start a generation job.

    Prompt jobs may run in parallel (up to MAX_PARALLEL_PROMPT_JOBS). Wiring/build
    remain exclusive with other jobs of the same kind unless ``replace_running``.
    """
    kind_norm = (kind or "prompt").lower()
    if allow_parallel is None:
        allow_parallel = kind_norm == "prompt"

    with _file_lock(project_path):
        if project_path.name in _CANCELED_PROJECTS and is_running(project_path):
            # Only block when a project-wide cancel is active AND something still runs.
            raise GenerationCanceled("Generation canceled.")
        # Stale project cancel after finished runs — clear so new work can start.
        if project_path.name in _CANCELED_PROJECTS and not is_running(project_path):
            _CANCELED_PROJECTS.discard(project_path.name)

        raw = None
        path = _path(project_path)
        if path.is_file():
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                raw = None
        data = _normalize_stale(raw, project_path=project_path) if raw else None
        jobs = _jobs_from_data(data)
        running = [j for j in jobs if j.get("status") == "running"]

        if replace_running:
            # Replace the matching running job (or all running if no trace match).
            kept: list[dict[str, Any]] = []
            replaced = False
            for job in jobs:
                if job.get("status") != "running":
                    kept.append(job)
                    continue
                job_tid = str(job.get("trace_id") or job.get("id") or "")
                if str(trace_id) and job_tid == str(trace_id):
                    _untrack_running(project_path.name, job_tid)
                    replaced = True
                    continue
                if not trace_id:
                    _untrack_running(project_path.name, job_tid)
                    replaced = True
                    continue
                kept.append(job)
            if not replaced and not trace_id:
                jobs = [j for j in jobs if j.get("status") != "running"]
                _untrack_running(project_path.name)
            else:
                jobs = kept
            running = [j for j in jobs if j.get("status") == "running"]
        elif running:
            same_kind = [j for j in running if str(j.get("kind") or "").lower() == kind_norm]
            if not allow_parallel:
                raise GenerationInProgress(_compose_document(jobs))
            if kind_norm != "prompt":
                # Wiring/build stay exclusive per kind.
                if same_kind:
                    raise GenerationInProgress(_compose_document(jobs))
            else:
                prompt_running = [j for j in running if str(j.get("kind") or "prompt").lower() == "prompt"]
                if len(prompt_running) >= MAX_PARALLEL_PROMPT_JOBS:
                    raise GenerationInProgress(_compose_document(jobs))

        job: dict[str, Any] = {
            "id": str(trace_id),
            "status": "running",
            "kind": kind_norm,
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
        if speed:
            job["speed"] = str(speed).lower()
        elif isinstance(request_body, dict) and request_body.get("speed"):
            job["speed"] = str(request_body.get("speed")).lower()
        if model:
            job["model"] = model
        if provider:
            job["provider"] = provider
        if request_body:
            job["request_body"] = request_body
            target = str(request_body.get("target_mode") or "").strip().lower()
            if target in {"new", "edit"}:
                job["target_mode"] = target
            if request_body.get("codex_agent") or request_body.get("jake_codex_agent"):
                job["codex_agent"] = True

        _CANCELED_TRACES.discard(str(trace_id))
        if not running or replace_running:
            # Do not clear project cancel mid-flight of sibling jobs unless replacing.
            if not [j for j in jobs if j.get("status") == "running"]:
                _CANCELED_PROJECTS.discard(project_path.name)

        jobs.append(job)
        _track_running(project_path.name, trace_id)
        out = _write_unlocked(project_path, _compose_document(jobs))
    _emit(project_path, out)
    return out


def _update_job(
    project_path: Path,
    *,
    trace_id: str | None,
    mutator: Any,
    create_if_missing: bool = False,
) -> dict[str, Any]:
    with _file_lock(project_path):
        path = _path(project_path)
        raw = None
        if path.is_file():
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                raw = None
        jobs = _jobs_from_data(raw)
        if not jobs:
            jobs = []
        target = None
        if trace_id:
            for job in jobs:
                if str(job.get("trace_id") or job.get("id") or "") == str(trace_id):
                    target = job
                    break
            if target is None and not create_if_missing:
                # Do not mutate a sibling job when the target trace is unknown.
                out = _compose_document(jobs) if jobs else (raw or {"status": "idle"})
                return out
        if target is None and jobs:
            # Legacy callers without trace_id: update primary running job.
            target = _primary_job([j for j in jobs if j.get("status") == "running"]) or _primary_job(jobs)
        if target is None:
            if not create_if_missing and not trace_id:
                return raw or {"status": "idle", "jobs": [], "running_count": 0}
            target = {"id": str(trace_id or ""), "trace_id": trace_id, "status": "running"}
            jobs.append(target)
        mutator(target)
        if target.get("status") != "running":
            _untrack_running(project_path.name, target.get("trace_id"))
        out = _write_unlocked(project_path, _compose_document(jobs))
    _emit(project_path, out)
    return out


def complete(project_path: Path, result: dict[str, Any], *, trace_id: str | None = None) -> dict[str, Any]:
    tid = str(trace_id or result.get("trace_id") or "")
    if tid and is_canceled(project_path, tid):
        _untrack_running(project_path.name, tid)
        return public_summary(project_path)

    def mutate(job: dict[str, Any]) -> None:
        if is_canceled(project_path, job.get("trace_id")):
            job["status"] = "canceled"
            job["error"] = job.get("error") or "Generation canceled."
            job["finished_at"] = _now_iso()
            return
        job.update({k: v for k, v in result.items() if v is not None and k != "status"})
        job["status"] = "complete"
        job["finished_at"] = _now_iso()
        job["updated_at"] = _now_iso()
        job.pop("request_body", None)

    return _update_job(project_path, trace_id=tid or None, mutator=mutate)


def fail(
    project_path: Path,
    error: str,
    *,
    trace_id: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if is_canceled(project_path, trace_id):
        _untrack_running(project_path.name, trace_id)
        return public_summary(project_path)

    def mutate(job: dict[str, Any]) -> None:
        if is_canceled(project_path, job.get("trace_id")):
            job["status"] = "canceled"
            job["error"] = job.get("error") or "Generation canceled."
            job["finished_at"] = _now_iso()
            return
        if trace_id:
            job["trace_id"] = trace_id
            job["id"] = str(trace_id)
        job["status"] = "failed"
        job["error"] = error
        job["finished_at"] = _now_iso()
        job["updated_at"] = _now_iso()
        if extra:
            job.update({k: v for k, v in extra.items() if v is not None and k != "status"})
        job.pop("request_body", None)

    return _update_job(project_path, trace_id=trace_id, mutator=mutate)


def interrupt_for_restart(
    project_path: Path,
    message: str,
    *,
    trace_id: str | None = None,
) -> dict[str, Any]:
    """Quietly clear an in-flight job after server restart (no failure popup)."""

    def mutate(job: dict[str, Any]) -> None:
        if trace_id:
            job["trace_id"] = trace_id
            job["id"] = str(trace_id)
        job["status"] = "canceled"
        job["error"] = message
        job["benign_interrupt"] = True
        job["finished_at"] = _now_iso()
        job["updated_at"] = _now_iso()

    if trace_id:
        return _update_job(project_path, trace_id=trace_id, mutator=mutate)

    # No trace: interrupt every running job.
    with _file_lock(project_path):
        path = _path(project_path)
        raw = None
        if path.is_file():
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                raw = None
        jobs = _jobs_from_data(raw)
        for job in jobs:
            if job.get("status") == "running":
                mutate(job)
        _untrack_running(project_path.name)
        out = _write_unlocked(project_path, _compose_document(jobs))
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


def _merge_progress(prev: dict[str, Any] | None, progress: dict[str, Any]) -> dict[str, Any]:
    next_progress: dict[str, Any] = dict(prev or {})
    stage = progress.get("stage")
    pct = progress.get("pct")
    label = progress.get("label")
    detail = progress.get("detail") or progress.get("thinking")
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

    if isinstance(progress.get("checklist"), list) and progress.get("checklist"):
        next_progress["checklist"] = progress["checklist"][:16]
    else:
        next_progress["checklist"] = _checklist_for_stage(
            next_progress.get("stage"),
            current_label=next_progress.get("label"),
        )

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
    for key in ("improved_prompt", "prompt_preview"):
        if progress.get(key):
            next_progress[key] = progress.get(key)
    return next_progress


def update_progress(
    project_path: Path,
    progress: dict[str, Any],
    *,
    trace_id: str | None = None,
) -> dict[str, Any] | None:
    """Persist live pipeline progress for client polling."""
    if is_canceled(project_path, trace_id) or not project_path.is_dir():
        return None

    def mutate(job: dict[str, Any]) -> None:
        if job.get("status") != "running":
            return
        if trace_id and job.get("trace_id") and str(job.get("trace_id")) != str(trace_id):
            return
        prev = job.get("progress") if isinstance(job.get("progress"), dict) else {}
        job["progress"] = _merge_progress(prev, progress)
        job["updated_at"] = _now_iso()
        if trace_id:
            job["trace_id"] = str(trace_id)
            job["id"] = str(trace_id)

    return _update_job(project_path, trace_id=trace_id, mutator=mutate)


def request_cancel(
    project_path: Path,
    *,
    reason: str = "Canceled by user.",
    trace_id: str | None = None,
) -> dict[str, Any]:
    """Cancel one job (``trace_id``) or every running job when omitted.

    BackgroundTasks run in-process, so we cannot kill the uvicorn worker itself.
    AI calls poll the cancel flag; skill tools honor cancel_check.
    """
    project_id = project_path.name
    tid = str(trace_id).strip() if trace_id else ""

    killed = 0
    if not tid:
        # Cancel all — project-wide flag + kill every skill subprocess.
        _CANCELED_PROJECTS.add(project_id)
        for running_tid in list(_RUNNING_TRACES.get(project_id) or set()):
            _CANCELED_TRACES.add(str(running_tid))
        _untrack_running(project_id)
        try:
            from backend.services import skill_runner

            killed = skill_runner.kill_active_for_project(project_path, reason=reason)
        except Exception as exc:
            logger.warning("Failed to kill skill tools on cancel for %s: %s", project_id, exc)
    else:
        _CANCELED_TRACES.add(tid)
        _untrack_running(project_id, tid)
        # Do not set project-wide cancel — sibling jobs must keep running.
        # Skill kill is skipped so other jobs' scripts/step are not interrupted;
        # the canceled job's cancel_check stops its own tools within ~0.5s.

    with _file_lock(project_path):
        path = _path(project_path)
        raw = None
        if path.is_file():
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                raw = None
        jobs = _jobs_from_data(raw)
        canceled_ids: list[str] = []
        for job in jobs:
            if job.get("status") != "running":
                continue
            job_tid = str(job.get("trace_id") or job.get("id") or "")
            if tid and job_tid != tid:
                continue
            job["status"] = "canceled"
            job["error"] = reason
            job["finished_at"] = _now_iso()
            job["updated_at"] = _now_iso()
            job["killed_subprocesses"] = killed if not tid else 0
            canceled_ids.append(job_tid)
        out = _write_unlocked(project_path, _compose_document(jobs)) if project_path.is_dir() else _compose_document(jobs)
    _emit(project_path, out)
    summary = public_summary(project_path) if project_path.is_dir() else out
    summary = dict(summary)
    summary["canceled_trace_ids"] = canceled_ids
    summary["killed_subprocesses"] = killed
    if tid:
        summary["canceled_trace_id"] = tid
    return summary


def cancel_project(project_path: Path) -> dict[str, Any]:
    """Cancel generation because the project is being deleted."""
    return request_cancel(project_path, reason="Project was deleted.")


def is_canceled(project_path: Path, trace_id: str | None = None) -> bool:
    if project_path.name in _CANCELED_PROJECTS:
        return True
    if trace_id and str(trace_id) in _CANCELED_TRACES:
        return True
    return False


def _public_job(job: dict[str, Any], *, project_id: str) -> dict[str, Any]:
    out = {k: job.get(k) for k in _JOB_PUBLIC_KEYS}
    if job.get("status") == "complete" and job.get("filename"):
        out.setdefault("url", f"/api/projects/{project_id}/files/{job['filename']}")
    # Drop Nones for cleaner payloads.
    return {k: v for k, v in out.items() if v is not None}


def public_summary(project_path: Path) -> dict[str, Any]:
    data = load(project_path)
    if not data:
        return {"status": "idle", "jobs": [], "running_count": 0}
    jobs = [_public_job(j, project_id=project_path.name) for j in _jobs_from_data(data)]
    running_jobs = [j for j in jobs if j.get("status") == "running"]
    primary = _primary_job(_jobs_from_data(data)) or {}
    out = {k: data.get(k) for k in (
        "status", "kind", "trace_id", "started_at", "updated_at", "finished_at",
        "prompt", "label", "message", "filename", "url", "error",
        "timeline_index", "prompt_id", "by_user_id", "by_user_name", "by_avatar_url", "mode",
        "benign_interrupt", "model", "provider", "speed",
    )}
    if data.get("progress"):
        out["progress"] = data.get("progress")
    if data.get("status") == "complete" and data.get("filename"):
        pid = project_path.name
        out.setdefault("url", f"/api/projects/{pid}/files/{data['filename']}")
    out["jobs"] = jobs
    out["running_count"] = len(running_jobs)
    out["running_jobs"] = running_jobs
    # Helpful when primary is finished but siblings still run.
    if running_jobs and out.get("status") != "running":
        out["status"] = "running"
        if primary.get("status") != "running" and running_jobs:
            lead = running_jobs[0]
            for key in ("kind", "trace_id", "prompt", "label", "mode", "progress", "by_user_name", "by_user_id", "by_avatar_url"):
                if lead.get(key) is not None:
                    out[key] = lead.get(key)
    return out


def find_stuck_jobs(projects_root: Path) -> list[dict[str, Any]]:
    """Scan all projects for generations that were running when the server last stopped.

    Returns one entry per stuck running job that has a saved request_body.
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
        jobs = _jobs_from_data(data)
        for job in jobs:
            if job.get("status") != "running":
                continue
            if not job.get("request_body"):
                continue
            if job.get("restart_count", 0) >= 2:
                continue
            if _process_is_alive(job.get("worker_pid")):
                continue
            started = job.get("started_at")
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
                "trace_id": job.get("trace_id"),
                "data": job,
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
