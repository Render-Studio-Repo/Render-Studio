import json

import pytest

from backend.services.robotics_hardware_program import JOINT_NAMES, build_hardware_candidate, mujoco_qpos_to_openarm
from backend.services.robotics_policy_evaluation import CHECKPOINT


def test_mujoco_qpos_maps_to_pi_joint_order_and_normalized_grippers():
    qpos = [0.0, *range(1, 8), 0.785398, 0.785398, *range(11, 18), -0.785398, -0.785398, 9, 9, 9, 1, 0, 0, 0]

    mapped = mujoco_qpos_to_openarm(qpos)

    assert mapped == pytest.approx([1, 2, 3, 4, 5, 6, 7, 11, 12, 13, 14, 15, 16, 17, 1.0, 1.0])


def test_successful_act_trace_becomes_a_guarded_runnable_pi_program(tmp_path):
    trace = tmp_path / "trajectory.json"
    trace.write_text(json.dumps({
        "scene": "cell/demo.xml",
        "frames": [
            {"time": 0.5, "qpos": [0, *([0.1] * 9), *([0.2] * 9), 0, 0, 1, 1, 0, 0, 0]},
            {"time": 0.533, "qpos": [0, *([0.11] * 9), *([0.21] * 9), 0, 0, 1, 1, 0, 0, 0]},
        ],
    }))

    candidate = build_hardware_candidate(trace, evaluation={
        "simulationPassed": True,
        "checkpoint": CHECKPOINT,
        "revision": "test-revision",
        "evaluationId": "eval-1",
        "result": {"success": True},
    })

    assert candidate["validated"] is True
    assert candidate["blockers"] == []
    assert candidate["joint_names"] == JOINT_NAMES
    assert candidate["times"][0] == 0.0
    assert candidate["positions"][0] == pytest.approx([0.0] * 14 + [1.0, 1.0])
    assert candidate["positions"][-1][:14] == pytest.approx([0.11] * 7 + [0.21] * 7)
    assert len(candidate["positions"]) > 2
    assert candidate["required_cameras"] == ["top", "wrist_left", "wrist_right"]
    assert candidate["validation"]["guarded_home_required"] is True
    assert candidate["validation"]["max_joint_velocity_rad_s"] <= 0.5

    velocities = []
    for index in range(1, len(candidate["positions"])):
        dt = candidate["times"][index] - candidate["times"][index - 1]
        velocities.extend(
            abs(current - previous) / dt
            for previous, current in zip(candidate["positions"][index - 1][:14], candidate["positions"][index][:14])
        )
    assert max(velocities) <= 0.5 + 1e-9


def test_candidate_rejects_a_failed_simulation(tmp_path):
    trace = tmp_path / "trajectory.json"
    trace.write_text(json.dumps({"scene": "cell/demo.xml", "frames": []}))

    with pytest.raises(ValueError, match="successful ACT simulation"):
        build_hardware_candidate(trace, evaluation={"simulationPassed": False, "checkpoint": CHECKPOINT})
