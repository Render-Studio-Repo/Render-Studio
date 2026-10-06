"""Persistent, simulation-only OpenArm PPO training profiles and preflight gates."""

from __future__ import annotations

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
STORE = ROOT / "data" / "robotics-rl"
PYTHON = ROOT / ".venv-lerobot" / "bin" / "python"
SCENE = ROOT / "frontend/sandbox/openarm-mujoco/v2/cell/demo.xml"
DATASET_RELATIVE = Path("references/Robots/OpenArm 2.0/Training Data/OpenArm Cube Pick LeRobot")

DEFAULT_PROFILE: dict[str, Any] = {
    "task": "openarm_cube_pick",
    "algorithm": "ppo",
    "bootstrapAct": True,
    "parallelEnvs": 8,
    "totalTimesteps": 1_000_000,
    "evaluationSeeds": 20,
    "learningRate": 0.0003,
    "rewardWeights": {
        "reach": 1.0, "grasp": 2.0, "lift": 5.0, "success": 10.0,
        "smoothness": -0.02, "collision": -2.0, "drop": -5.0,
    },
    "domainRandomization": True,
}


def _path(user_id: str) -> Path:
    safe = "".join(c for c in user_id if c.isalnum() or c in "-_")[:96] or "user"
    return STORE / f"{safe}.json"


def _project_id(value: str) -> str:
    if not value or len(value) > 120 or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for c in value):
        raise ValueError("Invalid project ID")
    return value


def _read(user_id: str) -> dict[str, Any]:
    path = _path(user_id)
    if not path.is_file():
        return {"profiles": {}, "runs": {}}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {"profiles": {}, "runs": {}}
    except (OSError, json.JSONDecodeError):
        return {"profiles": {}, "runs": {}}


def _write(user_id: str, value: dict[str, Any]) -> None:
    STORE.mkdir(parents=True, exist_ok=True)
    path = _path(user_id)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")
    temp.replace(path)


def _profile(value: dict[str, Any] | None) -> dict[str, Any]:
    raw = value or {}
    rewards = dict(DEFAULT_PROFILE["rewardWeights"])
    rewards.update({k: float(v) for k, v in (raw.get("rewardWeights") or {}).items() if k in rewards})
    return {
        **DEFAULT_PROFILE,
        "bootstrapAct": bool(raw.get("bootstrapAct", True)),
        "parallelEnvs": max(1, min(64, int(raw.get("parallelEnvs", 8)))),
        "totalTimesteps": max(10_000, min(100_000_000, int(raw.get("totalTimesteps", 1_000_000)))),
        "evaluationSeeds": max(1, min(200, int(raw.get("evaluationSeeds", 20)))),
        "learningRate": max(0.000001, min(0.1, float(raw.get("learningRate", 0.0003)))),
        "rewardWeights": rewards,
        "domainRandomization": bool(raw.get("domainRandomization", True)),
    }


def get_profile(user_id: str, project_id: str) -> dict[str, Any]:
    project_id = _project_id(project_id)
    data = _read(user_id)
    return {"projectId": project_id, "profile": _profile(data.get("profiles", {}).get(project_id)), "run": data.get("runs", {}).get(project_id)}


def save_profile(user_id: str, project_id: str, profile: dict[str, Any]) -> dict[str, Any]:
    project_id = _project_id(project_id)
    data = _read(user_id)
    clean = _profile(profile)
    data.setdefault("profiles", {})[project_id] = clean
    _write(user_id, data)
    return {"ok": True, "projectId": project_id, "profile": clean}


def preflight(user_id: str, project_id: str) -> dict[str, Any]:
    project_id = _project_id(project_id)
    profile = get_profile(user_id, project_id)["profile"]
    dataset = ROOT / "projects" / project_id / DATASET_RELATIVE
    checks = [
        {"id": "scene", "label": "OpenArm cell/demo.xml", "ok": SCENE.is_file()},
        {"id": "python", "label": "LeRobot Python environment", "ok": PYTHON.is_file()},
        {"id": "dataset", "label": "OpenArm demonstration dataset", "ok": dataset.is_dir() or not profile["bootstrapAct"]},
    ]
    modules: dict[str, bool] = {}
    if PYTHON.is_file():
        code = "import importlib.util,json;print(json.dumps({x:bool(importlib.util.find_spec(x)) for x in ['torch','mujoco','gymnasium','stable_baselines3','lerobot']}))"
        try:
            out = subprocess.run([str(PYTHON), "-c", code], capture_output=True, text=True, timeout=15, check=True)
            modules = json.loads(out.stdout.strip())
        except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
            modules = {}
    for module in ("torch", "mujoco", "gymnasium", "stable_baselines3", "lerobot"):
        checks.append({"id": module, "label": module.replace("_", " "), "ok": modules.get(module, False)})
    blockers = [check["label"] for check in checks if not check["ok"]]
    return {
        "ok": not blockers, "simulationOnly": True, "hardwareAllowed": False,
        "projectId": project_id, "checks": checks, "blockers": blockers,
        "message": "Ready to train PPO in headless MuJoCo." if not blockers else "Training is blocked until the missing simulation dependencies are installed.",
    }


def start(user_id: str, project_id: str) -> dict[str, Any]:
    gate = preflight(user_id, project_id)
    if not gate["ok"]:
        return {**gate, "status": "blocked"}
    data = _read(user_id)
    run = {
        "status": "ready", "createdAt": datetime.now(timezone.utc).isoformat(),
        "stage": "trainer_not_yet_launched", "simulationOnly": True,
        "message": "Preflight passed. The PPO worker entrypoint is the next gated stage; no robot command was sent.",
    }
    data.setdefault("runs", {})[project_id] = run
    _write(user_id, data)
    return {"ok": True, "projectId": project_id, "run": run, "hardwareAllowed": False}
