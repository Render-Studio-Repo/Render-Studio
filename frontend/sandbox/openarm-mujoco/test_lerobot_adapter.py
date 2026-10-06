from __future__ import annotations

import importlib.util
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("lerobot_adapter.py")
SPEC = importlib.util.spec_from_file_location("lerobot_adapter", MODULE_PATH)
adapter = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = adapter
SPEC.loader.exec_module(adapter)


class FakeTensor:
    def __init__(self, value, shape=None):
        self.value = value
        self._shape = tuple(shape if shape is not None else (len(value),))

    @property
    def shape(self):
        return self._shape

    def permute(self, *axes):
        return FakeTensor(self.value, tuple(self._shape[index] for index in axes))

    def to(self, dtype=None):
        return self

    def __truediv__(self, value):
        return self


class FakeFrame:
    def __init__(self, shape):
        self.shape = shape

    def copy(self):
        return self


class FakeTorch:
    float32 = "float32"

    @staticmethod
    def tensor(value, dtype=None):
        return FakeTensor(value)

    @staticmethod
    def from_numpy(value):
        return FakeTensor(value, value.shape)


class FakeModel:
    def __init__(self):
        self.actuator_ctrlrange = [[-1.0, 1.0] for _ in range(16)]
        self.actuator_trnid = FakeMatrix([[index, 0] for index in range(16)])
        self.jnt_qposadr = list(range(16))
        self.jnt_dofadr = list(range(16))


class FakeMatrix:
    def __init__(self, rows):
        self.rows = rows

    def __getitem__(self, key):
        row, column = key
        return self.rows[row][column]


class FakeData:
    def __init__(self):
        self.qpos = [0.0] * 16
        self.ctrl = [0.0] * 16


class FakePositionData:
    def __init__(self):
        self.xpos = [
            [0.45, 0.0, 1.025],
            [0.30, 0.10, 1.10],
            [0.30, 0.14, 1.10],
            [0.45, -0.03, 1.025],
            [0.45, 0.01, 1.025],
        ]
        self.ncon = 0
        self.contact = []


class AdapterTests(unittest.TestCase):
    def test_actuator_order_matches_lerobot_dataset_metadata(self):
        self.assertEqual(
            adapter.ACTUATORS,
            tuple(
                [f"right_joint{i}_ctrl" for i in range(1, 8)]
                + ["right_finger1_ctrl"]
                + [f"left_joint{i}_ctrl" for i in range(1, 8)]
                + ["left_finger1_ctrl"]
            ),
        )

    def test_training_reset_updates_joint_state_and_controls(self):
        data = FakeData()
        adapter.reset_controlled_state(
            FakeModel(), data, tuple(range(16)), adapter.TRAINING_RESET_STATE
        )
        self.assertEqual(tuple(data.qpos), adapter.TRAINING_RESET_STATE)
        self.assertEqual(tuple(data.ctrl), adapter.TRAINING_RESET_STATE)

    def test_observation_uses_exact_checkpoint_shapes(self):
        frames = {
            camera.observation_key: FakeFrame((camera.height, camera.width, 3))
            for camera in adapter.CAMERAS
        }
        observation = adapter.make_observation(FakeTorch, [0.0] * 16, frames)
        self.assertEqual(observation["observation.state"].shape, (16,))
        for camera in adapter.CAMERAS:
            self.assertEqual(
                observation[camera.observation_key].shape,
                (3, camera.height, camera.width),
            )

    def test_observation_rejects_missing_camera(self):
        frames = {
            camera.observation_key: FakeFrame((camera.height, camera.width, 3))
            for camera in adapter.CAMERAS[:-1]
        }
        with self.assertRaisesRegex(ValueError, "camera frame mismatch"):
            adapter.make_observation(FakeTorch, [0.0] * 16, frames)

    def test_action_is_rate_limited_then_clipped(self):
        result = adapter.clamp_action(FakeModel(), tuple(range(16)), [2.0] * 16, [0.95] * 16, 0.08)
        self.assertEqual(result, [1.0] * 16)

    def test_zero_max_step_preserves_checkpoint_action_then_clips_to_actuator_range(self):
        requested = [0.5] * 8 + [2.0] * 8
        result = adapter.clamp_action(FakeModel(), tuple(range(16)), requested, [-0.9] * 16, 0.0)
        self.assertEqual(result, [0.5] * 8 + [1.0] * 8)

    def test_action_rejects_non_finite_value(self):
        action = [0.0] * 16
        action[4] = math.nan
        with self.assertRaisesRegex(ValueError, "non-finite"):
            adapter.clamp_action(FakeModel(), tuple(range(16)), action, [0.0] * 16, 0.08)

    def test_success_requires_sustained_lift(self):
        detector = adapter.LiftSuccessDetector(1.0, lift_meters=0.06, hold_steps=3)
        self.assertFalse(detector.update(1.07))
        self.assertFalse(detector.update(1.02))
        self.assertFalse(detector.update(1.07))
        self.assertFalse(detector.update(1.08))
        self.assertTrue(detector.update(1.07))

    def test_diagnostics_measure_visible_finger_midpoint_instead_of_wrist_site(self):
        class Model:
            body_geomadr = [0, 0, 0, 0, 0]
            body_geomnum = [1, 1, 1, 1, 1]

        result = adapter.episode_diagnostics(
            None,
            Model(),
            FakePositionData(),
            0,
            (1, 2, 3, 4),
            {1, 2, 3, 4},
            [0.0] * 16,
        )

        for actual, expected in zip(result["right_tool_xyz_m"], [0.45, -0.01, 1.025]):
            self.assertAlmostEqual(actual, expected)
        self.assertAlmostEqual(result["right_tool_distance_m"], 0.01)

    def test_trajectory_is_written_beside_result_for_browser_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "lerobot-latest.json"
            trajectory = adapter.write_trajectory(
                output, Path("/repo/v2/cell/demo.xml"),
                [{"step": 0, "time": 0.0, "qpos": [1.0, 2.0]}],
            )
            payload = json.loads(trajectory.read_text())
            self.assertEqual(trajectory.name, "lerobot-latest.trajectory.json")
            self.assertEqual(payload["scene"], "cell/demo.xml")
            self.assertEqual(payload["frames"][0]["qpos"], [1.0, 2.0])


if __name__ == "__main__":
    unittest.main()
