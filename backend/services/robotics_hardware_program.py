"""Convert a successful OpenArm MuJoCo ACT trace into a guarded Pi program."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from backend.services.robotics_policy_evaluation import CHECKPOINT, REVISION, PUBLIC_SCENE, TRAJECTORY

SCHEMA = "render-studio-policy-program/v2"
JOINT_NAMES = [
    *[f"openarm_left_joint{i}" for i in range(1, 8)],
    *[f"openarm_right_joint{i}" for i in range(1, 8)],
    "left_arm/gripper",
    "right_arm/gripper",
]
REQUIRED_CAMERAS = ["top", "wrist_left", "wrist_right"]
FINGER_TRAVEL_RAD = math.pi / 4.0
MAX_ARM_VELOCITY_RAD_S = 0.5
MAX_GRIPPER_VELOCITY_S = 0.5
MIN_SEGMENT_S = 1.0 / 30.0


def _finite(values: list[Any], *, width: int) -> list[float]:
    if len(values) < width:
        raise ValueError(f"trajectory qpos requires at least {width} values")
    out = [float(value) for value in values]
    if not all(math.isfinite(value) for value in out):
        raise ValueError("trajectory qpos must contain finite values")
    return out


def mujoco_qpos_to_openarm(qpos: list[Any]) -> list[float]:
    """Map cell/demo.xml qpos to the Pi's left, right, gripper order."""
    values = _finite(qpos, width=19)
    left = values[1:8]
    right = values[10:17]
    left_gripper = min(1.0, max(0.0, values[8] / FINGER_TRAVEL_RAD))
    right_gripper = min(1.0, max(0.0, -values[17] / FINGER_TRAVEL_RAD))
    return [*left, *right, left_gripper, right_gripper]


def _guarded_timing(positions: list[list[float]], source_times: list[float]) -> tuple[list[list[float]], list[float]]:
    """Lead in from guarded Home and cap every interpolated joint velocity."""
    if not positions:
        raise ValueError("trajectory has no positions")
    for index, row in enumerate(positions):
        if len(row) != len(JOINT_NAMES):
            raise ValueError(f"trajectory position {index} has the wrong joint count")
        if any(abs(value) > math.pi for value in row[:14]):
            raise ValueError(f"trajectory position {index} exceeds the conservative arm envelope")
        if any(value < 0.0 or value > 1.0 for value in row[14:]):
            raise ValueError(f"trajectory position {index} exceeds the normalized gripper envelope")

    guarded_positions = [[*([0.0] * 14), 1.0, 1.0]]
    guarded_times = [0.0]
    previous_source_time = 0.0
    for index, row in enumerate(positions):
        source_time = source_times[index]
        requested_dt = source_time - previous_source_time if index else MIN_SEGMENT_S
        arm_dt = max(abs(a - b) for a, b in zip(guarded_positions[-1][:14], row[:14])) / MAX_ARM_VELOCITY_RAD_S
        gripper_dt = max(abs(a - b) for a, b in zip(guarded_positions[-1][14:], row[14:])) / MAX_GRIPPER_VELOCITY_S
        dt = max(MIN_SEGMENT_S, requested_dt, arm_dt, gripper_dt)
        guarded_positions.append(row)
        guarded_times.append(guarded_times[-1] + dt)
        previous_source_time = source_time
    return guarded_positions, guarded_times


def build_hardware_candidate(
    trajectory_path: Path = TRAJECTORY,
    *,
    evaluation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    evaluation = evaluation or {}
    if evaluation.get("simulationPassed") is not True:
        raise ValueError("a successful ACT simulation evaluation is required")
    if str(evaluation.get("checkpoint") or "") != CHECKPOINT:
        raise ValueError("the evaluated checkpoint does not match the OpenArm ACT hardware candidate")
    payload = json.loads(trajectory_path.read_text())
    if str(payload.get("scene") or "") != PUBLIC_SCENE:
        raise ValueError(f"the ACT hardware candidate requires {PUBLIC_SCENE}")
    frames = payload.get("frames")
    if not isinstance(frames, list) or len(frames) < 2:
        raise ValueError("the successful evaluation did not produce a usable trajectory")
    first_time = float(frames[0].get("time") or 0.0)
    positions: list[list[float]] = []
    times: list[float] = []
    previous = -1.0
    for index, frame in enumerate(frames):
        if not isinstance(frame, dict) or not isinstance(frame.get("qpos"), list):
            raise ValueError(f"trajectory frame {index} is missing qpos")
        at = max(0.0, float(frame.get("time") or 0.0) - first_time)
        if at <= previous:
            at = previous + 1.0 / 30.0
        positions.append(mujoco_qpos_to_openarm(frame["qpos"]))
        times.append(at)
        previous = at
    policy_start = positions[0]
    start_offset = max(abs(value) for value in policy_start[:14])
    positions, times = _guarded_timing(positions, times)
    return {
        "schema": SCHEMA,
        "id": "act_openarm_cube_pick_candidate",
        "name": "Guarded ACT cube pick hardware program",
        "kind": "act_trajectory",
        "validated": True,
        "scene": PUBLIC_SCENE,
        "source": f"checkpoint:{CHECKPOINT}",
        "checkpoint": CHECKPOINT,
        "revision": str(evaluation.get("revision") or REVISION),
        "action_schema": "openarm_joint_position_v1",
        "joint_names": list(JOINT_NAMES),
        "times": times,
        "positions": positions,
        "start_positions": positions[0],
        "policy_start_positions": policy_start,
        "start_max_offset_from_arms_down_rad": start_offset,
        "required_cameras": list(REQUIRED_CAMERAS),
        "blockers": [],
        "validation": {
            "scope": "mapped_trajectory_with_runtime_safety_gates",
            "simulation_passed": True,
            "joint_mapping": "cell_demo_qpos_to_openarm_v1",
            "joint_envelope_rad": [-math.pi, math.pi],
            "gripper_envelope": [0.0, 1.0],
            "max_joint_velocity_rad_s": MAX_ARM_VELOCITY_RAD_S,
            "max_gripper_velocity_s": MAX_GRIPPER_VELOCITY_S,
            "guarded_home_required": True,
            "operator_clearance_required": True,
            "live_cameras_required": list(REQUIRED_CAMERAS),
        },
        "simulation": {
            "passed": True,
            "evaluation_id": str(evaluation.get("evaluationId") or ""),
            "result": evaluation.get("result") or {},
        },
    }
