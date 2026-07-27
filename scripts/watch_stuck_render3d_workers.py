#!/usr/bin/env python3
"""Watch Render Studio uvicorn workers for stuck CAD/kernel CPU burn and recycle them.

Detects worker processes that stay hot while they have no legitimate running
generation job (or the job heartbeat has gone stale). Sends SIGTERM/SIGKILL to
the worker only; uvicorn's parent process respawns a fresh worker.
"""

from __future__ import annotations

import json
import logging
import os
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.generation_service import (  # noqa: E402
    GENERATION_FILE,
    _is_long_running_model,
    _job_idle_seconds,
    _jobs_from_data,
    fail,
)

LOG = logging.getLogger("render3d.worker-watch")

STATE_PATH = Path(os.environ.get("RENDER3D_WORKER_WATCH_STATE", "/var/tmp/render3d-worker-watch.json"))
PROJECTS_ROOT = Path(os.environ.get("RENDER3D_PROJECTS", str(ROOT / "projects")))
CPU_THRESHOLD = float(os.environ.get("RENDER3D_STUCK_CPU_PCT", "35"))
SUSTAIN_SECONDS = float(os.environ.get("RENDER3D_STUCK_MIN_SECONDS", "600"))
STALE_PROGRESS_SECONDS = float(os.environ.get("RENDER3D_STUCK_PROGRESS_SECONDS", "1200"))
STALE_PROGRESS_SECONDS_LONG = float(os.environ.get("RENDER3D_STUCK_PROGRESS_SECONDS_LONG", "2700"))
CLK_TCK = os.sysconf(os.sysconf_names["SC_CLK_TCK"])


def _now() -> float:
    return time.time()


def _load_state() -> dict[str, Any]:
    try:
        raw = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _save_state(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    tmp.replace(STATE_PATH)


def render3d_main_pid() -> int:
    try:
        out = subprocess.run(
            ["systemctl", "show", "render3d.service", "-p", "MainPID", "--value"],
            capture_output=True,
            text=True,
            check=False,
        )
        value = int((out.stdout or "0").strip() or "0")
        return value if value > 0 else 0
    except (OSError, ValueError):
        return 0


def _read_stat(pid: int) -> tuple[int, int] | None:
    try:
        stat = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8")
        close_paren = stat.rfind(")")
        if close_paren < 0:
            return None
        fields = stat[close_paren + 2 :].split()
        utime = int(fields[11])
        stime = int(fields[12])
        return utime, stime
    except (OSError, ValueError, IndexError):
        return None


def worker_pids(main_pid: int) -> list[int]:
    if main_pid <= 0:
        return []
    workers: list[int] = []
    proc_root = Path("/proc")
    for entry in proc_root.iterdir():
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        if pid == main_pid:
            continue
        stat = _read_stat(pid)
        if stat is None:
            continue
        try:
            stat_raw = (proc_root / entry.name / "stat").read_text(encoding="utf-8")
            close_paren = stat_raw.rfind(")")
            ppid = int(stat_raw[close_paren + 2 :].split()[1])
        except (OSError, ValueError, IndexError):
            continue
        if ppid != main_pid:
            continue
        try:
            cmd = (entry / "cmdline").read_bytes().replace(b"\0", b" ").decode("latin1", errors="ignore")
        except OSError:
            cmd = ""
        if "multiprocessing.spawn" in cmd and "spawn_main" in cmd:
            workers.append(pid)
    return sorted(set(workers))


def running_jobs_by_worker() -> dict[int, list[dict[str, Any]]]:
    by_worker: dict[int, list[dict[str, Any]]] = {}
    if not PROJECTS_ROOT.is_dir():
        return by_worker
    now = datetime.now(timezone.utc)
    for project_dir in PROJECTS_ROOT.iterdir():
        if not project_dir.is_dir() or project_dir.name.startswith("."):
            continue
        gen_path = project_dir / GENERATION_FILE
        if not gen_path.is_file():
            continue
        try:
            data = json.loads(gen_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        for job in _jobs_from_data(data):
            if job.get("status") != "running":
                continue
            try:
                worker_pid = int(job.get("worker_pid") or 0)
            except (TypeError, ValueError):
                worker_pid = 0
            if worker_pid <= 0:
                continue
            entry = dict(job)
            entry["_project_path"] = project_dir
            entry["_project_id"] = project_dir.name
            entry["_idle_seconds"] = _job_idle_seconds(job, now=now)
            entry["_long_running"] = _is_long_running_model(job)
            by_worker.setdefault(worker_pid, []).append(entry)
    return by_worker


def _job_is_active(job: dict[str, Any]) -> bool:
    idle = job.get("_idle_seconds")
    if idle is None:
        return True
    limit = STALE_PROGRESS_SECONDS_LONG if job.get("_long_running") else STALE_PROGRESS_SECONDS
    return float(idle) < limit


def worker_cpu_percent(pid: int, prev: dict[str, Any] | None) -> float | None:
    stat = _read_stat(pid)
    if stat is None or not prev:
        return None
    prev_stat = prev.get("stat")
    prev_ts = prev.get("ts")
    if not isinstance(prev_stat, list) or len(prev_stat) != 2 or not isinstance(prev_ts, (int, float)):
        return None
    delta_jiffies = (stat[0] + stat[1]) - (int(prev_stat[0]) + int(prev_stat[1]))
    delta_seconds = _now() - float(prev_ts)
    if delta_seconds <= 0:
        return None
    return max(0.0, 100.0 * delta_jiffies / CLK_TCK / delta_seconds)


def terminate_worker(pid: int, *, dry_run: bool) -> None:
    if dry_run:
        LOG.warning("[dry-run] would terminate stuck worker pid=%s", pid)
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except OSError as exc:
        LOG.error("SIGTERM failed for pid=%s: %s", pid, exc)
        return

    deadline = time.time() + 8.0
    while time.time() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            LOG.warning("terminated stuck worker pid=%s after SIGTERM", pid)
            return
        time.sleep(0.5)

    try:
        os.kill(pid, signal.SIGKILL)
        LOG.warning("SIGKILL stuck worker pid=%s", pid)
    except ProcessLookupError:
        pass
    except OSError as exc:
        LOG.error("SIGKILL failed for pid=%s: %s", pid, exc)


def fail_jobs_for_worker(pid: int, jobs: list[dict[str, Any]], *, dry_run: bool) -> None:
    message = "Generation stopped because the server worker was stuck and was restarted."
    for job in jobs:
        project_path = job.get("_project_path")
        trace_id = job.get("trace_id") or job.get("id")
        if not isinstance(project_path, Path):
            continue
        if dry_run:
            LOG.warning(
                "[dry-run] would fail project=%s trace=%s for stuck worker pid=%s",
                project_path.name,
                trace_id,
                pid,
            )
            continue
        try:
            fail(project_path, message, trace_id=str(trace_id) if trace_id else None)
            LOG.warning(
                "marked generation failed project=%s trace=%s after stuck worker pid=%s",
                project_path.name,
                trace_id,
                pid,
            )
        except Exception as exc:
            LOG.error(
                "could not fail generation project=%s trace=%s: %s",
                project_path.name,
                trace_id,
                exc,
            )


def evaluate_worker(
    pid: int,
    prev: dict[str, Any] | None,
    jobs: list[dict[str, Any]],
    *,
    dry_run: bool,
) -> tuple[dict[str, Any], bool]:
    stat = _read_stat(pid)
    now = _now()
    sample = {
        "ts": now,
        "stat": list(stat) if stat else None,
        "high_cpu_since": None,
    }
    if stat is None:
        return sample, False

    cpu_pct = worker_cpu_percent(pid, prev)
    prev_high_since = None
    if prev and isinstance(prev.get("high_cpu_since"), (int, float)):
        prev_high_since = float(prev["high_cpu_since"])

    if cpu_pct is not None and cpu_pct >= CPU_THRESHOLD:
        sample["cpu_pct"] = round(cpu_pct, 1)
        sample["high_cpu_since"] = prev_high_since if prev_high_since else now
    else:
        sample["cpu_pct"] = round(cpu_pct, 1) if cpu_pct is not None else None
        sample["high_cpu_since"] = None
        return sample, False

    high_since = float(sample["high_cpu_since"] or now)
    if (_now() - high_since) < SUSTAIN_SECONDS:
        return sample, False

    active_jobs = [job for job in jobs if _job_is_active(job)]
    if active_jobs:
        LOG.info(
            "worker pid=%s hot for %.0fs but %d active generation job(s) still updating; skipping",
            pid,
            _now() - high_since,
            len(active_jobs),
        )
        return sample, False

    stale_jobs = [job for job in jobs if not _job_is_active(job)]
    reason = "no running generation" if not jobs else f"{len(stale_jobs)} stale running job(s)"
    LOG.warning(
        "stuck worker pid=%s cpu~%.1f%% sustained %.0fs (%s); recycling",
        pid,
        cpu_pct or 0.0,
        _now() - high_since,
        reason,
    )
    if stale_jobs:
        fail_jobs_for_worker(pid, stale_jobs, dry_run=dry_run)
    terminate_worker(pid, dry_run=dry_run)
    sample["high_cpu_since"] = None
    return sample, True


def run_guard(*, dry_run: bool = False) -> int:
    main_pid = render3d_main_pid()
    if main_pid <= 0:
        LOG.info("render3d.service is not running; nothing to watch")
        _save_state({"workers": {}, "updated_at": _now()})
        return 0

    workers = worker_pids(main_pid)
    if not workers:
        LOG.info("no uvicorn workers found under main pid=%s", main_pid)
        _save_state({"workers": {}, "main_pid": main_pid, "updated_at": _now()})
        return 0

    state = _load_state()
    prev_workers = state.get("workers") if isinstance(state.get("workers"), dict) else {}
    if state.get("main_pid") not in (None, main_pid):
        LOG.info("render3d main pid changed (%s -> %s); resetting watch state", state.get("main_pid"), main_pid)
        prev_workers = {}

    jobs_by_worker = running_jobs_by_worker()

    next_workers: dict[str, Any] = {}
    killed = 0
    for pid in workers:
        prev = prev_workers.get(str(pid)) if isinstance(prev_workers, dict) else None
        sample, did_kill = evaluate_worker(
            pid,
            prev if isinstance(prev, dict) else None,
            jobs_by_worker.get(pid, []),
            dry_run=dry_run,
        )
        next_workers[str(pid)] = sample
        if did_kill:
            killed += 1

    if not dry_run:
        _save_state(
            {
                "main_pid": main_pid,
                "workers": next_workers,
                "updated_at": _now(),
            }
        )
    LOG.info(
        "watch complete: main_pid=%s workers=%s killed=%s dry_run=%s",
        main_pid,
        len(workers),
        killed,
        dry_run,
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = list(argv or sys.argv[1:])
    dry_run = False
    if args[:1] == ["guard"]:
        args = args[1:]
    elif args[:1] == ["dry-run"]:
        dry_run = True
        args = args[1:]
    elif args and args[0] not in {"-h", "--help"}:
        LOG.error("Usage: %s [guard|dry-run]", Path(sys.argv[0]).name)
        return 2
    if args:
        LOG.error("unexpected args: %s", args)
        return 2
    return run_guard(dry_run=dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
