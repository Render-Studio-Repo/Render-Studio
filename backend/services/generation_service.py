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
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

GENERATION_FILE = "generation.json"
# Wall-clock budget for *abandoned* (dead-worker) jobs. Live workers are never
# killed by this — Sol / quality CAD 2.0 routinely needs far longer than 20 min.
MAX_RUNNING_SECONDS = 6 * 60 * 60  # default full-job recovery window
MAX_RUNNING_SECONDS_SOL = 9 * 60 * 60  # 5.6 / Fable-class jobs can span multiple long calls
# Auto-resume on restart is DISABLED for every model (current and future).
# The old path re-queued request_body from scratch and re-billed. Do not raise these.
MAX_RESTART_COUNT = 0
MAX_RESTART_COUNT_EXPENSIVE = 0  # legacy alias — same policy for all models
# Grace before declaring a dead-PID job abandoned.
STALE_IDLE_SECONDS = 60
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
    "server_restart_stop",
    "model",
    "provider",
    "speed",
    "progress",
    "target_mode",
    "codex_agent",
    "usage",
    "cost_usd",
    "ai_calls",
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


def _is_long_running_model(job: dict[str, Any] | None) -> bool:
    """GPT-5.6 Sol (and similar) need hours, not minutes — never short-circuit them."""
    if not job:
        return False
    model = str(job.get("model") or "").strip().lower()
    speed = str(job.get("speed") or "").strip().lower()
    mode = str(job.get("mode") or "").strip().lower()
    if model.endswith("-sol") or "-sol" in model:
        return True
    if speed == "quality" and mode in {"v2", "fusion", "architect"}:
        return True
    return False


def _job_max_running_seconds(job: dict[str, Any] | None) -> float:
    """Full-generation recovery window — at least 3x the model's single-call budget."""
    from backend.services.ai_service import model_hard_timeout_seconds

    model = str((job or {}).get("model") or "").strip()
    per_call = model_hard_timeout_seconds(model)
    # Multi-turn CAD needs several calls; keep a generous job-level window.
    return max(float(MAX_RUNNING_SECONDS), per_call * 3.0)


def _job_age_seconds(job: dict[str, Any], *, now: datetime | None = None) -> float | None:
    started = job.get("started_at")
    if not started:
        return None
    try:
        t0 = datetime.fromisoformat(str(started).replace("Z", "+00:00"))
    except ValueError:
        return None
    return ((now or datetime.now(timezone.utc)) - t0).total_seconds()


def _job_idle_seconds(job: dict[str, Any], *, now: datetime | None = None) -> float | None:
    heartbeat = job.get("updated_at") or job.get("started_at")
    if not heartbeat:
        return None
    try:
        t0 = datetime.fromisoformat(str(heartbeat).replace("Z", "+00:00"))
    except ValueError:
        return None
    return ((now or datetime.now(timezone.utc)) - t0).total_seconds()


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


def _job_model_provider(job: dict[str, Any]) -> tuple[str, str]:
    rb = job.get("request_body") if isinstance(job.get("request_body"), dict) else {}
    model = str(job.get("model") or rb.get("model") or "").lower()
    provider = str(job.get("provider") or rb.get("provider") or "").lower()
    return model, provider


def is_expensive_ai_job(job: dict[str, Any]) -> bool:
    """Deprecated: restart policy is model-agnostic. Kept for callers; always True.

    Any AI job is treated as too costly to auto-re-kick after a server restart.
    """
    return True


def max_restart_count_for_job(job: dict[str, Any]) -> int:
    """Never auto-resume any job after restart — including unknown future models."""
    return 0


def _normalize_job_stale(job: dict[str, Any], *, project_path: Path | None = None) -> dict[str, Any]:
    if job.get("status") != "running":
        return job
    if _process_is_alive(job.get("worker_pid")):
        # Live worker — never wall-clock cancel mid Sol/CAD (progress may be quiet for a long time).
        return job

    now = datetime.now(timezone.utc)
    idle = _job_idle_seconds(job, now=now)
    age = _job_age_seconds(job, now=now)
    has_body = isinstance(job.get("request_body"), dict) and bool(job.get("request_body"))
    max_age = _job_max_running_seconds(job)

    # Dead worker: never keep status=running for auto-resume. That path used to
    # re-queue the full prompt from scratch and re-bill. Give a short grace so
    # startup stop_for_server_restart can claim the job first.
    if idle is not None and idle <= STALE_IDLE_SECONDS:
        return job

    minutes = int(max_age / 60)
    tracked = ""
    try:
        cost = job.get("cost_usd")
        if cost is None:
            from backend.services.ai_cost import usage_fields_for_history

            meta = usage_fields_for_history(job_all_ai_traces(job))
            cost = meta.get("cost_usd")
        if cost is not None and float(cost) > 0:
            tracked = f" About ${float(cost):.2f} in AI usage was tracked before stopping."
    except Exception:
        tracked = ""
    if has_body:
        error = (
            "Generation stopped during a server restart. "
            "It was not re-run automatically — that would bill from scratch again. "
            f"Retry the prompt when ready.{tracked}"
        )
    elif age is not None and age > max_age:
        error = (
            f"Generation abandoned after {minutes} minutes with no live worker "
            f"(still waiting on AI/CAD). Retry the prompt.{tracked}"
        )
    else:
        error = (
            "Generation stopped — the worker exited and could not continue. "
            f"Retry the prompt when ready.{tracked}"
        )
    failed = {
        **job,
        "status": "failed",
        "error": error,
        "finished_at": job.get("finished_at") or _now_iso(),
        "updated_at": _now_iso(),
        "server_restart_stop": True,
        "benign_interrupt": True,
    }
    failed.pop("request_body", None)
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


def get_job_by_trace(project_path: Path, trace_id: str | None) -> dict[str, Any] | None:
    tid = str(trace_id or "").strip()
    if not tid:
        return None
    data = load(project_path) or {}
    for job in _jobs_from_data(data):
        if str(job.get("trace_id") or job.get("id") or "") == tid:
            return job
    return None


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
        settled_carry: list[dict[str, Any]] = []

        if replace_running:
            # Replace the matching running job (or all running if no trace match).
            # Preserve AI traces/cost so Anthropic-billed calls are not erased on resume.
            kept: list[dict[str, Any]] = []
            replaced = False
            for job in jobs:
                if job.get("status") != "running":
                    kept.append(job)
                    continue
                job_tid = str(job.get("trace_id") or job.get("id") or "")
                should_replace = (str(trace_id) and job_tid == str(trace_id)) or (not trace_id)
                if should_replace:
                    prior_settled = [
                        t for t in (job.get("settled_ai_traces") or []) if isinstance(t, dict)
                    ]
                    prior_live = [t for t in (job.get("ai_traces") or []) if isinstance(t, dict)]
                    if str(trace_id) and job_tid == str(trace_id):
                        settled_carry = prior_settled + prior_live
                    elif not trace_id and not settled_carry:
                        settled_carry = prior_settled + prior_live
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
        # Stable prompt history id across server-restart resumes.
        prompt_id = None
        if isinstance(request_body, dict):
            prompt_id = str(request_body.get("prompt_id") or "").strip() or None
        if not prompt_id:
            prompt_id = str(uuid.uuid4())[:10]
        job["prompt_id"] = prompt_id
        if request_body:
            body = dict(request_body)
            body["prompt_id"] = prompt_id
            job["request_body"] = body
            target = str(body.get("target_mode") or "").strip().lower()
            if target in {"new", "edit"}:
                job["target_mode"] = target
            if body.get("codex_agent") or body.get("jake_codex_agent"):
                job["codex_agent"] = True

        if settled_carry:
            from backend.services.ai_cost import usage_fields_for_history

            job["settled_ai_traces"] = settled_carry
            settled_meta = usage_fields_for_history(settled_carry)
            for key in ("usage", "cost_usd", "ai_calls", "model", "provider"):
                if settled_meta.get(key) is not None:
                    job[key] = settled_meta[key]

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
        job.pop("error", None)
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
        job["server_restart_stop"] = True
        job["finished_at"] = _now_iso()
        job["updated_at"] = _now_iso()
        job.pop("request_body", None)

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


def stop_for_server_restart(
    project_path: Path,
    message: str,
    *,
    trace_id: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Stop a dead-worker job after restart without re-queuing or re-billing.

    Keeps usage/cost fields, clears request_body so it cannot be kicked again,
    and marks the stop as a server-restart interrupt for quiet UI handling.
    """

    def mutate(job: dict[str, Any]) -> None:
        if trace_id:
            job["trace_id"] = trace_id
            job["id"] = str(trace_id)
        job["status"] = "failed"
        job["error"] = message
        job["benign_interrupt"] = True
        job["server_restart_stop"] = True
        job["finished_at"] = _now_iso()
        job["updated_at"] = _now_iso()
        if extra:
            job.update({k: v for k, v in extra.items() if v is not None and k != "status"})
        job.pop("request_body", None)

    if trace_id:
        return _update_job(project_path, trace_id=trace_id, mutator=mutate)

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


def job_all_ai_traces(job: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Settled (pre-restart) traces plus the current run's live traces."""
    if not isinstance(job, dict):
        return []
    settled = [t for t in (job.get("settled_ai_traces") or []) if isinstance(t, dict)]
    live = [t for t in (job.get("ai_traces") or []) if isinstance(t, dict)]
    return settled + live


def record_ai_traces(
    project_path: Path,
    ai_traces: list[dict[str, Any]] | None,
    *,
    trace_id: str | None = None,
) -> dict[str, Any] | None:
    """Persist accumulated AI call traces + derived usage/cost on the running job."""
    if not ai_traces:
        return None
    from backend.services.ai_cost import usage_fields_for_history

    traces = [t for t in ai_traces if isinstance(t, dict)]
    if not traces:
        return None

    def mutate(job: dict[str, Any]) -> None:
        if job.get("status") not in ("running", "canceled"):
            return
        if trace_id and job.get("trace_id") and str(job.get("trace_id")) != str(trace_id):
            return
        job["ai_traces"] = traces
        combined = job_all_ai_traces(job)
        usage_meta = usage_fields_for_history(combined)
        for key in ("usage", "cost_usd", "ai_calls", "model", "provider"):
            if usage_meta.get(key) is not None:
                job[key] = usage_meta[key]
        job["updated_at"] = _now_iso()

    return _update_job(project_path, trace_id=trace_id, mutator=mutate)


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
        "usage", "cost_usd", "ai_calls",
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

    Returns one entry per stuck running job with a dead worker (and usually a
    saved request_body). Callers must stop these — never auto-re-queue.
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
            if _process_is_alive(job.get("worker_pid")):
                continue
            # Prefer jobs we can attribute (request_body), but always stop dead runners.
            age = _job_age_seconds(job, now=now)
            if age is None:
                continue
            if age > _job_max_running_seconds(job):
                # Extremely old — normalize/fail path handles; still include so startup clears them.
                pass
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
