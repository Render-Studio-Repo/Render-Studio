"""Detached generation workers survive HTTP-process death and honor cancel flags."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from backend.services import generation_process, generation_service


def test_cancel_flags_are_visible_without_in_memory_state(tmp_path: Path) -> None:
    project = tmp_path / "proj"
    project.mkdir()
    generation_service.start(
        project,
        kind="prompt",
        trace_id="trace-a",
        prompt="hi",
        request_body={"prompt": "hi"},
    )
    assert generation_service.is_canceled(project, "trace-a") is False
    generation_service.request_cancel(project, reason="stop", trace_id="trace-a")
    # Simulate a detached worker process with empty in-memory sets.
    generation_service._CANCELED_TRACES.clear()
    generation_service._CANCELED_PROJECTS.clear()
    assert generation_service.is_canceled(project, "trace-a") is True


def test_find_stuck_skips_live_worker_pid(tmp_path: Path) -> None:
    projects = tmp_path / "projects"
    project = projects / "abc"
    project.mkdir(parents=True)
    generation_service.start(
        project,
        kind="prompt",
        trace_id="live-1",
        prompt="hi",
        request_body={"prompt": "hi"},
    )
    generation_service.set_worker_pid(project, os.getpid(), trace_id="live-1", detached=True)
    stuck = generation_service.find_stuck_jobs(projects)
    assert stuck == []


def test_compose_mirrors_detached_on_primary_job(tmp_path: Path) -> None:
    project = tmp_path / "proj"
    project.mkdir()
    generation_service.start(
        project,
        kind="prompt",
        trace_id="det-1",
        prompt="hi",
        request_body={"prompt": "hi", "mode": "vibecad"},
        mode="vibecad",
    )
    generation_service.set_worker_pid(project, os.getpid(), trace_id="det-1", detached=True)
    doc = generation_service.load(project)
    assert doc["detached"] is True
    assert doc["harness"] == "vibecad"
    summary = generation_service.public_summary(project)
    assert summary["detached"] is True
    assert summary["harness"] == "vibecad"


def test_wait_for_worker_jobs_ignores_detached_pids(tmp_path: Path) -> None:
    projects = tmp_path / "projects"
    project = projects / "abc"
    project.mkdir(parents=True)
    generation_service.start(
        project,
        kind="prompt",
        trace_id="live-1",
        prompt="hi",
        request_body={"prompt": "hi"},
    )
    # Worker is this process (detached). HTTP drain uses a different pid.
    generation_service.set_worker_pid(project, os.getpid(), trace_id="live-1", detached=True)
    remaining = generation_service.wait_for_worker_jobs(
        projects, timeout_sec=0.2, pid=os.getpid() + 1
    )
    assert remaining == 0
    assert generation_service.find_stuck_jobs(projects) == []


def test_spawn_detached_uses_new_session(tmp_path: Path) -> None:
    project = tmp_path / "proj"
    project.mkdir()
    done = project / "done.txt"
    meta = project / "meta.json"
    pid = generation_process.spawn_detached(
        "backend.services.generation_process.selftest_touch",
        [str(done), str(meta)],
        project_path=project,
        trace_id="selftest",
    )
    deadline = time.time() + 20
    while time.time() < deadline and not done.is_file():
        time.sleep(0.05)
    assert done.is_file(), f"worker did not finish; pid={pid} log={(project / '.generation_jobs' / 'selftest.log').read_text() if (project / '.generation_jobs' / 'selftest.log').is_file() else 'missing'}"
    info = json.loads(meta.read_text(encoding="utf-8"))
    assert info["pid"] == pid
    assert info["pgid"] == pid
    assert info["sid"] == pid
    assert info["ppid"] != 0
    jobs_dir = project / ".generation_jobs"
    for i in range(20):
        (jobs_dir / f"old-{i}.json").write_text("{}", encoding="utf-8")
        (jobs_dir / f"old-{i}.log").write_text("x", encoding="utf-8")
    removed = generation_process.prune_job_files(project, keep=4, keep_stem="selftest")
    selftest = list(jobs_dir.glob("selftest.*"))
    assert selftest
    leftover_stems = {p.stem for p in jobs_dir.glob("*.json")} | {p.stem for p in jobs_dir.glob("*.log")}
    assert "selftest" in leftover_stems
    assert len(leftover_stems) <= 5
    assert removed > 0
