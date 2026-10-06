"""Track in-flight CAD prompt/build jobs so clients can refresh and poll.

Supports multiple concurrent prompt jobs per project. ``generation.json`` keeps a
``jobs`` array; top-level fields mirror the primary (newest running) job for
backward-compatible clients.
"""

from __future__ import annotations

import fcntl
import json
import logging
import os
import re
import signal
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

logger = logging.getLogger(__name__)

GENERATION_FILE = "generation.json"


def _project_file_url(project_id: str, filename: str) -> str:
    rel = str(filename or "").lstrip("/")
    return f"/api/projects/{quote(str(project_id), safe='')}/files/{quote(rel, safe='/')}"


# Wall-clock budget for *abandoned* (dead-worker) jobs. Live workers are never
# killed by this — Sol / quality CAD 2.0 routinely needs far longer than 20 min.
MAX_RUNNING_SECONDS = 16 * 60 * 60  # default full-job recovery window (desktop-length CAD)
MAX_RUNNING_SECONDS_SOL = 16 * 60 * 60  # 5.6 / Fable-class jobs can span many long calls
# Auto-resume on restart is DISABLED for every model (current and future).
# The old path re-queued request_body from scratch and re-billed. Do not raise these.
MAX_RESTART_COUNT = 0
MAX_RESTART_COUNT_EXPENSIVE = 0  # legacy alias — same policy for all models
# Grace before declaring a dead-PID job abandoned.
STALE_IDLE_SECONDS = 60
MAX_PARALLEL_PROMPT_JOBS = 5
PARALLEL_PROMPT_KINDS = frozenset({"prompt", "improve_lab"})

_RUNNING_TRACES: dict[str, set[str]] = {}
_CANCELED_PROJECTS: set[str] = set()
_CANCELED_TRACES: set[str] = set()
_listeners: list[Any] = []
_FILE_LOCKS: dict[str, "_ProjectFileLock"] = {}
_FILE_LOCKS_GUARD = threading.Lock()
CANCEL_FLAGS_DIR = ".generation_flags"
# Set on SIGTERM/shutdown so we stop accepting new gens and wait for ours to finish.
_DRAINING = False
_DRAINING_LOCK = threading.Lock()

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
    "duration",
    "editor_name",
    "url",
    "error",
    "timeline_index",
    "prompt_id",
    "by_user_id",
    "by_user_name",
    "by_avatar_url",
    "mode",
    "harness",
    "detached",
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
    "blocker",
    "client",
    "lab_session_id",
    "lab_slot",
)


def register_listener(fn: Any) -> None:
    _listeners.append(fn)


def _emit(project_path: Path, data: dict[str, Any]) -> None:
    for fn in _listeners:
        try:
            fn(project_path, data)
        except Exception as exc:
            logger.warning("generation listener failed: %s", exc, exc_info=True)


class _ProjectFileLock:
    """Thread-reentrant lock plus cross-process flock on generation.json writes."""

    def __init__(self, project_path: Path) -> None:
        self._thread = threading.RLock()
        self._path = project_path
        self._fh: Any = None
        self._depth = 0

    def __enter__(self) -> "_ProjectFileLock":
        self._thread.acquire()
        self._depth += 1
        if self._depth == 1:
            try:
                self._path.mkdir(parents=True, exist_ok=True)
                lock_path = self._path / ".generation.lock"
                self._fh = lock_path.open("a+")
                fcntl.flock(self._fh.fileno(), fcntl.LOCK_EX)
            except OSError:
                if self._fh is not None:
                    try:
                        self._fh.close()
                    except OSError:
                        pass
                    self._fh = None
        return self

    def __exit__(self, *exc: Any) -> None:
        try:
            if self._depth == 1 and self._fh is not None:
                try:
                    fcntl.flock(self._fh.fileno(), fcntl.LOCK_UN)
                except OSError:
                    pass
                try:
                    self._fh.close()
                except OSError:
                    pass
                self._fh = None
        finally:
            self._depth -= 1
            self._thread.release()


def _file_lock(project_path: Path) -> _ProjectFileLock:
    key = project_path.name
    with _FILE_LOCKS_GUARD:
        lock = _FILE_LOCKS.get(key)
        if lock is None:
            lock = _ProjectFileLock(project_path)
            _FILE_LOCKS[key] = lock
        return lock


def _cancel_flags_dir(project_path: Path) -> Path:
    return project_path / CANCEL_FLAGS_DIR


def _cancel_flag_path(project_path: Path, trace_id: str | None) -> Path:
    name = "cancel-project" if not trace_id else f"cancel-{trace_id}"
    return _cancel_flags_dir(project_path) / name


def write_cancel_flag(project_path: Path, trace_id: str | None = None) -> None:
    try:
        d = _cancel_flags_dir(project_path)
        d.mkdir(parents=True, exist_ok=True)
        _cancel_flag_path(project_path, trace_id).write_text("1", encoding="utf-8")
    except OSError:
        logger.debug("Could not write generation cancel flag for %s", project_path.name, exc_info=True)


def clear_cancel_flags_for_start(project_path: Path, trace_id: str) -> None:
    d = _cancel_flags_dir(project_path)
    for name in ("cancel-project", f"cancel-{trace_id}"):
        try:
            (d / name).unlink(missing_ok=True)
        except OSError:
            pass


def _cancel_flag_set(project_path: Path, trace_id: str | None) -> bool:
    d = _cancel_flags_dir(project_path)
    if (d / "cancel-project").is_file():
        return True
    if trace_id and (d / f"cancel-{trace_id}").is_file():
        return True
    return False


def _job_status_on_disk(project_path: Path, trace_id: str) -> str | None:
    path = _path(project_path)
    if not path.is_file() or not trace_id:
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    want = str(trace_id)
    for job in _jobs_from_data(data):
        if str(job.get("trace_id") or job.get("id") or "") == want:
            return str(job.get("status") or "") or None
    return None


def terminate_worker_pid(pid: Any, *, reason: str = "") -> bool:
    """SIGTERM a detached generation session. Never signals this process."""
    try:
        value = int(pid)
    except (TypeError, ValueError):
        return False
    if value <= 0 or value == os.getpid():
        return False
    if not _process_is_alive(value):
        return False
    try:
        os.killpg(value, signal.SIGTERM)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            os.kill(value, signal.SIGTERM)
        except (ProcessLookupError, PermissionError, OSError) as exc:
            logger.warning("Could not signal generation worker pid=%s: %s", value, exc)
            return False
    logger.info("Signaled detached generation worker pid=%s (%s)", value, reason or "cancel")
    return True


def set_worker_pid(
    project_path: Path,
    pid: int,
    *,
    trace_id: str | None = None,
    detached: bool = True,
) -> dict[str, Any]:
    def mutate(job: dict[str, Any]) -> None:
        job["worker_pid"] = int(pid)
        job["detached"] = bool(detached)
        job["updated_at"] = _now_iso()

    return _update_job(project_path, trace_id=trace_id, mutator=mutate)


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
    if speed == "quality" and mode in {"v2", "vibecad", "mac", "fusion", "architect"}:
        return True
    return False


def _job_max_running_seconds(job: dict[str, Any] | None) -> float:
    """Full-generation recovery window — at least 3x the model's single-call budget."""
    from backend.services.ai_service import model_hard_timeout_seconds

    model = str((job or {}).get("model") or "").strip()
    per_call = model_hard_timeout_seconds(model)
    # Multi-turn CAD needs several calls; keep a generous job-level window.
    return max(float(MAX_RUNNING_SECONDS), float(MAX_RUNNING_SECONDS_SOL), per_call * 3.0)


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


def begin_drain() -> None:
    """Mark this worker as shutting down — refuse new generations."""
    global _DRAINING
    with _DRAINING_LOCK:
        _DRAINING = True
    logger.info("Generation drain started (pid=%s) — refusing new jobs", os.getpid())


def is_draining() -> bool:
    with _DRAINING_LOCK:
        return _DRAINING


def running_jobs_for_pid(projects_root: Path, *, pid: int | None = None) -> list[dict[str, Any]]:
    """Running jobs owned by this worker process (from on-disk generation.json)."""
    target = int(pid if pid is not None else os.getpid())
    out: list[dict[str, Any]] = []
    if not projects_root.is_dir():
        return out
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
        for job in _jobs_from_data(data):
            if job.get("status") != "running":
                continue
            try:
                job_pid = int(job.get("worker_pid") or 0)
            except (TypeError, ValueError):
                job_pid = 0
            if job_pid != target:
                continue
            out.append({**job, "project_id": d.name, "project_path": str(d)})
    return out


def wait_for_worker_jobs(
    projects_root: Path,
    *,
    timeout_sec: float,
    poll_sec: float = 2.0,
    pid: int | None = None,
) -> int:
    """Block until this worker's running jobs finish, or timeout. Returns remaining count."""
    deadline = time.time() + max(0.0, float(timeout_sec))
    last_log = 0.0
    while True:
        jobs = running_jobs_for_pid(projects_root, pid=pid)
        if not jobs:
            return 0
        now = time.time()
        if now >= deadline:
            logger.warning(
                "Drain timeout with %s job(s) still running on pid=%s: %s",
                len(jobs),
                pid or os.getpid(),
                [(j.get("project_id"), j.get("trace_id"), j.get("model")) for j in jobs],
            )
            return len(jobs)
        if now - last_log >= 15.0:
            logger.info(
                "Draining %s generation(s) on pid=%s (%.0fs left): %s",
                len(jobs),
                pid or os.getpid(),
                deadline - now,
                [(j.get("project_id"), j.get("trace_id"), (j.get("model") or "")[:24]) for j in jobs],
            )
            last_log = now
        time.sleep(max(0.5, float(poll_sec)))


def count_all_live_running_jobs(projects_root: Path) -> list[dict[str, Any]]:
    """All running jobs whose worker_pid is still alive (any worker)."""
    out: list[dict[str, Any]] = []
    if not projects_root.is_dir():
        return out
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
        for job in _jobs_from_data(data):
            if job.get("status") != "running":
                continue
            if not _process_is_alive(job.get("worker_pid")):
                continue
            out.append({**job, "project_id": d.name})
    return out


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
        "editor_name",
        "url",
        "error",
        "timeline_index",
        "prompt_id",
        "by_user_id",
        "by_user_name",
        "by_avatar_url",
        "mode",
        "harness",
        "detached",
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
        "usage",
        "cost_usd",
        "ai_calls",
        "blocker",
        "client",
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


def _normalize_generation_client(value: Any) -> str | None:
    token = str(value or "").strip().lower()
    if token in {"xr", "vr", "headset", "quest"}:
        return "xr"
    if token in {"ui", "pc", "desktop"}:
        return "ui"
    return None


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
        allow_parallel = kind_norm in PARALLEL_PROMPT_KINDS

    with _file_lock(project_path):
        if is_draining():
            raise GenerationCanceled(
                "Server is restarting — generation was not started. Retry in a moment."
            )
        clear_cancel_flags_for_start(project_path, str(trace_id))
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
            if kind_norm not in PARALLEL_PROMPT_KINDS:
                # Wiring/build stay exclusive per kind.
                if same_kind:
                    raise GenerationInProgress(_compose_document(jobs))
            else:
                prompt_running = [
                    j
                    for j in running
                    if str(j.get("kind") or "prompt").lower() in PARALLEL_PROMPT_KINDS
                ]
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
        harness = _harness_from_mode(mode)
        if harness:
            job["harness"] = harness
            job["progress"] = {"harness": harness, "pct": 1, "label": label or "Starting…"}
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
            astra = str(body.get("model") or "").strip().lower().startswith("gpt-6-astra")
            if body.get("codex_agent") or body.get("jake_codex_agent") or astra:
                job["codex_agent"] = True
            client = _normalize_generation_client(body.get("client") or body.get("source_client"))
            if client:
                job["client"] = client
            if body.get("lab_session_id"):
                job["lab_session_id"] = str(body.get("lab_session_id"))[:40]
                try:
                    job["lab_slot"] = int(body.get("lab_slot") or 0)
                except (TypeError, ValueError):
                    job["lab_slot"] = 0
        if not job.get("client"):
            client = _normalize_generation_client((request_body or {}).get("client") if isinstance(request_body, dict) else None)
            if client:
                job["client"] = client

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

    parent_job = get_job_by_trace(project_path, tid) if tid else None

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

    out = _update_job(project_path, trace_id=tid or None, mutator=mutate)
    published: list[str] = []
    for key in ("filename", "glb", "step"):
        value = result.get(key)
        if value:
            published.append(str(value))
    files = result.get("files")
    if isinstance(files, dict):
        published.extend(str(v) for v in files.values() if v)
    elif isinstance(files, (list, tuple)):
        published.extend(str(v) for v in files if v)
    if published:
        try:
            from backend.services.cad_service import clear_deleted_catalogs_for_published

            clear_deleted_catalogs_for_published(project_path, published)
        except Exception:
            logger.debug("deleted-catalog revive skipped after generation", exc_info=True)
    try:
        from backend.services.project_thumb import refresh_project_thumb

        refresh_project_thumb(project_path)
    except Exception:
        logger.debug("project thumb skipped after generation", exc_info=True)
    if parent_job and parent_job.get("kind") in {"prompt", "cad"}:
        try:
            from backend.services.electronics_build import after_cad_complete
            after_cad_complete(project_path, parent_job, result)
        except Exception:
            logger.exception("Electronics follow-up failed after CAD completion project=%s", project_path.name)
    return out


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

    out = _update_job(project_path, trace_id=trace_id, mutator=mutate)
    # An unfinished CAD build can still contain useful, clearly marked draft
    # sources. Publish its small Parts List index so the browser can discover it
    # without parsing authoring manifests on the project-open path.
    try:
        if (project_path / "vibecad").is_dir() or (project_path / "parts_list.json").is_file():
            from backend.services.parts_workspace import get_workspace
            get_workspace(project_path)
    except Exception:
        logger.debug("draft parts recovery skipped after generation failure", exc_info=True)
    return out


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
    {"id": "hardware", "label": "McMaster catalog STEPs"},
    {"id": "analyze", "label": "Analyze prompt & references"},
    {"id": "brief", "label": "Jake brief"},
    {"id": "ai_source", "label": "Write / edit build123d source"},
    {"id": "step", "label": "Run scripts/step (STEP / GLB)"},
    {"id": "inspect", "label": "Inspect geometry (facts / planes)"},
    {"id": "snapshot", "label": "Render multi-view snapshot"},
    {"id": "snapshot_review", "label": "Visual review (fail-closed)"},
    {"id": "finalize", "label": "Finalize artifacts"},
)

VIBECAD_PIPELINE_CHECKLIST = (
    {"id": "hardware", "label": "McMaster catalog STEPs"},
    {"id": "analyze", "label": "Inspect project / engine"},
    {"id": "brief", "label": "VibeCAD design review"},
    {"id": "ai_source", "label": "Author build123d / FreeCAD source"},
    {"id": "step", "label": "Run VibeCAD worker (STEP / GLB)"},
    {"id": "inspect", "label": "Inspect named solids (worker facts)"},
    {"id": "snapshot", "label": "Viewport capture (iso / top / front)"},
    {"id": "snapshot_review", "label": "Visual review (fail-closed)"},
    {"id": "finalize", "label": "Finalize artifacts"},
)

MESH_PIPELINE_CHECKLIST = (
    {"id": "analyze", "label": "Analyze image & admission"},
    {"id": "spec", "label": "Sculpt spec / strict-quality"},
    {"id": "generate", "label": "Forge pass (factory)"},
    {"id": "export", "label": "Export GLB"},
    {"id": "snapshot", "label": "Playwright factory views"},
    {"id": "review", "label": "Vision review vs reference"},
    {"id": "finalize", "label": "Finalize viewport model"},
)

_STAGE_ALIASES = {
    "hardware": "hardware",
    "analyze": "analyze",
    "plan": "analyze",
    "build": "step",
    "brief": "brief",
    "spec": "spec",
    "ai_source": "ai_source",
    "authoring": "ai_source",
    "repair": "ai_source",
    "generate": "generate",
    "export": "export",
    "step": "step",
    "inspect": "inspect",
    "inspect-quality": "inspect",
    "snapshot": "snapshot",
    "snapshot_review": "snapshot_review",
    "review": "review",
    "finalize": "finalize",
    "done": "finalize",
}

_TURN_RE = re.compile(r"\bturn\s+(\d+)\s*/\s*(\d+)", re.I)
_PHASE_COUNTER = {
    "hardware": "Hardware",
    "analyze": "Inspect",
    "plan": "Inspect",
    "brief": "Review",
    "spec": "Spec",
    "ai_source": "Authoring",
    "authoring": "Authoring",
    "repair": "Authoring",
    "generate": "Authoring",
    "step": "Building",
    "build": "Building",
    "export": "Export",
    "inspect": "Inspecting",
    "snapshot": "Snapshots",
    "snapshot_review": "Visual QA",
    "review": "Visual QA",
    "finalize": "Finishing",
    "done": "Finishing",
}


_JAKE_PIPELINE_HINTS = (
    "scripts/step",
    "scripts/inspect",
    "scripts/snapshot",
    "cadgen",
    "text-to-cad",
    "gen_step",
    "@step",
)


def _normalize_pipeline_id(value: str) -> str:
    token = str(value or "").strip().lower()
    if token in {"jake", "text-to-cad", "text_to_cad", "text to cad", "v2", "cad"}:
        return "jake"
    if token in {"vibecad", "vibe", "vibecade"}:
        return "vibecad"
    if token in {"multi_agent_cad", "mac", "macad"}:
        return "multi_agent_cad"
    if token in {"img2threejs", "mesh", "threejs"}:
        return "img2threejs"
    return token[:64] if token else ""


def _harness_from_mode(mode: str | None) -> str:
    m = str(mode or "").strip().lower().replace("-", "_")
    if m in {"mesh", "mesh_beta", "img2threejs", "threejs", "fusion"}:
        return "mesh"
    if m in {"vibecad", "vibe", "vibecade"}:
        return "vibecad"
    if m in {"mac", "macad", "multi_agent_cad", "multiagentcad"}:
        return "mac"
    if m == "architect":
        return "architect"
    if m in {"v2", "jake", "cad", "2", "2_0"}:
        return "jake"
    return ""


def _infer_pipeline(progress: dict[str, Any], prev: dict[str, Any]) -> str:
    incoming = str(progress.get("pipeline") or "").strip().lower()
    existing = str((prev or {}).get("pipeline") or "").strip().lower()
    blob = f"{progress.get('label') or ''} {(prev or {}).get('label') or ''}".lower()
    jake_signal = any(hint in blob for hint in _JAKE_PIPELINE_HINTS) and "vibecad" not in blob
    mesh_signal = blob.startswith("mesh") or "img2threejs" in blob
    vibe_signal = "vibecad" in blob
    # Live step labels beat a sticky Codex default of "vibecad".
    if jake_signal:
        return "jake"
    if mesh_signal:
        return "img2threejs"
    if incoming:
        return _normalize_pipeline_id(incoming) or incoming[:64]
    if existing:
        return _normalize_pipeline_id(existing) or existing[:64]
    if vibe_signal:
        return "vibecad"
    return ""


def _checklist_peak_idx(items: list[Any] | None) -> int:
    peak = -1
    for i, item in enumerate(items or []):
        if not isinstance(item, dict):
            continue
        if str(item.get("status") or "").lower() in {"done", "active"}:
            peak = i
    return peak


def _freeze_checklist(
    prev_items: list[Any] | None,
    incoming: list[Any] | None,
    *,
    current_label: str | None = None,
) -> list[dict[str, Any]]:
    """Keep the farthest pipeline step; later sub-stages attach as detail instead of rewinding."""
    incoming_rows = [dict(item) for item in (incoming or []) if isinstance(item, dict)]
    if not incoming_rows:
        return [dict(item) for item in (prev_items or []) if isinstance(item, dict)]
    ids = [str(item.get("id") or "") for item in incoming_rows]
    aligned_peak = _checklist_peak_idx(incoming_rows)
    for item in prev_items or []:
        if not isinstance(item, dict):
            continue
        if str(item.get("status") or "").lower() not in {"done", "active"}:
            continue
        pid = str(item.get("id") or "")
        if pid and pid in ids:
            aligned_peak = max(aligned_peak, ids.index(pid))
    if aligned_peak < 0:
        return incoming_rows
    out: list[dict[str, Any]] = []
    for i, item in enumerate(incoming_rows):
        entry = dict(item)
        if i < aligned_peak:
            entry["status"] = "done"
            entry.pop("detail", None)
        elif i == aligned_peak:
            entry["status"] = "active"
            if current_label:
                entry["detail"] = str(current_label)[:240]
        else:
            entry["status"] = "pending"
            entry.pop("detail", None)
        out.append(entry)
    return out


def _progress_counter(label: str | None, stage: str | None, checklist: list[Any] | None) -> str:
    """HUD meter counter — agent turns when available, otherwise the current phase name."""
    text = str(label or "")
    match = _TURN_RE.search(text)
    if match:
        return f"Turn {int(match.group(1))}/{int(match.group(2))}"
    lowered = text.lower()
    if "mcmaster" in lowered:
        return "Hardware"
    if "design review" in lowered or "independent design review" in lowered:
        return "Review"
    for item in checklist or []:
        if not isinstance(item, dict):
            continue
        if str(item.get("status") or "").lower() != "active":
            continue
        iid = str(item.get("id") or "").lower()
        if iid in _PHASE_COUNTER:
            return _PHASE_COUNTER[iid]
        name = str(item.get("label") or "").strip()
        if name:
            return name[:24]
    stage_key = str(stage or "").strip().lower()
    if stage_key in _PHASE_COUNTER:
        return _PHASE_COUNTER[stage_key]
    return "Working"


def authoring_loop_pct(turn: int, max_turns: int, *, lo: int = 28, hi: int = 74) -> int:
    """Spread a long agent loop across the authoring band instead of slamming 70% at turn 12."""
    n = max(int(max_turns or 1), 1)
    t = min(max(int(turn), 0), n - 1)
    if n <= 1:
        return int(hi)
    return int(lo) + int(round((t / (n - 1)) * (int(hi) - int(lo))))


def _checklist_for_stage(
    stage: str | None,
    *,
    current_label: str | None = None,
    pipeline: str | None = None,
) -> list[dict[str, Any]]:
    """Pipeline checklist derived from the active progress stage."""
    label = str(current_label or "")
    pipe = str(pipeline or "").strip().lower()
    lowered = label.lower()
    use_mesh = pipe in {"img2threejs", "mesh", "threejs"} or lowered.startswith("mesh")
    use_vibecad = (not use_mesh) and (
        pipe in {"vibecad", "vibe", "vibecade"} or lowered.startswith("vibecad") or "vibecad" in lowered
    )
    checklist = (
        MESH_PIPELINE_CHECKLIST
        if use_mesh
        else VIBECAD_PIPELINE_CHECKLIST
        if use_vibecad
        else PIPELINE_CHECKLIST
    )
    raw_stage = str(stage or "").strip().lower()
    normalized = _STAGE_ALIASES.get(raw_stage, "")
    if use_mesh and normalized in {"ai_source", "brief"}:
        normalized = "spec" if raw_stage == "brief" else "generate"
    if use_mesh and raw_stage in {"authoring", "repair", "generate"}:
        normalized = "generate"
    if use_mesh and normalized in {"step", "inspect"}:
        normalized = "export"
    if use_mesh and normalized == "snapshot_review":
        normalized = "review"
    if use_vibecad and normalized == "generate":
        normalized = "ai_source"
    if use_vibecad and (normalized == "export" or raw_stage == "export"):
        normalized = "step"
    ids = [item["id"] for item in checklist]
    active_idx = ids.index(normalized) if normalized in ids else -1
    out: list[dict[str, Any]] = []
    for i, item in enumerate(checklist):
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
            incoming_pct = max(0, min(100, int(pct)))
            try:
                prev_pct = int(next_progress.get("pct"))
            except (TypeError, ValueError):
                prev_pct = None
            next_progress["pct"] = incoming_pct if prev_pct is None else max(prev_pct, incoming_pct)
        except (TypeError, ValueError):
            pass
    try:
        next_progress["pct_peak"] = int(next_progress.get("pct") or 0)
    except (TypeError, ValueError):
        next_progress["pct_peak"] = 0
    if label is not None:
        next_progress["label"] = str(label)[:240]
    if detail is not None:
        next_progress["thinking"] = str(detail)[:4000]
    elif label is not None:
        next_progress["thinking"] = str(label)[:4000]
    chunk = progress.get("thinking_append")
    if chunk:
        log = [item for item in (next_progress.get("thinking_log") or []) if isinstance(item, dict)]
        text = str(chunk).strip()[:2000]
        last = str((log[-1] or {}).get("text") or "") if log else ""
        if text and text != last:
            if last and text.startswith(last):
                log[-1] = {"ts": _now_iso(), "text": text}
            elif last and last.startswith(text) and len(text) < len(last):
                pass
            else:
                log.append({"ts": _now_iso(), "text": text})
        next_progress["thinking_log"] = log[-80:]
    if isinstance(progress.get("thinking_log"), list) and progress.get("thinking_log"):
        merged = [item for item in (next_progress.get("thinking_log") or []) if isinstance(item, dict)]
        for item in progress["thinking_log"]:
            if isinstance(item, dict) and item.get("text"):
                merged.append({"ts": item.get("ts") or _now_iso(), "text": str(item.get("text"))[:2000]})
        next_progress["thinking_log"] = merged[-80:]
    inferred = _infer_pipeline(progress, next_progress)
    if inferred:
        next_progress["pipeline"] = inferred

    incoming_checklist = None
    if isinstance(progress.get("checklist"), list) and progress.get("checklist"):
        incoming_checklist = progress["checklist"][:16]
    else:
        incoming_checklist = _checklist_for_stage(
            next_progress.get("stage"),
            current_label=next_progress.get("label"),
            pipeline=next_progress.get("pipeline"),
        )
    next_progress["checklist"] = _freeze_checklist(
        prev.get("checklist") if isinstance(prev, dict) else None,
        incoming_checklist,
        current_label=next_progress.get("label"),
    )
    next_progress["counter"] = _progress_counter(
        next_progress.get("label"),
        next_progress.get("stage"),
        next_progress.get("checklist"),
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
    for key in (
        "improved_prompt",
        "prompt_preview",
        "harness",
        "wand",
        "wand_version",
        "skill",
        "skill_version",
        "engine",
        "cost_usd",
        "usage",
        "ai_calls",
        "model",
    ):
        if progress.get(key) is not None and progress.get(key) != "":
            next_progress[key] = progress.get(key)
    if isinstance(progress.get("mcmaster_parts"), list):
        next_progress["mcmaster_parts"] = [
            item for item in progress["mcmaster_parts"][:40] if isinstance(item, dict)
        ]
        next_progress["mcmaster_count"] = len(next_progress["mcmaster_parts"])
    elif progress.get("mcmaster_count") is not None:
        try:
            next_progress["mcmaster_count"] = int(progress["mcmaster_count"])
        except (TypeError, ValueError):
            pass
    try:
        from backend.services.live_preview import copy_preview_keys

        copy_preview_keys(progress, next_progress)
    except Exception:
        pass
    return next_progress


def job_all_ai_traces(job: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Settled (pre-restart) traces plus the current run's live traces."""
    if not isinstance(job, dict):
        return []
    settled = [t for t in (job.get("settled_ai_traces") or []) if isinstance(t, dict)]
    live = [t for t in (job.get("ai_traces") or []) if isinstance(t, dict)]
    return settled + live


def _attach_live_meter(job: dict[str, Any]) -> None:
    """Keep harness + running AI cost on progress so McMaster ticks cannot drop the HUD."""
    if not isinstance(job, dict):
        return
    progress = job.get("progress") if isinstance(job.get("progress"), dict) else {}
    progress = dict(progress)
    harness = job.get("harness") or _harness_from_mode(job.get("mode"))
    if harness:
        progress["harness"] = harness
    if job.get("cost_usd") is not None:
        progress["cost_usd"] = job.get("cost_usd")
    if job.get("usage"):
        progress["usage"] = job.get("usage")
    if job.get("ai_calls") is not None:
        progress["ai_calls"] = job.get("ai_calls")
    if job.get("model"):
        progress["model"] = job.get("model")
    job["progress"] = progress


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
        _attach_live_meter(job)

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
        _attach_live_meter(job)

    return _update_job(project_path, trace_id=trace_id, mutator=mutate)


def request_cancel(
    project_path: Path,
    *,
    reason: str = "Canceled by user.",
    trace_id: str | None = None,
) -> dict[str, Any]:
    """Cancel one job (``trace_id``) or every running job when omitted.

    Cancel is persisted to disk so a detached generation process (not sharing
    uvicorn memory) still sees it. Detached worker PIDs are SIGTERM'd; we never
    signal the HTTP process itself.
    """
    project_id = project_path.name
    tid = str(trace_id).strip() if trace_id else ""

    killed = 0
    if not tid:
        # Cancel all — project-wide flag + kill every skill subprocess.
        _CANCELED_PROJECTS.add(project_id)
        write_cancel_flag(project_path, None)
        for running_tid in list(_RUNNING_TRACES.get(project_id) or set()):
            _CANCELED_TRACES.add(str(running_tid))
            write_cancel_flag(project_path, str(running_tid))
        _untrack_running(project_id)
        try:
            from backend.services import skill_runner

            killed = skill_runner.kill_active_for_project(project_path, reason=reason)
        except Exception as exc:
            logger.warning("Failed to kill skill tools on cancel for %s: %s", project_id, exc)
    else:
        _CANCELED_TRACES.add(tid)
        write_cancel_flag(project_path, tid)
        _untrack_running(project_id, tid)
        # Do not set project-wide cancel — sibling jobs must keep running.
        # Detached worker SIGTERM stops that job's tools; siblings keep their PIDs.

    worker_pids: list[int] = []
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
            try:
                wpid = int(job.get("worker_pid") or 0)
            except (TypeError, ValueError):
                wpid = 0
            if wpid > 0 and wpid != os.getpid():
                worker_pids.append(wpid)
            if job_tid:
                write_cancel_flag(project_path, job_tid)
            job["status"] = "canceled"
            job["error"] = reason
            job["finished_at"] = _now_iso()
            job["updated_at"] = _now_iso()
            job["killed_subprocesses"] = killed if not tid else 0
            canceled_ids.append(job_tid)
        out = _write_unlocked(project_path, _compose_document(jobs)) if project_path.is_dir() else _compose_document(jobs)
    for wpid in worker_pids:
        terminate_worker_pid(wpid, reason=reason)
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
    try:
        from backend.services.project_lifecycle import is_project_deleted

        if is_project_deleted(project_path.name):
            return True
    except Exception:
        pass
    if trace_id and str(trace_id) in _CANCELED_TRACES:
        return True
    # Detached workers do not share uvicorn's in-memory sets — honor disk flags.
    if _cancel_flag_set(project_path, str(trace_id) if trace_id else None):
        return True
    if trace_id and _job_status_on_disk(project_path, str(trace_id)) == "canceled":
        return True
    return False


def _public_job(job: dict[str, Any], *, project_id: str) -> dict[str, Any]:
    out = {k: job.get(k) for k in _JOB_PUBLIC_KEYS}
    if job.get("status") == "complete" and job.get("filename"):
        out.setdefault("url", _project_file_url(project_id, job["filename"]))
    # Drop Nones for cleaner payloads.
    return {k: v for k, v in out.items() if v is not None}


_LIST_SUMMARY_KEYS = (
    "status",
    "kind",
    "trace_id",
    "progress",
    "filename",
    "label",
    "by_user_id",
    "by_user_name",
    "by_avatar_url",
    "mode",
    "harness",
    "model",
    "provider",
    "usage",
    "cost_usd",
    "ai_calls",
    "started_at",
)

_LIST_RUNNING_JOB_KEYS = (
    "id",
    "status",
    "kind",
    "trace_id",
    "progress",
    "label",
    "by_user_name",
    "by_avatar_url",
    "mode",
    "harness",
    "model",
    "provider",
    "usage",
    "cost_usd",
    "ai_calls",
    "started_at",
)


def list_public_summary(project_path: Path) -> dict[str, Any]:
    """Sidebar list: lock-free generation peek, no prompts/jobs/stale-writes.

    ``public_summary`` takes an exclusive flock and can rewrite generation.json.
    Listing ~100+ projects while a CAD job is writing that file made Explorer
    sit on Loading. Cards only need status/progress/who.
    """
    path = _path(project_path)
    if not path.is_file():
        return {"status": "idle", "running_count": 0}
    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw) if raw.strip() else None
    except (json.JSONDecodeError, OSError, UnicodeError):
        return {"status": "idle", "running_count": 0}
    if not isinstance(data, dict):
        return {"status": "idle", "running_count": 0}
    jobs = _jobs_from_data(data)
    running = [j for j in jobs if j.get("status") == "running"]
    primary = _primary_job(jobs) or data
    out: dict[str, Any] = {}
    for key in _LIST_SUMMARY_KEYS:
        value = primary.get(key) if primary.get(key) is not None else data.get(key)
        if value is not None:
            out[key] = value
    if data.get("progress") and not out.get("progress"):
        out["progress"] = data.get("progress")
    running_jobs = []
    for job in running:
        slim = {k: job.get(k) for k in _LIST_RUNNING_JOB_KEYS if job.get(k) is not None}
        if slim:
            running_jobs.append(slim)
    out["running_count"] = len(running)
    if running_jobs:
        out["running_jobs"] = running_jobs
        out["status"] = "running"
        lead = running[0]
        for key in (
            "kind",
            "trace_id",
            "label",
            "mode",
            "harness",
            "progress",
            "by_user_name",
            "by_user_id",
            "by_avatar_url",
            "usage",
            "cost_usd",
            "ai_calls",
            "model",
            "provider",
            "started_at",
        ):
            if lead.get(key) is not None:
                out[key] = lead.get(key)
    else:
        out.setdefault("status", data.get("status") or "idle")
    return out


def public_summary(project_path: Path) -> dict[str, Any]:
    data = load(project_path)
    if not data:
        return {"status": "idle", "jobs": [], "running_count": 0}
    jobs = [_public_job(j, project_id=project_path.name) for j in _jobs_from_data(data)]
    running_jobs = [j for j in jobs if j.get("status") == "running"]
    primary = _primary_job(_jobs_from_data(data)) or {}
    out = {k: data.get(k) for k in (
        "status", "kind", "trace_id", "started_at", "updated_at", "finished_at",
        "prompt", "label", "message", "filename", "editor_name", "url", "error",
        "timeline_index", "prompt_id", "by_user_id", "by_user_name", "by_avatar_url", "mode",
        "harness", "detached", "benign_interrupt", "model", "provider", "speed",
        "usage", "cost_usd", "ai_calls", "blocker", "client",
    )}
    if data.get("progress"):
        out["progress"] = data.get("progress")
    if data.get("status") == "complete" and data.get("filename"):
        pid = project_path.name
        out.setdefault("url", _project_file_url(pid, data["filename"]))
    out["jobs"] = jobs
    out["running_count"] = len(running_jobs)
    out["running_jobs"] = running_jobs
    lead = running_jobs[0] if running_jobs else None
    if lead:
        out["status"] = "running"
        for key in (
            "kind",
            "trace_id",
            "prompt",
            "label",
            "mode",
            "harness",
            "detached",
            "progress",
            "by_user_name",
            "by_user_id",
            "by_avatar_url",
            "client",
            "usage",
            "cost_usd",
            "ai_calls",
            "model",
            "provider",
            "started_at",
        ):
            if lead.get(key) is None:
                continue
            if out.get(key) is None or key in ("progress", "harness", "cost_usd", "usage", "detached"):
                out[key] = lead.get(key)
    elif running_jobs and out.get("status") != "running":
        out["status"] = "running"
        if primary.get("status") != "running" and running_jobs:
            lead = running_jobs[0]
            for key in ("kind", "trace_id", "prompt", "label", "mode", "harness", "progress", "by_user_name", "by_user_id", "by_avatar_url", "client"):
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
