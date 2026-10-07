"""Launch the allowlisted OpenArm ACT evaluator without any hardware access."""

from __future__ import annotations

import json
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
ADAPTER = ROOT / "frontend/sandbox/openarm-mujoco/lerobot_adapter.py"
PYTHON = ROOT / ".venv-lerobot/bin/python"
SCENE_ROOT = ROOT / "frontend/sandbox/openarm-mujoco/v2"
SCENE = SCENE_ROOT / "cell/demo.xml"
OUTPUT = ROOT / "frontend/sandbox/openarm-mujoco/runs/lerobot-latest.json"
TRAJECTORY = ROOT / "frontend/sandbox/openarm-mujoco/runs/lerobot-latest.trajectory.json"
CHECKPOINT = "enactic/act-openarm-2-cell-pick_up_cube_mujoco"
REVISION = "27cbd9a205d2e006aef518a54a3c53cf8e421a13"
PUBLIC_SCENE = "cell/demo.xml"

_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def status(user_id: str) -> dict[str, Any]:
    with _lock:
        return {key: value for key, value in (_jobs.get(user_id) or {"status": "idle", "scene": PUBLIC_SCENE, "checkpoint": CHECKPOINT}).items() if key != "process"}


def _scene_path(scene: str) -> Path:
    relative = Path(str(scene or ""))
    if relative.is_absolute() or ".." in relative.parts or relative.suffix != ".xml":
        raise ValueError("Select a bundled MuJoCo XML scene")
    resolved = (SCENE_ROOT / relative).resolve()
    if resolved.parent != SCENE_ROOT and SCENE_ROOT not in resolved.parents:
        raise ValueError("Scene must stay inside the bundled MuJoCo scenes")
    if not resolved.is_file():
        raise ValueError(f"MuJoCo scene is unavailable: {scene}")
    return resolved


def _run(user_id: str, evaluation_id: str) -> None:
    with _lock:
        original = dict(_jobs.get(user_id) or {})
    scene = _scene_path(str(original.get("scene") or PUBLIC_SCENE))
    checkpoint = str(original.get("checkpoint") or CHECKPOINT)
    revision = str(original.get("revision") or "main")
    command = [
        str(PYTHON), str(ADAPTER), "--scene", str(scene), "--output", str(OUTPUT),
        "--checkpoint", checkpoint, "--revision", revision, "--device", "auto", "--seconds", "20",
    ]
    try:
        TRAJECTORY.unlink(missing_ok=True)
        process = subprocess.Popen(
            command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
        )
        with _lock:
            live = _jobs.get(user_id)
            if not live or live.get("evaluationId") != evaluation_id:
                process.terminate()
                return
            live["process"] = process
        timeout_guard = threading.Timer(300, process.kill)
        timeout_guard.daemon = True
        timeout_guard.start()
        output_tail: list[str] = []
        try:
            assert process.stdout is not None
            for line in process.stdout:
                output_tail.append(line)
                output_tail = output_tail[-40:]
                try:
                    frame = json.loads(line)
                except json.JSONDecodeError:
                    continue
                # The adapter prints a final indented JSON summary after the
                # JSONL trajectory stream. A scalar summary line (for example
                # the calibration offset) is valid JSON but is not a frame.
                if not isinstance(frame, dict):
                    continue
                if frame.get("kind") != "trajectory_frame" or not isinstance(frame.get("qpos"), list):
                    continue
                with _lock:
                    live = _jobs.get(user_id)
                    if live and live.get("evaluationId") == evaluation_id and live.get("status") == "running":
                        live["liveFrame"] = frame
                        live["progressSteps"] = int(frame.get("step") or 0)
                        live["simSeconds"] = float(frame.get("sim_seconds") or 0)
            exit_code = process.wait()
        finally:
            timeout_guard.cancel()
        result = json.loads(OUTPUT.read_text()) if OUTPUT.is_file() else {}
        job = {
            "status": "completed" if exit_code in (0, 2) else "failed",
            "scene": original["scene"],
            "checkpoint": checkpoint,
            "revision": revision,
            "evaluationId": evaluation_id,
            "result": result,
            "exitCode": exit_code,
            "finishedAt": _now(),
            "error": "" if exit_code in (0, 2) else "".join(output_tail)[-2000:],
            "startedAt": original.get("startedAt", ""),
            "runId": original.get("runId", ""),
            "dataset": original.get("dataset", ""),
            "successRule": "cube rises at least 0.06 m and stays above the threshold for 8 consecutive policy steps",
            "simulationPassed": result.get("success") is True,
            "trajectoryAvailable": TRAJECTORY.is_file(),
            "hardwareValidated": False,
            "hardwareBlockers": [
                "ACT action schema is not validated against the Dimensional OpenArm coordinator",
                "No feedback-checked ACT-to-Dimensional trajectory adapter is installed",
                "Browser and headless MuJoCo action streams are not connected",
            ],
        }
    except Exception as exc:  # surfaced to the authenticated status endpoint
        job = {"status": "failed", "scene": original.get("scene", PUBLIC_SCENE), "checkpoint": checkpoint, "revision": revision, "evaluationId": evaluation_id, "finishedAt": _now(), "error": str(exc)[:2000]}
    with _lock:
        current = _jobs.get(user_id)
        if current and current.get("evaluationId") == evaluation_id:
            _jobs[user_id] = job


def start(user_id: str, body: dict[str, Any]) -> dict[str, Any]:
    checkpoint = str(body.get("checkpoint") or "").strip()
    scene = str(body.get("scene") or "").strip()
    revision = str(body.get("revision") or "main").strip()
    if not checkpoint or len(checkpoint) > 160 or any(ch.isspace() for ch in checkpoint):
        raise ValueError("Select a valid ACT checkpoint")
    _scene_path(scene)
    if checkpoint == CHECKPOINT and scene != PUBLIC_SCENE:
        raise ValueError(f"The OpenArm cube-pick ACT checkpoint is trained for {PUBLIC_SCENE}, not {scene}")
    if not PYTHON.is_file():
        raise RuntimeError("The LeRobot evaluator environment is not installed")
    if not ADAPTER.is_file() or not SCENE.is_file():
        raise RuntimeError("The OpenArm evaluator or cell/demo.xml scene is missing")
    with _lock:
        current = _jobs.get(user_id)
        if current and current.get("status") == "running":
            if current.get("scene") == scene and current.get("checkpoint") == checkpoint:
                return {key: value for key, value in current.items() if key != "process"}
            raise ValueError(f"Stop the active evaluation for {current.get('scene')} before starting {scene}")
        evaluation_id = uuid.uuid4().hex
        job = {
            "status": "running", "scene": scene, "checkpoint": checkpoint, "revision": revision, "evaluationId": evaluation_id,
            "dataset": str(body.get("dataset") or ""), "runId": str(body.get("runId") or ""), "startedAt": _now(),
        }
        _jobs[user_id] = job
    threading.Thread(target=_run, args=(user_id, evaluation_id), daemon=True, name=f"openarm-act-{user_id[:12]}").start()
    return dict(job)


def stop(user_id: str) -> dict[str, Any]:
    with _lock:
        current = _jobs.get(user_id)
        if not current or current.get("status") != "running":
            job = {"status": "idle", "scene": "", "checkpoint": "", "stoppedAt": _now()}
            _jobs[user_id] = job
            return dict(job)
        process = current.get("process")
        job = {key: value for key, value in current.items() if key != "process"}
        job.update({"status": "stopped", "stoppedAt": _now(), "finishedAt": _now()})
        _jobs[user_id] = job
    if process is not None and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
    return job
