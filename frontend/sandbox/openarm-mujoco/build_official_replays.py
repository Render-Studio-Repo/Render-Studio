"""Build deterministic browser replays from successful OpenArm episodes.

Enactic's dataset replayer drives MuJoCo with recorded observation qpos. It
does not use the converted LeRobot action column. This script mirrors that
behavior and records complete MuJoCo qpos frames for the browser viewer.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import mujoco
import pyarrow.parquet as pq

from lerobot_adapter import ACTUATORS, clamp_action, reset_controlled_state, resolve_named_ids, write_action

EPISODE_CUBE_XY = {0: (0.45, 0.0), 3: (0.41, 0.0)}


def build_episode(scene: Path, rows: list[dict], episode_index: int) -> dict:
    episode = sorted(
        (row for row in rows if int(row["episode_index"]) == episode_index),
        key=lambda row: int(row["frame_index"]),
    )
    if not episode or int(episode[0].get("success", 0)) != 1:
        raise ValueError(f"episode {episode_index} is absent or not marked successful")

    model = mujoco.MjModel.from_xml_path(str(scene))
    data = mujoco.MjData(model)
    actuator_ids = resolve_named_ids(mujoco, model, mujoco.mjtObj.mjOBJ_ACTUATOR, ACTUATORS)
    cube_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, "orange_cube")
    if cube_id < 0:
        raise ValueError("scene is missing orange_cube")

    mujoco.mj_resetData(model, data)
    reset_controlled_state(model, data, actuator_ids, episode[0]["observation.state"])
    cube_joint_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, "orange_cube")
    cube_qpos_address = int(model.jnt_qposadr[cube_joint_id])
    cube_x, cube_y = EPISODE_CUBE_XY.get(episode_index, (0.45, 0.0))
    data.qpos[cube_qpos_address:cube_qpos_address + 3] = (cube_x, cube_y, 1.05)
    mujoco.mj_forward(model, data)
    initial_z = float(data.xpos[cube_id][2])
    peak_z = initial_z
    physics_steps = max(1, round((1 / 30) / float(model.opt.timestep)))
    frames = []
    for row in episode:
        observed = row["observation.state"]
        targets = clamp_action(model, actuator_ids, observed, observed, 999.0)
        write_action(data, actuator_ids, targets)
        for _ in range(physics_steps):
            mujoco.mj_step(model, data)
        cube_z = float(data.xpos[cube_id][2])
        peak_z = max(peak_z, cube_z)
        frames.append({
            "step": int(row["frame_index"]),
            "time": float(data.time),
            "qpos": [float(value) for value in data.qpos],
        })

    lift_m = peak_z - initial_z
    if lift_m < 0.06:
        raise RuntimeError(f"episode {episode_index} did not reproduce success; lift={lift_m:.6f} m")
    return {
        "source": "enactic/dora-openarm-dataset-replayer",
        "dataset": "enactic/openarm-2-cell-pick_up_cube_mujoco-lerobot",
        "scene": "cell/demo.xml",
        "episodeIndex": episode_index,
        "success": True,
        "initialCubeZM": initial_z,
        "peakCubeZM": peak_z,
        "liftM": lift_m,
        "fps": 30,
        "frames": frames,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--parquet", type=Path, required=True)
    parser.add_argument("--scene", type=Path, default=Path(__file__).parent / "v2/cell/demo.xml")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).parent / "runs/official")
    parser.add_argument("--episodes", type=int, nargs="+", default=[0, 3])
    args = parser.parse_args()

    rows = pq.read_table(args.parquet).to_pylist()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for episode_index in args.episodes:
        replay = build_episode(args.scene.resolve(), rows, episode_index)
        destination = args.output_dir / f"episode-{episode_index}.trajectory.json"
        destination.write_text(json.dumps(replay, separators=(",", ":")))
        print(f"episode={episode_index} frames={len(replay['frames'])} lift_m={replay['liftM']:.6f} output={destination}")


if __name__ == "__main__":
    main()
