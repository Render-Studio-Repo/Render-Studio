"""Spawn generation kernels outside uvicorn so HTTP restarts do not kill jobs."""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]
KEEP_JOB_FILES = 16


def prune_job_files(project_path: Path, *, keep: int = KEEP_JOB_FILES, keep_stem: str | None = None) -> int:
    """Drop old detached-worker payload/log pairs so `.generation_jobs` cannot run away."""
    jobs_dir = project_path / ".generation_jobs"
    if not jobs_dir.is_dir():
        return 0
    files = [
        p
        for p in jobs_dir.iterdir()
        if p.is_file() and p.suffix.lower() in {".json", ".log"}
    ]
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    kept_stems: set[str] = set()
    if keep_stem:
        kept_stems.add(str(keep_stem))
    removed = 0
    for fp in files:
        stem = fp.stem
        if stem in kept_stems or len(kept_stems) < keep:
            kept_stems.add(stem)
            continue
        try:
            fp.unlink()
            removed += 1
        except OSError:
            pass
    return removed


def selftest_touch(done_path: str, meta_path: str) -> None:
    """Tiny worker target for tests — does not import backend.main."""
    Path(meta_path).write_text(
        json.dumps(
            {
                "pid": os.getpid(),
                "pgid": os.getpgid(0),
                "sid": os.getsid(0),
                "ppid": os.getppid(),
            }
        ),
        encoding="utf-8",
    )
    Path(done_path).write_text("ok", encoding="utf-8")


def spawn_detached(
    target: str,
    args: list[Any],
    *,
    project_path: Path,
    trace_id: str,
) -> int:
    """Start ``target(*args)`` in a new session and record its PID on the job.

    ``target`` is ``module.function`` imported in the child (e.g.
    ``backend.main._background_prompt_kernel``).
    """
    jobs_dir = project_path / ".generation_jobs"
    jobs_dir.mkdir(parents=True, exist_ok=True)
    payload_path = jobs_dir / f"{trace_id}.json"
    log_path = jobs_dir / f"{trace_id}.log"
    payload_path.write_text(
        json.dumps(
            {
                "target": target,
                "args": args,
                "project_path": str(project_path),
                "trace_id": str(trace_id),
            }
        ),
        encoding="utf-8",
    )
    env = os.environ.copy()
    env["RENDER3D_GENERATION_WORKER"] = "1"
    root = str(REPO_ROOT)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = root if not existing else f"{root}{os.pathsep}{existing}"
    log_f = open(log_path, "ab")
    try:
        proc = subprocess.Popen(
            [sys.executable, "-m", "backend.generation_worker", "--payload", str(payload_path)],
            cwd=root,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log_f,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            close_fds=True,
        )
    except Exception:
        log_f.close()
        raise
    log_f.close()
    from backend.services import generation_service

    generation_service.set_worker_pid(
        project_path, proc.pid, trace_id=str(trace_id), detached=True
    )
    prune_job_files(project_path, keep_stem=str(trace_id))
    logger.info(
        "Spawned detached generation worker pid=%s target=%s project=%s trace=%s",
        proc.pid,
        target,
        project_path.name,
        trace_id,
    )
    return int(proc.pid)
