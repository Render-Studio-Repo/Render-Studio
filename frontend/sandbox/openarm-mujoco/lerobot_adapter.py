"""Run the OpenArm cube-pick ACT checkpoint in the matching MuJoCo scene.

This adapter is simulation-only. It never imports or calls the Raspberry Pi
robot API. The policy observes the five cameras and 16 controlled joints used
during training, then emits absolute MuJoCo joint targets.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import math
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

CHECKPOINT = "enactic/act-openarm-2-cell-pick_up_cube_mujoco"
CHECKPOINT_REVISION = "27cbd9a205d2e006aef518a54a3c53cf8e421a13"
POLICY_HZ = 30.0


@dataclass(frozen=True)
class CameraSpec:
    observation_key: str
    mujoco_name: str
    height: int
    width: int


CAMERAS = (
    CameraSpec("observation.images.ceiling", "camera_ceiling", 600, 960),
    CameraSpec("observation.images.head_left", "camera_head_left", 720, 1280),
    CameraSpec("observation.images.head_right", "camera_head_right", 720, 1280),
    CameraSpec("observation.images.wrist_left", "camera_wrist_left", 600, 960),
    CameraSpec("observation.images.wrist_right", "camera_wrist_right", 600, 960),
)

ACTUATORS = tuple(
    [f"right_joint{i}_ctrl" for i in range(1, 8)]
    + ["right_finger1_ctrl"]
    + [f"left_joint{i}_ctrl" for i in range(1, 8)]
    + ["left_finger1_ctrl"]
)

# Episode 0 frame 0 from the checkpoint's LeRobot v3 training dataset. The
# generic MuJoCo "home" keyframe is outside that dataset's reset distribution.
TRAINING_RESET_STATE = (
    -0.5286853, 0.4474375, 0.2101837, 2.0552807,
    0.4284768, -0.3993252, 0.7187716, -0.7853599,
    0.4838451, -0.3621209, -0.3063321, 2.0235825,
    -0.2978640, 0.3201285, -0.5273666, 0.7853647,
)


@dataclass(frozen=True)
class EpisodeResult:
    checkpoint: str
    checkpoint_revision: str
    scene: str
    device: str
    success: bool
    reason: str
    steps: int
    sim_seconds: float
    wall_seconds: float
    initial_cube_z: float
    peak_cube_z: float
    success_threshold_z: float
    max_abs_joint_change: float
    min_left_tool_distance_m: float
    min_right_tool_distance_m: float
    max_cube_contacts: int
    closest_tool_side: str
    closest_tool_distance_m: float
    closest_tool_vertical_offset_m: float
    closest_cube_xyz_m: list[float]
    closest_tool_xyz_m: list[float]
    right_tool_z_correction_m: float
    settle_seconds: float


class LiftSuccessDetector:
    def __init__(self, initial_z: float, lift_meters: float = 0.06, hold_steps: int = 8):
        if lift_meters <= 0 or hold_steps < 1:
            raise ValueError("lift_meters must be positive and hold_steps must be at least one")
        self.threshold_z = initial_z + lift_meters
        self.hold_steps = hold_steps
        self.consecutive_steps = 0
        self.peak_z = initial_z

    def update(self, cube_z: float) -> bool:
        if not math.isfinite(cube_z):
            raise ValueError("cube height must be finite")
        self.peak_z = max(self.peak_z, cube_z)
        self.consecutive_steps = self.consecutive_steps + 1 if cube_z >= self.threshold_z else 0
        return self.consecutive_steps >= self.hold_steps


def camera_thumbnails(frames: Mapping[str, Any], width: int = 192) -> dict[str, str]:
    from PIL import Image

    encoded = {}
    for key, frame in frames.items():
        image = Image.fromarray(frame)
        height = max(1, round(image.height * width / image.width))
        image.thumbnail((width, height))
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=62, optimize=True)
        encoded[key.rsplit(".", 1)[-1]] = "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
    return encoded


def episode_diagnostics(
    mujoco: Any, model: Any, data: Any, cube_id: int,
    finger_body_ids: Sequence[int], gripper_geom_ids: set[int], state: Sequence[float],
) -> dict[str, Any]:
    cube = [float(value) for value in data.xpos[cube_id]]
    # The ee_control_point sites sit at the wrist base, roughly one finger
    # length above the actual grasp. Report the midpoint between the two finger
    # roots so the displayed distance matches the visible jaws.
    tools = []
    for body_pair in (finger_body_ids[:2], finger_body_ids[2:4]):
        tools.append([
            float(sum(data.xpos[body_id][axis] for body_id in body_pair) / len(body_pair))
            for axis in range(3)
        ])
    distances = [math.dist(tool, cube) for tool in tools]
    cube_geoms = set(range(int(model.body_geomadr[cube_id]), int(model.body_geomadr[cube_id] + model.body_geomnum[cube_id])))
    environment_contacts = 0
    gripper_contacts = 0
    for index in range(int(data.ncon)):
        contact = data.contact[index]
        pair = {int(contact.geom1), int(contact.geom2)}
        if pair & cube_geoms:
            environment_contacts += 1
            if pair & gripper_geom_ids:
                gripper_contacts += 1
    return {
        "cube_xyz_m": cube,
        "left_tool_xyz_m": tools[0],
        "right_tool_xyz_m": tools[1],
        "left_tool_distance_m": distances[0],
        "right_tool_distance_m": distances[1],
        "left_gripper": float(state[15]),
        "right_gripper": float(state[7]),
        "cube_gripper_contacts": gripper_contacts,
        "cube_environment_contacts": environment_contacts,
    }


def resolve_named_ids(mujoco: Any, model: Any, object_type: Any, names: Iterable[str]) -> tuple[int, ...]:
    ids = tuple(int(mujoco.mj_name2id(model, object_type, name)) for name in names)
    missing = [name for name, object_id in zip(names, ids) if object_id < 0]
    if missing:
        raise ValueError(f"MuJoCo model is missing required names: {', '.join(missing)}")
    return ids


def state_from_mujoco(model: Any, data: Any, actuator_ids: Sequence[int]) -> list[float]:
    state = []
    for actuator_id in actuator_ids:
        joint_id = int(model.actuator_trnid[actuator_id, 0])
        if joint_id < 0:
            raise ValueError(f"actuator {actuator_id} is not joint-coupled")
        state.append(float(data.qpos[int(model.jnt_qposadr[joint_id])]))
    return state


def clamp_action(
    model: Any,
    actuator_ids: Sequence[int],
    proposed: Sequence[float],
    prior: Sequence[float],
    max_step: float,
) -> list[float]:
    if len(proposed) != 16 or len(prior) != 16:
        raise ValueError("policy action and prior state must each contain 16 values")
    if max_step < 0:
        raise ValueError("max_step must be non-negative")
    safe = []
    for actuator_id, requested, previous in zip(actuator_ids, proposed, prior):
        if not math.isfinite(float(requested)):
            raise ValueError("policy returned a non-finite action")
        low, high = (float(value) for value in model.actuator_ctrlrange[actuator_id])
        bounded_step = (
            max(previous - max_step, min(previous + max_step, float(requested)))
            if max_step > 0
            else float(requested)
        )
        safe.append(max(low, min(high, bounded_step)))
    return safe


def write_action(data: Any, actuator_ids: Sequence[int], action: Sequence[float]) -> None:
    for actuator_id, value in zip(actuator_ids, action):
        data.ctrl[actuator_id] = value


def apply_right_tool_z_correction(
    mujoco: Any,
    np: Any,
    model: Any,
    current_data: Any,
    scratch_data: Any,
    actuator_ids: Sequence[int],
    action: Sequence[float],
    right_site_id: int,
    offset_m: float,
) -> list[float]:
    """Apply a bounded Cartesian Z correction to right-arm joint targets.

    This changes only simulated commands. The Jacobian is evaluated at the
    policy's proposed pose, so the correction remains Cartesian rather than a
    brittle fixed joint-angle bias.
    """
    corrected = list(action)
    if abs(offset_m) < 1e-9:
        return corrected
    scratch_data.qpos[:] = current_data.qpos
    scratch_data.qvel[:] = current_data.qvel
    for actuator_id, value in zip(actuator_ids, action):
        joint_id = int(model.actuator_trnid[actuator_id, 0])
        scratch_data.qpos[int(model.jnt_qposadr[joint_id])] = value
    mujoco.mj_forward(model, scratch_data)
    jacobian = np.zeros((3, model.nv))
    rotation_jacobian = np.zeros((3, model.nv))
    mujoco.mj_jacSite(model, scratch_data, jacobian, rotation_jacobian, right_site_id)
    right_arm_actuators = actuator_ids[:7]
    dofs = [
        int(model.jnt_dofadr[int(model.actuator_trnid[actuator_id, 0])])
        for actuator_id in right_arm_actuators
    ]
    arm_jacobian = jacobian[:, dofs]
    damping = 0.03
    desired = np.asarray([0.0, 0.0, offset_m])
    delta = arm_jacobian.T @ np.linalg.solve(
        arm_jacobian @ arm_jacobian.T + (damping ** 2) * np.eye(3), desired
    )
    for action_index, (actuator_id, adjustment) in enumerate(zip(right_arm_actuators, delta)):
        low, high = (float(value) for value in model.actuator_ctrlrange[actuator_id])
        bounded = max(-0.12, min(0.12, float(adjustment)))
        corrected[action_index] = max(low, min(high, corrected[action_index] + bounded))
    return corrected


def reset_controlled_state(model: Any, data: Any, actuator_ids: Sequence[int], state: Sequence[float]) -> None:
    if len(state) != 16:
        raise ValueError("reset state must contain 16 values")
    for actuator_id, value in zip(actuator_ids, state):
        joint_id = int(model.actuator_trnid[actuator_id, 0])
        data.qpos[int(model.jnt_qposadr[joint_id])] = value
        data.ctrl[actuator_id] = value


def settle_policy_scene(
    mujoco: Any,
    model: Any,
    data: Any,
    actuator_ids: Sequence[int],
    state: Sequence[float],
    settle_seconds: float,
) -> None:
    """Settle free objects, then restore the exact recorded policy reset state."""
    if settle_seconds < 0:
        raise ValueError("settle_seconds must be non-negative")
    reset_controlled_state(model, data, actuator_ids, state)
    mujoco.mj_forward(model, data)
    for _ in range(round(settle_seconds / float(model.opt.timestep))):
        mujoco.mj_step(model, data)
    # Training frame zero has the cube resting on the table while the arm state
    # is exactly the recorded reset vector. Reapply that vector after settling
    # and clear arm velocity without moving the cube back to its authored height.
    reset_controlled_state(model, data, actuator_ids, state)
    for actuator_id in actuator_ids:
        joint_id = int(model.actuator_trnid[actuator_id, 0])
        data.qvel[int(model.jnt_dofadr[joint_id])] = 0.0
    mujoco.mj_forward(model, data)


def select_device(torch: Any, requested: str) -> str:
    if requested != "auto":
        if requested == "mps" and not torch.backends.mps.is_available():
            raise ValueError("MPS was requested but is unavailable")
        return requested
    return "mps" if torch.backends.mps.is_available() else "cpu"


def make_observation(torch: Any, state: Sequence[float], frames: Mapping[str, Any]) -> dict[str, Any]:
    if len(state) != 16:
        raise ValueError("observation state must contain 16 values")
    expected = {camera.observation_key for camera in CAMERAS}
    if set(frames) != expected:
        missing = sorted(expected - set(frames))
        extra = sorted(set(frames) - expected)
        raise ValueError(f"camera frame mismatch; missing={missing}, extra={extra}")
    observation = {"observation.state": torch.tensor(state, dtype=torch.float32)}
    for camera in CAMERAS:
        frame = frames[camera.observation_key]
        if tuple(frame.shape) != (camera.height, camera.width, 3):
            raise ValueError(
                f"{camera.observation_key} must be {(camera.height, camera.width, 3)}, got {tuple(frame.shape)}"
            )
        observation[camera.observation_key] = (
            torch.from_numpy(frame.copy()).permute(2, 0, 1).to(dtype=torch.float32) / 255.0
        )
    return observation


def write_result(path: Path, result: EpisodeResult) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(asdict(result), indent=2) + "\n")
    temporary.replace(path)


def write_trajectory(path: Path, scene: Path, frames: list[dict]) -> Path:
    trajectory_path = path.with_name(f"{path.stem}.trajectory.json")
    temporary = trajectory_path.with_suffix(trajectory_path.suffix + ".tmp")
    payload = {"version": 1, "scene": scene.as_posix().split("/v2/")[-1], "frames": frames}
    temporary.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    temporary.replace(trajectory_path)
    return trajectory_path


def run_episode(
    scene: Path,
    output: Path,
    checkpoint: str,
    revision: str | None,
    device_request: str,
    seconds: float,
    max_step: float,
    lift_meters: float,
    hold_steps: int,
    right_tool_z_correction_m: float,
    settle_seconds: float,
) -> EpisodeResult:
    import mujoco
    import numpy as np
    import torch
    from lerobot.policies.act.modeling_act import ACTPolicy
    from lerobot.policies.factory import make_pre_post_processors

    device = select_device(torch, device_request)
    model = mujoco.MjModel.from_xml_path(str(scene))
    data = mujoco.MjData(model)
    correction_data = mujoco.MjData(model)
    home_id = int(mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_KEY, "home"))
    if home_id < 0:
        raise ValueError("MuJoCo model is missing the home keyframe")
    mujoco.mj_resetDataKeyframe(model, data, home_id)
    mujoco.mj_forward(model, data)

    actuator_ids = resolve_named_ids(mujoco, model, mujoco.mjtObj.mjOBJ_ACTUATOR, ACTUATORS)
    resolve_named_ids(mujoco, model, mujoco.mjtObj.mjOBJ_CAMERA, (camera.mujoco_name for camera in CAMERAS))
    cube_id = resolve_named_ids(mujoco, model, mujoco.mjtObj.mjOBJ_BODY, ("orange_cube",))[0]
    site_ids = resolve_named_ids(mujoco, model, mujoco.mjtObj.mjOBJ_SITE, ("left_ee_control_point", "right_ee_control_point"))
    finger_body_ids = resolve_named_ids(mujoco, model, mujoco.mjtObj.mjOBJ_BODY, (
        "openarm_left_ee_inner_finger", "openarm_left_ee_outer_finger",
        "openarm_right_ee_inner_finger", "openarm_right_ee_outer_finger",
    ))
    gripper_geom_ids = {
        geom_id
        for body_id in finger_body_ids
        for geom_id in range(int(model.body_geomadr[body_id]), int(model.body_geomadr[body_id] + model.body_geomnum[body_id]))
    }
    settle_policy_scene(
        mujoco, model, data, actuator_ids, TRAINING_RESET_STATE, settle_seconds
    )
    initial_cube_z = float(data.xpos[cube_id, 2])
    detector = LiftSuccessDetector(initial_cube_z, lift_meters, hold_steps)

    policy = ACTPolicy.from_pretrained(checkpoint, revision=revision)
    policy.config.device = device
    policy.to(device)
    policy.eval()
    policy.reset()
    preprocessor, postprocessor = make_pre_post_processors(
        policy.config,
        pretrained_path=checkpoint,
        preprocessor_overrides={"device_processor": {"device": device}},
    )

    renderers = {
        camera.observation_key: mujoco.Renderer(model, height=camera.height, width=camera.width)
        for camera in CAMERAS
    }
    sim_steps_per_action = max(1, round((1.0 / POLICY_HZ) / float(model.opt.timestep)))
    max_actions = max(1, round(seconds * POLICY_HZ))
    prior = state_from_mujoco(model, data, actuator_ids)
    reset_state = list(prior)
    started = time.monotonic()
    success = False
    steps = 0
    initial_diagnostics = episode_diagnostics(
        mujoco, model, data, cube_id, finger_body_ids, gripper_geom_ids, prior
    )
    min_distances = [initial_diagnostics["left_tool_distance_m"], initial_diagnostics["right_tool_distance_m"]]
    closest_side = "left" if min_distances[0] <= min_distances[1] else "right"
    closest_diagnostics = dict(initial_diagnostics)
    closest_distance = min(min_distances)
    max_cube_contacts = int(initial_diagnostics["cube_gripper_contacts"])
    trajectory = [{"step": 0, "time": float(data.time), "qpos": list(map(float, data.qpos)), "diagnostics": initial_diagnostics}]
    try:
        for steps in range(1, max_actions + 1):
            frames = {}
            for camera in CAMERAS:
                renderer = renderers[camera.observation_key]
                renderer.update_scene(data, camera=camera.mujoco_name)
                frames[camera.observation_key] = np.asarray(renderer.render())
            observation = make_observation(torch, prior, frames)
            processed = preprocessor(observation)
            with torch.inference_mode():
                action_tensor = postprocessor(policy.select_action(processed))
            proposed = action_tensor.detach().to("cpu").reshape(-1).tolist()
            corrected = apply_right_tool_z_correction(
                mujoco, np, model, data, correction_data, actuator_ids, proposed,
                site_ids[1], right_tool_z_correction_m,
            )
            safe = clamp_action(model, actuator_ids, corrected, prior, max_step)
            write_action(data, actuator_ids, safe)
            for _ in range(sim_steps_per_action):
                mujoco.mj_step(model, data)
            prior = state_from_mujoco(model, data, actuator_ids)
            diagnostics = episode_diagnostics(
                mujoco, model, data, cube_id, finger_body_ids, gripper_geom_ids, prior
            )
            min_distances[0] = min(min_distances[0], diagnostics["left_tool_distance_m"])
            min_distances[1] = min(min_distances[1], diagnostics["right_tool_distance_m"])
            frame_side = "left" if diagnostics["left_tool_distance_m"] <= diagnostics["right_tool_distance_m"] else "right"
            frame_distance = min(diagnostics["left_tool_distance_m"], diagnostics["right_tool_distance_m"])
            if frame_distance < closest_distance:
                closest_side = frame_side
                closest_distance = frame_distance
                closest_diagnostics = dict(diagnostics)
            max_cube_contacts = max(max_cube_contacts, int(diagnostics["cube_gripper_contacts"]))
            if steps == 1 or steps % round(POLICY_HZ) == 0 or success:
                diagnostics["camera_thumbnails"] = camera_thumbnails(frames)
            trajectory.append({"step": steps, "time": float(data.time), "qpos": list(map(float, data.qpos)), "diagnostics": diagnostics})
            success = detector.update(float(data.xpos[cube_id, 2]))
            print(json.dumps({
                    "kind": "trajectory_frame",
                    "step": steps,
                    "sim_seconds": round(float(data.time), 3),
                    "cube_z": round(float(data.xpos[cube_id, 2]), 4),
                    "peak_cube_z": round(detector.peak_z, 4),
                    "qpos": trajectory[-1]["qpos"],
                    "diagnostics": diagnostics,
                    "max_abs_joint_change": round(
                        max(abs(value - start) for value, start in zip(prior, reset_state)), 4
                    ),
                    "success": success,
                }, separators=(",", ":")), flush=True)
            if success:
                break
    finally:
        for renderer in renderers.values():
            renderer.close()

    result = EpisodeResult(
        checkpoint=checkpoint,
        checkpoint_revision=revision or "default",
        scene=str(scene),
        device=device,
        success=success,
        reason="cube_lifted_and_held" if success else "timeout_before_cube_lift",
        steps=steps,
        sim_seconds=float(data.time),
        wall_seconds=time.monotonic() - started,
        initial_cube_z=initial_cube_z,
        peak_cube_z=detector.peak_z,
        success_threshold_z=detector.threshold_z,
        max_abs_joint_change=max(abs(value - start) for value, start in zip(prior, reset_state)),
        min_left_tool_distance_m=min_distances[0],
        min_right_tool_distance_m=min_distances[1],
        max_cube_contacts=max_cube_contacts,
        closest_tool_side=closest_side,
        closest_tool_distance_m=closest_distance,
        closest_tool_vertical_offset_m=(
            closest_diagnostics[f"{closest_side}_tool_xyz_m"][2] - closest_diagnostics["cube_xyz_m"][2]
        ),
        closest_cube_xyz_m=closest_diagnostics["cube_xyz_m"],
        closest_tool_xyz_m=closest_diagnostics[f"{closest_side}_tool_xyz_m"],
        right_tool_z_correction_m=right_tool_z_correction_m,
        settle_seconds=settle_seconds,
    )
    write_trajectory(output, scene, trajectory)
    write_result(output, result)
    return result


def main() -> None:
    default_scene = Path(__file__).parent / "v2" / "cell" / "demo.xml"
    default_output = Path(__file__).parent / "runs" / "lerobot-latest.json"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scene", type=Path, default=default_scene)
    parser.add_argument("--output", type=Path, default=default_output)
    parser.add_argument("--checkpoint", default=CHECKPOINT)
    parser.add_argument("--revision", default=CHECKPOINT_REVISION)
    parser.add_argument("--device", choices=("auto", "cpu", "mps"), default="auto")
    parser.add_argument("--seconds", type=float, default=20.0)
    parser.add_argument(
        "--max-step", type=float, default=0.0,
        help="optional per-action joint delta limit; 0 preserves the checkpoint output",
    )
    parser.add_argument("--lift-meters", type=float, default=0.06)
    parser.add_argument("--hold-steps", type=int, default=8)
    parser.add_argument(
        "--right-tool-z-correction-m", type=float, default=0.0,
        help="optional simulation-only diagnostic correction; default preserves checkpoint actions",
    )
    parser.add_argument(
        "--settle-seconds", type=float, default=0.5,
        help="settle free objects before restoring the exact training reset state",
    )
    args = parser.parse_args()
    if not args.scene.is_file():
        parser.error(f"scene does not exist: {args.scene}")
    if args.seconds <= 0 or args.max_step < 0 or args.settle_seconds < 0:
        parser.error("seconds must be positive; max-step and settle-seconds must be non-negative")
    result = run_episode(
        args.scene.resolve(),
        args.output.resolve(),
        args.checkpoint,
        args.revision or None,
        args.device,
        args.seconds,
        args.max_step,
        args.lift_meters,
        args.hold_steps,
        args.right_tool_z_correction_m,
        args.settle_seconds,
    )
    print(json.dumps(asdict(result), indent=2))
    raise SystemExit(0 if result.success else 2)


if __name__ == "__main__":
    main()
