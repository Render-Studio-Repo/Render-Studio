"""Install and discover bounded, project-scoped robotics demo bundles."""
from __future__ import annotations

import json
import re
import shutil
import time
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import quote

import httpx

DEMO_NAME = "Demo OpenArm"
DATASET_REPO = "enactic/openarm-2-cell-pick_up_cube_mujoco-lerobot"
MODEL_REPO = "enactic/act-openarm-2-cell-pick_up_cube_mujoco"
OPENARM_ROOT = Path("references/Robots/OpenArm 2.0")
DEMO_ROOT = OPENARM_ROOT / "Demos" / DEMO_NAME
TRAINING_DATA_ROOT = OPENARM_ROOT / "Training Data" / "OpenArm Cube Pick LeRobot"
POLICY_ROOT = OPENARM_ROOT / "Policies" / "ACT Cube Pick"
SIMULATION_ROOT = OPENARM_ROOT / "Simulation" / "openarm_mujoco_v2"
SIMULATION_SOURCE = Path(__file__).resolve().parents[2] / "frontend" / "sandbox" / "openarm-mujoco" / "v2"
MAX_FILES = 500
STATUS_FILE = ".install-status.json"
WORKSPACE_FOLDERS = {
    "Demos": "Runnable examples, setup receipts, and pinned source manifests.",
    "Scenes": "Scene selections and links to complete simulator bundles.",
    "Robot Models": "Robot descriptions such as MJCF, URDF, and Xacro.",
    "Meshes": "Robot and workcell mesh assets.",
    "Config": "Controller, runtime, and task configuration.",
    "Calibration": "Camera, controller, robot-frame, and joint calibration evidence.",
    "Recordings": "Recorded robot episodes and synchronized observations.",
    "Training Data": "Local datasets or pinned remote streaming manifests.",
    "Policies": "Policy checkpoints or pinned remote model manifests.",
    "Simulation": "Complete MuJoCo or other simulator bundles.",
    "Viser": "Viser scenes, recordings, and visualization manifests.",
}


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temp.replace(path)


def _safe_repo_file(value: str) -> PurePosixPath:
    raw = str(value or "").replace("\\", "/").strip("/")
    rel = PurePosixPath(raw)
    if not raw or len(raw) > 1000 or any(part in {"", ".", ".."} for part in rel.parts):
        raise ValueError("Dataset repository returned an unsafe file path.")
    return rel


def _manifest(root: str) -> dict[str, Any]:
    return {
        "schema": "render3d.robotics-demo.v1",
        "name": DEMO_NAME,
        "robot": "OpenArm 2.0 bimanual",
        "task": "pick up cube",
        "simulator": "MuJoCo",
        "dataset": {"format": "LeRobot Dataset v3", "repo_id": DATASET_REPO, "root": f"{root}/dataset", "episodes": 30, "frames": 5405, "fps": 30},
        "observations": ["observation.state", "observation.images.ceiling", "observation.images.head_left", "observation.images.head_right", "observation.images.wrist_left", "observation.images.wrist_right"],
        "actions": ["right arm 7 joints + gripper", "left arm 7 joints + gripper"],
        "camera_roles": {"pov": "observation.images.ceiling", "head_left": "observation.images.head_left", "head_right": "observation.images.head_right", "left": "observation.images.wrist_left", "right": "observation.images.wrist_right"},
        "hardware": {"config_url": "http://192.168.1.77:8450/robotics/config", "requires_explicit_connect": True, "requires_preflight": ["kill/reset", "calibration", "guarded arms-down home"]},
        "model": {"repo_id": MODEL_REPO, "installed": False, "note": "Model weights remain on Hugging Face and are never executed or deployed to hardware by setup."},
        "simulation": {"project_root": SIMULATION_ROOT.as_posix(), "scene": "cell/demo.xml", "source": "enactic/openarm_mujoco"},
    }


def _instructions() -> str:
    return """# Demo OpenArm

This project folder contains the OpenArm 2.0 cube-pick demonstration in LeRobot Dataset v3.

## Loaded files

- `Training Data/OpenArm Cube Pick LeRobot/remote-dataset.json`: pinned dataset revision and remote shard index.
- `Policies/ACT Cube Pick/remote-policy.json`: pinned example ACT policy revision and file index.
- `Simulation/openarm_mujoco_v2`: complete local MuJoCo bundle used by the browser simulator.
- `robotics-profile.json`: robot, task, camera-role, simulator, and safety mappings.
- `install-receipt.json`: exact revision, file list, byte count, and validation.
- `.install-status.json`: readable background-install progress and log.

## Safe demo order

1. Open Robotics → Home and load **Demo OpenArm**.
2. Start in **Simulation** and stream episodes/camera frames on demand.
3. Use **Shadow** to compare commands without commanding arm motion.
4. For hardware, keep the wired E-stop reachable, clear the cell, connect the Pi, and run reset → calibration → guarded home.
5. Dataset actions are examples, not a validated physical trajectory. Never replay them directly on hardware without joint limits, collision checking, and a tested policy runner.

## Agent-created profiles

Render Agent may create another folder under `references/Robots/` containing `robotics-profile.json` with schema `render3d.robotics-demo.v1`. Robotics Home discovers these project-scoped folders. Loading one never arms hardware.
"""


def _workspace_guides(project: Path) -> None:
    root = Path(project) / OPENARM_ROOT
    for name, description in WORKSPACE_FOLDERS.items():
        folder = root / name
        folder.mkdir(parents=True, exist_ok=True)
        guide = folder / "README.md"
        if not guide.exists():
            guide.write_text(f"# {name}\n\n{description}\n", encoding="utf-8")
    reference = Path(project) / "references" / "OpenArm Demo Sources.md"
    if not reference.exists():
        reference.write_text(
            "# OpenArm demo sources\n\n"
            f"- Dataset: https://huggingface.co/datasets/{DATASET_REPO}\n"
            f"- Example policy: https://huggingface.co/{MODEL_REPO}\n"
            "- MuJoCo source: https://github.com/enactic/openarm_mujoco\n"
            "- MuJoCo documentation: https://docs.openarm.dev/simulation/mujoco/\n",
            encoding="utf-8",
        )


def _remote_manifest(repo_id: str, *, kind: str) -> dict[str, Any]:
    api_kind = "datasets" if kind == "dataset" else "models"
    meta_url = f"https://huggingface.co/api/{api_kind}/{quote(repo_id, safe='/')}"
    response = httpx.get(meta_url, timeout=30.0)
    response.raise_for_status()
    meta = response.json()
    revision = str(meta.get("sha") or "main")
    tree_url = f"https://huggingface.co/api/{api_kind}/{quote(repo_id, safe='/')}/tree/main"
    tree_response = httpx.get(tree_url, params={"recursive": "true", "expand": "true", "limit": 100}, timeout=30.0)
    tree_response.raise_for_status()
    files = []
    total = 0
    tree_payload = tree_response.json()
    for row in tree_payload if isinstance(tree_payload, list) else []:
        if not isinstance(row, dict) or row.get("type") != "file":
            continue
        rel = _safe_repo_file(row.get("path"))
        size = row.get("size")
        size = int(size) if isinstance(size, (int, float)) else 0
        total += size
        files.append({"path": rel.as_posix(), "bytes": size or None})
    if not files or len(files) > MAX_FILES:
        raise ValueError(f"The Hugging Face {kind} manifest is empty or unexpectedly large.")
    return {"repo_id": repo_id, "revision": revision, "files": files, "remote_bytes": total}


def _install_simulation(project: Path) -> dict[str, Any]:
    if not SIMULATION_SOURCE.is_dir():
        raise FileNotFoundError("The bundled OpenArm MuJoCo simulation is unavailable.")
    destination = Path(project) / SIMULATION_ROOT
    shutil.copytree(SIMULATION_SOURCE, destination, dirs_exist_ok=True)
    robot_model = Path(project) / OPENARM_ROOT / "Robot Models" / "openarm_bimanual.xml"
    shutil.copy2(SIMULATION_SOURCE / "openarm_bimanual.xml", robot_model)
    scene_link = Path(project) / OPENARM_ROOT / "Scenes" / "cube-pick-demo.json"
    _write_json(scene_link, {"simulator": "MuJoCo", "root": SIMULATION_ROOT.as_posix(), "scene": "cell/demo.xml", "source": "https://github.com/enactic/openarm_mujoco"})
    files = [path for path in destination.rglob("*") if path.is_file()]
    return {"root": SIMULATION_ROOT.as_posix(), "files": len(files), "bytes": sum(path.stat().st_size for path in files)}


def _local_snapshot(folder: Path, revision: str) -> dict[str, Any] | None:
    try:
        receipt = json.loads((folder / "local-snapshot.json").read_text(encoding="utf-8"))
        if receipt.get("complete") is True and receipt.get("revision") == revision:
            return receipt
    except Exception:
        pass
    return None


def status(project: Path) -> dict[str, Any]:
    root = Path(project) / DEMO_ROOT
    try:
        payload = json.loads((root / STATUS_FILE).read_text(encoding="utf-8"))
    except Exception:
        payload = {"state": "not_installed", "message": "Demo OpenArm is not installed in this project.", "logs": []}
    payload.update({"root": DEMO_ROOT.as_posix(), "name": DEMO_NAME})
    return {"ok": True, "demo": payload}


def _set_status(root: Path, state: str, message: str, logs: list[str], **extra: Any) -> None:
    _write_json(root / STATUS_FILE, {"state": state, "message": message, "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "logs": logs[-30:], **extra})


def install(project: Path) -> dict[str, Any]:
    """Install local simulation assets and pinned remote dataset/model manifests."""
    project = Path(project).resolve()
    root = project / DEMO_ROOT
    root.mkdir(parents=True, exist_ok=True)
    logs = ["Created project folder: Demo OpenArm", f"Source: huggingface.co/datasets/{DATASET_REPO}"]
    _set_status(root, "installing", "Reading the Hugging Face repository manifest…", logs, progress=20)
    try:
        _workspace_guides(project)
        dataset_remote = _remote_manifest(DATASET_REPO, kind="dataset")
        logs.append(f"Pinned dataset revision {dataset_remote['revision'][:12]}")
        _set_status(root, "installing", "Indexing the example ACT policy…", logs, progress=45)
        policy_remote = _remote_manifest(MODEL_REPO, kind="model")
        logs.append(f"Pinned policy revision {policy_remote['revision'][:12]}")
        _set_status(root, "installing", "Copying the bundled OpenArm MuJoCo simulation…", logs, progress=70)
        simulation = _install_simulation(project)
        (root / "README.md").write_text(_instructions(), encoding="utf-8")
        (root / "requirements-streaming.txt").write_text("lerobot>=0.4.0\n", encoding="utf-8")
        manifest = _manifest(DEMO_ROOT.as_posix())
        manifest["dataset"].update({"root": f"hf://datasets/{DATASET_REPO}@{dataset_remote['revision']}", "storage": "hub_stream", "loader": "lerobot.datasets.streaming_dataset.StreamingLeRobotDataset", "local_bytes": 0, "remote_bytes": dataset_remote["remote_bytes"]})
        manifest["model"].update({"root": f"hf://models/{MODEL_REPO}@{policy_remote['revision']}", "revision": policy_remote["revision"]})
        manifest["simulation"].update(simulation)
        _write_json(root / "robotics-profile.json", manifest)
        dataset_root = project / TRAINING_DATA_ROOT
        dataset_root.mkdir(parents=True, exist_ok=True)
        remote = {"schema": "render3d.remote-dataset.v1", **dataset_remote, "loader": "StreamingLeRobotDataset", "streaming": True, "cache_policy": "bounded-runtime-cache", "episodes": 30, "videos": 5}
        _write_json(dataset_root / "remote-dataset.json", remote)
        policy_root = project / POLICY_ROOT
        policy_root.mkdir(parents=True, exist_ok=True)
        _write_json(policy_root / "remote-policy.json", {"schema": "render3d.remote-policy.v1", **policy_remote, "execution": "disabled", "requires_evaluation": True})
        dataset_local = _local_snapshot(dataset_root, dataset_remote["revision"])
        policy_local = _local_snapshot(policy_root, policy_remote["revision"])
        if dataset_local:
            manifest["dataset"].update({"storage": "local_mirror", "local_root": f"{TRAINING_DATA_ROOT.as_posix()}/snapshot", "local_bytes": int(dataset_local.get("bytes") or 0)})
        if policy_local:
            manifest["model"].update({"installed": True, "local_root": f"{POLICY_ROOT.as_posix()}/snapshot", "local_bytes": int(policy_local.get("bytes") or 0), "execution": "disabled"})
        _write_json(root / "robotics-profile.json", manifest)
        checks = {"dataset_manifest": bool(dataset_remote["files"]), "policy_manifest": bool(policy_remote["files"]), "simulation_bundle": simulation["files"] > 0, "streaming_profile": True, "local_dataset_shards": bool(dataset_local), "local_policy_snapshot": bool(policy_local), "policy_execution": False}
        receipt = {"schema": "render3d.robotics-install-receipt.v1", "installed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "dataset_repo": DATASET_REPO, "dataset_revision": dataset_remote["revision"], "dataset_remote_files": len(dataset_remote["files"]), "dataset_remote_bytes": dataset_remote["remote_bytes"], "policy_repo": MODEL_REPO, "policy_revision": policy_remote["revision"], "policy_remote_files": len(policy_remote["files"]), "simulation": simulation, "local_dataset_bytes": int((dataset_local or {}).get("bytes") or 0), "local_policy_bytes": int((policy_local or {}).get("bytes") or 0), "validation": checks}
        _write_json(root / "install-receipt.json", receipt)
        dataset_note = (f"Verified complete local dataset snapshot ({int(dataset_local['bytes']):,} bytes)" if dataset_local else "StreamingLeRobotDataset enabled; no Parquet or MP4 shards copied by setup")
        policy_note = (f"Verified complete local policy snapshot ({int(policy_local['bytes']):,} bytes); execution remains disabled" if policy_local else f"Indexed {len(policy_remote['files'])} policy files without executing weights")
        logs.extend([f"Indexed {len(dataset_remote['files'])} dataset files ({dataset_remote['remote_bytes']:,} remote bytes)", policy_note, f"Copied {simulation['files']} MuJoCo files ({simulation['bytes']:,} local bytes)", dataset_note, "Demo profile is ready; hardware remains disconnected"])
        local_bytes = sum(p.stat().st_size for p in (project / OPENARM_ROOT).rglob("*") if p.is_file())
        _set_status(root, "ready", "Demo OpenArm is ready with local MuJoCo assets and pinned Hugging Face dataset and policy files.", logs, progress=100, files=len(dataset_remote["files"]), local_bytes=local_bytes, remote_bytes=dataset_remote["remote_bytes"], revision=dataset_remote["revision"], active_dataset_root=manifest["dataset"].get("local_root") or manifest["dataset"]["root"], storage=manifest["dataset"]["storage"])
        return status(project)
    except Exception as exc:
        for partial in root.rglob("*.part"):
            partial.unlink(missing_ok=True)
        logs.append(f"Install failed: {exc}")
        _set_status(root, "failed", str(exc)[:500], logs, progress=0)
        raise


def list_profiles(project: Path) -> dict[str, Any]:
    base = Path(project) / "references/Robots"
    profiles = []
    if base.is_dir():
        for path in base.rglob("robotics-profile.json"):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                if payload.get("schema") not in {"render3d.robotics-demo.v1", "render3d.robotics-home-profile.v1"}:
                    continue
                profiles.append({"name": str(payload.get("name") or path.parent.name)[:120], "root": path.parent.relative_to(project).as_posix(), "profile": payload, "updated_at": path.stat().st_mtime_ns})
            except Exception:
                continue
    profiles.sort(key=lambda row: (-int(row.get("updated_at") or 0), row["name"].lower()))
    return {"ok": True, "profiles": profiles}


def save_profile(project: Path, *, name: str, base_root: str = "", settings: dict[str, Any] | None = None) -> dict[str, Any]:
    project = Path(project).resolve()
    label = str(name or "").strip()[:120]
    if not label:
        raise ValueError("Enter a name for the saved robotics profile.")
    base = next((row for row in list_profiles(project)["profiles"] if row["root"] == base_root), None)
    payload = dict((base or {}).get("profile") or {})
    payload.update({
        "schema": "render3d.robotics-home-profile.v1",
        "name": label,
        "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "home": dict(settings or {}),
    })
    dataset_root = str((settings or {}).get("dataset_root") or payload.get("dataset", {}).get("root") or "")[:800]
    payload["dataset"] = {**dict(payload.get("dataset") or {}), "root": dataset_root}
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", label).strip("-._")[:80] or "Robotics-Profile"
    root = project / "references" / "Robots" / "Saved Profiles" / slug
    suffix = 2
    while root.exists():
        root = project / "references" / "Robots" / "Saved Profiles" / f"{slug}-{suffix}"
        suffix += 1
    _write_json(root / "robotics-profile.json", payload)
    return {"ok": True, "saved": {"name": label, "root": root.relative_to(project).as_posix(), "profile": payload}, "hardware_armed": False}
